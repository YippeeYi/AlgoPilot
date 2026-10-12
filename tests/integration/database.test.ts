// 真正的 PostgreSQL WASM 引擎执行迁移/RLS；auth.uid 是测试 JWT 上下文替身，不是托管 Supabase。
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
type FunctionMetadata = { name: string; source: string; owner: number; acl: unknown; settings: unknown; security: boolean };
let beforeConflicts: FunctionMetadata[];
const functionMetadata = `select oid::regprocedure::text as name, prosrc as source, proowner as owner, proacl as acl, proconfig as settings, prosecdef as security from pg_proc where pronamespace='public'::regnamespace and prosrc like '%errcode%' order by oid`;
const user = "10000000-0000-4000-8000-000000000009";

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  for (const name of [
    "202610110001_m1_training.sql",
    "202610110002_m2_tutor.sql",
    "202610110003_gemini_usage.sql",
    "202610120004_business_conflicts.sql",
  ]) {
    if (name === "202610120004_business_conflicts.sql")
      beforeConflicts = (await db.query<FunctionMetadata>(functionMetadata)).rows;
    await db.exec(await readFile(resolve(`supabase/migrations/${name}`), "utf8"));
  }
  await db.query(
    "insert into auth.users values ($1, 'extra@example.invalid')",
    [user],
  );
}, 30_000);
afterAll(async () => {
  await db?.close();
});

async function asUser<T>(operation: (tx: PGlite) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
      user,
    ]);
    return operation(tx as unknown as PGlite);
  });
}
async function newSession() {
  return asUser(
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          "select id from public.create_training_session(null, '', 'practice', gen_random_uuid())",
        )
      ).rows[0]!.id,
  );
}

describe("真实 SQL/RLS（本地 PostgreSQL，非 Supabase 集成）", () => {
  it("增量迁移只改变业务冲突 SQLSTATE，函数体、ACL、owner 和安全配置保持一致", async () => {
    const after = (await db.query<FunctionMetadata>(functionMetadata)).rows;
    expect(after).toEqual(beforeConflicts.map((f) => ({
      ...f, source: f.source.replace(/errcode\s*=\s*'40001'/g, "errcode = 'PT409'"),
    })));
    expect(after.filter((f) => f.source.includes("PT409"))).toHaveLength(7);
  });
  it("执行完整双用户、匿名、私有题面、不可变字段、RPC 权限和计时 SQL 测试", async () => {
    await db.exec(await readFile(resolve("supabase/tests/m1_rls.sql"), "utf8"));
    const result = await db.query<{ count: number }>(
      "select count(*)::int as count from public.training_sessions",
    );
    expect(result.rows[0]?.count).toBe(0);
  }, 20_000);
  it.each(["thought", "code"])("%s CAS 成功、幂等重试、过期 PT409 且不覆盖", async (kind) => {
    const id = await newSession();
    const save = (content: string, revision: number) => asUser((tx) => tx.query(
      "select public.save_training_draft($1,$2,$3,$4)", [id, kind, content, revision],
    ));
    await save("newer draft", 0);
    await save("newer draft", 0);
    await expect(save("stale request", 0)).rejects.toMatchObject({code: "PT409"});
    const row = (await asUser((tx) => tx.query<Record<string, unknown>>(
      "select code_draft,code_revision,thought_draft,thought_revision from public.training_sessions where id=$1", [id],
    ))).rows[0]!;
    expect(row[`${kind}_draft`]).toBe("newer draft");
    expect(row[`${kind}_revision`]).toBe(1);
  });
  it("竞争追加只接受一个同 revision 请求，重试后历史版本仍连续", async () => {
    const id = await newSession();
    const append = (content: string, revision: number) =>
      asUser((tx) =>
        tx.query<{ result: { thought: { version: number } } }>(
          "select public.append_training_thought($1, $2, $3, gen_random_uuid()) as result",
          [id, content, revision],
        ),
      );
    const results = await Promise.allSettled([
      append("first", 0),
      append("other", 0),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (await append("retry using current revision", 1)).rows[0]?.result.thought
        .version,
    ).toBe(2);
    expect(
      (
        await asUser((tx) =>
          tx.query(
            "select version from public.thought_snapshots where session_id = $1 order by version",
            [id],
          ),
        )
      ).rows,
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });
  it("竞争恢复不重置 resumed_at 或重复增加状态 revision", async () => {
    const id = await newSession();
    await asUser((tx) =>
      tx.query(
        "select public.transition_training_session($1, 'pause', 0, null)",
        [id],
      ),
    );
    const resume = () =>
      asUser((tx) =>
        tx.query<{ resumed_at: Date; state_revision: number }>(
          "select resumed_at, state_revision from public.transition_training_session($1, 'resume', 1, null)",
          [id],
        ),
      );
    const [one, two] = await Promise.all([resume(), resume()]);
    expect(one.rows[0]?.resumed_at).toEqual(two.rows[0]?.resumed_at);
    expect(one.rows[0]?.state_revision).toBe(2);
    expect(two.rows[0]?.state_revision).toBe(2);
  });
  it("无 uid 的 authenticated 角色不能调用可信写入", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(
          "set local role authenticated; select set_config('request.jwt.claim.sub', '', true)",
        );
        await tx.query(
          "select public.create_training_session(null, '', 'practice', gen_random_uuid())",
        );
      }),
    ).rejects.toMatchObject({ code: "28000" });
  });
});
