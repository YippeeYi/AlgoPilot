// PostgreSQL semantics in serial PGlite; synthetic claims, NOT native/hosted acceptance.
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {database,publish,query,alice,fixtureSecret} from '../evaluation/database';
import {signTutorPayload} from '@/server/tutor/repository';
import {trainingFeedbackSchema,type TrainingFeedback} from '@/lib/validation/training-feedback';
import {trainingFeedbackSummary,trainingFeedbackState,recommendationObservation} from '@/features/learning/training-feedback';
import {evidenceSchema} from '@/lib/validation/learning';
import {skillIntelligence} from '@/features/learning/intelligence';
vi.mock('server-only',()=>({}));
let db:PGlite,owner:string,other:string,ids:string[],legacy:unknown;
async function record(problemIds=ids.slice(1,3),changes:Record<string,unknown>={},uid=owner){
  const p={operation:'recommendation_record',runId:randomUUID(),revision:0,officialRevision:0,repeat:false,focus:null,baseline:null,problemIds,...changes};
  const s=signTutorPayload(p,uid,fixtureSecret);const result=(await query<{v:{available:boolean;items:{id:string;problemId:string}[]}}>(db,'select public.record_recommendation_run($1,$2) v',[s.p_payload,s.p_signature],uid)).rows[0]!.v;
  return {payload:p,result};
}
async function choose(id:string,action='start',uid=owner){return (await query<{v:{sessionId:string|null;resumed:boolean}}>(db,'select public.recommendation_choice($1,$2) v',[id,action],uid)).rows[0]!.v;}
async function read(uid=owner,window='all',sessionId:string|null=null):Promise<TrainingFeedback>{return trainingFeedbackSchema.parse((await query<{v:unknown}>(db,'select public.recommendation_training_evidence($1,$2) v',[window,sessionId],uid)).rows[0]!.v);}
async function start(problemId:string,uid=owner){return (await query<{id:string;state_revision:number}>(db,'select id,state_revision from public.start_cf_session($1::jsonb)',[JSON.stringify({problemId,requestId:randomUUID()})],uid)).rows[0]!;}
async function finish(id:string,outcome='solved_self_reported',revision=1){await query(db,"select public.transition_training_session($1,'finish',$2,$3)",[id,revision,outcome],owner);}
beforeAll(async()=>{
  db=await database('202610270012');await publish(db,Array.from({length:8},(_,i)=>({contestId:70000+i,index:'A',name:'[SYNTHETIC] feedback',rating:1400,tags:['graphs'],solvedCount:null})));
  ids=(await db.query<{id:string}>('select id from public.problems order by contest_id')).rows.map(r=>r.id);
  await start(ids[0]!,alice);legacy=(await db.query('select to_jsonb(s) from public.training_sessions s')).rows;
  await db.exec(await readFile('supabase/migrations/202610280013_recommendation_training_feedback.sql','utf8'));
},30000);
beforeEach(async()=>{owner=randomUUID();other=randomUUID();await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);});
afterAll(()=>db?.close());
it('013 preserves 001–012 history, enables private RLS and narrows function privileges',async()=>{
  expect((await db.query('select to_jsonb(s) from public.training_sessions s')).rows).toEqual(legacy);
  expect((await db.query<{v:boolean}>("select relrowsecurity v from pg_class where oid='algopilot_private.recommendation_trials'::regclass")).rows[0]!.v).toBe(true);
  for(const signature of ['record_recommendation_run(text,text)','recommendation_choice(uuid,text)','recommendation_training_evidence(text,uuid)']){
    expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated from pg_proc where oid=$1::regprocedure",['public.'+signature])).rows[0]).toEqual({prosecdef:true,proconfig:['search_path=""'],anon:false,authenticated:true});
  }
  const definitions=(await db.query("select oid::regprocedure::text,pg_get_functiondef(oid) from pg_proc where pronamespace='public'::regnamespace order by oid")).rows;
  await expect(db.exec(await readFile('supabase/migrations/202610280013_recommendation_training_feedback.sql','utf8'))).rejects.toMatchObject({code:'42P07'});await db.exec('rollback');
  expect((await db.query("select oid::regprocedure::text,pg_get_functiondef(oid) from pg_proc where pronamespace='public'::regnamespace order by oid")).rows).toEqual(definitions);
});
it('records only signed actual snapshots; idempotent replay returns same receipts and changed intent conflicts',async()=>{
  const first=await record();expect((await read()).items).toHaveLength(2);
  const repeat=await record(undefined,{...first.payload});expect(repeat.result).toEqual(first.result);
  await expect(record([ids[4]!],{...first.payload,problemIds:[ids[4]!]})).rejects.toMatchObject({code:'PT409'});
  await expect(query(db,'select public.record_recommendation_run($1,$2)',['{}','00'.repeat(32)],owner)).rejects.toMatchObject({code:'42501'});
  await expect(record([ids[0]!],{owner:other})).rejects.toMatchObject({code:'23514'});
  expect((await read()).items).toHaveLength(2);
});
it('rejects partial/bad snapshots atomically without retaining a good prefix',async()=>{
  await expect(record([ids[1]!,randomUUID()])).rejects.toMatchObject({code:'23514'});
  await expect(record([ids[1]!,ids[1]!])).rejects.toMatchObject({code:'23514'});
  await expect(record([ids[1]!],{focus:{topic:'graphs',window:'30'},baseline:{samples:null,solved:0,concerns:0}})).rejects.toMatchObject({code:'23514'});
  expect((await read()).items).toEqual([]);
});
it('keeps users isolated for reads, start/skip and direct private access, even with identical run IDs',async()=>{
  const r=await record(),item=r.result.items[0]!;
  expect((await read(other)).items).toEqual([]);await expect(choose(item.id,'start',other)).rejects.toMatchObject({code:'P0002'});
  await expect(choose(item.id,'skip',other)).rejects.toMatchObject({code:'P0002'});
  await expect(query(db,'select * from algopilot_private.recommendation_trials',[],owner)).rejects.toMatchObject({code:'42501'});
  await expect(query(db,'delete from algopilot_private.recommendation_trials',[],other)).rejects.toMatchObject({code:'42501'});
  await record([ids[2]!],{runId:r.payload.runId},other);expect((await read(other)).items).toHaveLength(1);expect((await read()).items).toHaveLength(2);
});
it('skip is idempotent and never a failure; start retries reuse one session and cannot later be skipped',async()=>{
  const r=await record([ids[1]!]),id=r.result.items[0]!.id;
  await choose(id,'skip');const first=await read();await choose(id,'skip');expect(await read()).toEqual(expect.objectContaining({items:first.items}));
  expect(trainingFeedbackState(first.items[0]!)).toBe('skipped');expect((await query(db,'select id from public.training_sessions',[],owner)).rows).toEqual([]);
  const initial=await choose(id),again=await choose(id);expect(initial.resumed).toBe(false);expect(again).toEqual({sessionId:initial.sessionId,resumed:true});
  await expect(choose(id,'skip')).rejects.toMatchObject({code:'PT409'});expect((await query(db,'select id from public.training_sessions',[],owner)).rows).toHaveLength(1);
});
it('another recommendation restores the prior attempt without double attribution; legacy restoration is also explicit',async()=>{
  const r=await record([ids[1]!]),a=await choose(r.result.items[0]!.id);
  const next=await record([ids[1]!]),b=await choose(next.result.items[0]!.id);expect(b).toEqual({sessionId:a.sessionId,resumed:true});
  expect(trainingFeedbackSummary((await read()).items)).toMatchObject({chosen:2,restored:1,attempts:1,solved:0});
  const old=await start(ids[2]!);await query(db,"select public.save_training_draft($1,'thought','preserved',0)",[old.id],owner);
  const before=(await query(db,'select id,thought_draft,state_revision from public.training_sessions where id=$1',[old.id],owner)).rows;
  const legacyRun=await record([ids[2]!]);expect(await choose(legacyRun.result.items[0]!.id)).toEqual({sessionId:old.id,resumed:true});
  expect((await query(db,'select id,thought_draft,state_revision from public.training_sessions where id=$1',[old.id],owner)).rows).toEqual(before);
  expect((await read(owner,'all',old.id)).items[0]!.originated).toBe(false);
});
it('self-reported completion flows into current profile and full-history exclusion; ended receipts always restore the same history',async()=>{
  const r=await record([ids[1]!],{focus:{topic:'graphs',window:'30'},baseline:{samples:5,concerns:3,solved:4}}),id=r.result.items[0]!.id;
  const a=await choose(id);await finish(a.sessionId!);await finish(a.sessionId!);
  const rows=(await read()).items;expect(trainingFeedbackState(rows[0]!)).toBe('self_reported');expect(rows[0]!.official).toBe('disabled');
  const e=evidenceSchema.parse((await query<{v:unknown}>(db,'select public.learning_evidence() v',[],owner)).rows[0]!.v);
  expect(skillIntelligence(e,'all',Date.now()+1).recent).toMatchObject({completedProblems:1,selfReportedSolved:1,medianSolvedRating:null});
  const pool=(await query<{v:{items:{id:string}[]}}>(db,'select public.learning_candidates($1::jsonb) v',[JSON.stringify({min:1200,max:1800,themes:[],target:1400,repeat:false})],owner)).rows[0]!.v;
  expect(pool.items.map(p=>p.id)).not.toContain(ids[1]!);expect(await choose(id)).toEqual({sessionId:a.sessionId,resumed:true});
  const stale=await record([ids[1]!]);await expect(choose(stale.result.items[0]!.id)).rejects.toMatchObject({code:'PT409'});
  expect((await query(db,'select id from public.training_sessions',[],owner)).rows).toHaveLength(1);
});
it('five actual SQL-linked results refresh growth, source denominators and owned next-action evidence without a new metric table',async()=>{
  const r=await record(ids.slice(1,6));expect(recommendationObservation(await read())).toMatchObject({loaded:5,selected:0,started:0,solved:0});
  for(const receipt of r.result.items){const a=await choose(receipt.id);await finish(a.sessionId!);expect(await choose(receipt.id)).toEqual({sessionId:a.sessionId,resumed:true});}
  const feedback=await read();expect(recommendationObservation(feedback)).toMatchObject({loaded:5,started:5,ended:5,solved:5,completion:{numerator:5,denominator:5},officialAfterRecommendation:null});
  const e=evidenceSchema.parse((await query<{v:unknown}>(db,'select public.learning_evidence() v',[],owner)).rows[0]!.v);
  const growth=skillIntelligence(e,'30',Date.now()+1).growth;
  expect(growth).toMatchObject({current:{problems:5,known:5,solved:5},previous:{problems:0},comparison:'insufficient',medianChange:null});
  expect(growth.actions).toMatchObject([{topic:'graphs',reason:'new_evidence'}]);
  expect(recommendationObservation(await read(other))).toMatchObject({loaded:0,started:0,solved:0});
  const peer=evidenceSchema.parse((await query<{v:unknown}>(db,'select public.learning_evidence() v',[],other)).rows[0]!.v);expect(skillIntelligence(peer,'30',Date.now()+1).growth.current.problems).toBe(0);
});
it.each(['unsolved','abandoned','not_recorded'])('preserves %s as a distinct result, never official or synthetic success',async outcome=>{
  const r=await record([ids[1]!]),a=await choose(r.result.items[0]!.id);await finish(a.sessionId!,outcome);
  const rows=(await read()).items;expect(rows[0]!.outcome).toBe(outcome);expect(trainingFeedbackSummary(rows)).toMatchObject({solved:0,ended:1,completion:null});
});
it('cohort windows use issue time, missing official sync is UNKNOWN and stale preference source requires refresh',async()=>{
  const r=await record([ids[1]!]);await db.query("update algopilot_private.recommendation_trials set issued_at=clock_timestamp()-interval '10 days' where user_id=$1",[owner]);
  expect((await read(owner,'7')).items).toEqual([]);expect((await read(owner,'30')).items).toHaveLength(1);
  await query(db,'select public.learning_write($1::jsonb)',[JSON.stringify({action:'preferences',requestId:randomUUID(),revision:0,preferences:{min:800,max:1800,themes:[],goal:'balanced',repeat:false,reviewEvidence:false}})],owner);
  await expect(choose(r.result.items[0]!.id)).rejects.toMatchObject({code:'PT409'});expect((await read()).items[0]!.sessionId).toBeNull();
});
it('official WA/OK revisions and duplicate pages update only observed public evidence, not the local outcome',async()=>{
  const command=async(p:Record<string,unknown>)=>{const s=signTutorPayload({operation:'cf_account',...p},owner,fixtureSecret);return (await query<{v:Record<string,unknown>}>(db,'select public.cf_account_command($1,$2) v',[s.p_payload,s.p_signature],owner)).rows[0]!.v;};
  const state=async()=>(await query<{v:{revision:number;evidenceRevision:number}}>(db,'select public.cf_account_state() v',[],owner)).rows[0]!.v;
  const bind=await command({action:'reserve',kind:'bind',handle:'Fixture_User',revision:0,requestId:randomUUID()});await command({action:'bind',nonce:bind.nonce,scope:bind.scope,handle:'Fixture_User',registrationSeconds:10});
  const enable=await command({action:'reserve',kind:'enable',revision:(await state()).revision,requestId:randomUUID()});await command({action:'enable',nonce:enable.nonce,scope:enable.scope,handle:'Fixture_User',registrationSeconds:10});
  const r=await record([ids[1]!],{officialRevision:(await state()).evidenceRevision});expect((await read()).items[0]!.official).toBe('not_synced');
  const attempt=await choose(r.result.items[0]!.id);await finish(attempt.sessionId!,'unsolved');
  const lease=await command({action:'reserve',kind:'sync',revision:(await state()).revision,requestId:randomUUID()});
  const row={submissionId:100,contestId:70001,index:'A',createdSeconds:10000,verdict:'WRONG_ANSWER'};
  const page={action:'page',nonce:lease.nonce,scope:lease.scope,requestId:randomUUID(),purpose:'pending',from:1,resetCycle:randomUUID(),submissions:[row]};
  await command(page);expect((await read()).items[0]!.official).toBe('not_observed');
  const ok={...page,requestId:randomUUID(),submissions:[{...row,verdict:'OK'}]};await command(ok);await command(ok);
  const evidence=(await read()).items;expect(evidence).toHaveLength(1);expect(evidence[0]).toMatchObject({official:'observed_ok',outcome:'unsolved'});
  expect(trainingFeedbackSummary(evidence)).toMatchObject({solved:0,unsolved:1,attempts:1});
  await command({action:'consent',enabled:false,revision:(await state()).revision,requestId:randomUUID()});expect((await read()).items[0]!.official).toBe('disabled');
  expect(await choose(r.result.items[0]!.id)).toEqual({sessionId:attempt.sessionId,resumed:true});
});
