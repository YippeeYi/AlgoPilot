import { describe, it, expect, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { recommend, abilityProfile, recommendationTarget } from "@/features/learning/engine";
import * as baseline from "./m32-baseline-engine";
import { emptyEvidence, fixtureId, scenarios, syntheticCatalog, training } from "./scenarios";
vi.mock("server-only", () => ({}));
const catalog=syntheticCatalog();
const rows: unknown[]=[];
describe("versioned recommendation evaluation; synthetic histories, automatic assertions only",()=>{
 for(const scenario of scenarios(catalog)) it(scenario.label,()=>{
  const e=scenario.e, p=e.preferences??{min:800,max:1200};
  const candidates=catalog.map((c,i)=>({...c,inPlan:scenario.id==='extensive'&&i%3===0,practiced:e.sessions.some(s=>s.problemId===c.id)})).filter(c=>c.rating!==null&&c.rating>=p.min&&c.rating<=p.max).slice(0,600);
  const start=performance.now(),result=recommend(e,candidates),elapsed=performance.now()-start;
  expect(result.items.length).toBeGreaterThan(0);expect(result.items.length).toBeLessThanOrEqual(5);
  expect(result.items.every(i=>i.problem.rating!==null&&i.problem.rating>=p.min&&i.problem.rating<=p.max)).toBe(true);
  expect(new Set(result.items.map(i=>i.problem.id)).size).toBe(result.items.length);
  expect(result.items.some(i=>e.sessions.some(s=>s.problemId===i.problem.id&&s.outcome==='solved_self_reported'))).toBe(false);
  expect(recommend(e,[...candidates].reverse())).toEqual(result);
  const known=new Set([...e.sessions,...e.reviews,...e.feedback].map(r=>r.id));
  expect(result.items.every(i=>i.refs.every(ref=>known.has(ref.id)))).toBe(true);
  expect(JSON.stringify(result.items)).not.toContain('"tags"');
  if(['graphs','dp'].includes(scenario.id)) expect(result.items.filter(i=>candidates.find(c=>c.id===i.problem.id)?.tags.includes(scenario.id)).length).toBeGreaterThanOrEqual(3);
  if(scenario.id==='cold')expect(result.profile.directions).toEqual([]);
  if(scenario.id==='sparse')expect(result.profile.directions.every(d=>d.confidence==='样本不足')).toBe(true);
  const tags=result.items.flatMap(i=>candidates.find(c=>c.id===i.problem.id)!.tags);
  rows.push({scenario:scenario.id,source:'SYNTHETIC fixture',range:[p.min,p.max],target:result.target,ratings:result.items.map(i=>i.problem.rating),distinctTopics:new Set(tags).size,uniqueProblems:result.items.length,evidenceReferences:result.items.reduce((n,i)=>n+i.refs.length,0),elapsedMs:elapsed});
 });
 it("captures baseline counterexamples before any fix, and requires truthful current score explanations",()=>{
  const e=emptyEvidence();e.preferences={min:800,max:1200,themes:[],goal:'balanced',repeat:true,reviewEvidence:false};
  e.sessions=[training(1,800),training(2,800),training(3,1600),training(4,1800)];
  expect(baseline.recommendationTarget(e).target).toBe(1200); // Upper-middle is not the median of even samples.
  expect(recommendationTarget(e).target).toBe(1200); // True median also reaches upper boundary in this range.
  e.preferences.max=2000;expect(recommendationTarget(e).target).toBe(1200);
  const c={...catalog[0]!,practiced:true};
  expect(baseline.recommend(e,[c]).items[0]!.reasons.join()).toContain('重复程度已计入排序');
  expect(recommend(e,[c]).items[0]!.reasons.join()).not.toContain('重复程度已计入排序');
  const reroll=recommend(e,[c],[c.id]).items[0]!;
  expect(reroll.score).toBe(Object.values(reroll.factors).reduce((a,b)=>a+b,0));
 });
 it("feedback response compares actual difficulty movement after clamping, not an invented +100",()=>{
  const e=emptyEvidence();e.preferences={min:800,max:1200,themes:[],goal:'balanced',repeat:false,reviewEvidence:false};
  e.sessions=[training(1,2500),training(2,2500),training(3,2500)];
  e.feedback=[{id:fixtureId(600000),problemId:catalog[0]!.id,kind:'too_easy',rating:800,createdAt:'2026-10-14T00:00:00Z'}];
  const old=baseline.recommendationTarget(e);expect(old.target).toBe(1200);expect(old.shift).toBe(100);
  const current=recommendationTarget(e);expect(current.target).toBe(1200);expect(current.shift).toBe(0);
  expect(recommend(e,[catalog[0]!]).items[0]!.reasons.join()).toContain('实际调整 0');
 });
 it("AI counts do not amplify ranking and revocation exactly removes the signal",()=>{
  const e=emptyEvidence();e.preferences={min:800,max:1200,themes:[],goal:'balanced',repeat:false,reviewEvidence:true};
  const r=(n:number)=>({id:fixtureId(700000+n),reviewId:fixtureId(800000+n),problemId:fixtureId(900000+n),knowledge:'图论。',risks:'',createdAt:new Date(Date.UTC(2026,0,1)+n*60000).toISOString()});
  e.reviews=[r(1)];const one=recommend(e,catalog.slice(0,40));e.reviews=Array.from({length:200},(_,i)=>r(i+1));const many=recommend(e,catalog.slice(0,40));
  expect(many.items.map(i=>[i.problem.id,i.score,i.factors.review])).toEqual(one.items.map(i=>[i.problem.id,i.score,i.factors.review]));
  e.preferences.reviewEvidence=false;expect(recommend(e,catalog.slice(0,40))).toEqual(recommend({...e,reviews:[]},catalog.slice(0,40)));
 });
 it("negative AI mentions cannot recommend an algorithm the review explicitly says is unnecessary",()=>{
  const e=emptyEvidence();e.preferences={min:800,max:1200,themes:[],goal:'balanced',repeat:false,reviewEvidence:true};
  e.reviews=[{id:fixtureId(810001),reviewId:fixtureId(820001),problemId:fixtureId(830001),knowledge:'不需要动态规划。',risks:'没有边界问题。',createdAt:'2026-10-14T00:00:00Z'}];
  const pool=[{...catalog[1]!,rating:1000}];
  expect(baseline.recommend(e,pool).items[0]!.factors.review).toBe(6);
  expect(recommend(e,pool).items[0]!.factors.review).toBe(0);
  expect(abilityProfile(e).reviewDirections).toEqual([]);
 });
 it("window audit measures erasure instead of pretending the 500-session portrait is lifetime ability",()=>{
  const e=emptyEvidence();e.sessions=[...Array.from({length:100},(_,i)=>training(i+1,1600,'graphs',4)),...Array.from({length:500},(_,i)=>training(i+101,1600,'dp',0))];e.totalSessions=600;
  const lifetime=abilityProfile(e),window=abilityProfile({...e,sessions:e.sessions.slice(-500)});
  expect(lifetime.directions.find(d=>d.topic==='graphs')!.samples).toBe(100);expect(window.directions.some(d=>d.topic==='graphs')).toBe(false);expect(window.limitations.join()).toContain('500');
 });
 // 24 complete runs share CPU/GC with the SQL suite. Align only this sampling
 // timeout with vitest.evaluation.config.ts; individual timings remain recorded.
 it("benchmarks maximum input windows without treating local timing as a production SLA",async()=>{
  const e=emptyEvidence();e.preferences={min:800,max:2600,themes:[],goal:'independence',repeat:false,reviewEvidence:true};
  e.sessions=Array.from({length:500},(_,i)=>training(i+1,1600,['graphs','dp','math','greedy'][i%4]!,4));e.totalSessions=700;
  e.reviews=Array.from({length:200},(_,i)=>({id:fixtureId(710000+i),reviewId:fixtureId(810000+i),problemId:fixtureId(910000+i),knowledge:'图论、动态规划、数学、贪心。',risks:'边界问题待验证。',createdAt:new Date(Date.UTC(2026,0,1)+i*60000).toISOString()}));
  const pool=catalog.slice(0,600),metrics:Record<string,{medianMs:number;p95Ms:number;samples:number}>={};
  for(const [name,fn] of [['baseline',baseline.recommend],['current',recommend]] as const){const times:number[]=[];for(let n=0;n<12;n++){const start=performance.now();const r=fn(e,pool);if(n>=2)times.push(performance.now()-start);expect(r.items).toHaveLength(5);}times.sort((a,b)=>a-b);metrics[name]={samples:times.length,medianMs:(times[times.length/2-1]!+times[times.length/2]!)/2,p95Ms:times.at(-1)!};}
  if(process.env.M321_EVALUATION_OUTPUT) {await mkdir(process.env.M321_EVALUATION_OUTPUT,{recursive:true});await writeFile(`${process.env.M321_EVALUATION_OUTPUT}/engine-performance.json`,JSON.stringify({source:'SYNTHETIC worst-window workload; ten measured runs after two warmups',sessions:500,reviews:200,candidates:600,metrics},null,2)+'\n');}
 }, 30000);
 it("writes reproducible scenario observations only when an output directory is explicitly supplied",async()=>{
  if(!process.env.M321_EVALUATION_OUTPUT)return;
  await mkdir(process.env.M321_EVALUATION_OUTPUT,{recursive:true});
  await writeFile(`${process.env.M321_EVALUATION_OUTPUT}/synthetic-scenarios.json`,JSON.stringify({version:'m321/1',qualification:'Automatic assertions on synthetic histories; not teaching-quality validation',rows},null,2)+'\n');
 });
});
