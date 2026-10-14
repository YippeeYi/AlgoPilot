import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { catalogRecording } from "./catalog-recording";
import { recommend, recommendationTarget } from "@/features/learning/engine";
import * as baseline from "./m32-baseline-engine";
import { scenarios } from "./scenarios";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { candidatesSchema } from "@/lib/validation/learning";
import { parseProblemset } from "@/server/codeforces/parser";
import { database, publish, query } from "./database";
import { syntheticCatalog } from "./scenarios";
vi.mock("server-only",()=>({}));
let db:PGlite;
const q={min:800,max:2600,target:1700,themes:[],repeat:false};
const read=async(input:unknown)=>candidatesSchema.parse((await query<{v:unknown}>(db,'select public.learning_candidates($1::jsonb) v',[JSON.stringify(input)])).rows[0]!.v);
beforeAll(async()=>{db=await database('202610140007');},30000);
afterAll(()=>db?.close());
describe('actual SQL candidate coverage and structural bias audit',()=>{
 it('proves first-tag order bias using 1200 otherwise identical eligible candidates',async()=>{
  const problems=Array.from({length:1200},(_,i)=>({contestId:10000+i,index:'A',name:'[SYNTHETIC] order-bias probe',rating:1600,tags:i<600?['dp','graphs']:['graphs','dp'],solvedCount:null}));
  await publish(db,problems);const before=await read({...q,target:1600});
  const normalized=problems.map(p=>({...p,tags:['dp','graphs']}));await publish(db,normalized);const after=await read({...q,target:1600});
  const a=new Set(before.items.map(i=>i.id));const overlap=after.items.filter(i=>a.has(i.id)).length;
  expect(before.items).toHaveLength(600);expect(after.items).toHaveLength(600);expect(before.total).toBe(1200);
  expect(overlap).toBe(300);
  const baselineOverlap=overlap; // Stored baseline SQL has only 300/600 overlap despite equivalent metadata.
  const migration=await readFile('supabase/migrations/202610140008_recommendation_audit.sql','utf8');await db.exec(migration);
  await publish(db,problems);const fixedA=await read({...q,target:1600});await publish(db,normalized);const fixedB=await read({...q,target:1600});
  expect(new Set(fixedA.items.map(i=>i.id))).toEqual(new Set(fixedB.items.map(i=>i.id)));
  expect(baselineOverlap).toBe(300);
 });
 it('proves planned-candidate starvation and newer-contest tie bias, then preserves fresh alternatives',async()=>{
  const oldSql=await readFile('supabase/migrations/202610140007_learning_recommendations.sql','utf8');
  await db.exec(oldSql.slice(oldSql.indexOf('create function public.learning_candidates'),oldSql.lastIndexOf('commit;')).replace('create function','create or replace function'));
  const metadata=Array.from({length:1200},(_,i)=>({contestId:20000+i,index:'A',name:'[SYNTHETIC] plan starvation probe',rating:1600,tags:['math'],solvedCount:null}));await publish(db,metadata);
  const old=await read({...q,target:1600});expect(old.items.every(p=>p.contestId>=20600)).toBe(true);
  await db.exec(await readFile('supabase/migrations/202610140008_recommendation_audit.sql','utf8'));const hashed=await read({...q,target:1600});const hashedNewer=hashed.items.filter(p=>p.contestId>=20600).length;expect(hashedNewer).toBeGreaterThan(0);expect(hashedNewer).toBeLessThan(600);
  await db.exec(oldSql.slice(oldSql.indexOf('create function public.learning_candidates'),oldSql.lastIndexOf('commit;')).replace('create function','create or replace function'));
  for(let n=0;n<3;n++){const id=`73000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`;await query(db,'select public.plan_write($1,$2::jsonb)',[id,JSON.stringify({action:'create',requestId:id,name:'[FIXTURE] plan',description:'',problemIds:old.items.slice(n*200,n*200+200).map(p=>p.id)})]);}
  expect((await read({...q,target:1600})).items.filter(p=>p.inPlan)).toHaveLength(600);
  await db.exec(await readFile('supabase/migrations/202610140008_recommendation_audit.sql','utf8'));
  const fixed=await read({...q,target:1600});expect(fixed.items.filter(p=>p.inPlan)).toHaveLength(0);expect(fixed.total).toBe(1200);
  if(process.env.M321_EVALUATION_OUTPUT){await mkdir(process.env.M321_EVALUATION_OUTPUT,{recursive:true});await writeFile(`${process.env.M321_EVALUATION_OUTPUT}/structural-bias.json`,JSON.stringify({source:'SYNTHETIC SQL counterexamples',tagPermutation:{beforeOverlap:300,afterOverlap:600,limit:600,eligible:1200},plans:{beforePlanned:600,afterPlanned:0,availableUnplanned:600},contests:{beforeNewestHalf:600,afterNewestHalf:hashedNewer,afterOlderHalf:600-hashedNewer,note:'Same-fit unplanned candidates; deterministic external-key hash, not a stochastic exploration score.'}},null,2)+'\n');}
 });
 it('measures real recorded CF shortlist coverage, missing metadata and stable replay',async()=>{
  const {source:path,raw,sha256}=await catalogRecording();const problems=parseProblemset(JSON.parse(raw));
  await publish(db,problems);
  const cases=[];
  const matrix=[];
  for(const [name,min,max] of [['beginner',800,1200],['intermediate',1400,1800],['advanced',2000,2600]] as const){
   const input={min,max,target:(min+max)/2,themes:[],repeat:false};const pool=await read(input);
   expect(pool.items.every(i=>i.rating!==null&&i.rating>=min&&i.rating<=max)).toBe(true);expect(await read(input)).toEqual(pool);expect(pool.items.length).toBeLessThanOrEqual(600);
   cases.push({name,total:pool.total,selected:pool.items.length,coverage:pool.total?pool.items.length/pool.total:0,ratings:distribution(pool.items.map(i=>String(i.rating))),topics:distribution(pool.items.flatMap(i=>i.tags)),contestRange:[Math.min(...pool.items.map(i=>i.contestId)),Math.max(...pool.items.map(i=>i.contestId))]});
  }
  const all=(await read({...q,min:800,max:3500,target:1600})).items;
  for(const scenario of scenarios(all)) {
   const {preferences,target}=recommendationTarget(scenario.e);
   const pool=await read({min:preferences.min,max:preferences.max,target,themes:preferences.themes,repeat:preferences.repeat});
   const simulated=pool.items.map((p,i)=>({...p,inPlan:scenario.id==='extensive'&&i%3===0,practiced:scenario.e.sessions.some(s=>s.problemId===p.id)}));
   const result=recommend(scenario.e,simulated),old=baseline.recommend(scenario.e,simulated);
   const known=new Set([...scenario.e.sessions,...scenario.e.reviews,...scenario.e.feedback].map(r=>r.id));
   expect(result.items.every(i=>i.refs.every(r=>known.has(r.id)))).toBe(true);
   expect(result.items.every(i=>!scenario.e.sessions.some(s=>s.problemId===i.problem.id&&s.outcome==='solved_self_reported'))).toBe(true);
   expect(recommend(scenario.e,[...simulated].reverse())).toEqual(result);
   const selected=result.items.map(i=>({...i,metadataTags:simulated.find(p=>p.id===i.problem.id)!.tags}));
   matrix.push({id:scenario.id,label:scenario.label,playerSource:'SYNTHETIC history/preferences/plan flags; not an actual player',version:result.version,range:[preferences.min,preferences.max],goal:preferences.goal,target:result.target,eligible:pool.total,shortlisted:pool.items.length,ratings:selected.map(i=>i.problem.rating),distinctTags:new Set(selected.flatMap(i=>i.metadataTags)).size,weakDirectionHits:['graphs','dp'].includes(scenario.id)?selected.filter(i=>i.metadataTags.includes(scenario.id)).length:null,duplicateRate:0,knownSolvedRate:0,unauditableRefCount:0,baselineSamePoolRatings:old.items.map(i=>i.problem.rating),items:selected});
  }
  if(process.env.M321_EVALUATION_OUTPUT){
   const output=process.env.M321_EVALUATION_OUTPUT;await mkdir(output,{recursive:true});
   await writeFile(`${output}/catalog-coverage.json`,JSON.stringify({source:path,sha256,count:problems.length,missingRating:problems.filter(p=>p.rating===null).length,missingTags:problems.filter(p=>!p.tags.length).length,cases},null,2)+'\n');
   await writeFile(`${output}/recorded-catalog-scenarios.json`,JSON.stringify({source:path,sha256,qualification:'Recorded CF metadata with synthetic player evidence; not manual teaching assessment',matrix},null,2)+'\n');
   const csv=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
   const header=['scenario','player_source','problem_key','official_url','rating','goal','reference_difficulty','metadata_tags_for_reviewer','recommendation_reasons','evidence_ids','assessment','suggestion','reviewer','reviewed_at','statement_consulted'];
   const lines=matrix.flatMap(row=>row.items.map(i=>[row.id,row.playerSource,`${i.problem.contestId}/${i.problem.index}`,`https://codeforces.com/problemset/problem/${i.problem.contestId}/${i.problem.index}`,i.problem.rating,row.goal,row.target,i.metadataTags.join(';'),i.reasons.join(' | '),i.refs.map(r=>`${r.kind}:${r.id}`).join(';'),'','','','',''].map(csv).join(',')));
   await writeFile(`${output}/manual-review.csv`,header.map(csv).join(',')+'\n'+lines.join('\n')+'\n');
  }
 });
 it('holds 600 limit at scale and does not depend on JSON input order',async()=>{
  const metadata=syntheticCatalog(12000).map(({contestId,index,name,rating,tags,solvedCount})=>({contestId,index,name,rating,tags,solvedCount}));await publish(db,metadata);const a=await read(q);await publish(db,[...metadata].reverse());expect(await read(q)).toEqual(a);expect(a.items).toHaveLength(600);expect(a.total).toBe(12000);
 });
});
function distribution(values:string[]){const d:Record<string,number>={};for(const v of values)d[v]=(d[v]??0)+1;return d;}
