// Serial PGlite compatibility checks. These are explicitly NOT native/multi-backend tests.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { sqlGenerationRepositories } from "../fixtures/generation-sql";
import { readTutorConfig } from "@/server/tutor/config";
import { runTutor } from "@/server/tutor/orchestrator";
import { runReview } from "@/server/review/orchestrator";
import { MockProvider, OpenAICompatibleProvider, type LLMProvider } from "@/server/tutor/provider";
import { type GenerationPolicy } from "@/server/llm/execution-gate";
const q = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const secret = "bc".repeat(32), confirmation = "我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘";
const config = readTutorConfig({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "https://fixture.invalid/v1", LLM_MODEL: "fixture-native",
  LLM_API_KEY: "fixture-not-real-native", TUTOR_RPC_SIGNING_SECRET: secret, LLM_DAILY_REQUEST_LIMIT: "100" })!;
const analysis = { summary: "合成静态分析", correctness: "未运行代码。", assumptions: "输入前提未验证。", timeComplexity: "O(1)", spaceComplexity: "O(1)",
  lineAnalysis: [{ start: 1, end: 1, analysis: "入口。" }], risks: "需检查边界。", improvements: "命名改进。", alternatives: "", transferableKnowledge: "前提检查", revisionQuestions: ["输入前提是什么？"], answer: "" };
let db: PGlite, alice: string, problem: string;
let migratedHistory: unknown, originalHistory: unknown;
async function read<T = unknown>(sql: string) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated"); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [alice]);
    const result = await tx.query<Record<string, T>>(sql);
    if (result.rows.length !== 1) throw Error("Expected one SQL value");
    return Object.values(result.rows[0]!)[0]!;
  });
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("create role anon;create role authenticated nosuperuser nobypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;");
  const migrations = (await readdir("supabase/migrations")).filter(f => /^\d{12}_.+\.sql$/.test(f) && f.slice(0,12) <= "202610270012").sort(); expect(migrations).toHaveLength(12);
  for (const file of migrations) {
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    if (file.startsWith("202610120005")) {
      alice = randomUUID(); await db.query("insert into auth.users values($1,'legacy@fixture.invalid')", [alice]);
      const id = await read<string>(`select to_json(id) from public.create_training_session(null,'legacy synthetic statement','practice',${q(randomUUID())})`);
      await read(`select to_jsonb(public.save_training_draft(${q(id)},'code','legacy synthetic draft',0))`);
      originalHistory = (await db.query("select to_jsonb(s) from public.training_sessions s")).rows;
    }
  }
  migratedHistory = (await db.query("select to_jsonb(s) from public.training_sessions s")).rows;
  await db.query("insert into algopilot_private.tutor_settings(signing_secret) values($1)", [secret]); problem = randomUUID();
  await db.query("insert into public.problems(id,platform,contest_id,problem_index,title,rating,tags,canonical_url,metadata_synced_at) values($1,'codeforces',999999,'A','[SYNTHETIC] fixture',1200,'{}','https://codeforces.com/problemset/problem/999999/A',clock_timestamp())", [problem]);
}, 30000);
beforeEach(async () => { alice = randomUUID(); await db.query("insert into auth.users values($1,'a@fixture.invalid')", [alice]); });
afterAll(async () => { await db?.close(); });
it("applies actual 001–012 in order without rewriting legacy training/draft data (serial WASM only)", () => {
  expect(migratedHistory).toEqual(originalHistory);
});
type Kind = "tutor" | "review";
async function context(kind: Kind) {
  let id = await read<string>(`select to_json(id) from public.start_cf_session(${q(JSON.stringify({ problemId: problem, requestId: randomUUID(), statementSnapshot: "合成题面：输入一个整数，输出它本身。", mode: "practice", timerEnabled: false }))}::jsonb)`);
  if (kind === "review") id = await read<string>(`select to_json(public.create_code_review(${q(JSON.stringify({ sessionId: id, requestId: randomUUID(), code: "int main() { return 0; }", source: "paste", fileName: null, problemUrl: "", statement: "", submissionId: null, confirmation }))}::jsonb))`);
  const repo = sqlGenerationRepositories(read, alice, secret);
  const input = kind === "tutor" ? { action: "chat" as const, message: "合成问题", requestId: randomUUID() } : { question: "合成问题", requestId: randomUUID() };
  const run = (provider: LLMProvider, requestId = input.requestId) => kind === "tutor" ? runTutor(repo.tutor, config, id, { ...input, requestId } as Parameters<typeof runTutor>[3], undefined, provider) : runReview(repo.review, config, id, { ...input, requestId } as Parameters<typeof runReview>[3], undefined, provider);
  const snapshot = async () => (await db.query(`select to_jsonb(r) v from public.${kind}_requests r where ${kind === "tutor" ? "session_id" : "review_id"}=$1 order by created_at,id`, [id])).rows;
  const mock = () => new MockProvider({ text: kind === "tutor" ? JSON.stringify({ disclosureLevel: 0, content: "", focus: "premise", quote: "" }) : JSON.stringify(analysis), usage: [] });
  const payload = { operation: kind === "tutor" ? "reserve" : "review_reserve", [kind === "tutor" ? "sessionId" : "reviewId"]: id, ...input, fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"), dailyLimit: 100 };
  return { id, repo, input, run, snapshot, mock, payload };
}
describe.each<Kind>(["tutor", "review"])("%s + full migrations + serial SQL gate state", kind => {
  it("denied new intent consumes no admission; completed replay still works and preserves immutable history", async () => {
    const x = await context(kind), fetcher = vi.fn<typeof fetch>(), denied = new OpenAICompatibleProvider(config, fetcher);
    await expect(x.run(denied)).rejects.toMatchObject({ code: "LLM_FREE_TIER_UNVERIFIED" }); expect(await x.snapshot()).toEqual([]);
    const mock = x.mock(); const initial = await x.run(mock); expect(initial.cached).toBe(false);
    const committed = await x.snapshot(); expect((await x.run(denied)).cached).toBe(true);
    expect(await x.snapshot()).toEqual(committed); expect(mock.calls).toHaveLength(1); expect(fetcher).not.toHaveBeenCalled();
    await expect(x.run(denied, randomUUID())).rejects.toMatchObject({ code: "LLM_FREE_TIER_UNVERIFIED" }); expect(await x.snapshot()).toEqual(committed);
  });
  it("valid pending is busy; expired same ID terminates without dispatch; explicit Mock intent alone can admit replacement", async () => {
    const x = await context(kind), repo = kind === "tutor" ? x.repo.tutor : x.repo.review, fetcher = vi.fn<typeof fetch>(), denied = new OpenAICompatibleProvider(config, fetcher);
    const reserved = await repo.reserve(x.payload, secret);
    await expect(x.run(denied)).rejects.toMatchObject({ code: "AP004" });
    await db.query(`update public.${kind}_requests set lease_until=clock_timestamp()-interval '1 second' where id=$1`, [x.input.requestId]);
    await expect(x.run(denied)).rejects.toMatchObject({ code: "AP006" }); await expect(x.run(denied)).rejects.toMatchObject({ code: "AP006" });
    expect(await x.snapshot()).toHaveLength(1); await expect(x.run(denied, randomUUID())).rejects.toMatchObject({ code: "LLM_FREE_TIER_UNVERIFIED" });
    const mock = x.mock(), nextId = randomUUID(); expect((await x.run(mock, nextId)).cached).toBe(false);
    const beforeLate = await x.snapshot();
    const late = { operation: kind === "tutor" ? "finish" : "review_finish", [kind === "tutor" ? "sessionId" : "reviewId"]: x.id, requestId: x.input.requestId, leaseNonce: reserved.leaseNonce, success: true, usage: [], content: "late result", disclosureLevel: 0, verification: "not_applicable", analysis, model: "fixture", promptVersion: "fixture/test", thoughtRevision: 0, codeRevision: 0 };
    expect(await repo.finish(late, secret)).toEqual({ accepted: false }); expect(await x.snapshot()).toEqual(beforeLate);
    expect(fetcher).not.toHaveBeenCalled(); expect(mock.calls).toHaveLength(1);
  });
  it("revocation immediately after SQL admission fails settlement without a Provider dispatch", async () => {
    const x = await context(kind), repo = kind === "tutor" ? x.repo.tutor : x.repo.review;
    let permitted = true, dispatches = 0;
    const policy: GenerationPolicy = { check: () => permitted ? { allowed: true, mode: "offline-mock" } : { allowed: false, code: "LLM_EXECUTION_UNAUTHORIZED" } };
    const provider = new OpenAICompatibleProvider(config, async () => { dispatches++; throw Error("must not dispatch"); }, undefined, undefined, policy);
    const original = repo.reserve.bind(repo); repo.reserve = async (p, s) => { const r = await original(p, s); permitted = false; return r; };
    await expect(x.run(provider)).rejects.toMatchObject({ code: "LLM_EXECUTION_UNAUTHORIZED" }); expect(dispatches).toBe(0);
    expect(await x.snapshot()).toMatchObject([{ v: { status: "failed" } }]); await expect(x.run(provider)).rejects.toMatchObject({ code: "AP006" });
    if (kind === "review") expect((await db.query<{ usage: unknown[] }>("select usage from public.review_requests where id=$1", [x.input.requestId])).rows[0]!.usage).toEqual([]);
    else expect((await db.query("select request_id from public.llm_usage where request_id=$1", [x.input.requestId])).rows).toEqual([]);
  });
  it.each([429, 503])("qualification revokes after synthetic HTTP %s; retry denied and actual failed usage retained", async status => {
    const x = await context(kind); let permitted = true, dispatches = 0;
    const policy: GenerationPolicy = { check: () => permitted ? { allowed: true, mode: "offline-mock" } : { allowed: false, code: "LLM_EXECUTION_UNAUTHORIZED" } };
    const provider = new OpenAICompatibleProvider(config, async () => { dispatches++; permitted = false; return new Response("synthetic unavailable", { status }); }, undefined, async () => {}, policy);
    await expect(x.run(provider)).rejects.toMatchObject({ code: "LLM_EXECUTION_UNAUTHORIZED" }); expect(dispatches).toBe(1);
    expect(await x.snapshot()).toMatchObject([{ v: { status: "failed" } }]);
    const usage = kind === "review" ? (await db.query<{ usage: unknown[] }>("select usage from public.review_requests where id=$1", [x.input.requestId])).rows[0]!.usage : (await db.query("select model,input_tokens,output_tokens,total_tokens,cost_usd,status from public.llm_usage where request_id=$1", [x.input.requestId])).rows;
    expect(usage).toHaveLength(1); expect(JSON.stringify(usage)).not.toContain("fixture-not-real-native");
    if (kind === "review") expect(usage[0]).toMatchObject({ attempt: 1, model: config.model, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, status: "error" });
    else expect(usage[0]).toEqual({ model: config.model, input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null, status: "error" });
    await expect(x.run(provider)).rejects.toMatchObject({ code: "AP006" }); expect(dispatches).toBe(1);
  });
});
it("012 refuses an unexpected function definition atomically, then original restore + exact patch succeeds", async () => {
  const original = (await db.query<{ definition: string }>("select pg_get_functiondef('public.tutor_reserve(text,text)'::regprocedure) definition")).rows[0]!.definition;
  await db.exec(original.replace("request failed; use new request id", "synthetic unexpected clause"));
  const before = (await db.query("select pg_get_functiondef('public.tutor_reserve(text,text)'::regprocedure),proacl from pg_proc where oid='public.tutor_reserve(text,text)'::regprocedure")).rows;
  await expect(db.exec(await readFile("supabase/migrations/202610270012_tutor_retry_recovery.sql", "utf8"))).rejects.toMatchObject({ code: "23514" }); await db.exec("rollback");
  expect((await db.query("select pg_get_functiondef('public.tutor_reserve(text,text)'::regprocedure),proacl from pg_proc where oid='public.tutor_reserve(text,text)'::regprocedure")).rows).toEqual(before);
  await db.exec(original); await db.exec(await readFile("supabase/migrations/202610270012_tutor_retry_recovery.sql", "utf8"));
  expect((await db.query<{ definition: string }>("select pg_get_functiondef('public.tutor_reserve(text,text)'::regprocedure) definition")).rows[0]!.definition).toBe(original);
});
