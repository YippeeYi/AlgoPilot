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
    for (const f of files.filter(f => !f.includes('006')))
        await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
    await db.query("insert into auth.users values($1,'a@test'),($2,'b@test')", [alice, bob]);
    legacyId = (await sql<{
        id: string;
    }>("select id from public.create_custom_problem('旧私人题','旧题面',$1)", [randomUUID()])).rows[0]!.id;
    legacySession = (await sql<{
        id: string;
    }>("select id from public.create_training_session($1,null,'practice',$2)", [legacyId, randomUUID()])).rows[0]!.id;
    await db.exec(await readFile("supabase/migrations/202610120006_cf_catalog_plans.sql", "utf8"));
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
