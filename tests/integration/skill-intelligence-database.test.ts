// Real SQL/RLS in serial PGlite with synthetic claims. NOT native multi-connection/hosted acceptance.
import { beforeAll,afterAll,it,expect,vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { database,publish,query,alice,bob,fixtureSecret } from "../evaluation/database";
import { evidenceSchema,defaultPreferences } from "@/lib/validation/learning";
import { skillIntelligence } from "@/features/learning/intelligence";
import { recommendationTarget,recommend } from "@/features/learning/engine";
import { learningRepository, } from "@/server/learning/repository";
import { signTutorPayload } from "@/server/tutor/repository";
vi.mock('server-only',()=>({}));
let db:PGlite,ids:string[];
const signed=async(name:string,p:Record<string,unknown>)=>{const s=signTutorPayload(p,alice,fixtureSecret);return (await query<{v:Record<string,unknown>}>(db,`select public.${name}($1,$2) v`,[s.p_payload,s.p_signature])).rows[0]!.v;};
const read=async(uid=alice)=>evidenceSchema.parse((await query<{v:unknown}>(db,'select public.learning_evidence() v',[],uid)).rows[0]!.v);
const intelligence=async(uid=alice)=>skillIntelligence(await read(uid),'all',Date.now()+1);
async function train(problemId:string,hints=false) {
  const session=(await query<{id:string;state_revision:number}>(db,'select id,state_revision from public.start_cf_session($1::jsonb)',[JSON.stringify({problemId,requestId:randomUUID()})])).rows[0]!;
  if(hints){
    for(let revision=0;revision<3;revision++)await query(db,"select public.tutor_hint($1,'upgrade',$2,$3,null)",[session.id,revision,randomUUID()]);
    const requestId=randomUUID();const lease=await signed('tutor_reserve',{operation:'reserve',sessionId:session.id,requestId,action:'chat',fingerprint:'a'.repeat(64),dailyLimit:100});
    await signed('tutor_finish',{operation:'finish',sessionId:session.id,requestId,leaseNonce:lease.leaseNonce,success:true,usage:[],userMessage:'fixture',content:'synthetic reviewed message',disclosureLevel:3,verification:'not_applicable',thoughtRevision:0,codeRevision:0,promptVersion:'synthetic/sql'});
  }
  await query(db,"select public.transition_training_session($1,'finish',$2,'solved_self_reported')",[session.id,session.state_revision]);
}
beforeAll(async()=>{db=await database();await publish(db,Array.from({length:9},(_,i)=>({contestId:60000+i,index:'A',name:'[SYNTHETIC] skill evidence',rating:i===8?null:1400,tags:[i===7?'math':'graphs'],solvedCount:null})));
  ids=(await db.query<{id:string}>('select id from public.problems order by contest_id')).rows.map(r=>r.id);
},30000);
afterAll(()=>db?.close());
it('narrow signed Tutor writes become owned diagnosis; SQL candidate filtering and recommendation keep the same exclusions',async()=>{
  for(const id of ids.slice(0,5))await train(id,true);
  const input={action:'preferences',revision:0,requestId:randomUUID(),preferences:{...defaultPreferences,min:1200,max:1800}};
  await query(db,'select public.learning_write($1::jsonb)',[JSON.stringify(input)]);
  const e=await read(),r=await intelligence();expect(r.topics.find(t=>t.topic==='graphs')).toMatchObject({trainingSamples:5,concernSamples:5,action:{topic:'graphs',window:'all'}});
  const original=(await db.query('select * from public.training_sessions order by id')).rows;
  const p={...e.preferences!,themes:['graphs'] as ['graphs']};const {target}=recommendationTarget({...e,preferences:p});
  // Exercise actual Repository schema/policy checks against the SQL contract.
  const client={rpc:async(name:string,args:{p_query:unknown})=>({data:(await query<{v:unknown}>(db,`select public.${name}($1::jsonb) v`,[JSON.stringify(args.p_query)])).rows[0]!.v,error:null})} as unknown as Parameters<typeof learningRepository>[0];
  const pool=await learningRepository(client).candidates(p,target),result=recommend({...e,preferences:p},pool.items);
  expect(result.items).toHaveLength(2);expect(result.items.map(i=>i.problem.id).sort()).toEqual(ids.slice(5,7).sort());expect(result.items[0]!.refs.some(r=>r.kind==='training')).toBe(true);
  expect((await db.query('select * from public.training_sessions order by id')).rows).toEqual(original);
  expect((await intelligence(bob)).recent.completedProblems).toBe(0);expect((await intelligence(bob)).topics.every(t=>t.action===null)).toBe(true);
  expect((await query(db,'select id from public.training_sessions',[],bob)).rows).toEqual([]);
});
it('WA to AC, repeated OK and replayed sync pages count only official per-problem evidence; revoke removes it without altering training',async()=>{
  const command=(p:Record<string,unknown>)=>signed('cf_account_command',{operation:'cf_account',...p});
  const state=async()=>(await query<{v:{revision:number}}>(db,'select public.cf_account_state() v')).rows[0]!.v;
  const bind=await command({action:'reserve',kind:'bind',handle:'Fixture_User',revision:0,requestId:randomUUID()});await command({action:'bind',nonce:bind.nonce,scope:bind.scope,handle:'Fixture_User',registrationSeconds:10});
  const enable=await command({action:'reserve',kind:'enable',revision:(await state()).revision,requestId:randomUUID()});await command({action:'enable',nonce:enable.nonce,scope:enable.scope,handle:'Fixture_User',registrationSeconds:10});
  const lease=await command({action:'reserve',kind:'sync',revision:(await state()).revision,requestId:randomUUID()});
  const submission={submissionId:100,contestId:60005,index:'A',createdSeconds:100000,verdict:'WRONG_ANSWER'};
  const page={action:'page',nonce:lease.nonce,scope:lease.scope,requestId:randomUUID(),purpose:'pending',from:1,resetCycle:randomUUID(),submissions:[submission]};
  await command(page);expect((await intelligence()).coverage.officialAccepted).toBe(0);
  await command({...page,requestId:randomUUID(),submissions:[{...submission,verdict:'OK'}]});
  const ok={...page,requestId:randomUUID(),submissions:[{...submission,submissionId:102,contestId:60006},{...submission,submissionId:101,verdict:'OK'}]};await command(ok);
  const e=await read();expect(e.official!.items).toHaveLength(1);expect((await intelligence()).topics.find(t=>t.topic==='graphs')).toMatchObject({officialAccepted:1,knownOutcomes:5,concernSamples:5});
  await command(ok);expect(await read()).toEqual(e);expect((await intelligence(bob)).coverage.officialAccepted).toBe(0);
  const trainingBefore=(await db.query('select * from public.training_sessions order by id')).rows;
  await command({action:'consent',enabled:false,revision:(await state()).revision,requestId:randomUUID()});expect((await intelligence()).coverage.officialAccepted).toBe(0);
  expect((await db.query('select * from public.training_sessions order by id')).rows).toEqual(trainingBefore);
  expect((await db.query('select submission_id from algopilot_private.cf_submissions')).rows).toHaveLength(3);
});
it('new training refreshes latest-per-problem analysis without erasing old evidence or changing preferences',async()=>{
  const pref=(await read()).preferences;
  for(const id of ids.slice(0,5))await train(id);
  expect((await intelligence()).topics.find(t=>t.topic==='graphs')).toMatchObject({trainingSamples:5,highHints:0,concernSamples:0,action:null,status:'documented_practice'});
  const e=await read();expect(e.totalSessions).toBe(10);expect(e.preferences).toEqual(pref);
  expect((await db.query('select id from public.tutor_messages')).rows).toHaveLength(10);
});
