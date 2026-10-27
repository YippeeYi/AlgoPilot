// Actual local PostgreSQL/RLS + pgcrypto, with auth.uid() fixture; no hosted claims.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { signTutorPayload } from "@/server/tutor/repository";
import { runReview } from "@/server/review/orchestrator";
import type { ReviewRepository } from "@/server/review/repository";
import { MockProvider, OpenAICompatibleProvider } from "@/server/tutor/provider";
import { GenerationGateError } from "@/server/llm/execution-gate";
import { readTutorConfig } from "@/server/tutor/config";
import { reviewResultSchema, reviewSchema } from "@/lib/validation/review";
let db: PGlite;
const alice = "10000000-0000-4000-8000-000000000011", bob = "10000000-0000-4000-8000-000000000012", secret = "ab".repeat(32);
const confirmation = "我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘";
beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
    for (const name of ["202610110001_m1_training.sql", "202610110002_m2_tutor.sql", "202610110003_gemini_usage.sql", "202610120004_business_conflicts.sql", "202610120005_ac_reviews.sql"])
        await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.exec(await readFile("supabase/migrations/202610260011_review_retry_recovery.sql", "utf8"));
    await db.query("insert into algopilot_private.tutor_settings(signing_secret) values($1)", [secret]);
    await db.query("insert into auth.users values($1,'a@test.invalid'),($2,'b@test.invalid')", [alice, bob]);
}, 30000);
afterAll(async () => { await db?.close(); });
function asUser<T>(uid: string, fn: (tx: PGlite) => Promise<T>) { return db.transaction(async (tx) => { await tx.exec("set local role authenticated"); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]); return fn(tx as unknown as PGlite); }); }
async function session(mode = "practice") { return (await asUser(alice, tx => tx.query<{
    id: string;
}>("select id from public.create_training_session(null,'约束 n<=100','" + mode + "',$1)", [randomUUID()]))).rows[0]!.id; }
const body = (sessionId: string | null = null) => ({ sessionId, requestId: randomUUID(), code: "int main() { return 0; }", source: "paste", fileName: null, problemUrl: "https://codeforces.com/problemset/problem/1234/A", statement: "", submissionId: "123", confirmation });
async function create(input = body()) { return (await asUser(alice, tx => tx.query<{
    id: string;
}>("select public.create_code_review($1::jsonb) id", [JSON.stringify(input)]))).rows[0]!.id; }
async function signed(fn: string, p: Record<string, unknown>, uid = alice) { const v = signTutorPayload(p, uid, secret); return asUser(uid, tx => tx.query<{
    v: Record<string, unknown>;
}>(`select public.${fn}($1,$2) v`, [v.p_payload, v.p_signature])); }
async function reserve(id: string, limit = 100) { const requestId = randomUUID(); const p = { operation: "review_reserve", reviewId: id, requestId, fingerprint: "a".repeat(64), question: "", dailyLimit: limit }; const result = await signed("review_reserve", p); return { p, nonce: result.rows[0]!.v.leaseNonce }; }
async function settle(id: string, q: Awaited<ReturnType<typeof reserve>>, success = false) { return signed("review_finish", { operation: "review_finish", reviewId: id, requestId: q.p.requestId, leaseNonce: q.nonce, success, codeHash: (await db.query<{
        code_hash: string;
    }>("select code_hash from public.code_reviews where id=$1", [id])).rows[0]!.code_hash, analysis: { summary: "测试夹具" }, model: "fixture", promptVersion: "review/test", usage: [] }); }
describe("AC review SQL isolation and authorization_event", () => {
    it("requires explicit confirmation, rejects contest, anonymous and foreign session", async () => {
        const id = await session();
        await expect(create({ ...body(id), confirmation: "AC" })).rejects.toMatchObject({ code: "23514" });
        await expect(create({...body(id),source:"file",fileName:null})).rejects.toMatchObject({code:"23514"});
        await expect(create({...body(id),code:"bad\ufffd"})).rejects.toMatchObject({code:"23514"});
        const contest = await session("contest");
        await expect(create(body(contest))).rejects.toMatchObject({ code: "AP001" });
        await expect(asUser(bob, tx => tx.query("select public.create_code_review($1::jsonb)", [JSON.stringify(body(id))]))).rejects.toMatchObject({ code: "P0002" });
        await expect(asUser("", tx => tx.query("select public.create_code_review($1::jsonb)", [JSON.stringify(body())]))).rejects.toMatchObject({ code: "28000" });
    });
    it("freezes snapshot, records pre-AC state, closes Tutor and keeps old drafts/history", async () => {
        const id = await session();
        await asUser(alice, tx => tx.query("select public.save_training_draft($1,'code','legacy cpp',0)", [id]));
        await asUser(alice, tx => tx.query("select public.append_training_thought($1,'已有思路',0,$2)", [id, randomUUID()]));
        const input = body(id);
        const rid = await create(input);
        expect(await create(input)).toBe(rid);
        const r = (await db.query<{
            authorization_event: {
                status: string;
            };
            code_snapshot: string;
            official_verdict: null;
        }>("select * from public.code_reviews where id=$1", [rid])).rows[0]!;
        expect(r.authorization_event.status).toBe("active");
        expect(r.code_snapshot).toBe(input.code);
        expect(r.official_verdict).toBeNull();
        const s = (await db.query<{
            status: string;
            code_draft: string;
            max_hint_seen: number;
        }>("select * from public.training_sessions where id=$1", [id])).rows[0]!;
        expect(s.status).toBe("completed");
        expect(s.code_draft).toBe("legacy cpp");
        expect(s.max_hint_seen).toBe(0);
        expect((await asUser(alice, tx => tx.query("select * from public.thought_snapshots where session_id=$1", [id]))).rows).toHaveLength(1);
        await expect(create({ ...input, code: "new cpp" })).rejects.toMatchObject({ code: "PT409" });
        await expect(asUser(alice, tx => tx.query("update public.code_reviews set code_snapshot='overwrite' where id=$1", [rid]))).rejects.toMatchObject({ code: "42501" });
        await expect(signed("tutor_reserve", { operation: "reserve", sessionId: id, requestId: randomUUID(), action: "chat", fingerprint: "b".repeat(64), dailyLimit: 100 })).rejects.toMatchObject({ code: "AP002" });
    });
    it("RLS isolates both tables, prevents forged result and hides nonce/usage", async () => {
        const rid = await create();
        const q = await reserve(rid);
        for (const table of ["code_reviews", "review_requests"])
            expect((await asUser(bob, tx => tx.query(`select id from public.${table}`))).rows).toHaveLength(0);
        for (const field of ["lease_nonce", "usage"])
            await expect(asUser(alice, tx => tx.query(`select ${field} from public.review_requests`))).rejects.toMatchObject({ code: "42501" });
        await expect(asUser(alice, tx => tx.query("update public.review_requests set analysis='{}'"))).rejects.toMatchObject({ code: "42501" });
        await expect(asUser(bob, tx => tx.query("select public.edit_code_review($1,0,'attack')", [rid]))).rejects.toMatchObject({ code: "P0002" });
        const p = signTutorPayload({ operation: "review_finish", reviewId: rid, requestId: q.p.requestId, leaseNonce: q.nonce, success: true, usage: [] }, alice, secret);
        await expect(asUser(alice, tx => tx.query("select public.review_finish($1,$2)", [p.p_payload, "0".repeat(64)]))).rejects.toMatchObject({ code: "42501" });
        await expect(signed("review_finish", { operation: "review_finish", reviewId: rid, requestId: q.p.requestId, leaseNonce: randomUUID(), success: false, usage: [] })).rejects.toMatchObject({ code: "42501" });
        await settle(rid, q);
    });
    it("review and Tutor share cross-session concurrency and daily quota in both directions", async () => {
        const rid = await create();
        const sid = await session();
        const q = await reserve(rid);
        const p = { operation: "reserve", sessionId: sid, requestId: randomUUID(), action: "chat", fingerprint: "c".repeat(64), dailyLimit: 100 };
        await expect(signed("tutor_reserve", p)).rejects.toMatchObject({ code: "AP004" });
        await settle(rid, q);
        const tutor = await signed("tutor_reserve", p);
        await expect(reserve(rid)).rejects.toMatchObject({ code: "AP004" });
        await signed("tutor_finish", { operation: "finish", sessionId: sid, requestId: p.requestId, leaseNonce: tutor.rows[0]!.v.leaseNonce, success: false, usage: [] });
        await expect(reserve(rid, 1)).rejects.toMatchObject({ code: "AP003" });
        await expect(signed("tutor_reserve", { ...p, requestId: randomUUID(), dailyLimit: 1 })).rejects.toMatchObject({ code: "AP003" });
    });
    it("results remain separate, duplicate admission cached, notes use revision CAS", async () => {
        const rid = await create();
        const q = await reserve(rid);
        await settle(rid, q, true);
        expect((await signed("review_reserve", q.p)).rows[0]!.v.cached).toBe(true);
        expect((await db.query("select * from public.tutor_messages")).rows).toHaveLength(0);
        expect((await db.query("select * from public.hint_events")).rows).toHaveLength(0);
        await asUser(alice, tx => tx.query("select public.edit_code_review($1,0,'我的编辑')", [rid]));
        await expect(asUser(alice, tx => tx.query("select public.edit_code_review($1,0,'旧编辑')", [rid]))).rejects.toMatchObject({ code: "PT409" });
        expect((await db.query<{
            notes: string;
        }>("select notes from public.code_reviews where id=$1", [rid])).rows[0]!.notes).toBe("我的编辑");
    });
    it("expired lease cannot disclose; failed request keeps unknown usage and cannot replay", async () => {
        const rid = await create();
        const q = await reserve(rid);
        await db.query("update public.review_requests set lease_until=clock_timestamp()-interval '1 second' where id=$1", [q.p.requestId]);
        expect((await settle(rid, q, true)).rows[0]!.v.accepted).toBe(false);
        expect((await db.query<{
            analysis: null;
        }>("select analysis from public.review_requests where id=$1", [q.p.requestId])).rows[0]!.analysis).toBeNull();
        await expect(signed("review_reserve", q.p)).rejects.toMatchObject({ code: "AP006" });
    });
    it("same-ID expired pending admission must terminate without admitting a new model call", async () => {
        const rid = await create();
        const q = await reserve(rid);
        await expect(signed("review_reserve", q.p)).rejects.toMatchObject({ code: "AP004" });
        await db.query("update public.review_requests set lease_until=clock_timestamp()-interval '1 second' where id=$1", [q.p.requestId]);
        await expect(signed("review_reserve", q.p)).rejects.toMatchObject({ code: "AP006" });
        await expect(signed("review_reserve", q.p)).rejects.toMatchObject({ code: "AP006" });
        await expect(signed("review_reserve", { ...q.p, fingerprint: "b".repeat(64) })).rejects.toMatchObject({ code: "PT409" });
        await expect(signed("review_reserve", q.p, bob)).rejects.toMatchObject({ code: "P0002" });
        expect((await db.query("select id from public.review_requests where review_id=$1", [rid])).rows).toHaveLength(1);
        const fresh = await reserve(rid);
        expect((await settle(rid, q, true)).rows[0]!.v.accepted).toBe(false);
        expect((await db.query<{ status: string }>("select status from public.review_requests where id=$1", [fresh.p.requestId])).rows[0]!.status).toBe("pending");
        await settle(rid, fresh);
    });
    it("replays a committed generation through the real orchestrator/SQL without another Provider admission", async () => {
        const rid = await create();
        const repo = {
            hasRequest: async (id: string, requestId: string) => (await asUser(alice, tx => tx.query("select id from public.review_requests where review_id=$1 and id=$2", [id, requestId]))).rows.length > 0,
            get: async (id: string) => reviewSchema.parse((await asUser(alice, tx => tx.query<{ v: unknown }>("select to_jsonb(r) v from (select id,user_id,session_id,problem_id,problem_url,statement_snapshot,code_snapshot,code_hash,source,file_name,submission_id,verdict_source,official_verdict,source_match,authorization_event,notes,revision,created_at,edited_at from public.code_reviews where id=$1) r", [id]))).rows[0]!.v),
            results: async (id: string) => reviewResultSchema.array().parse((await asUser(alice, tx => tx.query("select id,review_id,question,analysis,model,prompt_version,to_char(created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') created_at from public.review_requests where review_id=$1 and status='completed' order by created_at desc", [id]))).rows),
            reserve: async (p: Record<string, unknown>) => (await signed("review_reserve", p)).rows[0]!.v,
            finish: async (p: Record<string, unknown>) => (await signed("review_finish", p)).rows[0]!.v,
        } as unknown as ReviewRepository;
        const config = readTutorConfig({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "https://fixture.invalid/v1", LLM_MODEL: "fixture", LLM_API_KEY: "fixture-not-real", TUTOR_RPC_SIGNING_SECRET: secret, LLM_DAILY_REQUEST_LIMIT: "100" })!;
        const analysis = { summary: "静态分析", correctness: "未运行代码。", assumptions: "给定前提尚未验证。", timeComplexity: "O(1)", spaceComplexity: "O(1)", lineAnalysis: [{ start: 1, end: 1, analysis: "入口。" }], risks: "边界需核对。", improvements: "命名改进。", alternatives: "", transferableKnowledge: "边界", revisionQuestions: ["输入前提是什么？"], answer: "" };
        const provider = new MockProvider({ text: JSON.stringify(analysis), usage: [] });
        const input = { requestId: randomUUID(), question: "静态核对边界。" };
        // First response is treated as lost by the caller, after SQL has committed it.
        const first = await runReview(repo, config, rid, input, undefined, provider);
        expect(first.cached).toBe(false);
        const recovered = await runReview(repo, config, rid, input, undefined, provider);
        expect(recovered.cached).toBe(true);
        expect(recovered.results).toEqual(first.results);
        expect(provider.calls).toHaveLength(1);
        expect((await db.query("select id from public.review_requests where review_id=$1", [rid])).rows).toHaveLength(1);
        const fresh = await runReview(repo, config, rid, { ...input, requestId: randomUUID() }, undefined, provider);
        expect(fresh.cached).toBe(false); expect(fresh.results).toHaveLength(2); expect(provider.calls).toHaveLength(2);
        const fetcher = vi.fn<typeof fetch>();
        const deniedProvider = new OpenAICompatibleProvider(config, fetcher);
        expect((await runReview(repo, config, rid, input, undefined, deniedProvider)).cached).toBe(true);
        // The database still validates the cached fingerprint; a changed question cannot reuse its ID.
        await expect(runReview(repo, config, rid, { ...input, question: "changed" }, undefined, deniedProvider)).rejects.toMatchObject({ code: "PT409" });
        await expect(runReview(repo, config, rid, { ...input, requestId: randomUUID() }, undefined, deniedProvider)).rejects.toMatchObject({ code: "LLM_FREE_TIER_UNVERIFIED" });
        expect((await db.query("select id from public.review_requests where review_id=$1", [rid])).rows).toHaveLength(2);
        expect(fetcher).not.toHaveBeenCalled();
        const revokedId = randomUUID();
        vi.spyOn(provider, "assertCanGenerate").mockImplementationOnce(() => {}).mockImplementation(() => { throw new GenerationGateError("LLM_EXECUTION_UNAUTHORIZED"); });
        await expect(runReview(repo, config, rid, { ...input, requestId: revokedId }, undefined, provider)).rejects.toMatchObject({ code: "LLM_EXECUTION_UNAUTHORIZED" });
        expect((await db.query<{ status: string; analysis: null; usage: unknown[] }>("select status,analysis,usage from public.review_requests where id=$1", [revokedId])).rows[0]).toMatchObject({ status: "failed", analysis: null, usage: [] });
        expect(await repo.results(rid)).toEqual(fresh.results);
        expect(provider.calls).toHaveLength(2);
        expect((await db.query("select id from public.tutor_messages")).rows).toHaveLength(0);
        expect((await db.query("select id from public.hint_events")).rows).toHaveLength(0);
    });
    it("011 preserves function privileges on replay", async () => {
        const definition = async () => (await db.query<{ definition: string }>("select pg_get_functiondef('public.review_reserve(text,text)'::regprocedure) definition")).rows[0]!.definition;
        const before = await definition();
        await db.exec(await readFile("supabase/migrations/202610260011_review_retry_recovery.sql", "utf8"));
        expect(await definition()).toBe(before);
        const rights = (await db.query<{ prosecdef: boolean; proconfig: string[]; anonymous: boolean; authenticated: boolean }>("select prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anonymous,has_function_privilege('authenticated',oid,'EXECUTE') authenticated from pg_proc where oid='public.review_reserve(text,text)'::regprocedure")).rows[0]!;
        expect(rights).toMatchObject({ prosecdef: true, anonymous: false, authenticated: true });
        expect(rights.proconfig).toEqual(['search_path=""']);
    });
    it("untimed sessions start paused at zero, retry doesn't pause a resumed session", async () => {
        const id = randomUUID();
        const make = () => asUser(alice, tx => tx.query<{
            id: string;
            status: string;
            active_seconds: number;
            state_revision: number;
        }>("select * from public.create_untimed_session(null,'notes','practice',$1)", [id]));
        const s = (await make()).rows[0]!;
        expect(s.status).toBe("paused");
        expect(s.active_seconds).toBe(0);
        await asUser(alice, tx => tx.query("select public.transition_training_session($1,'resume',1,null)", [s.id]));
        expect((await make()).rows[0]!.status).toBe("active");
    });
});
