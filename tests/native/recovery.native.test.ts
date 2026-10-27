// Native-only. This file is deliberately excluded from the ordinary PGlite/jsdom suite.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PsqlConnection, literal as q, validateTarget, applyMigration, type NativeTarget } from "./psql";
import { signTutorPayload } from "@/server/tutor/repository";
import { sqlGenerationRepositories } from "../fixtures/generation-sql";
import { runTutor } from "@/server/tutor/orchestrator";
import { runReview } from "@/server/review/orchestrator";
import { readTutorConfig } from "@/server/tutor/config";
import { MockProvider, OpenAICompatibleProvider } from "@/server/tutor/provider";
import { GenerationGateError, type GenerationPolicy } from "@/server/llm/execution-gate";

type Kind = "tutor" | "review";
type Receipt = { kind: Kind; resource: string; requestId: string; fingerprint: string };
type Reservation = { cached: boolean; leaseNonce?: string; requestId?: string; allowedLevel?: number };
const secret = "bc".repeat(32), confirmation = "我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘";
const config = readTutorConfig({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "https://fixture.invalid/v1", LLM_MODEL: "fixture-native",
  LLM_API_KEY: "fixture-not-real-native", TUTOR_RPC_SIGNING_SECRET: secret, LLM_DAILY_REQUEST_LIMIT: "100" })!;
const analysis = { summary: "合成静态分析", correctness: "未运行代码。", assumptions: "输入前提未验证。", timeComplexity: "O(1)", spaceComplexity: "O(1)",
  lineAnalysis: [{ start: 1, end: 1, analysis: "入口。" }], risks: "需检查边界。", improvements: "命名改进。", alternatives: "", transferableKnowledge: "前提检查", revisionQuestions: ["输入前提是什么？"], answer: "" };
const tutorText = JSON.stringify({ disclosureLevel: 0, content: "", focus: "premise", quote: "" });
let target: NativeTarget, admin: PsqlConnection, a: PsqlConnection, b: PsqlConnection, c: PsqlConnection;
let alice: string, bob: string, problem: string;
const evidence: Record<string, unknown> = { lockWaits: [], backends: [], boundary: "synthetic auth.uid claims; native authenticated LOGIN; no hosted JWT verification" };
const clients: PsqlConnection[] = [];
const connection = (role: "fixture_admin" | "authenticated" = "authenticated") => { const x = new PsqlConnection(target, role); clients.push(x); return x; };
async function begin(x: PsqlConnection, uid: string) {
  await x.query("begin isolation level read committed");
  await x.query(`set local request.jwt.claim.sub=${q(uid)}`);
}
async function user<T>(x: PsqlConnection, uid: string, fn: () => Promise<T>) {
  await begin(x, uid);
  try { const v = await fn(); await x.query("commit"); return v; }
  catch (error) { await x.query("rollback"); throw error; }
}
function rpcSql(name: string, uid: string, payload: Record<string, unknown>) {
  const signed = signTutorPayload(payload, uid, secret);
  return `select public.${name}(${q(signed.p_payload)},${q(signed.p_signature)})`;
}
const signed = (x: PsqlConnection, uid: string, name: string, p: Record<string, unknown>) => user(x, uid, () => x.value<Record<string, unknown>>(rpcSql(name, uid, p)));
const reservePayload = (r: Receipt) => ({ operation: r.kind === "tutor" ? "reserve" : "review_reserve",
  [r.kind === "tutor" ? "sessionId" : "reviewId"]: r.resource, requestId: r.requestId, fingerprint: r.fingerprint, action: "chat", question: "", dailyLimit: 100 });
const reserveInTransaction = (x: PsqlConnection, uid: string, r: Receipt) => x.value<Reservation>(rpcSql(r.kind + "_reserve", uid, reservePayload(r)));
const reserve = (x: PsqlConnection, uid: string, r: Receipt) => user(x, uid, () => reserveInTransaction(x, uid, r));
async function finishSql(r: Receipt, nonce: string, success = true, text = "immutable synthetic result") {
  const payload: Record<string, unknown> = { operation: r.kind === "tutor" ? "finish" : "review_finish",
    [r.kind === "tutor" ? "sessionId" : "reviewId"]: r.resource, requestId: r.requestId, leaseNonce: nonce, success, usage: [],
    userMessage: "synthetic question", content: text, disclosureLevel: 0, verification: "not_applicable", thoughtRevision: 0, codeRevision: 0, promptVersion: "native/test",
    analysis: { ...analysis, summary: text }, model: "fixture-native" };
  if (r.kind === "review") payload.codeHash = await admin.value(`select to_json(code_hash) from public.code_reviews where id=${q(r.resource)}`);
  return payload;
}
const finish = async (x: PsqlConnection, uid: string, r: Receipt, nonce: string, success = true, text?: string) => signed(x, uid, r.kind + "_finish", await finishSql(r, nonce, success, text));
async function session(x: PsqlConnection, uid: string) {
  return user(x, uid, () => x.value<string>(`select to_json(id) from public.start_cf_session(${q(JSON.stringify({ problemId: problem, requestId: randomUUID(), statementSnapshot: "合成题面：输入一个整数，输出它本身。", mode: "practice", timerEnabled: false }))}::jsonb)`));
}
async function receipt(kind: Kind, uid = alice, x = a): Promise<Receipt> {
  let resource = await session(x, uid);
  if (kind === "review") resource = await user(x, uid, () => x.value<string>(`select to_json(public.create_code_review(${q(JSON.stringify({ sessionId: resource, requestId: randomUUID(), code: "int main() { return 0; }", source: "paste", fileName: null, problemUrl: "", statement: "", submissionId: null, confirmation }))}::jsonb))`));
  return { kind, resource, requestId: randomUUID(), fingerprint: "a".repeat(64) };
}
const row = (r: Receipt) => admin.value<{ status: string; lease_nonce: string; analysis?: unknown }>(`select to_jsonb(t) from public.${r.kind}_requests t where id=${q(r.requestId)}`);
const count = (r: Receipt) => admin.value<number>(`select to_json(count(*)) from public.${r.kind}_requests where ${r.kind === "tutor" ? "session_id" : "review_id"}=${q(r.resource)}`);
const expire = (r: Receipt) => admin.query(`update public.${r.kind}_requests set lease_until=clock_timestamp()-interval '1 second' where id=${q(r.requestId)}`);
async function waiting(x: PsqlConnection, holderPid: number) {
  const deadline = performance.now() + 1500;
  while (performance.now() < deadline) {
    const state = await admin.value<{ wait: string; blockers: number[] }>(`select json_build_object('wait',wait_event_type,'blockers',pg_blocking_pids(pid)) from pg_stat_activity where pid=${await pid(x)}`);
    if (state.wait === "Lock" && state.blockers.includes(holderPid)) { (evidence.lockWaits as unknown[]).push(state); return; }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw Error("Independent backend never observed waiting on expected holder");
}
const pids = new Map<PsqlConnection, number>();
async function pid(x: PsqlConnection) {
  let result = pids.get(x);
  if (!result) { result = await x.value<number>("select to_json(pg_backend_pid())"); pids.set(x, result); }
  return result;
}
// Attach rejection handling before waiting for the lock, preventing unhandled promises.
const outcome = <T,>(promise: PromiseLike<T>) => Promise.resolve(promise).then(value => ({ value, code: "00000" }), (error: { code?: string }) => ({ code: error.code ?? "CLIENT_CONNECTION_CLOSED", value: undefined }));

beforeAll(async () => {
  if (!process.env.M353_NATIVE_TARGET) throw Error("Use test:isolated:m353; native target absent");
  target = JSON.parse(process.env.M353_NATIVE_TARGET); validateTarget(target);
  admin = connection("fixture_admin"); a = connection(); b = connection(); c = connection();
  expect(await admin.value("select to_json(current_setting('data_directory'))")).toBe(target.directory);
  const roles = [];
  for (const x of [a, b, c]) {
    const r = await x.value<Record<string, unknown>>("select json_build_object('pid',pg_backend_pid(),'current',current_user,'session',session_user,'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,'isolation',current_setting('transaction_isolation'),'database',current_database(),'host',inet_server_addr()::text,'port',inet_server_port()) from pg_roles r where rolname=current_user");
    expect(r).toMatchObject({ current: "authenticated", session: "authenticated", superuser: false, bypassrls: false, isolation: "read committed", database: target.database, host: "127.0.0.1", port: target.port });
    pids.set(x, r.pid as number); roles.push(r);
  }
  expect(new Set(roles.map(r => r.pid)).size).toBe(3); evidence.backends = roles;
  await admin.query(`insert into algopilot_private.tutor_settings(signing_secret) values(${q(secret)})`);
  problem = randomUUID();
  await admin.query(`insert into public.problems(id,platform,contest_id,problem_index,title,rating,tags,canonical_url,metadata_synced_at) values(${q(problem)},'codeforces',999999,'A','[SYNTHETIC] Native fixture',1200,'{}','https://codeforces.com/problemset/problem/999999/A',clock_timestamp())`);
}, 30000);
beforeEach(async () => {
  alice = randomUUID(); bob = randomUUID();
  await admin.query(`insert into auth.users values(${q(alice)},'a@fixture.invalid'),(${q(bob)},'b@fixture.invalid')`);
});
afterEach(async () => { for (const x of [a, b, c]) if (x) await x.query("rollback"); });
afterAll(async () => {
  for (const x of clients) { try { await x.query("rollback"); } catch { /* already terminated backend */ } await x.close(); }
  if (target) await writeFile(join(dirname(target.directory), "native-state-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
});

it("001–012 RPC contracts, column privileges, RLS and 011/012 replays preserve effective schema and history", async () => {
  const names = ["tutor_reserve", "tutor_finish", "review_reserve", "review_finish"];
  for (const name of names) expect(await admin.value(`select json_build_object('args',oidvectortypes(proargtypes),'result',prorettype::regtype::text,'definer',prosecdef,'path',proconfig,'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE')) from pg_proc where oid=${q("public." + name + "(text,text)")}::regprocedure`)).toEqual({ args: "text, text", result: "jsonb", definer: true, path: ['search_path=""'], anon: false, authenticated: true });
  for (const table of ["training_sessions", "tutor_requests", "review_requests", "tutor_messages", "code_reviews"])
    expect(await admin.value(`select to_json(relrowsecurity) from pg_class where oid=${q("public." + table)}::regclass`)).toBe(true);
  for (const table of ["tutor_requests", "review_requests"]) for (const field of ["lease_nonce", "lease_until", "fingerprint"])
    await expect(user(b, bob, () => b.query(`select ${field} from public.${table}`))).rejects.toMatchObject({ code: "42501" });
  const snapshot = () => admin.value("select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(s) order by id) from public.training_sessions s),'functions',(select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'acl',proacl) order by oid) from pg_proc where pronamespace='public'::regnamespace))");
  const before = await snapshot();
  for (const file of ["202610260011_review_retry_recovery.sql", "202610270012_tutor_retry_recovery.sql"]) {
    await applyMigration(target, join(dirname(target.directory), "workspace/supabase/migrations", file));
  }
  expect(await snapshot()).toEqual(before);
});

describe.each<Kind>(["tutor", "review"])("%s native state machine", kind => {
  it("same-ID concurrent reserve grants exactly one DB lease; concurrent finish writes history once", async () => {
    const r = await receipt(kind); await begin(a, alice); const admitted = await reserveInTransaction(a, alice, r);
    expect(admitted).toMatchObject({ cached: false, leaseNonce: expect.any(String) });
    const competing = outcome(reserve(b, alice, r)); await waiting(b, await pid(a)); await a.query("commit");
    expect((await competing).code).toBe("AP004"); expect(await count(r)).toBe(1);
    await begin(a, alice); const finishPayload = await finishSql(r, admitted.leaseNonce!);
    expect(await a.value(rpcSql(kind + "_finish", alice, finishPayload))).toEqual({ accepted: true });
    const repeated = outcome(finish(b, alice, r, admitted.leaseNonce!, true, "must not overwrite"));
    await waiting(b, await pid(a)); await a.query("commit"); expect((await repeated).value).toEqual({ accepted: true });
    expect((await row(r)).status).toBe("completed"); expect(await reserve(c, alice, r)).toMatchObject({ cached: true });
    if (kind === "review") expect((await row(r)).analysis).toEqual({ ...analysis, summary: "immutable synthetic result" });
    else expect(await admin.value(`select json_agg(content order by ordinal) from public.tutor_messages where request_id=${q(r.requestId)}`)).toEqual(["synthetic question", "immutable synthetic result"]);
    expect(await count(r)).toBe(1);
  });
  it("expired same ID terminates as AP006; only explicit new ID retires it; old completion cannot affect new lease", async () => {
    const r = await receipt(kind), old = await reserve(a, alice, r); await expire(r);
    const results = await Promise.all([outcome(reserve(a, alice, r)), outcome(reserve(b, alice, r))]);
    expect(results.map(v => v.code)).toEqual(["AP006", "AP006"]); expect(await count(r)).toBe(1);
    expect((await row(r)).status).toBe("pending"); // The raising RPC rolls back; logically expired, not live admission.
    const fresh = { ...r, requestId: randomUUID() }; const next = await reserve(c, alice, fresh);
    expect((await row(r)).status).toBe("failed"); expect(await finish(b, alice, r, old.leaseNonce!)).toEqual({ accepted: false });
    expect((await row(fresh)).status).toBe("pending"); expect((await row(fresh)).lease_nonce).toBe(next.leaseNonce);
    expect(await finish(c, alice, fresh, next.leaseNonce!, false)).toEqual({ accepted: false });
  });
  it("completed replay stays immutable; mismatched fingerprint and foreign owner cannot recover or settle", async () => {
    const r = await receipt(kind), v = await reserve(a, alice, r); await finish(a, alice, r, v.leaseNonce!);
    const before = await row(r);
    const pair = await Promise.all([outcome(reserve(a, alice, r)), outcome(reserve(b, bob, r))]);
    expect(pair[0]!.value).toMatchObject({ cached: true }); expect(pair[1]!.code).toBe("P0002");
    await expect(reserve(c, alice, { ...r, fingerprint: "b".repeat(64) })).rejects.toMatchObject({ code: "PT409" });
    await expect(finish(b, bob, r, v.leaseNonce!)).rejects.toMatchObject({ code: "P0002" });
    expect(await user(b, bob, () => b.query(`select to_json(id) from public.${kind}_requests where id=${q(r.requestId)}`))).toEqual([]);
    await expect(user(b, bob, () => b.query(`update public.${kind}_requests set status='completed' where id=${q(r.requestId)}`))).rejects.toMatchObject({ code: "42501" });
    const own = await receipt(kind, bob, b); await expect(reserve(b, bob, { ...own, requestId: r.requestId })).rejects.toMatchObject({ code: "P0002" });
    const forged = rpcSql(kind + "_reserve", alice, reservePayload(r));
    await expect(user(b, bob, () => b.query(forged))).rejects.toMatchObject({ code: "42501" });
    expect(await row(r)).toEqual(before);
  });
  it("rolled-back admission releases locks and request ID for a waiting independent backend", async () => {
    const r = await receipt(kind); await begin(a, alice); await reserveInTransaction(a, alice, r);
    const other = outcome(reserve(b, alice, r)); await waiting(b, await pid(a)); await a.query("rollback");
    const result = await other; expect(result.code).toBe("00000"); expect(result.value).toMatchObject({ cached: false, leaseNonce: expect.any(String) });
    expect(await count(r)).toBe(1); await finish(b, alice, r, result.value!.leaseNonce!, false);
  });
  it("real lock timeout aborts only waiter transaction; releasing holder permits clean retry", async () => {
    const r = await receipt(kind); await begin(a, alice); const v = await reserveInTransaction(a, alice, r);
    await begin(b, alice); await b.query("set local lock_timeout='500ms'");
    const timeout = outcome(reserveInTransaction(b, alice, r)); await waiting(b, await pid(a));
    expect((await timeout).code).toBe("55P03");
    await expect(b.query("select to_json(1)")).rejects.toMatchObject({ code: "25P02" });
    await b.query("rollback"); await a.query("commit");
    await expect(reserve(b, alice, r)).rejects.toMatchObject({ code: "AP004" }); expect(await count(r)).toBe(1);
    await finish(a, alice, r, v.leaseNonce!, false);
  });
  it("RPC exception rolls back attempted settlement; committed receipt remains recoverable", async () => {
    const r = await receipt(kind), v = await reserve(a, alice, r), before = await row(r);
    await expect(finish(b, alice, r, randomUUID())).rejects.toMatchObject({ code: "42501" }); expect(await row(r)).toEqual(before);
    await begin(b, alice); await b.value(rpcSql(kind + "_finish", alice, await finishSql(r, v.leaseNonce!)));
    await expect(b.query("select to_json(1/0)")).rejects.toMatchObject({ code: "22012" }); await b.query("rollback");
    expect(await row(r)).toEqual(before); await finish(a, alice, r, v.leaseNonce!); expect(await reserve(c, alice, r)).toMatchObject({ cached: true });
  });
  it("unexpected backend termination rolls back uncommitted work; committed lease still expires explicitly", async () => {
    const r = await receipt(kind), dying = connection(); const dyingPid = await pid(dying);
    await begin(dying, alice); await reserveInTransaction(dying, alice, r);
    const waiter = outcome(reserve(b, alice, r)); await waiting(b, dyingPid);
    expect(await admin.value(`select to_json(pg_terminate_backend(${dyingPid}))`)).toBe(true);
    const granted = await waiter; expect(granted.code).toBe("00000"); expect(await count(r)).toBe(1);
    await expire(r); await expect(reserve(c, alice, r)).rejects.toMatchObject({ code: "AP006" });
    const fresh = { ...r, requestId: randomUUID() }, next = await reserve(c, alice, fresh); await finish(c, alice, fresh, next.leaseNonce!, false);
  });
});

it("Tutor and Review concurrent admissions share one per-user lock and quota", async () => {
  const t = await receipt("tutor"), r = await receipt("review");
  await begin(a, alice); const v = await reserveInTransaction(a, alice, t);
  const competitor = outcome(reserve(b, alice, r)); await waiting(b, await pid(a)); await a.query("commit");
  expect((await competitor).code).toBe("AP004"); expect(await count(r)).toBe(0); await finish(a, alice, t, v.leaseNonce!, false);
  const review = await reserve(b, alice, r); await expect(reserve(c, alice, { ...t, requestId: randomUUID() })).rejects.toMatchObject({ code: "AP004" });
  await finish(b, alice, r, review.leaseNonce!, false);
  await expect(signed(c, alice, "tutor_reserve", { ...reservePayload({ ...t, requestId: randomUUID() }), dailyLimit: 1 })).rejects.toMatchObject({ code: "AP003" });
});

const repository = (x: PsqlConnection, uid: string) => sqlGenerationRepositories(<T,>(sql: string) => user(x, uid, () => x.value<T>(sql)), uid, secret);
describe.each<Kind>(["tutor", "review"])("%s gate + native orchestration", kind => {
  it("new denied concurrent calls create no receipts; completed cache survives denial and preserves history", async () => {
    const r = await receipt(kind), input = { requestId: r.requestId, message: "合成问题", action: "chat" as const, question: "合成问题" };
    const fetcher = vi.fn<typeof fetch>(), denied = new OpenAICompatibleProvider(config, fetcher);
    const run = (x: PsqlConnection, data = input, provider = denied) => kind === "tutor" ? runTutor(repository(x, alice).tutor, config, r.resource, { action: data.action, message: data.message, requestId: data.requestId }, undefined, provider) : runReview(repository(x, alice).review, config, r.resource, { question: data.question, requestId: data.requestId }, undefined, provider);
    const rejected = await Promise.all([outcome<{ cached: boolean }>(run(a)), outcome<{ cached: boolean }>(run(b))]); expect(rejected.map(v => v.code)).toEqual(["LLM_FREE_TIER_UNVERIFIED", "LLM_FREE_TIER_UNVERIFIED"]);
    expect(await count(r)).toBe(0); expect(fetcher).not.toHaveBeenCalled();
    const mock = new MockProvider({ text: kind === "tutor" ? tutorText : JSON.stringify(analysis), usage: [] });
    const initial = kind === "tutor" ? await runTutor(repository(a, alice).tutor, config, r.resource, { action: "chat", message: input.message, requestId: input.requestId }, undefined, mock) : await runReview(repository(a, alice).review, config, r.resource, { question: input.question, requestId: input.requestId }, undefined, mock);
    expect(initial.cached).toBe(false); const immutable = await row(r);
    const recovered = await Promise.all([run(a), run(b)]); expect(recovered.every(v => v.cached)).toBe(true);
    expect(await row(r)).toEqual(immutable); expect(mock.calls).toHaveLength(1); expect(fetcher).not.toHaveBeenCalled(); expect(await count(r)).toBe(1);
    await expect(run(c, { ...input, message: "changed", question: "changed" })).rejects.toMatchObject({ code: "PT409" });
  });
  it("revocation after admission settles failed; denied retry dispatch cannot generate or replace old content", async () => {
    const r = await receipt(kind), repo = repository(a, alice); let permit = true, checks = 0, dispatches = 0;
    const policy: GenerationPolicy = { check: () => { checks++; return permit ? { allowed: true, mode: "offline-mock" } : { allowed: false, code: "LLM_EXECUTION_UNAUTHORIZED" }; } };
    // All responses are in-memory. A 503 changes policy before Provider retry; no second dispatch.
    const fetcher: typeof fetch = async () => { dispatches++; permit = false; return new Response("synthetic unavailable", { status: 503 }); };
    const provider = new OpenAICompatibleProvider(config, fetcher, undefined, async () => {}, policy);
    const run = () => kind === "tutor" ? runTutor(repo.tutor, config, r.resource, { requestId: r.requestId, action: "chat", message: "fixture" }, undefined, provider) : runReview(repo.review, config, r.resource, { requestId: r.requestId, question: "fixture" }, undefined, provider);
    await expect(run()).rejects.toMatchObject({ code: "LLM_EXECUTION_UNAUTHORIZED" });
    expect(checks).toBeGreaterThanOrEqual(4); expect(dispatches).toBe(1); expect((await row(r)).status).toBe("failed");
    await expect(run()).rejects.toMatchObject({ code: "AP006" }); expect(dispatches).toBe(1); expect(await count(r)).toBe(1);
    expect(await user(b, alice, () => b.value<number>(`select to_json(count(*)) from public.${kind === "tutor" ? "tutor_messages" : "review_requests"} where ${kind === "tutor" ? "request_id" : "id"}=${q(r.requestId)}${kind === "review" ? " and status='completed'" : ""}`))).toBe(0);
    // Separate explicit intent: preflight allows, but a hook revokes only after the DB lease commits.
    const nextId = randomUUID(), fresh = { ...r, requestId: nextId }, inner = kind === "tutor" ? repo.tutor : repo.review;
    const original = inner.reserve.bind(inner); inner.reserve = async (p, key) => { const v = await original(p, key); permit = false; return v; };
    permit = true; dispatches = 0;
    const next = kind === "tutor" ? runTutor(repo.tutor, config, r.resource, { requestId: nextId, action: "chat", message: "fixture" }, undefined, provider) : runReview(repo.review, config, r.resource, { requestId: nextId, question: "fixture" }, undefined, provider);
    await expect(next).rejects.toBeInstanceOf(GenerationGateError); expect(dispatches).toBe(0); expect((await row(fresh)).status).toBe("failed");
  });
});
