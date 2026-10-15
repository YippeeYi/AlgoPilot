import { it,expect,vi } from 'vitest';
import { readFile,readdir,mkdir,writeFile } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { database,query,publish,alice,bob,fixtureSecret } from './database';
import { catalogRecording } from './catalog-recording';
import { parseProblemset } from '@/server/codeforces/parser';
import { parseUserInfo,parseUserStatus } from '@/server/codeforces/account-parser';
import { cfAccountRepository } from '@/server/codeforces/account-repository';
import { mutateCfAccount,synchronizeCfAccount } from '@/server/codeforces/account-service';
import { evidenceSchema,candidatesSchema } from '@/lib/validation/learning';
import { abilityProfile,recommend,recommendationTarget } from '@/features/learning/engine';
import { prepareStudy,allocation } from '../../scripts/m34-study';
import { scenarios } from './scenarios';
import { initialCfCursor,advanceCfCursor } from '@/features/learning/cf-cursor';
vi.mock('server-only',()=>({}));
const output=process.env.M34_EVALUATION_OUTPUT;
async function save(name:string,value:unknown){if(output){await mkdir(output,{recursive:true});await writeFile(`${output}/${name}.json`,JSON.stringify(value,null,2)+'\n');}}
it('executes the SELECT-only catalog audit locally, exports exact installed definitions and immutable migration hashes',async()=>{
 const db=await database();try{
  const sql=await readFile('docs/sql/M34_READONLY_DIAGNOSTICS.sql','utf8'),code=sql.replace(/--[^\n]*/g,'').trim();
  expect(code.startsWith('select ')).toBe(true);expect(code.replace(/'(?:''|[^'])*'/g,"''").match(/;/g)).toHaveLength(1);
  const result=(await db.query<{audit:{functions:{signature:string;securityDefiner:boolean;config:string[]|null;anonExecute:boolean;publicExecute:boolean}[];relations:{schema:string;name:string;rls:boolean;userInsert:boolean;userUpdate:boolean;userDelete:boolean}[]}}>(code)).rows[0]!.audit;
  for(const f of result.functions.filter(f=>f.signature.startsWith('public.'))){expect(f.securityDefiner).toBe(true);expect(f.config).toEqual(['search_path=""']);expect(f.anonExecute).toBe(false);expect(f.publicExecute).toBe(false);}
  for(const t of result.relations.filter(t=>['cf_accounts','cf_submissions','cf_account_receipts','learning_preferences','recommendation_feedback'].includes(t.name))){expect(t.rls).toBe(true);expect(t.userInsert||t.userUpdate||t.userDelete).toBe(false);}
  expect(result.relations.map(t=>t.name)).toEqual(expect.arrayContaining(['training_sessions','thought_snapshots','training_plans','training_plan_items','code_reviews','review_requests']));
  const migrations=await Promise.all((await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort().map(async file=>({file,sha256:createHash('sha256').update(await readFile(`supabase/migrations/${file}`)).digest('hex')})));
  expect((await db.query<{n:number}>('select count(*)::int n from algopilot_private.cf_accounts')).rows[0]!.n).toBe(0);
  await save('local-schema',{boundary:'PGlite catalog reference only; hosted definitions/migration history/HMAC unverified',migrations,...result});
 }finally{await db.close();}
},30000);
it('replays authorized actual CF responses through the real service/repository/SQL, preserves partial success and removes revoked references',async()=>{
 const db=await database();vi.stubEnv('CODEFORCES_RPC_SIGNING_SECRET',fixtureSecret);
 try{
  const recording=JSON.parse(await readFile('docs/m34/public-cf.json','utf8')),identity=parseUserInfo(recording.calls[0].response,recording.handle);
  const pages=recording.calls.filter((c:{method:string})=>c.method==='user.status');expect(pages.length).toBeGreaterThan(0);
  const actual=parseUserStatus(pages[0].response,recording.handle,200),pageMap=new Map<number,unknown>(pages.map((c:{url:string;response:unknown})=>[Number(new URL(c.url).searchParams.get('from')),c.response]));
  const {raw}=await catalogRecording();await publish(db,parseProblemset(JSON.parse(raw)));
  let elapsed=0,failTail=true,lostAck=true;const calls:{method:string;from:number|null}[]=[];
  const client={rpc:async(name:string,args:Record<string,unknown>)=>{
   try{
    const rows=await query<{v:unknown}>(db,name==='cf_account_state'?'select public.cf_account_state() v':'select public.cf_account_command($1,$2) v',name==='cf_account_state'?[]:[args.p_payload,args.p_signature]);
    if(name==='cf_account_command'&&JSON.parse(args.p_payload as string).action==='page'&&lostAck){lostAck=false;return {data:null,error:{code:'503'}};}
    return {data:rows.rows[0]!.v,error:null};
   }catch(e){return {data:null,error:{code:(e as {code?:string}).code??'UNKNOWN'}};}
  }} as unknown as Parameters<typeof cfAccountRepository>[0];
  const repo=cfAccountRepository(client,alice),fetcher=vi.fn().mockImplementation(async(url:string)=>{
   const u=new URL(url),from=u.searchParams.has('from')?Number(u.searchParams.get('from')):null;calls.push({method:u.pathname.split('/').at(-1)!,from});
   if(u.pathname.endsWith('user.info'))return Response.json(recording.calls[0].response);
   if(from!==1&&failTail)throw new DOMException('injected timeout','TimeoutError');
   const body=pageMap.get(from!);if(!body)throw new Error('Unrecorded page; do not fabricate actual CF history');return Response.json(body);
  });
  const runtime={fetcher,sleep:async(ms:number)=>{elapsed+=ms;await new Promise(r=>setTimeout(r,ms));},now:()=>elapsed};
  await mutateCfAccount(repo,{action:'bind',revision:0,requestId:randomUUID(),handle:recording.handle},runtime);
  await synchronizeCfAccount(repo,{revision:1,requestId:randomUUID()},runtime);const partial=await repo.state();
  expect(partial).toMatchObject({ownershipVerified:false,enabled:false,historyInProgress:true,observedSubmissions:actual.length,lastFullScanAt:null});
  await mutateCfAccount(repo,{action:'consent',enabled:true,revision:1,requestId:randomUUID()},runtime);
  const read=async()=>evidenceSchema.parse((await query<{v:unknown}>(db,'select public.learning_evidence() v')).rows[0]!.v);
  const enabled=await read(),p=enabled.preferences??recommendationTarget(enabled).preferences;
  const pool=async()=>candidatesSchema.parse((await query<{v:unknown}>(db,'select public.learning_candidates($1) v',[JSON.stringify({min:p.min,max:p.max,themes:p.themes,repeat:p.repeat,target:recommendationTarget(enabled).target})])).rows[0]!.v);
  const before=await pool(),ranked=recommend(enabled,before.items);expect(abilityProfile(enabled).official.analyzedAccepted).toBeGreaterThan(0);
  await expect(synchronizeCfAccount(repo,{revision:2,requestId:randomUUID()},runtime)).rejects.toMatchObject({status:503});
  const failed=await repo.state();expect(failed.observedSubmissions).toBe(actual.length);expect(failed.errorCode).toBe('network');
  failTail=false;
  // Preserve the real failure cooldown and real shared 3s clock even during HTTP replay.
  await new Promise(r=>setTimeout(r,30100));
  await synchronizeCfAccount(repo,{revision:2,requestId:randomUUID()},runtime);const recovered=await repo.state();
  if(actual.length<200){expect(recovered.historyInProgress).toBe(false);expect(recovered.lastFullScanAt).not.toBeNull();}
  expect(calls.some(c=>c.from===actual.length+1)).toBe(true);
  expect((await query<{v:{official:{items:unknown[]}}}>(db,'select public.learning_evidence() v',[],bob)).rows[0]!.v.official.items).toEqual([]);
  const oldRevision=recovered.evidenceRevision;await query(db,'select public.learning_evidence_guard(0,$1)',[oldRevision]);
  await mutateCfAccount(repo,{action:'consent',enabled:false,revision:2,requestId:randomUUID()},runtime);
  const disabled=await read(),after=await pool(),newRanked=recommend(disabled,after.items);expect(disabled.official!.items).toEqual([]);expect(abilityProfile(disabled).official.analyzedAccepted).toBe(0);expect(newRanked.items.every(i=>i.refs.every(r=>r.kind!=='official_submission'))).toBe(true);
  await expect(query(db,'select public.learning_evidence_guard(0,$1)',[oldRevision])).rejects.toMatchObject({code:'PT409'});
  expect(after.total).toBeGreaterThanOrEqual(before.total);
  await save('public-cf-replay',{boundary:'Actual authorized public CF response + local service/PGlite/JWT claims fixture. Injected timeout/ACK loss; not hosted JWT or deployed runtime',handle:identity.handle,realApiCalls:recording.calls.length,observedSubmissions:actual.length,distinctAccepted:recovered.acceptedProblems,partial,failed,recovered,
   beforePool:before.total,afterRevocationPool:after.total,enabledKeys:ranked.items.map(i=>`${i.problem.contestId}/${i.problem.index}`),revokedKeys:newRanked.items.map(i=>`${i.problem.contestId}/${i.problem.index}`),enabledOfficialRefs:ranked.items.flatMap(i=>i.refs).filter(r=>r.kind==='official_submission').length,afterRevocationOfficialRefs:0,localReplayRequests:calls});
 }finally{vi.unstubAllEnvs();await db.close();}
},120000);
it('prepares a common-pool Rating/Tags baseline, counterbalances order and quantifies 600-candidate omissions without changing online weights',async()=>{
 const db=await database();try{
  const {raw,sha256}=await catalogRecording();await publish(db,parseProblemset(JSON.parse(raw)));
  const broad={min:800,max:3500,target:1600,themes:[],repeat:false},seed=candidatesSchema.parse((await query<{v:unknown}>(db,'select public.learning_candidates($1) v',[JSON.stringify(broad)])).rows[0]!.v).items;
  const matrix=[];
  for(const [index,s] of scenarios(seed).entries()){
   const {preferences:p,target}=recommendationTarget(s.e),q={min:p.min,max:p.max,target,themes:p.themes,repeat:p.repeat};
   const uid=randomUUID();await db.query('insert into auth.users(id) values($1)',[uid]);
   const known=new Set(s.e.sessions.filter(t=>t.outcome==='solved_self_reported').map(t=>t.problemId));
   await db.query("insert into public.training_sessions(user_id,problem_id,statement_snapshot,phase,status,started_at,resumed_at,ended_at,outcome,max_hint_seen,create_request_id) select $1,p.id,'[M34 SYNTHETIC] eligibility','finished','completed',clock_timestamp()-interval '1 second',null,clock_timestamp(),'solved_self_reported',0,gen_random_uuid() from public.problems p where p.id=any($2::uuid[])",[uid,[...known]]);
   const selected=candidatesSchema.parse((await query<{v:unknown}>(db,'select public.learning_candidates($1) v',[JSON.stringify(q)],uid)).rows[0]!.v);
   const all=(await db.query<{v:unknown}>(`select jsonb_build_object('id',p.id,'contestId',p.contest_id,'index',p.problem_index,'name',p.title,'rating',p.rating,'tags',p.tags,'solvedCount',p.solved_count,'inPlan',false,'practiced',false) v
    from public.problems p where p.rating between $1 and $2 and not ('interactive'=any(p.tags))
    and not exists(select 1 from algopilot_private.recommendation_restrictions r where r.contest_id=p.contest_id and (r.problem_index is null or r.problem_index=p.problem_index) and r.status='source_checked_by_ai') and (cardinality($3::text[])=0 or p.tags && $3::text[]) order by p.id`,[p.min,p.max,p.themes])).rows.map(r=>r.v);
   const full=candidatesSchema.parse({items:all,total:all.length,policyVersion:'training-fit/1'}).items;
   const eligible=(items:typeof full)=>items.filter(c=>!known.has(c.id));
   const short=eligible(selected.items),unlimited=eligible(full),a=recommend(s.e,short),control=recommend(s.e,unlimited);
   const compact=(c:typeof full[number])=>({id:c.id,contestId:c.contestId,index:c.index,rating:c.rating!,tags:c.tags});
   const input={participantId:`P${String(index+1).padStart(3,'0')}`,consentId:'SYNTHETIC-NOT-PARTICIPANT',consented:true,seed:'m34-synthetic-only',enrollmentIndex:index,block:0,engineVersion:'deterministic/1.3-official',policyVersion:'training-fit/1',evidenceRevision:0,officialRevision:0,min:p.min,max:p.max,target,themes:p.themes,goal:p.goal,eligiblePool:short.map(compact),personalizedIds:a.items.map(i=>i.problem.id),eligibilitySource:'authorized_current_learning_candidates_snapshot'};
   const paired=prepareStudy(input);expect(prepareStudy({...input,eligiblePool:[...input.eligiblePool].reverse()})).toEqual(paired);expect(()=>prepareStudy({...input,consented:false})).toThrow();
   expect(paired.baseline).toHaveLength(a.items.length);expect(paired.sharedCandidateCount).toBe(short.length);
   const poolIds=new Set(short.map(c=>c.id)),omitted=control.items.filter(i=>!poolIds.has(i.problem.id));
   const firstScores=a.items[0]!.score,fullFirst=control.items[0]!.score;
   matrix.push({scenario:s.id,eligible:unlimited.length,shortlisted:short.length,shortKeys:a.items.map(i=>`${i.problem.contestId}/${i.problem.index}`),fullKeys:control.items.map(i=>`${i.problem.contestId}/${i.problem.index}`),omittedFullTop5:omitted.map(i=>`${i.problem.contestId}/${i.problem.index}`),firstScoreDelta:fullFirst-firstScores,paired});
  }
  for(let i=0;i<8;i+=2){expect(allocation(i,0,'fixed')).not.toBe(allocation(i+1,0,'fixed'));expect(allocation(i,0,'fixed')).not.toBe(allocation(i,1,'fixed'));}
  const paginationBurden=[93,200,1000,10000].map(n=>{let cursor=initialCfCursor(randomUUID()),rounds=0;while(!cursor.done&&rounds<1000){const ids=Array.from({length:Math.min(200,Math.max(0,n-cursor.from+1))},(_,i)=>n-cursor.from-i+1);cursor=advanceCfCursor(cursor,ids,randomUUID());rounds++;}return {fixedHistorySize:n,historyRounds:rounds,minimumUpstreamRequests:rounds*3,boundary:'Static no-drift model: one identity/head/history request each round, no pending/retry; not live UX latency'};});
  await save('reliability-study',{paginationBurden,boundary:'Synthetic histories/current recorded catalog; full-pool score comparison is not teaching quality or actual trial',engineVersion:'deterministic/1.3-official',catalogSha256:sha256,participants:0,humanOriginalCompleted:0,humanReplacementsCompleted:0,matrix});
  expect(matrix).toHaveLength(8);
 }finally{await db.close();}
},30000);
