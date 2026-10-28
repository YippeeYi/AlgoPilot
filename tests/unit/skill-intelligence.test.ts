import { describe, it, expect } from "vitest";
import { skillIntelligence } from "@/features/learning/intelligence";
import { skillEvidence, skillId, skillNow, skillSession } from "../fixtures/skill-intelligence";
import type { SkillWindow } from "@/lib/validation/learning";
const profile=(e=skillEvidence(),window:SkillWindow="30")=>skillIntelligence(e,window,skillNow);
const graph=(e=skillEvidence())=>profile(e).topics.find(t=>t.topic==='graphs')!;
describe("deterministic skill evidence diagnostics",()=>{
  it("empty data has unknown medians/ratios and no weakness or action",()=>{
    const r=profile();expect(r.recent.medianSolvedRating).toBeNull();expect(r.medianChange).toBeNull();
    expect(r.topics.every(t=>t.status==='insufficient' && !t.action && !t.completion)).toBe(true);
  });
  it.each([1,2,3,4])("%i different completed problems cannot establish a diagnostic",n=>{
    expect(graph(skillEvidence(n))).toMatchObject({trainingSamples:n,status:'insufficient',action:null,completion:null});
  });
  it("five explicit results create a traceable suggestion; does not double-count hint plus unsolved",()=>{
    const e=skillEvidence(5);e.sessions[0]={...e.sessions[0]!,outcome:'unsolved',maxHint:5};
    const t=graph(e);expect(t).toMatchObject({knownOutcomes:5,concernSamples:5,completion:{numerator:4,denominator:5},action:{topic:'graphs',window:'30'}});
    expect(t.refs.map(r=>r.id)).toEqual(e.sessions.map(s=>s.id));expect(profile(e).recent.medianSolvedRating).toBeNull();
  });
  it("minimum and fraction thresholds distinguish practice evidence and unknown outcomes",()=>{
    const e=skillEvidence(5);e.sessions=e.sessions.map(s=>({...s,maxHint:0}));expect(graph(e).status).toBe('documented_practice');expect(graph(e).action).toBeNull();
    e.sessions[0]!.maxHint=3;expect(graph(e).action).toBeNull();e.sessions[1]!.maxHint=3;expect(graph(e).action).not.toBeNull();
    e.sessions.push(skillSession(20,{outcome:'not_recorded',maxHint:5}));expect(graph(e).knownOutcomes).toBe(5);expect(graph(e).concernSamples).toBe(2);
  });
  it("latest completed problem wins independent of record order, repeats/active rows don't inflate counts",()=>{
    const e=skillEvidence(5);e.sessions.push({...e.sessions[0]!,id:skillId(90),createdAt:'2026-10-27T12:00:00Z',maxHint:0},skillSession(91,{status:'active',problemId:e.sessions[1]!.problemId}));
    const before=profile(e);expect(before.recent.completedProblems).toBe(5);expect(before.coverage.activeOrPaused).toBe(1);
    e.sessions.reverse();expect(profile(e)).toEqual(before);
    e.sessions.push({...e.sessions[0]!});expect(profile(e)).toEqual(before);
  });
  it("hides unresolved tags until L5 even when supplied by an overbroad fixture",()=>{
    const e=skillEvidence(5);e.sessions=e.sessions.map(s=>({...s,outcome:'unsolved',maxHint:4}));
    expect(graph(e).trainingSamples).toBe(0);expect(profile(e).coverage.missingVisibleTags).toBe(5);expect(profile(e).bands[0]!.highHints).toBe(5);
    e.sessions=e.sessions.map(s=>({...s,maxHint:5}));expect(graph(e).action).not.toBeNull();
  });
  it("missing tags/rating and unlinked legacy data remain unknown without erasing difficulty facts",()=>{
    const e=skillEvidence(2);e.sessions[0]={...e.sessions[0]!,tags:[],rating:null};e.sessions[1]!.problemId=null;
    const r=profile(e);expect(r.coverage).toMatchObject({missingRating:1,missingVisibleTags:1,unlinkedCompleted:1});expect(r.bands).toEqual([]);
  });
  it("multi-tag coverage is not a partition and tag duplicates do not multiply a sample",()=>{
    const e=skillEvidence(5);e.sessions=e.sessions.map(s=>({...s,tags:['graphs','dp','dp']}));
    expect(profile(e).topics.find(t=>t.topic==='dp')!.trainingSamples).toBe(5);expect(profile(e).recent.completedProblems).toBe(5);
  });
  it.each(['7','30','90','all'] as const)("%s window has explicit left-open/right-closed bounds",window=>{
    const e=skillEvidence();const days=window==='all'?10000:Number(window);
    e.sessions=[skillSession(1,{createdAt:new Date(skillNow-days*86400000).toISOString()}),skillSession(2,{createdAt:new Date(skillNow).toISOString()}),skillSession(3,{createdAt:new Date(skillNow+1).toISOString()}),skillSession(4,{createdAt:'invalid'})];
    expect(profile(e,window).recent.completedProblems).toBe(window==='all'?2:1);
  });
  it("same instant in different time zones is deterministic",()=>{
    const e=skillEvidence(5),r=profile(e);e.sessions=e.sessions.map(s=>({...s,createdAt:'2026-10-27T08:00:00+08:00'}));expect(profile(e)).toEqual(r);
  });
  it("two adequate adjacent windows compare descriptive medians, with an even median averaged",()=>{
    const e=skillEvidence(6);e.sessions=e.sessions.map((s,i)=>({...s,rating:1200+i*100}));
    e.sessions.push(...Array.from({length:5},(_,i)=>skillSession(20+i,{createdAt:'2026-09-10T00:00:00Z',rating:1000})));
    expect(profile(e)).toMatchObject({recent:{medianSolvedRating:1450},previous:{medianSolvedRating:1000},medianChange:450});
    expect(profile({...e,sessions:e.sessions.slice(0,10)}).medianChange).toBeNull();
  });
  it("concentration requires enough samples, and is not an automatic skill defect",()=>{
    expect(profile(skillEvidence(9)).concentration).toBeNull();expect(profile(skillEvidence(10)).concentration).toMatchObject({topic:'graphs',numerator:10,denominator:10});
  });
  it("official OK is deduplicated separately, never repairs training difficulty or failures; revoke removes it",()=>{
    const e=skillEvidence(5);const item={id:skillId(900),submissionId:1,contestId:9999,index:'A',problemId:e.sessions[0]!.problemId,rating:3000,tags:['graphs'],createdAt:'2026-10-27T00:00:00Z',observedAt:'2026-10-28T00:00:00Z'};
    e.official={revision:1,enabled:true,handle:'Fixture_User',ownershipVerified:false,totalAcceptedProblems:1,lastSyncedAt:null,lastFullScanAt:null,fullScanUpperId:null,oldestObservedAt:null,items:[item,{...item,id:skillId(901),submissionId:2}]};
    const r=profile(e);expect(r.coverage.officialAccepted).toBe(1);expect(r.recent.medianSolvedRating).toBe(1400);expect(graph(e).completion).toEqual({numerator:5,denominator:5});expect(graph(e).officialRefs[0]!.submissionId).toBe(2);
    e.official.items.reverse();expect(profile(e)).toEqual(r);e.official.enabled=false;expect(graph(e).officialAccepted).toBe(0);
  });
  it("bounds large data deterministically, reports truncation and does not mutate source",()=>{
    const e=skillEvidence(10000),copy=JSON.stringify(e);expect(profile(e).coverage).toMatchObject({loadedTraining:500,totalTraining:10000,truncated:true});
    expect(JSON.stringify(e)).toBe(copy);e.sessions.reverse();expect(profile(e)).toEqual(profile(JSON.parse(copy)));
  });
});
