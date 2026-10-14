import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { database, query, alice, bob, fixtureSecret, publish } from "../evaluation/database";
import { signTutorPayload } from "@/server/tutor/repository";
import { cfAccountStateSchema } from "@/lib/validation/cf-account";
import { initialCfCursor, advanceCfCursor } from "@/features/learning/cf-cursor";
import { readFile } from 'node:fs/promises';
import { parseUserStatus, parseUserInfo } from '@/server/codeforces/account-parser';
vi.mock("server-only", () => ({}));
let db: PGlite;
const command = async (v: Record<string, unknown>, uid = alice) => { const p = signTutorPayload({ operation: 'cf_account', ...v }, uid, fixtureSecret); return (await query<{ v: Record<string, unknown> }>(db, 'select public.cf_account_command($1,$2) v', [p.p_payload, p.p_signature], uid)).rows[0]!.v; };
const state = async (uid = alice) => cfAccountStateSchema.parse((await query<{ v: unknown }>(db, 'select public.cf_account_state() v', [], uid)).rows[0]!.v);
beforeAll(async () => { db = await database(); }, 30000);
afterAll(() => db?.close());
it("applies 010, binds public identities independently, denies forged verdicts and preserves source scopes", async () => {
    expect(await state()).toMatchObject({ revision: 0, handle: null, enabled: false, ownershipVerified: false });
    for (const uid of [alice, bob]) {
        const lease = await command({ action: 'reserve', kind: 'bind', handle: 'Public_Handle', revision: 0, requestId: randomUUID() }, uid);
        await command({ action: 'bind', nonce: lease.nonce, scope: lease.scope, handle: 'Public_Handle', registrationSeconds: 1000 }, uid);
        expect(await state(uid)).toMatchObject({ revision: 1, handle: 'Public_Handle', enabled: false });
    }
    await expect(query(db, 'select public.cf_account_command($1,$2)', ['{}', '00'.repeat(32)])).rejects.toMatchObject({ code: '42501' });
});
it("persists actual pages, revises verdicts, excludes AC before shortlist and revokes all derived evidence", async () => {
    await publish(db, [{ contestId: 9999, index: 'A', name: 'SQL fixture', rating: 1000, tags: ['dp'], solvedCount: null }]);
    const s = await state();
    const enable = await command({ action: 'reserve', kind: 'enable', revision: s.revision, requestId: randomUUID() });
    await command({ action: 'enable', nonce: enable.nonce, scope: enable.scope, handle: 'Public_Handle', registrationSeconds: 1000 });
    const lease = await command({ action: 'reserve', kind: 'sync', revision: (await state()).revision, requestId: randomUUID() });
    const row = { submissionId: 100, contestId: 9999, index: 'A', createdSeconds: 10000, verdict: 'TESTING' };
    await command({ action: 'page', nonce: lease.nonce, scope: lease.scope, requestId: randomUUID(), purpose: 'head', from: 1, resetCycle: randomUUID(), submissions: [row] });
    await command({ action: 'page', nonce: lease.nonce, scope: lease.scope, requestId: randomUUID(), purpose: 'history', from: 1, resetCycle: randomUUID(), submissions: [{ ...row, verdict: 'OK' }] });
    expect(await state()).toMatchObject({ acceptedProblems: 1, pendingSubmissions: 0, lastFullScanAt: null });
    const readPool = async () => (await query<{ v: { total: number } }>(db, 'select public.learning_candidates($1) v', [JSON.stringify({ min: 800, max: 1200, target: 1000, themes: [], repeat: false })])).rows[0]!.v;
    expect((await readPool()).total).toBe(0);
    await command({ action: 'page', nonce: lease.nonce, scope: lease.scope, requestId: randomUUID(), purpose: 'history', from: 2, resetCycle: randomUUID(), submissions: [] });
    expect((await state()).lastFullScanAt).not.toBeNull();
    await command({ action: 'consent', enabled: false, revision: (await state()).revision, requestId: randomUUID() });
    expect((await readPool()).total).toBe(1);
    await expect(command({ action: 'page', nonce: lease.nonce, scope: lease.scope, requestId: randomUUID(), purpose: 'pending', from: 1, resetCycle: randomUUID(), submissions: [row] })).rejects.toMatchObject({ code: 'PT409' });
});
it("keeps SQL/TypeScript checkpoint rules equal and restarts drift without asserting complete",async()=>{
    const c=initialCfCursor(randomUUID()),cycle=randomUUID(),ids=Array.from({length:200},(_,i)=>1000-i);
    const advance=async(cursor:unknown,page:number[],head=false)=>(await db.query<{v:unknown}>('select algopilot_private.cf_advance_cursor($1,$2,$3,$4) v',[JSON.stringify(cursor),page,cycle,head])).rows[0]!.v;
    const next=advanceCfCursor(c,ids,cycle);expect(await advance(c,ids)).toEqual(next);
    expect(await advance(next,Array.from({length:200},(_,i)=>1500-i))).toEqual(advanceCfCursor(next,Array.from({length:200},(_,i)=>1500-i),cycle));
    const short=advanceCfCursor(c,[9,8],cycle);expect(await advance(short,[])).toEqual(advanceCfCursor(short,[],cycle));
    expect(await advance(next,[])).toEqual(advanceCfCursor(next,[],cycle));
});
it("deduplicates IDs/AC, changes old verdicts, rejects stale guards and keeps two linked users isolated",async()=>{
    const rev=(await state()).revision,enable=await command({action:'reserve',kind:'enable',revision:rev,requestId:randomUUID()});await command({action:'enable',nonce:enable.nonce,scope:enable.scope,handle:'Public_Handle',registrationSeconds:1000});
    const runId=randomUUID(),lease=await command({action:'reserve',kind:'sync',revision:(await state()).revision,requestId:runId});
    const row={submissionId:101,contestId:9999,index:'A',createdSeconds:10001,verdict:'OK'},body={action:'page',nonce:lease.nonce,scope:lease.scope,requestId:randomUUID(),purpose:'pending',from:1,resetCycle:randomUUID(),submissions:[row]};
    await command(body);const before=await state();await command(body);expect((await state()).evidenceRevision).toBe(before.evidenceRevision);expect((await state()).acceptedProblems).toBe(1);
    await command({...body,requestId:randomUUID(),submissions:[{...row,verdict:'WRONG_ANSWER'}]});expect((await state()).acceptedProblems).toBe(1); // Older separate OK still exists.
    await command({...body,requestId:randomUUID(),submissions:[{submissionId:100,contestId:9999,index:'A',createdSeconds:10000,verdict:'CHALLENGED'}]});expect((await state()).acceptedProblems).toBe(0);
    await expect(command({...body,requestId:randomUUID(),submissions:[{...row,index:'B'}]})).rejects.toMatchObject({code:'PT409'});
    await expect(query(db,'select public.learning_evidence_guard(0,$1)',[before.evidenceRevision])).rejects.toMatchObject({code:'PT409'});
    expect(await state(bob)).toMatchObject({acceptedProblems:0,observedSubmissions:0,handle:'Public_Handle'});
    const e=(await query<{v:{official:{items:unknown[]}}}>(db,'select public.learning_evidence() v',[],bob)).rows[0]!.v;expect(e.official.items).toEqual([]);
    for(const table of ['cf_accounts','cf_submissions','cf_account_receipts'])await expect(query(db,`select * from algopilot_private.${table}`,[],bob)).rejects.toMatchObject({code:'42501'});
    await command({action:'finish',nonce:lease.nonce,scope:lease.scope});expect(await command({action:'reserve',kind:'sync',revision:(await state()).revision,requestId:runId})).toMatchObject({acquired:false,replayed:true});
});
it("replaces/unlinks/deletes association data without changing training and forbids an old scope from returning",async()=>{
    const trainingBefore=(await db.query('select * from public.training_sessions')).rows;
    const old=(await db.query<{scope_id:string}>('select scope_id from algopilot_private.cf_accounts where user_id=$1',[alice])).rows[0]!.scope_id;
    const bind=await command({action:'reserve',kind:'bind',handle:'Other_Handle',revision:(await state()).revision,requestId:randomUUID()});await command({action:'bind',nonce:bind.nonce,scope:bind.scope,handle:'Other_Handle',registrationSeconds:2000});
    expect(await state()).toMatchObject({handle:'Other_Handle',acceptedProblems:0,observedSubmissions:0,enabled:false});expect((await db.query<{scope_id:string}>('select scope_id from algopilot_private.cf_accounts where user_id=$1',[alice])).rows[0]!.scope_id).not.toBe(old);
    await expect(command({action:'page',nonce:bind.nonce,scope:old,requestId:randomUUID(),purpose:'pending',from:1,resetCycle:randomUUID(),submissions:[]})).rejects.toMatchObject({code:'PT409'});
    const requestId=randomUUID(),revision=(await state()).revision;await command({action:'unlink',requestId,revision});await command({action:'unlink',requestId,revision});expect(await state()).toMatchObject({handle:null,enabled:false,observedSubmissions:0});
    await command({action:'delete',requestId:randomUUID(),revision:(await state()).revision});expect((await db.query('select * from algopilot_private.cf_submissions where user_id=$1',[alice])).rows).toHaveLength(0);
    expect((await db.query('select * from public.training_sessions')).rows).toEqual(trainingBefore);expect((await state(bob)).handle).toBe('Public_Handle');
});
it("shares the same request clock with catalog sync, rather than providing a second API allowance",async()=>{
    const s=await state(bob),lease=await command({action:'reserve',kind:'sync',revision:s.revision,requestId:randomUUID()},bob);
    await db.exec("update algopilot_private.cf_cache_state set next_slot_at='-infinity',next_attempt_at='-infinity',lease_nonce=null,lease_until=null");
    const p=signTutorPayload({operation:'cf_sync',action:'reserve',force:true},alice,fixtureSecret);const catalog=(await query<{v:{nonce:string}}>(db,'select public.cf_sync($1,$2) v',[p.p_payload,p.p_signature])).rows[0]!.v;
    expect(await command({action:'slot',nonce:lease.nonce,scope:lease.scope},bob)).toMatchObject({waitMs:0});
    const signed=signTutorPayload({operation:'cf_sync',action:'slot',nonce:catalog.nonce},alice,fixtureSecret);const slot=(await query<{v:{waitMs:number}}>(db,'select public.cf_sync($1,$2) v',[signed.p_payload,signed.p_signature])).rows[0]!.v;expect(slot.waitMs).toBeGreaterThan(0);expect(slot.waitMs).toBeLessThanOrEqual(3000);
});

it('resumes committed multi-page history after crash, tolerates overlap drift, checks EOF and revisits pending verdicts',async()=>{
    const uid=randomUUID();await db.query('insert into auth.users(id) values($1)',[uid]);
    const act=(v:Record<string,unknown>)=>command(v,uid);
    const bind=await act({action:'reserve',kind:'bind',handle:'Public_Handle',revision:0,requestId:randomUUID()});await act({action:'bind',nonce:bind.nonce,scope:bind.scope,handle:'Public_Handle',registrationSeconds:10});
    const start=async()=>act({action:'reserve',kind:'sync',revision:(await state(uid)).revision,requestId:randomUUID()});
    const lease=await start(),rows=Array.from({length:350},(_,i)=>({submissionId:1000-i,contestId:9999,index:'A',createdSeconds:10000-i,verdict:i===0?null:'OK'}));
    const page=(l:Record<string,unknown>,purpose:string,from:number,submissions:unknown[])=>act({action:'page',nonce:l.nonce,scope:l.scope,requestId:randomUUID(),purpose,from,resetCycle:randomUUID(),submissions});
    await page(lease,'head',1,rows.slice(0,200));await page(lease,'history',1,rows.slice(0,200));
    expect(await state(uid)).toMatchObject({historyFrom:161,historyInProgress:true,lastFullScanAt:null,observedSubmissions:200,highWater:1000,pendingSubmissions:1});
    await db.query("update algopilot_private.cf_accounts set lease_until=clock_timestamp()-interval '1 second',next_attempt_at='-infinity' where user_id=$1",[uid]);
    const resumed=await start();await expect(page(lease,'history',161,rows.slice(160))).rejects.toMatchObject({code:'PT409'});
    const newRows=Array.from({length:10},(_,i)=>({...rows[1]!,submissionId:1010-i,createdSeconds:10010-i})),shifted=[...newRows,...rows];
    await page(resumed,'history',161,shifted.slice(160,360));expect((await state(uid)).historyFrom).toBe(321);
    await page(resumed,'history',321,shifted.slice(320));expect((await state(uid)).lastFullScanAt).toBeNull();
    await page(resumed,'history',361,[]);expect((await state(uid)).lastFullScanAt).not.toBeNull();
    await page(resumed,'pending',1,[{...rows[0]!,verdict:'OK'}]);expect((await state(uid)).pendingSubmissions).toBe(0);
    await act({action:'finish',nonce:resumed.nonce,scope:resumed.scope});const incremental=await start();await page(incremental,'head',1,shifted.slice(0,200));expect((await state(uid)).highWater).toBe(1010);
    // A later large drift loses the overlap: facts persist, checkpoint restarts, completeness is not promoted.
    await page(incremental,'history',1,shifted.slice(0,200));await page(incremental,'history',161,Array.from({length:200},(_,i)=>({...rows[1]!,submissionId:5000-i,createdSeconds:15000-i})));
    expect(await state(uid)).toMatchObject({historyFrom:1,historyInProgress:true});
    expect((await db.query<{v:{gaps:number}}>('select history v from algopilot_private.cf_accounts where user_id=$1',[uid])).rows[0]!.v.gaps).toBe(1);
    await act({action:'finish',nonce:incremental.nonce,scope:incremental.scope});const empty=await start();
    await page(empty,'history',1,[]);expect(await state(uid)).toMatchObject({observedSubmissions:0,acceptedProblems:0,pendingSubmissions:0,historyInProgress:false});
    // Withdrawing no-longer-observed facts is not an "unsolved" training outcome.
    expect((await db.query('select * from public.training_sessions where user_id=$1',[uid])).rows).toHaveLength(0);
});

it('replays actual minimized official responses as public facts, not a complete history or owned account',async()=>{
    const recording=JSON.parse(await readFile('docs/m33/public-api.json','utf8'));
    const identity=parseUserInfo(recording.calls[0].response,recording.handle),pages=recording.calls.slice(1).map((c:{response:unknown})=>parseUserStatus(c.response,recording.handle,200));
    expect(pages).toHaveLength(2);expect(pages[0]).toHaveLength(200);expect(new Set(pages.flat().map((p:{submissionId:number})=>p.submissionId)).size).toBe(360);
    const uid=randomUUID();await db.query('insert into auth.users(id) values($1)',[uid]);const act=(v:Record<string,unknown>)=>command(v,uid);
    const bind=await act({action:'reserve',kind:'bind',handle:recording.handle,revision:0,requestId:randomUUID()});await act({action:'bind',nonce:bind.nonce,scope:bind.scope,...identity});
    const lease=await act({action:'reserve',kind:'sync',revision:1,requestId:randomUUID()});
    for(let i=0;i<2;i++)await act({action:'page',nonce:lease.nonce,scope:lease.scope,requestId:randomUUID(),purpose:'history',from:1+i*160,resetCycle:randomUUID(),submissions:pages[i]});
    expect(await state(uid)).toMatchObject({observedSubmissions:360,historyFrom:321,historyInProgress:true,lastFullScanAt:null,ownershipVerified:false,enabled:false});
});
