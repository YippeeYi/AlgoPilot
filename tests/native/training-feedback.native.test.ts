// Prepared native-only 013 increment. Ordinary test/test:e2e never executes these hooks.
import {beforeAll,beforeEach,afterAll,afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {PsqlConnection,validateTarget,literal as q,applyMigration,type NativeTarget} from './psql';
import {signTutorPayload} from '@/server/tutor/repository';
import {trainingFeedbackSchema} from '@/lib/validation/training-feedback';
import {nativeHistorySql} from '../../scripts/native-node-audit';

type Trial={id:string;problemId:string};
type Choice={sessionId:string|null;resumed:boolean};
const secret='e1'.repeat(32);
let target:NativeTarget,admin:PsqlConnection,a:PsqlConnection,b:PsqlConnection,c:PsqlConnection;
let owner:string,other:string,problems:string[];
const evidence:{backends:unknown[];locks:unknown[];boundary:string}={backends:[],locks:[],boundary:'013 native independent LOGIN, synthetic claims; NOT hosted JWT or application instances'};
async function begin(x:PsqlConnection,uid=owner){await x.query('begin isolation level read committed');await x.query(`set local request.jwt.claim.sub=${q(uid)}`);}
async function user<T>(x:PsqlConnection,uid:string,fn:()=>Promise<T>){await begin(x,uid);try{const v=await fn();await x.query('commit');return v;}catch(e){await x.query('rollback');throw e;}}
const outcome=<T,>(p:Promise<T>)=>p.then(value=>({code:'00000',value}), (e:{code?:string})=>({code:e.code??'CLIENT_FAILURE',value:undefined}));
function recordSql(runId=randomUUID(),ids=problems.slice(0,2),uid=owner,extra:Record<string,unknown>={}){
  const signed=signTutorPayload({operation:'recommendation_record',runId,revision:0,officialRevision:0,repeat:false,focus:null,baseline:null,problemIds:ids,...extra},uid,secret);
  return `select public.record_recommendation_run(${q(signed.p_payload)},${q(signed.p_signature)})`;
}
async function record(ids=problems.slice(0,2),uid=owner,x=a){return user(x,uid,()=>x.value<{items:Trial[]}>(recordSql(randomUUID(),ids,uid)));}
const choiceSql=(id:string,action='start')=>`select public.recommendation_choice(${q(id)},${q(action)})`;
const choose=(id:string,x=a,uid=owner,action='start')=>user(x,uid,()=>x.value<Choice>(choiceSql(id,action)));
const read=(x=a,uid=owner)=>user(x,uid,async()=>trainingFeedbackSchema.parse(await x.value("select public.recommendation_training_evidence('all',null)")));
const count=(table:string,uid=owner)=>admin.value<number>(`select to_json(count(*)) from ${table} where user_id=${q(uid)}`);
// Obtain PID BEFORE issuing a query which blocks this same connection.
const pids=new Map<PsqlConnection,number>();
async function blocked(x:PsqlConnection,holder:PsqlConnection){
  const id=pids.get(x)!,holderId=pids.get(holder)!,deadline=performance.now()+1500;
  while(performance.now()<deadline){
    const state=await admin.value<{wait:string;blockers:number[]}>(`select json_build_object('wait',wait_event_type,'blockers',pg_blocking_pids(pid)) from pg_stat_activity where pid=${id}`);
    if(state.wait==='Lock'&&state.blockers.includes(holderId)){evidence.locks.push(state);return;}
    await new Promise<void>(resolve=>setImmediate(resolve));
  }
  throw Error('013 expected lock barrier was not observed');
}
beforeAll(async()=>{
  if(!process.env.M353_NATIVE_TARGET)throw Error('Use the isolated native runner; target absent');
  target=JSON.parse(process.env.M353_NATIVE_TARGET);validateTarget(target);
  admin=new PsqlConnection(target,'fixture_admin');
  expect(await admin.value("select to_json(current_setting('data_directory'))")).toBe(target.directory);
  a=new PsqlConnection(target,'authenticated');b=new PsqlConnection(target,'authenticated');c=new PsqlConnection(target,'authenticated');
  for(const x of [a,b,c]){
    const role=await x.value<{pid:number;current:string;session:string;superuser:boolean;bypass:boolean;inherit:boolean;isolation:string;database:string;host:string;port:number}>("select json_build_object('pid',pg_backend_pid(),'current',current_user,'session',session_user,'superuser',rolsuper,'bypass',rolbypassrls,'inherit',rolinherit,'isolation',current_setting('transaction_isolation'),'database',current_database(),'host',inet_server_addr()::text,'port',inet_server_port()) from pg_roles where rolname=current_user");
    expect(role).toMatchObject({current:'authenticated',session:'authenticated',superuser:false,bypass:false,inherit:false,isolation:'read committed',database:target.database,host:'127.0.0.1',port:target.port});
    pids.set(x,role.pid);evidence.backends.push(role);
  }
  expect(new Set(pids.values()).size).toBe(3);
  expect(await admin.value("select to_json(to_regclass('algopilot_private.recommendation_trials') is not null)")).toBe(true);
  await admin.query(`insert into algopilot_private.cf_settings(signing_secret) values(${q(secret)})`);
  problems=[];
  for(let i=0;i<4;i++){
    const id=randomUUID();problems.push(id);
    await admin.query(`insert into public.problems(id,platform,contest_id,problem_index,title,rating,tags,canonical_url,metadata_synced_at) values(${q(id)},'codeforces',999990+${i},'R1','[SYNTHETIC] native 013',1400,'{}','https://codeforces.com/problemset/problem/'||(999990+${i})||'/R1',clock_timestamp())`);
  }
},30000);
beforeEach(async()=>{owner=randomUUID();other=randomUUID();await admin.query(`insert into auth.users(id) values(${q(owner)}),(${q(other)})`);});
afterEach(async()=>{for(const x of [a,b,c])if(x)await x.query('rollback');});
afterAll(async()=>{
  for(const x of [a,b,c,admin])if(x){try{await x.query('rollback');}catch{ /* Connection may already be closed after a failure. */ }await x.close();}
  if(target)await writeFile(join(dirname(target.directory),'native-013-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
});

it('013 RLS, ACL, definer path, ownership FK and uniqueness contracts are effective',async()=>{
  expect(await admin.value("select to_json(relrowsecurity) from pg_class where oid='algopilot_private.recommendation_trials'::regclass")).toBe(true);
  for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])
    expect(await admin.value(`select to_json(has_table_privilege(${q(role)},'algopilot_private.recommendation_trials',${q(privilege)}))`)).toBe(false);
  for(const name of ['record_recommendation_run(text,text)','recommendation_choice(uuid,text)','recommendation_training_evidence(text,uuid)']){
    expect(await admin.value(`select json_build_object('definer',prosecdef,'path',proconfig,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'public',exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) where grantee=0 and privilege_type='EXECUTE')) from pg_proc where oid=${q('public.'+name)}::regprocedure`)).toEqual({definer:true,path:['search_path=""'],anon:false,authenticated:true,public:false});
  }
  const constraints=await admin.value<{foreignKeys:number;uniqueKeys:number;checks:number}>("select json_build_object('foreignKeys',count(*) filter(where contype='f'),'uniqueKeys',count(*) filter(where contype='u'),'checks',count(*) filter(where contype='c')) from pg_constraint where conrelid='algopilot_private.recommendation_trials'::regclass");
  expect(constraints).toEqual({foreignKeys:3,uniqueKeys:1,checks:1});
  expect(await admin.value("select to_json(indisunique and indpred is not null) from pg_index where indexrelid='algopilot_private.recommendation_origin_once'::regclass")).toBe(true);
});
it('concurrent signed record replay waits, returns the same receipts and rejects changed intent or forgery',async()=>{
  const runId=randomUUID(),sql=recordSql(runId);await begin(a);
  const first=await a.value<{items:Trial[]}>(sql);
  const replay=outcome(user(b,owner,()=>b.value<{items:Trial[]}>(sql)));await blocked(b,a);await a.query('commit');
  expect((await replay).value).toEqual(first);expect(await count('algopilot_private.recommendation_trials')).toBe(2);
  await expect(user(c,owner,()=>c.value(recordSql(runId,[problems[2]!])))).rejects.toMatchObject({code:'PT409'});
  await expect(user(c,owner,()=>c.value(`select public.record_recommendation_run('{}',${q('00'.repeat(32))})`))).rejects.toMatchObject({code:'42501'});
});
it('an invalid suffix rolls back the whole record and a corrected request can reuse its ID',async()=>{
  const runId=randomUUID();await expect(user(a,owner,()=>a.value(recordSql(runId,[problems[0]!,randomUUID()])))).rejects.toMatchObject({code:'23514'});
  expect(await count('algopilot_private.recommendation_trials')).toBe(0);
  await user(b,owner,()=>b.value(recordSql(runId)));expect(await count('algopilot_private.recommendation_trials')).toBe(2);
});
it('concurrent skip preserves one explicit timestamp and never creates a training',async()=>{
  const item=(await record([problems[0]!])).items[0]!;await begin(a);await a.value(choiceSql(item.id,'skip'));
  const retry=outcome(choose(item.id,b,owner,'skip'));await blocked(b,a);await a.query('commit');expect((await retry).code).toBe('00000');
  const first=(await read()).items[0]!;await choose(item.id,c,owner,'skip');expect((await read()).items).toEqual([first]);
  expect(first.skippedAt).not.toBeNull();expect(first.chosenAt).toBeNull();expect(await count('public.training_sessions')).toBe(0);
});
it('same receipt concurrent start creates one session, one origin, and rejects later skip',async()=>{
  const item=(await record([problems[0]!])).items[0]!;await begin(a);const first=await a.value<Choice>(choiceSql(item.id));
  const retry=outcome(choose(item.id,b));await blocked(b,a);await a.query('commit');
  expect(first.resumed).toBe(false);expect((await retry).value).toEqual({sessionId:first.sessionId,resumed:true});
  expect(await count('public.training_sessions')).toBe(1);expect((await read()).items[0]!.originated).toBe(true);
  await expect(choose(item.id,c,owner,'skip')).rejects.toMatchObject({code:'PT409'});
});
it('different runs concurrently choose the same problem without a second source attribution',async()=>{
  const one=(await record([problems[0]!])).items[0]!,two=(await record([problems[0]!])).items[0]!;
  await begin(a);const first=await a.value<Choice>(choiceSql(one.id));const second=outcome(choose(two.id,b));await blocked(b,a);await a.query('commit');
  expect((await second).value).toEqual({sessionId:first.sessionId,resumed:true});expect(await count('public.training_sessions')).toBe(1);
  const rows=(await read()).items;expect(rows.filter(r=>r.originated)).toHaveLength(1);expect(rows.every(r=>r.sessionId===first.sessionId)).toBe(true);
  await expect(admin.query(`update algopilot_private.recommendation_trials set originated=true where id=${q(two.id)}`)).rejects.toMatchObject({code:'23505'});
});
it('restores legacy training without changing its draft, revisions, status or creating historical provenance',async()=>{
  const id=await user(a,owner,()=>a.value<string>(`select to_json(id) from public.start_cf_session(${q(JSON.stringify({problemId:problems[0],requestId:randomUUID()}))}::jsonb)`));
  await user(a,owner,()=>a.query(`select public.save_training_draft(${q(id)},'thought','synthetic preserved draft',0)`));
  const snapshot=()=>admin.value(`select to_jsonb(s) from public.training_sessions s where id=${q(id)}`),before=await snapshot();
  expect((await read()).items).toEqual([]);
  const item=(await record([problems[0]!])).items[0]!;expect(await choose(item.id,b)).toEqual({sessionId:id,resumed:true});
  expect(await snapshot()).toEqual(before);expect((await read()).items[0]!.originated).toBe(false);
});
it('foreign receipt/session reads and choices fail, direct DML is denied, identical run IDs remain per owner',async()=>{
  const runId=randomUUID(),one=await user(a,owner,()=>a.value<{items:Trial[]}>(recordSql(runId,[problems[0]!])));
  const item=one.items[0]!,selected=await choose(item.id);
  await expect(admin.query(`insert into algopilot_private.recommendation_trials(user_id,run_id,problem_id,source,fingerprint) select user_id,run_id,problem_id,source,fingerprint from algopilot_private.recommendation_trials where id=${q(item.id)}`)).rejects.toMatchObject({code:'23505'});
  expect((await read(c,other)).items).toEqual([]);
  for(const action of ['start','skip'])await expect(choose(item.id,c,other,action)).rejects.toMatchObject({code:'P0002'});
  await expect(user(c,other,()=>c.value(`select public.recommendation_training_evidence('all',${q(selected.sessionId!)})`))).rejects.toMatchObject({code:'P0002'});
  for(const sql of ['select * from algopilot_private.recommendation_trials','delete from algopilot_private.recommendation_trials'])await expect(user(c,other,()=>c.query(sql))).rejects.toMatchObject({code:'42501'});
  await user(c,other,()=>c.value(recordSql(runId,[problems[0]!],other)));expect((await read(c,other)).items).toHaveLength(1);
  await expect(admin.query(`update algopilot_private.recommendation_trials set session_id=${q(selected.sessionId!)},chosen_at=clock_timestamp() where user_id=${q(other)}`)).rejects.toMatchObject({code:'23503'});
});
it('rolled-back start releases the receipt and all training writes for the waiting backend',async()=>{
  const item=(await record([problems[0]!])).items[0]!;await begin(a);const rolled=await a.value<Choice>(choiceSql(item.id));
  const retry=outcome(choose(item.id,b));await blocked(b,a);await a.query('rollback');const next=(await retry).value!;
  expect(next.resumed).toBe(false);expect(next.sessionId).not.toBe(rolled.sessionId);expect(await count('public.training_sessions')).toBe(1);
  expect((await read()).items[0]!.sessionId).toBe(next.sessionId);
});
it.each(['solved_self_reported','unsolved','not_recorded'])('training result %s is read separately from official evidence; receipt replay keeps history',async result=>{
  const item=(await record([problems[0]!])).items[0]!,selected=await choose(item.id);
  await user(a,owner,()=>a.query(`select public.transition_training_session(${q(selected.sessionId!)},'finish',1,${q(result)})`));
  expect((await read()).items[0]).toMatchObject({outcome:result,official:'disabled',sessionStatus:'completed'});
  expect(await choose(item.id,b)).toEqual({sessionId:selected.sessionId,resumed:true});
  expect(await count('public.training_sessions')).toBe(1);
  if(result==='solved_self_reported'){
    const newer=(await record([problems[0]!])).items[0]!;await expect(choose(newer.id,c)).rejects.toMatchObject({code:'PT409'});
  }
});
it('stale preference revision rejects a new choice without partial attribution',async()=>{
  const item=(await record([problems[0]!])).items[0]!;
  await user(a,owner,()=>a.value(`select public.learning_write(${q(JSON.stringify({action:'preferences',revision:0,requestId:randomUUID(),preferences:{min:800,max:1800,themes:[],goal:'balanced',repeat:false,reviewEvidence:false}}))}::jsonb)`));
  await expect(choose(item.id,b)).rejects.toMatchObject({code:'PT409'});expect((await read()).items[0]!.sessionId).toBeNull();expect(await count('public.training_sessions')).toBe(0);
});
it('bare 013 replay is rejected atomically and preserves schema, ACL and all existing history',async()=>{
  const definitions=()=>admin.value("select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'hash',md5(pg_get_functiondef(oid)),'acl',proacl) order by oid) from pg_proc where pronamespace='public'::regnamespace");
  const before={rows:await admin.value(nativeHistorySql),functions:await definitions()};
  await expect(applyMigration(target,join(dirname(target.directory),'workspace/supabase/migrations/202610280013_recommendation_training_feedback.sql'))).rejects.toThrow('Isolated migration failed');
  expect({rows:await admin.value(nativeHistorySql),functions:await definitions()}).toEqual(before);
});
