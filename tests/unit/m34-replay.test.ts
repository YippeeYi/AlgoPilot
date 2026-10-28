import {describe,it,expect} from 'vitest';
import {byteDigest,freezeSemantics,semanticDigest,verifyReplay,renderReplay,rationalMedian,parseReplayJson} from '../../scripts/m34-replay-core';
import {evaluateStudy,inspectStudy,renderStudyReport,type StudyObservation} from '../../scripts/m34-results';
import {studyInput,studyBlock,studyObservation,eventId} from '../fixtures/m34-results';
import {replayFixture,replay,refreshArtifact,replayTools} from '../fixtures/m34-replay';
const row=(v:ReturnType<typeof replayFixture>,i=0)=>v.current.observations[i] as StudyObservation;
const codes=(v:ReturnType<typeof replay>)=>v.differences.map(x=>x.code);
describe('preparation replay, immutable cases and append-only histories',()=>{
 it('recomputes the actual prepareStudy v1 output and independently verifies a complete report',()=>{expect(replay()).toMatchObject({integrity:'PASS',status:'VALID',checks:{freeze:'PASS',independent:'PASS',json:'PASS',markdown:'PASS'},independent:{counts:{raw:2,latest:2,paired:1,withdrawnParticipants:0}}});});
 it.each(['missing','duplicate','unknown'])('detects %s preparation cases',kind=>{const v=replayFixture();if(kind==='missing')v.freeze.preparations=[];if(kind==='duplicate')v.freeze.preparations.push(structuredClone(v.freeze.preparations[0]!));if(kind==='unknown')v.freeze.preparations[0]!.case_id='P999/0';const r=replay(v);expect(r.integrity).toBe('FAIL');expect(r.checks.independent).toBe('NOT_RUN');});
 it('a changed seed/allocation is not accepted just because current results match the modified order',()=>{const v=replayFixture();v.freeze.preparations[0]!.input.enrollmentIndex++;expect(replay(v).integrity).toBe('FAIL');expect(replay(v).differences.some(d=>d.path.includes('order'))).toBe(true);});
 it('invalid preparation inputs are rejected without leaking their content',()=>{const v=replayFixture();Object.assign(v.freeze.preparations[0]!.input,{consented:false,SECRET_KEY:'private'});const r=replay(v);expect(codes(r)).toContain('PREPARATION_INPUT_INVALID');expect(JSON.stringify(r)).not.toContain('SECRET_KEY');});
 it('frozen config, study identity, criteria and A/B mappings cannot be changed',()=>{
  for(const field of ['study_id','criteria_version','data_source'] as const){const v=replayFixture();Object.assign(v.current,{[field]:'changed'});expect(replay(v).integrity).toBe('FAIL');}
  const v=replayFixture();v.current.blocks[0]!.masked_arms={X:'B',Y:'A'} as never;refreshArtifact(v);expect(replay(v).integrity).toBe('FAIL');
  v.freeze.rules.results='future/2';expect(replay(v).status).toBe('INVALID');
 });
 it('missing, duplicate and reassigned participant cases are located without raw participant IDs',()=>{
  for(const kind of ['missing','duplicate','owner']){const v=replayFixture();if(kind==='missing')v.current.blocks=[];if(kind==='duplicate')v.current.blocks.push(structuredClone(v.current.blocks[0]!));if(kind==='owner')v.current.blocks[0]!.prepared.participantId='P999';refreshArtifact(v);const r=replay(v);expect(r.integrity).toBe('FAIL');expect(JSON.stringify(r.differences)).not.toContain('P999');}
 });
 it('semantic conditions, metadata times, targets and candidate ranking are retained in comparisons',()=>{
  for(const kind of ['condition','time','target','ranking']){const v=replayFixture(),b=v.current.blocks[0]!;if(kind==='condition')b.conditions.time_limit_minutes=60;if(kind==='time')b.metadata_time='2026-10-27T00:00:00Z';if(kind==='target')b.prepared.target=1500;if(kind==='ranking')b.prepared.personalized[0]!.rating=1500;refreshArtifact(v);expect(replay(v).integrity).toBe('FAIL');}
 });
 it('post-freeze original events cannot be removed, edited or duplicated',()=>{
  for(const kind of ['delete','edit','duplicate']){const v=replayFixture();v.freeze.frozen.observations=structuredClone(v.current.observations);if(kind==='delete')v.current.observations.pop();if(kind==='edit')row(v).suitability='偏困难';if(kind==='duplicate')v.current.observations.push({...row(v)});refreshArtifact(v);expect(replay(v).integrity).toBe('FAIL');}
 });
 it('legal corrections retain original rows and only the latest evidence contributes',()=>{
  const v=replayFixture();v.freeze.frozen.observations=structuredClone(v.current.observations);v.current.observations.push({...row(v),event_id:eventId(3),supersedes_event_id:row(v).event_id,recorded_at:'2026-10-28T06:00:00Z',suitability:'偏困难'});refreshArtifact(v);
  expect(replay(v)).toMatchObject({status:'VALID',independent:{counts:{raw:3,superseded:1,latest:2,paired:1}}});expect(replay(v).independent!.metrics[0]!.medianDifference).toBe(0);
  const ledger=replay(v).lineage!;expect(ledger).toMatchObject({original:2,appended:1});expect(ledger.records.filter(r=>r.frozenOriginal&&!r.latestValid)).toHaveLength(1);expect(ledger.records.find(r=>r.appended)).toMatchObject({correction:true,latestValid:true,statistical:true,withdrawn:false});
 });
 it('conflicting roots and broken correction graphs are consistently invalid without inventing samples',()=>{
  for(const kind of ['root','parent','branch']){const v=replayFixture(),next={...row(v),event_id:eventId(3),supersedes_event_id:kind==='root'?null:kind==='parent'?eventId(99):row(v).event_id,recorded_at:'2026-10-28T06:00:00Z'};v.current.observations.push(next);if(kind==='branch')v.current.observations.push({...next,event_id:eventId(4)});refreshArtifact(v);const r=replay(v);expect(r.integrity).toBe('PASS');expect(['INVALID','INCOMPLETE']).toContain(r.status);expect(r.independent!.counts.paired).toBe(0);}
 });
 it('withdrawal survives later false corrections and excludes all paired statistics',()=>{
  const v=replayFixture();v.current.observations.push({...row(v),event_id:eventId(3),supersedes_event_id:row(v).event_id,recorded_at:'2026-10-28T06:00:00Z',withdrawal:true},{...row(v),event_id:eventId(4),supersedes_event_id:eventId(3),recorded_at:'2026-10-28T07:00:00Z',withdrawal:false});refreshArtifact(v);
  expect(replay(v)).toMatchObject({integrity:'PASS',status:'NON_COMPARABLE',independent:{counts:{withdrawnParticipants:1,paired:0}}});
  expect(replay(v).lineage!.records.every(r=>r.withdrawn&&!r.statistical)).toBe(true);
 });
 it('only active->withdrawn and initial unblinding are allowed, never implicit reconsent or a new unblind time',()=>{
  const v=replayFixture();v.current.blocks[0]!.consent_status='withdrawn';refreshArtifact(v);expect(replay(v).integrity).toBe('PASS');
  v.freeze.frozen.blocks[0]!.consent_status='withdrawn';v.current.blocks[0]!.consent_status='active';refreshArtifact(v);expect(replay(v).integrity).toBe('FAIL');
  const w=replayFixture();w.freeze.frozen.blocks[0]!.unblinded_at=w.current.blocks[0]!.unblinded_at;w.current.blocks[0]!.unblinded_at='2026-10-28T05:00:00Z';expect(replay(w).integrity).toBe('FAIL');
 });
 it('NULL stays missing, rather than being normalized to zero',()=>{const v=replayFixture();row(v).goal_match=null;refreshArtifact(v);expect(replay(v)).toMatchObject({integrity:'PASS'});const m=replay(v).independent!.metrics.find(m=>m.metric==='goalMatch')!;expect(m).toMatchObject({pairs:0,missingPairs:1,missingA:1,missingB:0,medianDifference:null});});
 it('invalid or empty observations are checked as invalid/incomplete data, never real research',()=>{
  const v=replayFixture();v.current.observations=[{}];refreshArtifact(v);const r=replay(v);expect(r.integrity).toBe('PASS');expect(r.status).toBe('INCOMPLETE');expect(r.independent!.counts.paired).toBe(0);
  v.current.observations=[];refreshArtifact(v);expect(replay(v).status).toBe('INCOMPLETE');expect(replay(v).dataSource).toBe('synthetic');
 });
});
describe('independent arithmetic and artifact agreement',()=>{
 it('rejects duplicate decoded JSON keys, overflow and unsafe integers while preserving ordinary formatting',()=>{const ordinary={n:1,x:[null,true,'a"b']};expect(parseReplayJson(JSON.stringify(ordinary).replace('"n":1','"n":1.0'))).toEqual(ordinary);for(const text of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"n":1e309}','{"n":9007199254740993}'])expect(()=>parseReplayJson(text)).toThrow();});
 it('catches a producer miscount even if its JSON and Markdown agree with one another',()=>{
  const v=replayFixture(),badTools={...replayTools,inspectStudy:(raw:unknown)=>{const x=inspectStudy(raw);if(x.result.counts)x.result.counts.paired++;return x;}};
  const bad=badTools.inspectStudy(v.current).result;const r=verifyReplay(v.freeze,v.current,bad,renderStudyReport(bad),badTools);
  expect(r.checks).toMatchObject({json:'PASS',markdown:'PASS',independent:'FAIL'});expect(codes(r)).toContain('INDEPENDENT_RECOUNT_MISMATCH');
 });
 it.each(['denominator','missing','participant','median','inputHash'])('detects a matching but wrong producer %s',kind=>{
  const v=replayFixture(),tools={...replayTools,inspectStudy:(raw:unknown)=>{const x=inspectStudy(raw);if(kind==='inputHash'&&'inputHash' in x.result)x.result.inputHash='f'.repeat(64);const m=x.result.metrics[0];if(m){if(kind==='denominator')m.A.denominator++;if(kind==='missing')m.missingPairs++;if(kind==='participant')m.participants++;if(kind==='median')m.medianDifference=1-Number.EPSILON;}return x;}};
  const bad=tools.inspectStudy(v.current).result;expect(verifyReplay(v.freeze,v.current,bad,renderStudyReport(bad),tools).checks.independent).toBe('FAIL');
 });
 it('stale pre-withdrawal statistics cannot be retained after revocation',()=>{const v=replayFixture();v.current.blocks[0]!.consent_status='withdrawn';const r=replay(v);expect(r.independent!.counts.paired).toBe(0);expect(r.checks.json).toBe('FAIL');expect(r.checks.markdown).toBe('FAIL');});
 it('JSON and Markdown tampering, extra fields and inconsistent conclusions are located safely',()=>{
  const v=replayFixture();v.artifact={...v.artifact,PRIVATE_KEY:'secret'} as never;v.markdown+='secret private code';const r=replay(v);expect(r.checks.json).toBe('FAIL');expect(r.checks.markdown).toBe('FAIL');expect(JSON.stringify(r)+renderReplay(r)).not.toMatch(/PRIVATE_KEY|secret private code/);
 });
 it('reordering collections or JSON keys preserves semantic content; raw byte hashes remain different',()=>{
  const v=replayFixture(),before=replay(v);v.current.observations.reverse();v.freeze.preparations[0]!.input.eligiblePool.reverse();refreshArtifact(v);expect(replay(v)).toEqual(before);
  const reordered=JSON.parse(JSON.stringify(v),(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).reverse()):x);expect(replay(reordered)).toEqual(before);
  expect(byteDigest(JSON.stringify(v))).not.toBe(byteDigest(JSON.stringify(v,null,2)));expect(semanticDigest(freezeSemantics(v.freeze))).toBe(before.freezeHash);
 });
 it('valid original CLI output is byte-compatible with the pre-change version',()=>{const r=evaluateStudy(studyInput());expect(byteDigest(JSON.stringify(r,null,2)+'\n')).toBe('8a0568978e0031a4e37a9942bb0042249a9b6bf39fb19fdbbe7b9f971a08f2ed');expect(byteDigest(renderStudyReport(r))).toBe('b51561cf62bbf77fbbba433efa9711d3605dfaccf5344ed342e9219ce4848ba6');});
 it('exact rational arithmetic covers decimal boundaries without rounding observed inputs',()=>{
  expect(rationalMedian([{numerator:1,denominator:3},{numerator:1,denominator:2}])).toEqual({numerator:'5',denominator:'12'});
  const v=replayFixture();row(v).duration_minutes=45+Number.EPSILON*32;refreshArtifact(v);expect(replay(v)).toMatchObject({status:'NON_COMPARABLE',independent:{counts:{paired:0}}});
 });
 it('three cases from two participants remain two independent units, with per-metric denominators',()=>{
  const c=studyInput(),second=studyBlock('P001',1),peer=studyBlock('P002');c.blocks.push(second,peer);c.reviewers.push({id:'R-P002',kind:'participant',participant_id:'P002',verified:true});
  c.observations.push({...studyObservation(second,'A',3),suitability:'偏困难'},studyObservation(second,'B',4),{...studyObservation(peer,'A',5),suitability:'偏困难'},{...studyObservation(peer,'B',6),suitability:'适合'});
  const v=replayFixture(c),r=replay(v);expect(r.integrity).toBe('PASS');expect(r.independent!.metrics[0]).toMatchObject({pairs:3,participants:2,medianDifference:-0.25});
  expect(r.independent!.exactFractions.suitability).toMatchObject({median:{numerator:'-1',denominator:'4'}});
  v.current.blocks[0]!.consent_status='withdrawn';refreshArtifact(v);expect(replay(v)).toMatchObject({integrity:'PASS',independent:{counts:{withdrawnParticipants:1,paired:1}}});
 });
});
