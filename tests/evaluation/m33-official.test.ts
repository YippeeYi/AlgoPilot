import { it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { database, query, publish, fixtureSecret } from './database';
import { signTutorPayload } from '@/server/tutor/repository';
import { recommend, recommendationTarget, abilityProfile, recommendationTopicMatch as topicMatch } from '@/features/learning/engine';
import { trainingCompatibility } from '@/features/learning/problem-fit';
import { candidatesSchema, evidenceSchema, type LearningEvidence, type LearningCandidate } from '@/lib/validation/learning';
import { parseProblemset } from '@/server/codeforces/parser';
import { catalogRecording } from './catalog-recording';
import { scenarios } from './scenarios';
import { parseCsv } from '../../scripts/m322-review';
vi.mock('server-only',()=>({}));
it('replays 8 players/11,450 catalog entries, separates exclusion/coverage effects, keeps 40 AI labels and 5 pending replacements',async()=>{
 const db=await database('202610140009');
 try{
  const {raw,sha256}=await catalogRecording(),metadata=parseProblemset(JSON.parse(raw));await publish(db,metadata);
  const oldSql=await readFile('supabase/migrations/202610140008_recommendation_audit.sql','utf8'),fit=await readFile('supabase/migrations/202610140009_recommendation_fit.sql','utf8');
  await db.exec(oldSql);const read=async(input:unknown,uid?:string)=>candidatesSchema.parse((await query<{v:unknown}>(db,'select public.learning_candidates($1) v',[JSON.stringify(input)],uid)).rows[0]!.v);
  const seed=(await read({min:800,max:3500,target:1600,themes:[],repeat:false})).items;
  await db.exec(fit.slice(fit.indexOf('create or replace function'),fit.indexOf('revoke all on function')));
  const officialSql=await readFile('supabase/migrations/202610150010_cf_official_evidence.sql','utf8');await db.exec(officialSql);
  const candidateSql=officialSql.slice(officialSql.indexOf('create or replace function public.learning_candidates'),officialSql.indexOf('revoke all on function public.learning_candidates'));
  const recorded=JSON.parse(await readFile('docs/m322/recorded-catalog-scenarios.json','utf8')) as {matrix:{id:string;items:{problem:{contestId:number;index:string}}[]}[]};
  const originalAi=parseCsv(await readFile('docs/m321/ai-assisted-review.csv','utf8')),human=parseCsv(await readFile('docs/m321/manual-review.csv','utf8')),queue=parseCsv(await readFile('docs/m322/recommendations-for-review.csv','utf8'));
  expect(originalAi).toHaveLength(40);expect(human.filter(r=>r.assessment)).toHaveLength(0);const originalKeys=new Set(originalAi.map(r=>`${r.scenario}:${r.problem_key}`));
  const replacements=queue.filter(r=>!originalKeys.has(`${r.scenario}:${r.problem_key}`));expect(replacements).toHaveLength(5);expect(replacements.every(r=>!r.assessment)).toBe(true);
  const matrix=[];
  for(const scenario of scenarios(seed)){
   const uid=randomUUID();await db.query('insert into auth.users(id) values($1)',[uid]);
   const {preferences:p,target}=recommendationTarget(scenario.e),input={min:p.min,max:p.max,target,themes:p.themes,repeat:p.repeat};
   await db.exec(oldSql);const oldPlanPool=await read(input,uid);await db.exec(candidateSql);
   const poolBefore=await read(input,uid),planned=new Set(oldPlanPool.items.filter((_,i)=>scenario.id==='extensive'&&i%3===0).map(c=>c.id));
   const prepare=(items:LearningCandidate[])=>items.map(c=>({...c,inPlan:planned.has(c.id),practiced:scenario.e.sessions.some(s=>s.problemId===c.id)}));
   const before=recommend(scenario.e,prepare(poolBefore.items)),keys=(r:ReturnType<typeof recommend>)=>r.items.map(i=>`${i.problem.contestId}/${i.problem.index}`);
   expect(keys(before)).toEqual(recorded.matrix.find(s=>s.id===scenario.id)!.items.map(i=>`${i.problem.contestId}/${i.problem.index}`));
   const chosen=new Map(before.items.slice(0,2).map(i=>[i.problem.id,poolBefore.items.find(c=>c.id===i.problem.id)!]));
   const count=scenario.id==='extensive'?602:20;
   const all=(await db.query<{id:string;contest_id:number;problem_index:string}>('select id,contest_id,problem_index from public.problems where rating between $1 and $2 and not ($3=any(tags)) and contest_id<>130 order by contest_id,problem_index',[p.min,p.max,'interactive'])).rows;
   for(const c of all){if(chosen.size>=count)break;if(!chosen.has(c.id))chosen.set(c.id,{id:c.id,contestId:c.contest_id,index:c.problem_index} as LearningCandidate);}
   const act=async(v:Record<string,unknown>)=>{const s=signTutorPayload({operation:'cf_account',...v},uid,fixtureSecret);return (await query<{v:Record<string,unknown>}>(db,'select public.cf_account_command($1,$2) v',[s.p_payload,s.p_signature],uid)).rows[0]!.v;};
   const bind=await act({action:'reserve',kind:'bind',handle:'Synthetic_Public',revision:0,requestId:randomUUID()});await act({action:'bind',nonce:bind.nonce,scope:bind.scope,handle:'Synthetic_Public',registrationSeconds:100});
   const enable=await act({action:'reserve',kind:'enable',revision:1,requestId:randomUUID()});await act({action:'enable',nonce:enable.nonce,scope:enable.scope,handle:'Synthetic_Public',registrationSeconds:100});
   const lease=await act({action:'reserve',kind:'sync',revision:2,requestId:randomUUID()});
   const submissions=[...chosen.values()].map((c,i)=>({submissionId:10000+i,contestId:c.contestId,index:c.index,createdSeconds:1780000000+i,verdict:'OK'})).reverse();
   for(let i=0;i<submissions.length;i+=200)await act({action:'page',nonce:lease.nonce,scope:lease.scope,requestId:randomUUID(),purpose:'pending',from:1+i,resetCycle:randomUUID(),submissions:submissions.slice(i,i+200)});
   const official=evidenceSchema.parse((await query<{v:unknown}>(db,'select public.learning_evidence() v',[],uid)).rows[0]!.v).official!;
   expect(official.items).toHaveLength(Math.min(count,500));expect(official.totalAcceptedProblems).toBe(count);expect(official.lastFullScanAt).toBeNull();
   const e:LearningEvidence={...scenario.e,official},poolAfter=await read(input,uid),prepared=prepare(poolAfter.items);
   expect(poolAfter.total).toBe(poolBefore.total-count);expect(poolAfter.items).toHaveLength(Math.min(600,poolAfter.total));expect(poolAfter.items.every(c=>!chosen.has(c.id))).toBe(true);
   const filterOnly=recommend(scenario.e,prepared),after=recommend(e,prepared);
   expect(recommend(e,[...prepared].reverse())).toEqual(after);expect(after.target).toBe(before.target);
   const known=new Set([...e.sessions,...e.reviews,...e.feedback,...official.items].map(r=>r.id));
   for(const item of after.items){expect(chosen.has(item.problem.id)).toBe(false);expect(item.problem.rating).toBeGreaterThanOrEqual(p.min);expect(item.problem.rating).toBeLessThanOrEqual(p.max);expect(item.inPlan).toBe(false);expect(item.refs.every(r=>known.has(r.id))).toBe(true);expect(item.score).toBe(Object.values(item.factors).reduce((a,b)=>a+b,0));expect(trainingCompatibility(prepared.find(c=>c.id===item.problem.id)!)).not.toBe('interactive');expect(trainingCompatibility(prepared.find(c=>c.id===item.problem.id)!)).not.toBe('language_not_cpp');if(item.refs.some(r=>r.kind==='official_submission'))expect(item.reasons.join()).toContain('公开账号');}
   expect(new Set(keys(after)).size).toBe(after.items.length);expect(after.profile.directions.every(d=>d.suggestion.startsWith('暂定加强方向')||d.suggestion.startsWith('继续收集证据'))).toBe(true);
   const timings=Array.from({length:12},()=>{const t=performance.now();recommend(e,prepared);return performance.now()-t;}).slice(2).sort((a,b)=>a-b);
   const metrics=(r:ReturnType<typeof recommend>)=>({keys:keys(r),ratings:r.items.map(i=>i.problem.rating),uniqueTags:new Set(r.items.flatMap(i=>prepared.find(c=>c.id===i.problem.id)?.tags??poolBefore.items.find(c=>c.id===i.problem.id)?.tags??[])).size,officialRefs:r.items.flatMap(i=>i.refs).filter(r=>r.kind==='official_submission').length,coreMatch:['graphs','dp'].includes(scenario.id)?r.items.map(i=>({key:`${i.problem.contestId}/${i.problem.index}`,...topicMatch(prepared.find(c=>c.id===i.problem.id)??poolBefore.items.find(c=>c.id===i.problem.id)!,scenario.id)})):[]});
   const profile=abilityProfile(e);expect(profile.official.analyzedAccepted).toBe(Math.min(count,500));
   await act({action:'consent',enabled:false,revision:2,requestId:randomUUID()});const revoked=await read(input,uid);expect(revoked).toEqual(poolBefore);
   const disabled={...scenario.e,official:{...official,enabled:false}};expect(recommend(disabled,prepare(revoked.items)).items).toEqual(before.items);
   matrix.push({scenario:scenario.id,officialKnown:count,window:official.items.length,target,beforePool:poolBefore.total,afterPool:poolAfter.total,beforeCoverage:poolBefore.items.length/poolBefore.total,afterCoverage:poolAfter.items.length/poolAfter.total,before:metrics(before),filterOnly:metrics(filterOnly),after:metrics(after),medianMs:(timings[4]!+timings[5]!)/2,p95Ms:timings[9]});
  }
  if(process.env.M33_EVALUATION_OUTPUT){await mkdir(process.env.M33_EVALUATION_OUTPUT,{recursive:true});await writeFile(`${process.env.M33_EVALUATION_OUTPUT}/recommendation-comparison.json`,JSON.stringify({version:'deterministic/1.3-official',baseline:'bc76e52',boundary:'Synthetic public submissions and 8 synthetic players on recorded official metadata; no teaching outcome claims',catalogSize:metadata.length,sha256,originalAI:40,humanCompleted:0,replacementsPending:5,matrix},null,2)+'\n');}
 }finally{await db.close();}
},30000);
