import {describe,it,expect} from 'vitest';
import {skillIntelligence} from '@/features/learning/intelligence';
import {recommendationObservation} from '@/features/learning/training-feedback';
import {skillEvidence,skillSession,skillNow,skillId} from '../fixtures/skill-intelligence';
import {trial} from '../fixtures/training-feedback';
import type {TrainingFeedback} from '@/lib/validation/training-feedback';
const day=86400000;
const sample=(n:number,age:number,rating=1400)=>skillSession(n,{createdAt:new Date(skillNow-age*day).toISOString(),rating,maxHint:0});
const cohorts=(n=5,old=5)=>{const e=skillEvidence();e.sessions=[...Array.from({length:n},(_,i)=>sample(i+1,1)),...Array.from({length:old},(_,i)=>sample(i+100,40,1000))];e.totalSessions=e.sessions.length;return e;};
const grow=(e=cohorts(),window:'7'|'30'|'90'|'all'='30')=>skillIntelligence(e,window,skillNow).growth;
describe('growth observations are cohorts, not reconstructed ability snapshots',()=>{
  it('new users and small windows keep uncertainty',()=>{
    expect(grow(skillEvidence())).toMatchObject({comparison:'insufficient',medianChange:null,topics:[],actions:[]});
    expect(grow(cohorts(4,4))).toMatchObject({comparison:'insufficient',medianChange:null,actions:[]});
  });
  it.each(['7','30','90'] as const)('uses adjacent left-open/right-closed %s day cohorts',window=>{
    const days=Number(window),e=skillEvidence();e.sessions=[sample(1,0),sample(2,days),sample(3,days*2),sample(4,days-0.001)];e.totalSessions=4;
    const r=grow(e,window);expect(r.current.problems).toBe(2);expect(r.previous!.problems).toBe(1);
    expect(r.previousEnd).toBe(r.currentStart);expect(r.previousStart).toBe(new Date(skillNow-days*2*day).toISOString());
  });
  it('all-loaded mode cannot invent a prior baseline',()=>{expect(grow(cohorts(),'all')).toMatchObject({comparison:'not_applicable',previous:null,medianChange:null,actions:[]});});
  it('describes harder selected problems without claiming growth and preserves separate band denominators',()=>{
    const r=grow();expect(r).toMatchObject({comparison:'descriptive',medianChange:400,current:{known:5,median:1400},previous:{known:5,median:1000}});
    expect(r.bands).toMatchObject([{min:800,current:{known:0,completion:null},previous:{known:5,completion:{numerator:5,denominator:5}}},{min:1200,current:{known:5},previous:{known:0}}]);
  });
  it('topic reaching a sample threshold has explicit refs and a bounded opt-in action',()=>{
    const r=grow(cohorts(5,4));expect(r.topics[0]).toMatchObject({topic:'graphs',transition:'more_evidence',current:{known:5},previous:{known:4}});
    expect(r.actions[0]).toMatchObject({topic:'graphs',window:'30',reason:'new_evidence'});expect(r.actions[0]!.refs).toHaveLength(9);
    expect(grow(cohorts(4,5)).topics[0]!.transition).toBe('less_evidence');expect(grow(cohorts(4,5)).actions).toEqual([]);
  });
  it('unchanged difficulty supports a review action, not an automatic difficulty change',()=>{
    const e=cohorts();e.sessions=e.sessions.map(s=>({...s,rating:1400}));expect(grow(e).actions[0]).toMatchObject({reason:'same_range'});
    expect(e.preferences).toMatchObject({min:1200,max:1800,themes:[]});
    e.sessions[0]!.maxHint=4;e.sessions[1]!.maxHint=4;expect(grow(e).actions).toEqual([]); // Existing diagnostic owns the action.
  });
  it('truncation suppresses comparisons and cross-window recommendations, retaining subset counts',()=>{
    const e=cohorts(5,4);e.totalSessions=900;const r=grow(e);expect(r).toMatchObject({comparison:'incomplete',medianChange:null,actions:[]});expect(r.current.known).toBe(5);
    expect(r.topics[0]!.transition).toBe('unknown');expect(skillIntelligence(e,'30',skillNow).medianChange).toBeNull();
  });
  it.each(['invalid','2027-01-01T00:00:00Z'])('bad/future time %s cannot support a complete comparison',createdAt=>{
    const e=cohorts();e.sessions.push(skillSession(300,{createdAt}));e.totalSessions++;expect(grow(e).comparison).toBe('incomplete');
  });
  it('unlinked legacy completion disables cross-window inference; missing rating/tag does not become zero skill',()=>{
    const e=cohorts();e.sessions[0]!.problemId=null;expect(grow(e).comparison).toBe('incomplete');
    const sparse=cohorts();sparse.sessions=sparse.sessions.map(s=>({...s,rating:null,tags:[]}));const r=grow(sparse);expect(r).toMatchObject({medianChange:null,bands:[],topics:[],actions:[]});expect(r.current.known).toBe(5);
  });
  it('latest completion replaces previous evidence without manufacturing an additional success; ordering/replay are stable',()=>{
    const e=cohorts(5,4);e.sessions.push({...e.sessions[5]!,id:skillId(500),createdAt:new Date(skillNow-day).toISOString()});e.totalSessions++;
    const r=grow(e);expect(r.current.problems).toBe(6);expect(r.previous!.problems).toBe(3);e.sessions.reverse();expect(grow(e)).toEqual(r);e.sessions.push({...e.sessions[0]!});expect(grow(e)).toEqual(r);
  });
  it('visible multitag coverage overlaps and unresolved hidden tags never become recommendations',()=>{
    const e=cohorts(5,0);e.sessions=e.sessions.map(s=>({...s,tags:['graphs','dp','dp']}));const r=grow(e);expect(r.current).toMatchObject({problems:5,tagged:5,topics:2});expect(r.actions).toHaveLength(2);
    e.sessions=e.sessions.map(s=>({...s,outcome:'unsolved',maxHint:4}));expect(grow(e).topics).toEqual([]);expect(grow(e).current.completion).toEqual({numerator:0,denominator:5});
  });
  it('official OK does not increase a training cohort or repair self-reported failures',()=>{
    const e=cohorts();const before=grow(e);e.official={revision:1,enabled:true,handle:'Fixture',ownershipVerified:false,totalAcceptedProblems:1,lastSyncedAt:null,lastFullScanAt:null,fullScanUpperId:null,oldestObservedAt:null,
      items:[{id:skillId(990),problemId:e.sessions[0]!.problemId,submissionId:9,contestId:300,index:'A',rating:3500,tags:['dp'],createdAt:new Date(skillNow).toISOString(),observedAt:new Date(skillNow).toISOString()}]};expect(grow(e)).toEqual(before);
  });
  it('large histories stay bounded and immutable',()=>{const e=skillEvidence(5000),saved=JSON.stringify(e);expect(grow(e)).toMatchObject({comparison:'incomplete',medianChange:null,actions:[]});expect(JSON.stringify(e)).toBe(saved);});
});
const observed=(items:TrainingFeedback['items'],total=items.length)=>recommendationObservation({available:true,items,total,asOf:'2026-10-28T00:00:00Z'})!;
const origin=(n:number,changes:Partial<TrainingFeedback['items'][number]>={})=>trial(n,{originated:true,sessionId:skillId(n+1000),chosenAt:'2026-10-28T00:00:00Z',sessionStatus:'paused',...changes});
describe('recommendation observations have explicit, different units and no causal attribution',()=>{
  it('unavailable data is unknown, available zero rows are observed zero without impressions',()=>{
    expect(recommendationObservation({available:false,items:[],total:0,asOf:''})).toBeNull();expect(observed([])).toMatchObject({loaded:0,selected:0,started:0,impressions:null,untrackedTraining:null,completion:null,officialAfterRecommendation:null});
  });
  it('distinguishes unselected, skip history, restored associations and unknown results',()=>{
    const rows=[trial(1),trial(2,{skippedAt:'now'}),origin(3,{skippedAt:'now'}),trial(4,{sessionId:skillId(900),originated:false,sessionStatus:'completed',outcome:'solved_self_reported'}),origin(5,{sessionStatus:'completed',outcome:'not_recorded'}),origin(6,{sessionStatus:'completed',outcome:'unsolved'}),origin(7,{sessionStatus:'completed',outcome:'abandoned'}),origin(8,{sessionStatus:'completed',outcome:'solved_self_reported'})];
    expect(observed(rows)).toMatchObject({loaded:8,selected:6,restored:1,unselected:1,skipped:1,skipEvents:2,started:5,ended:4,solved:1,unsolved:1,abandoned:1,active:1,unknownEnded:1,awaitingResult:2,completion:null});
  });
  it('duplicate receipts/sessions and replay cannot inflate outcomes; five distinct problems needed for ratio',()=>{
    const rows=Array.from({length:5},(_,i)=>origin(i+1,{sessionStatus:'completed',outcome:i?'solved_self_reported':'unsolved'}));
    const r=observed(rows);expect(r.completion).toEqual({numerator:4,denominator:5});
    expect(observed([...rows,rows[0]!,{...rows[0]!,id:skillId(99)}])).toMatchObject({started:5,solved:4,completion:r.completion});
    expect(observed(rows.map(r=>({...r,problemId:rows[0]!.problemId}))).completion).toBeNull();expect(observed([...rows].reverse())).toEqual(r);
  });
  it('independent repeated attempts count as attempts, not extra distinct problems',()=>{
    const rows=Array.from({length:6},(_,i)=>origin(i+1,{problemId:skillId(i<2?100:100+i),sessionStatus:'completed',outcome:'solved_self_reported'}));
    expect(observed(rows).completion).toEqual({numerator:6,denominator:6});
  });
  it('official OK is current observation, never a new post-recommendation completion or added to self-reports',()=>{
    const rows=[origin(1,{official:'observed_ok',sessionStatus:'completed',outcome:'unsolved'}),origin(2,{official:'not_observed'}),origin(3,{official:'disabled'}),origin(4,{official:'not_synced'}),origin(5,{official:'observed_ok',problemId:origin(1).problemId})];
    expect(observed(rows)).toMatchObject({solved:0,unsolved:1,officialAfterRecommendation:null,official:{checkedProblems:2,observedOK:1,unavailableProblems:2}});
    expect(observed([origin(1)]).official.observedOK).toBeNull();expect(observed([trial(1,{official:'observed_ok'})]).official.observedOK).toBeNull();
  });
  it('truncated receipts are a subset, never extrapolated to all training',()=>{expect(observed([origin(1)],500)).toMatchObject({loaded:1,total:500,truncated:true,started:1,untrackedTraining:null});});
  it('different supplied owner cohorts remain isolated without global caching',()=>{expect(observed([origin(1,{sessionStatus:'completed',outcome:'solved_self_reported'})]).solved).toBe(1);expect(observed([trial(2)]).solved).toBe(0);});
});
