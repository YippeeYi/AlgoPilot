// Actual local PostgreSQL + pgcrypto. auth.uid() is a JWT-context fixture, not hosted Supabase.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { signTutorPayload } from "@/server/tutor/repository";
let db: PGlite;
const alice = "10000000-0000-4000-8000-000000000011";
const bob = "10000000-0000-4000-8000-000000000012";
const secret = "ab".repeat(32);
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  for (const name of [
    "202610110001_m1_training.sql",
    "202610110002_m2_tutor.sql",
    "202610110003_gemini_usage.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.query(
    "insert into algopilot_private.tutor_settings(signing_secret) values($1)",
    [secret],
  );
  await db.query(
    "insert into auth.users values ($1,'alice@sql.invalid'),($2,'bob@sql.invalid')",
    [alice, bob],
  );
}, 30_000);
afterAll(async () => {
  await db?.close();
});
function asUser<T>(userId: string, operation: (tx: PGlite) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userId,
    ]);
    return operation(tx as unknown as PGlite);
  });
}
async function session(mode = "practice", uid = alice) {
  return (
    await asUser(uid, (tx) =>
      tx.query<{ id: string }>(
        "select id from public.create_training_session(null,'private statement',$1,gen_random_uuid())",
        [mode],
      ),
    )
  ).rows[0]!.id;
}
async function signed(
  operation: string,
  payload: Record<string, unknown>,
  uid = alice,
) {
  const p = signTutorPayload({ operation, ...payload }, uid, secret);
  return asUser(uid, (tx) =>
    tx.query<{ result: Record<string, unknown> }>(
      `select public.tutor_${operation}($1,$2) as result`,
      [p.p_payload, p.p_signature],
    ),
  );
}
const reserve = (
  id: string,
  requestId: string = randomUUID(),
  dailyLimit = 100,
  action = "chat",
) =>
  signed("reserve", {
    sessionId: id,
    requestId,
    fingerprint: "c".repeat(64),
    dailyLimit,
    action,
  });
async function finish(
  id: string,
  requestId: string,
  leaseNonce: unknown,
  disclosureLevel = 0,
  success = true,
) {
  return signed("finish", {
    sessionId: id,
    requestId,
    leaseNonce,
    success,
    disclosureLevel,
    userMessage: "我的已有思路",
    content: "能说明这一步的依据吗？",
    promptVersion: "test/mock",
    thoughtRevision: 0,
    codeRevision: 0,
    usage: [
      {
        attempt: 1,
        model: "fixture-model",
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        durationMs: 10,
        status: "success",
        costUsd: null,
      },
    ],
  });
}
async function upgrade(
  id: string,
  revision: number,
  operation = "upgrade",
  requestId = randomUUID(),
  challenge: string | null = null,
  uid = alice,
) {
  return asUser(uid, (tx) =>
    tx.query<{
      result: { allowedLevel: number; revision: number; challengeId: string };
    }>("select public.tutor_hint($1,$2,$3,$4,$5) as result", [
      id,
      operation,
      revision,
      requestId,
      challenge,
    ]),
  );
}
async function state(id: string, uid = alice) {
  return (
    await asUser(uid, (tx) =>
      tx.query<{
        result: { allowedLevel: number; maxSeenLevel: number; used: number };
      }>("select public.tutor_state($1) as result", [id]),
    )
  ).rows[0]!.result;
}
describe("M2 实际 SQL/RLS 和事务边界（本地 PostgreSQL）", () => {
  it("Gemini 9/62/710 is persisted exactly through signed finish; extra 639 is unclassified and owner-isolated", async () => {
    const id = await session();
    const requestId = randomUUID();
    const admitted = (await reserve(id, requestId)).rows[0]!.result;
    const result = await signed("finish", {
      sessionId: id,
      requestId,
      leaseNonce: admitted.leaseNonce,
      success: true,
      disclosureLevel: 0,
      userMessage: "已有思路",
      content: "能说明这一步的依据吗？",
      promptVersion: "2.0.0",
      thoughtRevision: 0,
      codeRevision: 0,
      usage: [
        {
          attempt: 1,
          model: "gemini-3.8-flash",
          inputTokens: 9,
          outputTokens: 62,
          totalTokens: 710,
          durationMs: 100,
          status: "success",
          costUsd: null,
        },
      ],
    });
    expect(result.rows[0]!.result.accepted).toBe(true);
    const select =
      "select input_tokens,output_tokens,total_tokens,unclassified_tokens,cost_usd from public.llm_usage where request_id=$1";
    expect(
      (await asUser(alice, (tx) => tx.query(select, [requestId]))).rows,
    ).toEqual([
      {
        input_tokens: 9,
        output_tokens: 62,
        total_tokens: 710,
        unclassified_tokens: 639,
        cost_usd: null,
      },
    ]);
    expect(
      (await asUser(bob, (tx) => tx.query(select, [requestId]))).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(alice, (tx) =>
          tx.query(
            "select role,disclosure_level from public.tutor_messages where request_id=$1 order by ordinal",
            [requestId],
          ),
        )
      ).rows,
    ).toEqual([
      { role: "user", disclosure_level: 0 },
      { role: "assistant", disclosure_level: 0 },
    ]);
    await expect(
      asUser(alice, (tx) =>
        tx.query(
          "update public.llm_usage set total_tokens=1 where request_id=$1",
          [requestId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("usage constraints reject contradictory/partial/negative/huge counts even in trusted SQL", async () => {
    const id = await session();
    const requestId = randomUUID();
    const admitted = (await reserve(id, requestId)).rows[0]!.result;
    for (const counts of [
      [9, 62, 70],
      [null, 62, 710],
      [9, 62, null],
      [-1, 62, 710],
      [9, 62, 100000001],
    ]) {
      await expect(
        db.query(
          `insert into public.llm_usage(request_id,attempt,provider,model,input_tokens,output_tokens,total_tokens,duration_ms,status)
        values($1,1,'openai-compatible','fixture',$2,$3,$4,0,'error')`,
          [requestId, ...counts],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await db.query(
      `insert into public.llm_usage(request_id,attempt,provider,model,duration_ms,status)
      values($1,1,'openai-compatible','fixture',0,'timeout')`,
      [requestId],
    );
    expect(
      (
        await db.query(
          "select total_tokens,unclassified_tokens from public.llm_usage where request_id=$1",
          [requestId],
        )
      ).rows,
    ).toEqual([{ total_tokens: null, unclassified_tokens: null }]);
    await expect(
      db.query(
        "update public.llm_usage set unclassified_tokens=1 where request_id=$1",
        [requestId],
      ),
    ).rejects.toMatchObject({ code: "428C9" });
    await signed("finish", {
      sessionId: id,
      requestId,
      leaseNonce: admitted.leaseNonce,
      success: false,
      errorCode: "FIXTURE_TIMEOUT",
      usage: [],
    });
  });
  it("可独立运行的匿名/双用户 RLS 脚本", async () => {
    await db.exec(await readFile("supabase/tests/m2_rls.sql", "utf8"));
  });
  it("不能绕过服务端签名伪造 assistant、事件或 usage，私有签名和租约不可读", async () => {
    for (const table of [
      "tutor_messages",
      "hint_events",
      "llm_usage",
      "tutor_authorizations",
    ]) {
      await expect(
        asUser(alice, (tx) =>
          tx.exec(`insert into public.${table} default values`),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        asUser(alice, (tx) => tx.exec(`delete from public.${table}`)),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      asUser(alice, (tx) =>
        tx.exec("select * from algopilot_private.tutor_settings"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(alice, (tx) =>
        tx.exec("select lease_nonce from public.tutor_requests"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(alice, (tx) =>
        tx.query("select public.tutor_reserve($1,'forged')", ["{}"]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("L0-L5 授权不虚增已查看等级，二次确认绑定请求且防重放", async () => {
    const id = await session();
    expect((await state(id)).maxSeenLevel).toBe(0);
    for (let level = 1; level <= 4; level++) {
      const r = await upgrade(id, level - 1);
      expect(r.rows[0]!.result.allowedLevel).toBe(level);
      expect((await state(id)).maxSeenLevel).toBe(0);
    }
    await expect(upgrade(id, 4, "confirm_l5")).rejects.toMatchObject({
      code: "AP005",
    });
    const req = randomUUID();
    const c = (await upgrade(id, 4, "begin_l5", req)).rows[0]!.result
      .challengeId;
    await expect(
      upgrade(id, 4, "confirm_l5", randomUUID(), c),
    ).rejects.toMatchObject({ code: "AP005" });
    await expect(
      upgrade(id, 4, "confirm_l5", req, c, bob),
    ).rejects.toMatchObject({ code: "P0002" });
    await upgrade(id, 4, "confirm_l5", req, c);
    await expect(upgrade(id, 5, "confirm_l5", req, c)).rejects.toMatchObject({
      code: "23514",
    });
    expect((await state(id)).maxSeenLevel).toBe(0);
    const requestId = randomUUID();
    const lease = (await reserve(id, requestId, 100, "explain")).rows[0]!
      .result;
    await finish(id, requestId, lease.leaseNonce, 5);
    expect((await state(id)).maxSeenLevel).toBe(5);
    const request2 = randomUUID();
    const lease2 = (await reserve(id, request2)).rows[0]!.result;
    await finish(id, request2, lease2.leaseNonce, 0);
    expect((await state(id)).maxSeenLevel).toBe(5);
    await expect(
      db.query(
        "update public.training_sessions set max_hint_seen=0 where id=$1",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("L5 确认过期、签名跨用户和签名过期拒绝", async () => {
    const id = await session();
    for (let i = 0; i < 4; i++) await upgrade(id, i);
    const req = randomUUID();
    const c = (await upgrade(id, 4, "begin_l5", req)).rows[0]!.result
      .challengeId;
    await db.query(
      "update algopilot_private.l5_challenges set expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [c],
    );
    await expect(upgrade(id, 4, "confirm_l5", req, c)).rejects.toMatchObject({
      code: "AP005",
    });
    const p = signTutorPayload(
      {
        operation: "reserve",
        sessionId: id,
        requestId: randomUUID(),
        action: "chat",
        fingerprint: "c".repeat(64),
        dailyLimit: 100,
      },
      alice,
      secret,
    );
    await expect(
      asUser(bob, (tx) =>
        tx.query("select public.tutor_reserve($1,$2)", [
          p.p_payload,
          p.p_signature,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("竞争请求仅一个入场，失败仍计额度，幂等重放不调用模型、不重复消息或用量", async () => {
    const id = await session();
    const req = randomUUID();
    const results = await Promise.allSettled([reserve(id, req), reserve(id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const accepted = results.find(
      (r) => r.status === "fulfilled",
    )! as PromiseFulfilledResult<Awaited<ReturnType<typeof reserve>>>;
    const row = accepted.value.rows[0]!.result;
    await finish(id, String(row.requestId), row.leaseNonce);
    const cached = await reserve(id, String(row.requestId));
    expect(cached.rows[0]!.result.cached).toBe(true);
    await finish(id, String(row.requestId), row.leaseNonce);
    const usage = await asUser(alice, (tx) =>
      tx.query(
        "select input_tokens,output_tokens from public.llm_usage where request_id=$1",
        [row.requestId],
      ),
    );
    expect(usage.rows).toEqual([{ input_tokens: 20, output_tokens: 10 }]);
    const messages = await asUser(alice, (tx) =>
      tx.query("select role from public.tutor_messages where request_id=$1", [
        row.requestId,
      ]),
    );
    expect(messages.rows).toHaveLength(2);
    const used = (await state(id)).used;
    await expect(reserve(id, randomUUID(), used)).rejects.toMatchObject({
      code: "AP003",
    });
  });
  it("比赛和完成会话拒绝模型入场；分析途中完成会话丢弃内容但保留真实用量", async () => {
    const contest = await session("contest");
    await expect(reserve(contest)).rejects.toMatchObject({ code: "AP001" });
    const id = await session();
    const req = randomUUID();
    const r = (await reserve(id, req)).rows[0]!.result;
    await asUser(alice, (tx) =>
      tx.query(
        "select public.transition_training_session($1,'finish',0,'not_recorded')",
        [id],
      ),
    );
    expect((await finish(id, req, r.leaseNonce)).rows[0]!.result.accepted).toBe(
      false,
    );
    await expect(reserve(id)).rejects.toMatchObject({ code: "AP002" });
    expect(
      (
        await asUser(alice, (tx) =>
          tx.query("select id from public.tutor_messages where session_id=$1", [
            id,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(alice, (tx) =>
          tx.query("select status from public.llm_usage where request_id=$1", [
            req,
          ]),
        )
      ).rows,
    ).toEqual([{ status: "rejected" }]);
  });
  it("私人消息和 usage 按可信会话归属隔离", async () => {
    const id = await session();
    const req = randomUUID();
    const r = (await reserve(id, req)).rows[0]!.result;
    await finish(id, req, r.leaseNonce);
    for (const table of ["tutor_messages", "hint_events", "llm_usage"])
      expect(
        (
          await asUser(bob, (tx) => tx.exec(`select * from public.${table}`))
        )[0]!.rows,
      ).toHaveLength(0);
    await expect(state(id, bob)).rejects.toMatchObject({ code: "P0002" });
  });
  it("越级披露、错误 nonce、请求变更和重放签名全部拒绝", async () => {
    const id = await session();
    const req = randomUUID();
    const lease = (await reserve(id, req)).rows[0]!.result;
    await expect(finish(id, req, randomUUID())).rejects.toMatchObject({
      code: "42501",
    });
    await expect(finish(id, req, lease.leaseNonce, 5)).rejects.toMatchObject({
      code: "42501",
    });
    const changed = {
      sessionId: id,
      requestId: req,
      fingerprint: "d".repeat(64),
      dailyLimit: 100,
      action: "chat",
    };
    await expect(signed("reserve", changed)).rejects.toMatchObject({
      code: "40001",
    });
    const expired = signTutorPayload(
      { operation: "reserve", ...changed },
      alice,
      secret,
    );
    const payload = JSON.parse(expired.p_payload);
    payload.expiresAt = new Date(Date.now() - 1000).toISOString();
    const serialized = JSON.stringify(payload);
    const { createHmac } = await import("node:crypto");
    await expect(
      asUser(alice, (tx) =>
        tx.query("select public.tutor_reserve($1,$2)", [
          serialized,
          createHmac("sha256", secret).update(serialized).digest("hex"),
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await finish(id, req, lease.leaseNonce, 0, false);
    await expect(reserve(id, req)).rejects.toMatchObject({ code: "AP006" });
  });
  it("跨会话共享单用户租约；过期请求不展示内容而可结算实际 usage", async () => {
    const one = await session();
    const two = await session();
    const req = randomUUID();
    const lease = (await reserve(one, req)).rows[0]!.result;
    await expect(reserve(two)).rejects.toMatchObject({ code: "AP004" });
    await db.query(
      "update public.tutor_requests set lease_until=clock_timestamp()-interval '1 second' where id=$1",
      [req],
    );
    const nextReq = randomUUID();
    const next = (await reserve(two, nextReq)).rows[0]!.result;
    expect(
      (await finish(one, req, lease.leaseNonce)).rows[0]!.result.accepted,
    ).toBe(false);
    expect(
      (
        await asUser(alice, (tx) =>
          tx.query("select id from public.tutor_messages where request_id=$1", [
            req,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(alice, (tx) =>
          tx.query(
            "select total_tokens,status from public.llm_usage where request_id=$1",
            [req],
          ),
        )
      ).rows,
    ).toEqual([{ total_tokens: 30, status: "rejected" }]);
    await finish(two, nextReq, next.leaseNonce, 0, false);
  });
  it("可信 context 证据不可从浏览器读取，UTC 前一日不占今日额度", async () => {
    const uid = "10000000-0000-4000-8000-000000000013";
    await db.query("insert into auth.users values($1,'utc@sql.invalid')", [
      uid,
    ]);
    const id = await session("practice", uid);
    const p = {
      sessionId: id,
      requestId: randomUUID(),
      fingerprint: "c".repeat(64),
      dailyLimit: 1,
      action: "chat",
      contextEvidence: { thought: "历史思路证据", thoughtRevision: 4 },
    };
    const lease = (await signed("reserve", p, uid)).rows[0]!.result;
    await signed(
      "finish",
      {
        sessionId: id,
        requestId: p.requestId,
        leaseNonce: lease.leaseNonce,
        success: false,
        errorCode: "TEST",
        usage: [],
      },
      uid,
    );
    await expect(
      asUser(uid, (tx) =>
        tx.exec("select context_evidence from public.tutor_requests"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await db.query<{ context_evidence: { thought: string } }>(
          "select context_evidence from public.tutor_requests where id=$1",
          [p.requestId],
        )
      ).rows[0]!.context_evidence.thought,
    ).toBe("历史思路证据");
    await db.query(
      "update public.tutor_requests set created_at=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' - interval '1 second' where id=$1",
      [p.requestId],
    );
    expect((await state(id, uid)).used).toBe(0);
    const nextId = randomUUID();
    const next = (await signed("reserve", { ...p, requestId: nextId }, uid))
      .rows[0]!.result;
    await signed(
      "finish",
      {
        sessionId: id,
        requestId: nextId,
        leaseNonce: next.leaseNonce,
        success: false,
        errorCode: "TEST",
        usage: [],
      },
      uid,
    );
  });

  it("消息 ordinal 在同时间戳下仍连续，分页不会遗漏或打乱 user/assistant", async () => {
    const id = await session();
    const requests: string[] = [];
    for (let i = 0; i < 26; i++) {
      const req = randomUUID();
      requests.push(req);
      const lease = (await reserve(id, req)).rows[0]!.result;
      await finish(id, req, lease.leaseNonce);
    }
    // Force identical timestamps to exercise ordering independent of timestamp precision.
    await db.query(
      "update public.tutor_messages set created_at='2026-01-01T00:00:00Z' where session_id=$1",
      [id],
    );
    const rows = (
      await asUser(alice, (tx) =>
        tx.query<{ ordinal: number; role: string }>(
          "select ordinal,role from public.tutor_messages where session_id=$1 order by ordinal desc limit 50",
          [id],
        ),
      )
    ).rows.reverse();
    expect(rows).toHaveLength(50);
    expect(rows[0]!.ordinal).toBe(3);
    expect(rows.at(-1)!.ordinal).toBe(52);
    expect(rows[0]!.role).toBe("user");
    expect(rows[1]!.role).toBe("assistant");
    const older = (
      await asUser(alice, (tx) =>
        tx.query<{ ordinal: number }>(
          "select ordinal from public.tutor_messages where session_id=$1 and ordinal<$2 order by ordinal desc limit 50",
          [id, rows[0]!.ordinal],
        ),
      )
    ).rows.reverse();
    expect(older).toEqual([{ ordinal: 1 }, { ordinal: 2 }]);
    expect(new Set([...older, ...rows].map((r) => r.ordinal)).size).toBe(52);
  });
});
