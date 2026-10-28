import {describe,it,expect} from 'vitest';
import {evaluateStudy,renderStudyReport,type StudyObservation} from '../../scripts/m34-results';
import {studyInput,studyBlock,studyObservation,eventId} from '../fixtures/m34-results';
const row=(v=studyInput(),i=0)=>v.observations[i] as StudyObservation;
const summary=(v=studyInput())=>evaluateStudy(v);
const metric=(v=studyInput(),name='suitability')=>summary(v).metrics.find(m=>m.metric===name)!;
describe('registered M3.4 pairing without forced matches',()=>{
 it('matches one declared participant pair and reports all count units',()=>{expect(summary()).toMatchObject({status:'VALID',counts:{raw:2,valid:2,paired:1,unpaired:0,pairedObservations:2,notInPairedAnalysis:0,registeredBlocks:1,expectedBlocks:2}});});
 it('missing arm has no comparison and is counted explicitly',()=>{const v=studyInput();v.observations.pop();const r=summary(v);expect(r).toMatchObject({status:'NON_COMPARABLE',counts:{paired:0,unpaired:1}});expect(r.pairs[0]!.reasons).toContain('MISSING_ARM');expect(metric(v).medianDifference).toBeNull();});
 it('does not select one of two participant arm responses',()=>{
  const v=studyInput();v.reviewers.push({id:'R-P001-second',kind:'participant',participant_id:'P001',verified:true});v.observations.push({...row(v),event_id:eventId(3),reviewer:'R-P001-second'});
  expect(summary(v).pairs[0]!.reasons).toContain('AMBIGUOUS_ARM');expect(summary(v).counts?.paired).toBe(0);
 });
 it('pair ID conflicts across blocks cannot increase N',()=>{const v=studyInput();const b=studyBlock('P002');b.pair.pair_id=v.blocks[0]!.pair.pair_id;v.blocks.push(b);expect(summary(v).status).toBe('INVALID');});
 it.each(['rating','theme','shared','unverified','blinded','no_pair'])('excludes %s mismatch',reason=>{
  const v=studyInput(),b=v.blocks[0]!;
  if(reason==='rating')b.prepared.personalized[0]!.rating=1800;
  if(reason==='theme')b.pair.theme='dp';
  if(reason==='shared'){b.prepared.baseline=[structuredClone(b.prepared.personalized[0]!)];b.prepared.sharedIds=[b.prepared.personalized[0]!.id];b.pair.B=b.pair.A;row(v,1).problem_key=b.pair.A;}
  if(reason==='unverified')b.provenance_verified=false;if(reason==='blinded')b.unblinded_at=null;
  if(reason==='no_pair')(b as unknown as {pair:null}).pair=null;
  expect(summary(v).counts?.paired).toBe(0);expect(summary(v).status).not.toBe('VALID');
 });
 it.each(['previously_seen','stopped','missing_prerequisite'])('%s excludes both sides from training-pair statistics',field=>{const v=studyInput();Object.assign(row(v),{[field]:true});expect(summary(v).status).toBe('NON_COMPARABLE');expect(summary(v).counts?.paired).toBe(0);});
 it('unknown training eligibility and protocol deviations are not failures or zeros',()=>{for(const update of [{previously_seen:null},{stopped:null},{protocol_deviation:'SYNTHETIC private reason'}]){const v=studyInput();Object.assign(row(v),update);expect(summary(v).counts?.paired).toBe(0);expect(metric(v).medianDifference).toBeNull();}});
 it('repeated problems across blocks cannot form independent outcomes',()=>{const v=studyInput();const b=structuredClone(v.blocks[0]!);b.prepared.block=1;b.prepared.order=b.prepared.order==='AB'?'BA':'AB';b.pair.pair_id='PAIR-SECOND';v.blocks.push(b);expect(summary(v).pairs.every(p=>p.reasons.includes('REPEATED_PROBLEM'))).toBe(true);});
 it('two blocks require reversed order; missing block is visible rather than invented',()=>{const v=studyInput();const b=studyBlock('P001',1);b.prepared.order=v.blocks[0]!.prepared.order;v.blocks.push(b);expect(summary(v).pairs.every(p=>p.reasons.includes('ORDER_NOT_COUNTERBALANCED'))).toBe(true);expect(summary().counts).toMatchObject({registeredBlocks:1,expectedBlocks:2});});
});
describe('transparent participant-unit statistics and reproducible reports',()=>{
 it('single pair has binary dimensions and honest sample sizes',()=>{expect(metric()).toMatchObject({pairs:1,participants:1,missingPairs:0,medianDifference:1,range:[1,1]});expect(metric(studyInput(),'highHint').medianDifference).toBe(-1);});
 it('averages within a participant before the median; three pairs are not three independent players',()=>{
  const v=studyInput(),second=studyBlock('P001',1),peer=studyBlock('P002');v.blocks.push(second,peer);v.reviewers.push({id:'R-P002',kind:'participant',participant_id:'P002',verified:true});
  v.observations.push({...studyObservation(second,'A',3),suitability:'偏困难'},studyObservation(second,'B',4),{...studyObservation(peer,'A',5),suitability:'偏困难'},{...studyObservation(peer,'B',6),suitability:'适合'});
  const m=metric(v);expect(m).toMatchObject({pairs:3,participants:2,medianDifference:-0.25,range:[-1,0.5]});expect(m.byParticipant.map(p=>p.pairs).sort()).toEqual([1,2]);
 });
 it('per-metric complete pairs use their own denominators, not the observed one-sided score',()=>{
  const v=studyInput();row(v).goal_match=null;expect(metric(v,'goalMatch')).toMatchObject({pairs:0,participants:0,missingPairs:1,missingA:1,missingB:0,medianDifference:null,range:null});expect(metric(v).pairs).toBe(1);
 });
 it('all UNKNOWN scores produce no comparison claim even with structurally matched pairs',()=>{
  const v=studyInput();for(const x of v.observations)Object.assign(x as object,{suitability:null,difficulty:null,goal_match:null,reason_supported:null,highest_hint_seen:null});
  const r=summary(v);expect(r.status).toBe('INCOMPLETE');expect(r.counts?.paired).toBe(1);expect(r.metrics.every(m=>m.participants===0&&m.medianDifference===null)).toBe(true);expect(renderStudyReport(r)).toContain('UNKNOWN');
 });
 it('observation/block/reviewer order and object key order do not change JSON or Markdown',()=>{
  const v=studyInput();v.observations.push({...row(v),event_id:eventId(3),supersedes_event_id:row(v).event_id,recorded_at:'2026-10-28T06:00:00Z'});
  const original=summary(v),md=renderStudyReport(original);v.observations.reverse();v.reviewers.reverse();v.blocks.reverse();
  expect(summary(v)).toEqual(original);expect(renderStudyReport(summary(v))).toBe(md);
  const reorder=JSON.parse(JSON.stringify(v),(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).reverse()):x);expect(evaluateStudy(reorder)).toEqual(original);
 });
 it('invalid records cannot be silently excluded to retain a favorable complete pair',()=>{const v=studyInput();v.observations.push({bad:'SECRET'});const r=summary(v);expect(r.counts?.paired).toBe(0);expect(r.metrics.every(m=>m.participants===0)).toBe(true);expect(renderStudyReport(r)).not.toContain('SECRET');});
 it('free-text suggestions, code or sensitive response material never appear in the output',()=>{
  const v=studyInput();row(v).suggestion='PRIVATE_CODE API_KEY SECRET_RESPONSE';row(v).new_issue='PRIVATE_CODE';const r=summary(v);expect(JSON.stringify(r)+renderStudyReport(r)).not.toMatch(/PRIVATE_CODE|API_KEY|SECRET_RESPONSE|SYNTHETIC-CONSENT/);
 });
 it('official and self-report facts never change the six registered comparison dimensions',()=>{
  const v=studyInput(),before=summary(v).metrics;Object.assign(row(v),{outcome_self_report:'unsolved',official_verdict:'OK'});expect(summary(v).metrics).toEqual(before);expect(renderStudyReport(summary(v))).toContain('自报、官方和代码一致性分开');
 });
 it('malformed envelopes produce safe locatable diagnostics, not guesses',()=>{const r=evaluateStudy({...studyInput(),observations:'private-secret'});expect(r.counts).toBeNull();expect(r.inputIssues[0]!.path).toBe('observations');expect(renderStudyReport(r)).not.toContain('private-secret');});
 it('unknown prerequisite check leaves the pair non-comparable',()=>{const v=studyInput();row(v).missing_prerequisite=null;expect(summary(v).pairs[0]!.reasons).toContain('UNKNOWN_PREREQUISITE');expect(summary(v).counts?.paired).toBe(0);});
 it('extra AI commentary does not invalidate an otherwise eligible participant pair',()=>{const v=studyInput();v.reviewers.push({id:'AI001',kind:'ai',participant_id:null,verified:true});v.observations.push({...row(v),reviewer:'AI001',review_type:'ai',event_id:eventId(3)});expect(summary(v)).toMatchObject({status:'VALID',counts:{paired:1,nonComparable:1}});});
 it('paired event counts explicitly separate teacher, historical and excluded raw records',()=>{const r=summary();expect(r.counts).toMatchObject({raw:2,pairedObservations:2,notInPairedAnalysis:0});expect(metric().A).toEqual({numerator:1,denominator:1});expect(metric().B).toEqual({numerator:0,denominator:1});});
});
