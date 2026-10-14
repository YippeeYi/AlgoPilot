import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { signTutorPayload } from "@/server/tutor/repository";
let db: PGlite;
const alice = "10000000-0000-4000-8000-000000000011", bob = "10000000-0000-4000-8000-000000000012", secret = "cd".repeat(32);
let legacyId: string, legacySession: string, problemIds: string[] = [];
const metadata = [{ contestId: 1538, index: "D", name: "Another Problem About Dividing Numbers", rating: 1700, tags: ["math", "number theory"], solvedCount: 100 }, { contestId: 1732, index: "C1", name: "Sheikh (Easy version)", rating: 1400, tags: ["bitmasks"], solvedCount: 10 }, { contestId: 921, index: "01", name: "Parser boundary", rating: null, tags: [], solvedCount: null }];
const confirmation = "我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘";
async function asUser<T>(uid: string, fn: (tx: PGlite) => Promise<T>) { return db.transaction(async (tx) => { await tx.exec("set local role authenticated"); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]); return fn(tx as unknown as PGlite); }); }
async function sql<T = Record<string, unknown>>(q: string, args: unknown[] = [], uid = alice) { return asUser(uid, tx => tx.query<T>(q, args)); }
async function sync(p: Record<string, unknown>, uid = alice) { const sig = signTutorPayload({ operation: "cf_sync", ...p }, uid, secret); return sql<{
    v: Record<string, unknown>;
}>("select public.cf_sync($1,$2) v", [sig.p_payload, sig.p_signature], uid); }
async function write(id: string, input: Record<string, unknown>, uid = alice) { return sql("select public.plan_write($1,$2::jsonb)", [id, JSON.stringify(input)], uid); }
async function detail(id: string, uid = alice) { return (await sql<{
    v: {
        plan: {
            revision: number;
        };
        items: {
            id: string;
            manual_status: string;
            sessions: unknown[];
            reviews: {
                analyzed: boolean;
            }[];
            officialStatus: string;
        }[];
    };
}>("select public.plan_detail($1) v", [id], uid)).rows[0]!.v; }
async function plan(ids = problemIds) { const id = randomUUID(); await write(id, { action: "create", requestId: id, name: "我的计划", description: "", problemIds: ids }); return id; }
async function start(problemId: string, itemId?: string, rid = randomUUID(), newSession = false) { return (await sql<{
    id: string;
}>("select id from public.start_cf_session($1::jsonb)", [JSON.stringify({ problemId, requestId: rid, ...(itemId ? { itemId, newSession } : {}) })])).rows[0]!.id; }
beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;");
    const files = (await readdir("supabase/migrations")).filter(f => f.endsWith('.sql')).sort();
    for (const f of files.filter(f => f < '202610120006'))
        await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
    await db.query("insert into auth.users values($1,'a@test'),($2,'b@test')", [alice, bob]);
    legacyId = (await sql<{
        id: string;
    }>("select id from public.create_custom_problem('旧私人题','旧题面',$1)", [randomUUID()])).rows[0]!.id;
    legacySession = (await sql<{
        id: string;
    }>("select id from public.create_training_session($1,null,'practice',$2)", [legacyId, randomUUID()])).rows[0]!.id;
    await db.exec(await readFile("supabase/migrations/202610120006_cf_catalog_plans.sql", "utf8"));
    await db.exec(await readFile("supabase/migrations/202610140007_learning_recommendations.sql", "utf8"));
    await db.exec(await readFile("supabase/migrations/202610140008_recommendation_audit.sql", "utf8"));
    await db.exec(await readFile("supabase/migrations/202610140009_recommendation_fit.sql", "utf8"));
    await db.query("insert into algopilot_private.cf_settings(signing_secret) values($1)", [secret]);
    const nonce = (await sync({ action: "reserve" })).rows[0]!.v.nonce;
    await sync({ action: "slot", nonce });
    await sync({ action: "publish", nonce, problems: metadata });
    problemIds = (await db.query<{
        id: string;
    }>("select id from public.problems where platform='codeforces' order by contest_id desc")).rows.map(p => p.id);
}, 30000);
afterAll(() => db?.close());
describe("M3 real local SQL/RLS (Auth context fixture)", () => {
    it("catalog parser filters exact multi-character id, name, rating, tags, missing rating and count sorting", async () => {
        const search = async (q: unknown) => (await sql<{
            v: {
                items: {
                    index: string;
                    rating: number | null;
                }[];
                total: number;
                syncedAt: string;
            };
        }>("select public.cf_catalog($1::jsonb) v", [JSON.stringify(q)])).rows[0]!.v;
        expect((await search({ q: "1732c1" })).items[0]!.index).toBe("C1");
        expect((await search({ q: "dividing" })).total).toBe(1);
        expect((await search({ min: 1600, max: 1800, tags: "math;number theory" })).total).toBe(1);
        expect((await search({ q: "921/01" })).items[0]!.rating).toBeNull();
        expect((await search({ sort: "solved_desc", offset: 1, limit: 1 })).items[0]!.index).toBe("C1");
        expect((await search({})).syncedAt).toBeTruthy();
        await expect(sql("select public.cf_catalog('{}')", [], "")).rejects.toMatchObject({ code: "28000" });
    });
    it("shared lease deduplicates, throttles slots, cools manual refresh and denies unsigned publication", async () => {
        expect((await sync({ action: "reserve", force: true })).rows[0]!.v.acquired).toBe(false);
        await db.exec("update algopilot_private.cf_cache_state set next_attempt_at='-infinity'");
        const nonce = (await sync({ action: "reserve", force: true })).rows[0]!.v.nonce;
        expect((await sync({ action: "reserve", force: true }, bob)).rows[0]!.v.acquired).toBe(false);
        expect((await sync({ action: "slot", nonce })).rows[0]!.v.waitMs).toBeGreaterThan(0);
        await expect(sql("select public.cf_sync($1,$2)", [JSON.stringify({ operation: "cf_sync" }), "0".repeat(64)])).rejects.toMatchObject({ code: "42501" });
        await sync({ action: "fail", nonce });
        expect((await sql<{
            v: {
                stale: boolean;
            };
        }>("select public.cf_catalog('{}') v")).rows[0]!.v.stale).toBe(true);
        await expect(sql("insert into public.problems(platform,title) values('codeforces','forged')")).rejects.toMatchObject({ code: "42501" });
    });
    it("creates multiple plans, deduplicates additions, validates whitelist and request fingerprints", async () => {
        const id = await plan();
        const other = await plan([problemIds[0]!]);
        expect((await detail(other)).items).toHaveLength(1);
        const input = { action: "add", revision: 0, requestId: randomUUID(), problemIds: [problemIds[0], problemIds[0]] };
        await write(id, input);
        await write(id, input);
        expect((await detail(id)).items).toHaveLength(3);
        await expect(write(id, { ...input, problemIds: [] })).rejects.toMatchObject({ code: "PT409" });
        await expect(write(id, { action: "status", itemId: (await detail(id)).items[0]!.id, status: "completed", official_verdict: "OK", revision: 1, requestId: randomUUID() })).rejects.toMatchObject({ code: "23514" });
        await expect(plan([legacyId])).rejects.toMatchObject({ code: "23514" });
    });
    it("reorders with complete permutation and CAS, isolates users and prevents arbitrary state/table DML", async () => {
        const id = await plan(), d = await detail(id), ids = d.items.map(i => i.id).reverse();
        await write(id, { action: "reorder", itemIds: ids, revision: 0, requestId: randomUUID() });
        expect((await detail(id)).items.map(i => i.id)).toEqual(ids);
        await expect(write(id, { action: "reorder", itemIds: ids, revision: 0, requestId: randomUUID() })).rejects.toMatchObject({ code: "PT409" });
        await expect(write(id, { action: "reorder", itemIds: [ids[0], ids[0], ids[1]], revision: 1, requestId: randomUUID() })).rejects.toMatchObject({ code: "23514" });
        for (const table of ["training_plans", "training_plan_items", "training_plan_sessions"])
            expect((await sql(`select * from public.${table}`, [], bob)).rows).toHaveLength(0);
        await expect(detail(id, bob)).rejects.toMatchObject({ code: "P0002" });
        await expect(write(id, { action: "delete", revision: 1, requestId: randomUUID() }, bob)).rejects.toMatchObject({ code: "P0002" });
        await expect(sql("update public.training_plan_items set manual_status='completed'")).rejects.toMatchObject({ code: "42501" });
        await expect(plan(['10000000-0000-4000-8000-000000000099'])).rejects.toMatchObject({ code: "23514" });
    });
    it("links independent sessions/reviews, resumes unfinished, manual completion isn't AC, deletion preserves history", async () => {
        const id = await plan([problemIds[0]!]), item = (await detail(id)).items[0]!;
        const rid = randomUUID();
        const sid = await start(problemIds[0]!, item.id, rid);
        expect(await start(problemIds[0]!, item.id, rid)).toBe(sid);
        expect(await start(problemIds[0]!, item.id)).toBe(sid);
        const next = await start(problemIds[0]!, item.id, randomUUID(), true);
        expect(next).not.toBe(sid);
        const reviewInput = { sessionId: sid, requestId: randomUUID(), code: "int main(){}", source: "paste", fileName: null, problemUrl: "", statement: "", submissionId: null, confirmation };
        const reviewId = (await sql<{
            v: string;
        }>("select public.create_cf_review($1,$2::jsonb) v", [problemIds[0], JSON.stringify(reviewInput)])).rows[0]!.v;
        await write(id, { action: "status", itemId: item.id, status: "completed", revision: 0, requestId: randomUUID() });
        const d = await detail(id);
        expect(d.items[0]!.officialStatus).toBe("not_synced");
        expect(d.items[0]!.sessions).toHaveLength(2);
        expect(d.items[0]!.reviews[0]!.analyzed).toBe(false);
        const remove = { action: "delete", revision: 1, requestId: randomUUID() };
        await write(id, remove);
        await write(id, remove);
        await expect(detail(id)).rejects.toMatchObject({ code: "P0002" });
        expect((await sql("select id from public.training_sessions where id=$1", [sid])).rows).toHaveLength(1);
        expect((await sql("select id from public.code_reviews where id=$1", [reviewId])).rows).toHaveLength(1);
        await expect(sql("update public.code_reviews set official_verdict='OK'")).rejects.toMatchObject({ code: "42501" });
    });
    it("supplements current CF context with preserved notes/history, idempotent retry and owner/completion guards", async () => {
        const sid = await start(problemIds[0]!);
        await sql("select public.save_training_draft($1,'thought','我的旧笔记',0)", [sid]);
        const rid = randomUUID(), args = [sid, 'n<=100，输出整数', 1, rid];
        await sql("select public.supplement_cf_context($1,$2,$3,$4)", args);
        await sql("select public.supplement_cf_context($1,$2,$3,$4)", args);
        const s = (await sql<{
            thought_draft: string;
            thought_revision: number;
        }>("select thought_draft,thought_revision from public.training_sessions where id=$1", [sid])).rows[0]!;
        expect(s.thought_draft).toContain('我的旧笔记');
        expect(s.thought_draft).toContain('n<=100');
        expect(s.thought_revision).toBe(2);
        await expect(sql("select public.supplement_cf_context($1,$2,$3,$4)", [sid, 'changed', 1, rid])).rejects.toMatchObject({ code: 'PT409' });
        await expect(sql("select public.supplement_cf_context($1,$2,$3,$4)", [sid, 'other', 2, randomUUID()], bob)).rejects.toMatchObject({ code: 'P0002' });
        await sql("select public.transition_training_session($1,'finish',1,'not_recorded')", [sid]);
        await expect(sql("select public.supplement_cf_context($1,$2,$3,$4)", [sid, 'new', 2, randomUUID()])).rejects.toMatchObject({ code: '23514' });
    });
    it("rename/archive/restore/remove retain history and prevent writes while archived", async () => {
        const id = await plan([problemIds[1]!]);
        const d = await detail(id);
        await write(id, { action: 'edit', name: '新名字', description: '说明', archived: true, revision: 0, requestId: randomUUID() });
        await expect(write(id, { action: 'add', problemIds: [problemIds[0]], revision: 1, requestId: randomUUID() })).rejects.toMatchObject({ code: '23514' });
        await expect(start(problemIds[1]!, d.items[0]!.id)).rejects.toMatchObject({ code: '23514' });
        await write(id, { action: 'edit', name: '新名字', description: '说明', archived: false, revision: 1, requestId: randomUUID() });
        await write(id, { action: 'remove', itemId: d.items[0]!.id, revision: 2, requestId: randomUUID() });
        expect((await detail(id)).items).toHaveLength(0);
        expect((await sql('select id from public.problems where id=$1', [problemIds[1]])).rows).toHaveLength(1);
    });
    it("standalone CF review binds a real problem, numeric index URL and immutable idempotent snapshot", async () => {
        const body = {sessionId:null,requestId:randomUUID(),code:"int main(){}",source:"paste",fileName:null,problemUrl:"",statement:"user context",submissionId:null,confirmation};
        const create = () => sql<{v:string}>("select public.create_cf_review($1,$2::jsonb) v",[problemIds[2],JSON.stringify(body)]);
        const reviewId = (await create()).rows[0]!.v;
        expect((await create()).rows[0]!.v).toBe(reviewId);
        const review = (await sql<{problem_id:string;session_id:string;problem_url:string;code_snapshot:string;official_verdict:null}>("select problem_id,session_id,problem_url,code_snapshot,official_verdict from public.code_reviews where id=$1",[reviewId])).rows[0]!;
        expect(review.problem_id).toBe(problemIds[2]);
        expect(review.problem_url).toBe("https://codeforces.com/problemset/problem/921/01");
        expect(review.code_snapshot).toBe(body.code);
        expect(review.official_verdict).toBeNull();
        expect((await sql<{status:string}>("select status from public.training_sessions where id=$1",[review.session_id])).rows[0]!.status).toBe("completed");
    });
    it("retains legacy custom/read/review, blocks new custom and direct blank-session entry points", async () => {
        expect((await sql("select id from public.problems where id=$1", [legacyId])).rows).toHaveLength(1);
        expect((await sql("select id from public.training_sessions where id=$1", [legacySession])).rows).toHaveLength(1);
        await expect(sql("select public.create_custom_problem('new','',$1)", [randomUUID()])).rejects.toMatchObject({ code: "42501" });
        await expect(sql("select public.create_training_session(null,'','practice',$1)", [randomUUID()])).rejects.toMatchObject({ code: "42501" });
        const body = { sessionId: null, requestId: randomUUID(), code: "int main(){}", source: "paste", fileName: null, problemUrl: "", statement: "", submissionId: null, confirmation };
        expect((await sql("select public.create_code_review($1::jsonb)", [JSON.stringify(body)])).rows).toHaveLength(1);
        await expect(start(legacyId)).rejects.toMatchObject({ code: "23514" });
    });
});

// M3.2 reads and writes execute the actual appended PostgreSQL migration.
import { defaultPreferences, evidenceSchema, candidatesSchema } from "@/lib/validation/learning";
import { abilityProfile, recommend } from "@/features/learning/engine";
import { auditReview } from "@/server/review/orchestrator";
import { reviewSchema } from "@/lib/validation/review";
async function learningUser() { const uid = randomUUID(); await db.query("insert into auth.users values($1,'learning@test')", [uid]); return uid; }
async function evidence(uid: string) { return evidenceSchema.parse((await sql<{
    v: unknown;
}>("select public.learning_evidence() v", [], uid)).rows[0]!.v); }
async function learningWrite(uid: string, input: Record<string, unknown>) { return sql("select public.learning_write($1::jsonb)", [JSON.stringify(input)], uid); }
async function learningCandidates(uid: string, repeat = false, themes: string[] = []) { return candidatesSchema.parse((await sql<{
    v: unknown;
}>("select public.learning_candidates($1::jsonb) v", [JSON.stringify({ min: 800, max: 1800, target: 1400, themes, repeat })], uid)).rows[0]!.v); }
async function learningSession(uid: string, pid = problemIds[1]!) { return (await sql<{
    id: string;
}>("select id from public.start_cf_session($1::jsonb)", [JSON.stringify({ problemId: pid, requestId: randomUUID() })], uid)).rows[0]!.id; }
async function learningPref(uid: string, extra: Record<string, unknown> = {}, revision = 0) { return learningWrite(uid, { action: "preferences", requestId: randomUUID(), revision, preferences: { ...defaultPreferences, min: 800, max: 1800, ...extra } }); }
async function learningSigned(uid: string, fn: string, payload: Record<string, unknown>) { const s = signTutorPayload(payload, uid, secret); return (await sql<{
    v: Record<string, unknown>;
}>(`select public.${fn}($1,$2) v`, [s.p_payload, s.p_signature], uid)).rows[0]!.v; }
describe("M3.2 shared learning evidence / actual PostgreSQL with fixture Auth", () => {
    it("cold start and metadata boundaries filter in DB; no missing-rating or invented ability", async () => { const uid = await learningUser(); const e = await evidence(uid); expect(e.preferences).toBeNull(); expect(e.sessions).toEqual([]); const pool = await learningCandidates(uid); expect(pool.items).toHaveLength(2); expect(pool.items.every(p => p.rating !== null)).toBe(true); expect((await learningCandidates(uid, false, ["graphs"])).items).toEqual([]); expect(abilityProfile(e).directions).toEqual([]); await expect(sql("select public.learning_evidence()", [], "")).rejects.toMatchObject({ code: "28000" }); });
    it("preferences use strict DB whitelist, CAS/idempotency; direct DML and anonymous EXECUTE denied", async () => { const uid = await learningUser(); const input = { action: "preferences", requestId: randomUUID(), revision: 0, preferences: defaultPreferences }; await learningWrite(uid, input); await learningWrite(uid, input); expect((await evidence(uid)).revision).toBe(1); await expect(learningWrite(uid, { ...input, preferences: { ...defaultPreferences, max: 1800 } })).rejects.toMatchObject({ code: "PT409" }); await expect(learningWrite(uid, { ...input, requestId: randomUUID() })).rejects.toMatchObject({ code: "PT409" }); await expect(learningPref(uid, { mastery: 100 }, 1)).rejects.toMatchObject({ code: "23514" }); await expect(learningPref(uid, { min: null }, 1)).rejects.toMatchObject({ code: "23514" }); await expect(learningPref(uid, { themes: ["invented"] }, 1)).rejects.toMatchObject({ code: "23514" }); await expect(sql("update public.learning_preferences set revision=99", [], uid)).rejects.toMatchObject({ code: "42501" }); const acl = await db.query<{
        bad: number;
    }>("select count(*)::int bad from pg_proc where proname like 'learning_%' and (has_function_privilege('anon',oid,'EXECUTE') or (prosecdef and proconfig is distinct from array['search_path=\"\"']))"); expect(acl.rows[0]!.bad).toBe(0); });
    it("real HMAC-settled hint disclosure influences shared profile and ranking; authorization alone doesn't", async () => { const uid = await learningUser(); await db.query("insert into algopilot_private.tutor_settings(signing_secret) values($1) on conflict(singleton) do nothing", [secret]); await learningPref(uid, { repeat: true, goal: "independence" }); const sid = await learningSession(uid); for (let rev = 0; rev < 3; rev++)
        await sql("select public.tutor_hint($1,'upgrade',$2,$3,null)", [sid, rev, randomUUID()], uid); expect((await evidence(uid)).sessions[0]!.maxHint).toBe(0); const requestId = randomUUID(); const reservation = await learningSigned(uid, "tutor_reserve", { operation: "reserve", sessionId: sid, requestId, fingerprint: "e".repeat(64), dailyLimit: 100, action: "chat" }); await learningSigned(uid, "tutor_finish", { operation: "finish", sessionId: sid, requestId, leaseNonce: reservation.leaseNonce, success: true, disclosureLevel: 3, userMessage: "已有思路", content: "[FIXTURE] 算法方向已授权。", promptVersion: "fixture/learning", thoughtRevision: 0, codeRevision: 0, usage: [] }); const uncompleted = await evidence(uid); expect(uncompleted.sessions[0]!.tags).toEqual([]); expect(uncompleted.sessions[0]!.maxHint).toBe(3); await sql("select public.transition_training_session($1,'finish',1,'solved_self_reported')", [sid], uid); const e = await evidence(uid); const profile = abilityProfile(e); expect(profile.directions.find(d => d.topic === "math")).toMatchObject({ samples: 1, highHints: 1, confidence: "样本不足" }); const r = recommend(e, (await learningCandidates(uid, true)).items); const math = r.items.find(i => i.problem.id === problemIds[1])!; expect(math.factors.weakness).toBeGreaterThan(0); expect(math.refs).toContainEqual({ kind: "training", id: sid }); expect(JSON.stringify(r.items)).not.toContain('"tags"'); });
    it("all solved history excluded, repeat opt-in, multi-plan owner-aware penalty and manual progress isn't AC", async () => { const uid = await learningUser(); const pid = problemIds[0]!; const make = async () => { const id = randomUUID(); await write(id, { action: "create", requestId: id, name: "fixture plan", description: "", problemIds: [pid] }, uid); return id; }; const a = await make(); await make(); expect((await learningCandidates(uid)).items.find(i => i.id === pid)!.inPlan).toBe(true); const other = await learningUser(); expect((await learningCandidates(other)).items.find(i => i.id === pid)!.inPlan).toBe(false); const item = (await detail(a, uid)).items[0]!; await write(a, { action: "status", itemId: item.id, status: "completed", revision: 0, requestId: randomUUID() }, uid); expect((await learningCandidates(uid)).items.some(i => i.id === pid)).toBe(true); const sid = await learningSession(uid, pid); await sql("select public.transition_training_session($1,'finish',1,'solved_self_reported')", [sid], uid); await db.query("insert into public.training_sessions(user_id,problem_id,statement_snapshot,phase,status,started_at,resumed_at,ended_at,outcome,create_request_id) select $1,null,'[FIXTURE] newer record','finished','completed',clock_timestamp()-interval '1 second',null,clock_timestamp(),'not_recorded',gen_random_uuid() from generate_series(1,501)",[uid]);
        const window=await evidence(uid); expect(window.sessions).toHaveLength(500); expect(window.sessions.some(s=>s.id===sid)).toBe(false); expect(window.totalSessions).toBe(502);
        expect((await learningCandidates(uid)).items.some(i => i.id === pid)).toBe(false); expect((await learningCandidates(uid, true)).items.some(i => i.id === pid)).toBe(true); await write(a, { action: "delete", revision: 1, requestId: randomUUID() }, uid); expect((await sql("select id from public.training_sessions where id=$1",[sid],uid)).rows).toHaveLength(1); });
    it("new audited, HMAC-saved review updates evidence after consent; snapshot and notes aren't analysis", async () => { const uid = await learningUser(); await learningPref(uid, { reviewEvidence: true, repeat: true }); const sid = await learningSession(uid); const reviewId = (await sql<{
        v: string;
    }>("select public.create_cf_review($1,$2::jsonb) v", [problemIds[1], JSON.stringify({ sessionId: sid, requestId: randomUUID(), code: "int main(){}", source: "paste", fileName: null, problemUrl: "", statement: "user context", submissionId: null, confirmation })], uid)).rows[0]!.v; expect((await evidence(uid)).reviews).toEqual([]); const qid = randomUUID(); const reservation = await learningSigned(uid, "review_reserve", { operation: "review_reserve", reviewId, requestId: qid, fingerprint: "f".repeat(64), question: "", dailyLimit: 100 }); const review = reviewSchema.parse((await db.query<{
        v: unknown;
    }>("select to_jsonb(r) v from public.code_reviews r where id=$1", [reviewId])).rows[0]!.v); const analysis = auditReview(JSON.stringify({ summary: "[FIXTURE]", correctness: "静态分析，未运行代码", assumptions: "输入待确认", timeComplexity: "O(1)", spaceComplexity: "O(1)", lineAnalysis: [{ start: 1, end: 1, analysis: "程序入口" }], risks: "可能溢出；边界问题。", improvements: "检查边界", alternatives: "", transferableKnowledge: "数论与数学。", revisionQuestions: ["输入约束？"], answer: "" }), review, []); await learningSigned(uid, "review_finish", { operation: "review_finish", reviewId, requestId: qid, leaseNonce: reservation.leaseNonce, codeHash: review.code_hash, success: true, analysis, model: "fixture", promptVersion: "fixture/learning", usage: [] }); const e = await evidence(uid); expect(e.reviews).toHaveLength(1); expect(e.reviews[0]!.id).toBe(qid); const r = recommend(e, (await learningCandidates(uid, true)).items); expect(r.items.find(i => i.problem.id === problemIds[1])!.factors.review).toBeGreaterThan(0); expect(abilityProfile(e).reviewDirections.every(d => d.source.includes("未验证"))).toBe(true); expect(JSON.stringify(e)).not.toMatch(/code_snapshot|lease_nonce|usage|context_evidence|fingerprint/); const other = await learningUser(); expect((await evidence(other)).reviews).toEqual([]); await learningPref(uid, { reviewEvidence: false }, 1); expect((await evidence(uid)).reviews).toEqual([]); expect((await db.query<{
        analysis: unknown;
    }>("select analysis from public.review_requests where id=$1", [qid])).rows[0]!.analysis).toEqual(analysis); });
    it("feedback persists, is idempotent and isolated, cannot forge official state and alters next recommendation", async () => { const uid = await learningUser(); await learningPref(uid); const input = { action: "feedback", requestId: randomUUID(), problemId: problemIds[0], kind: "too_hard" }; await learningWrite(uid, input); await learningWrite(uid, input); const e = await evidence(uid); expect(e.feedback).toHaveLength(1); expect(recommend(e, (await learningCandidates(uid)).items).shift).toBe(-100); await expect(learningWrite(uid, { ...input, kind: "too_easy" })).rejects.toMatchObject({ code: "PT409" }); await expect(learningWrite(uid, { ...input, requestId: randomUUID(), official_verdict: "OK" })).rejects.toMatchObject({ code: "23514" }); const other = await learningUser(); expect((await evidence(other)).feedback).toEqual([]); expect((await sql("select * from public.recommendation_feedback", [], other)).rows).toEqual([]); await expect(sql("insert into public.recommendation_feedback values($1,$2,$3,'too_easy')", [randomUUID(), uid, problemIds[0]], other)).rejects.toMatchObject({ code: "42501" }); });
    it("completed unsolved L0 doesn't leak tags; invalid candidate query cannot expose arbitrary private data", async () => { const uid = await learningUser(); const sid = await learningSession(uid); await sql("select public.transition_training_session($1,'finish',1,'unsolved')", [sid], uid); expect((await evidence(uid)).sessions[0]!.tags).toEqual([]); expect(abilityProfile(await evidence(uid)).directions).toEqual([]); for (const extra of [{ userId: alice }, { target: null }, { themes: [123] }])
        await expect(sql("select public.learning_candidates($1::jsonb)", [JSON.stringify({ min: 800, max: 1800, target: 1400, themes: [], repeat: false, ...extra })], uid)).rejects.toMatchObject({ code: "23514" }); });
});
