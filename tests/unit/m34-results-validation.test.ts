import {it,expect,describe} from 'vitest';
import {readFile} from 'node:fs/promises';
import {evaluateStudy,type StudyObservation,conditionsHash} from '../../scripts/m34-results';
import {studyInput,studyBlock,studyObservation,eventId} from '../fixtures/m34-results';
const codes=(r:ReturnType<typeof evaluateStudy>)=>r.records.flatMap(row=>row.issues.map(i=>i.code));
const row=(v=studyInput(),i=0)=>v.observations[i] as StudyObservation;
describe('M3.4 explicit observation validation, no score imputation',()=>{
 it('accepts actual study-preparation/1 output unchanged and marks synthetic source',()=>{const r=evaluateStudy(studyInput());expect(r).toMatchObject({status:'VALID',humanEvidence:'SYNTHETIC_NOT_HUMAN_RESEARCH',counts:{raw:2,valid:2,paired:1}});});
 it('does not fabricate research rows from empty datasets or the legacy blank template',async()=>{
  const v=studyInput();v.blocks=[];v.observations=[];expect(evaluateStudy(v)).toMatchObject({status:'INCOMPLETE',counts:{raw:0,paired:0}});
  v.observations=[JSON.parse(await readFile('docs/m34/study-observation.template.json','utf8'))];expect(evaluateStudy(v).status).toBe('INCOMPLETE');expect(codes(evaluateStudy(v))).toContain('MISSING_FIELD');
 });
 it.each(['event_id','reviewer','suitability','conditions_hash'])('missing %s is incomplete, not repaired',field=>{
  const v=studyInput();delete (v.observations[0] as Record<string,unknown>)[field];const before=JSON.stringify(v),r=evaluateStudy(v);expect(r.status).toBe('INCOMPLETE');expect(r.counts?.paired).toBe(0);expect(JSON.stringify(v)).toBe(before);
 });
 it.each([['suitability',5],['highest_hint_seen',6],['duration_minutes',-1],['goal_match','yes'],['source_match','verified'],['problem_key','bad']])('rejects invalid %s without logging its value',(field,value)=>{
  const v=studyInput();(v.observations[0] as Record<string,unknown>)[field!]=value;const r=evaluateStudy(v);expect(r.status).toBe('INVALID');expect(r.counts?.paired).toBe(0);
 });
 it('rejects extra fields without echoing arbitrary secret field names or text',()=>{
  const v=studyInput();v.observations[0]={...row(v),PRIVATE_SECRET_FIELD:'SECRET_VALUE'};const r=evaluateStudy(v);expect(r.status).toBe('INVALID');expect(JSON.stringify(r)).not.toMatch(/PRIVATE_SECRET_FIELD|SECRET_VALUE/);
 });
 it('criteria and engine mismatch never mix versions',()=>{
  for(const [field,value] of [['criteria_version','future/2'],['engine_version','future/2']]){const v=studyInput();(v.observations[0] as Record<string,unknown>)[field!]=value;expect(evaluateStudy(v).status).toBe('INVALID');}
  expect(evaluateStudy({...studyInput(),criteria_version:'future/2'}).status).toBe('INVALID');
 });
 it('rejects identical event replay and conflicting event IDs, never double counts them',()=>{
  const v=studyInput();v.observations.push({...row(v)});expect(codes(evaluateStudy(v))).toContain('DUPLICATE_EVENT');expect(evaluateStudy(v).counts?.paired).toBe(0);
  (v.observations[2] as StudyObservation).suitability='偏困难';expect(codes(evaluateStudy(v))).toContain('CONFLICTING_EVENT');
 });
 it('new IDs do not conceal duplicate results without an explicit supersedes chain',()=>{
  const v=studyInput();v.observations.push({...row(v),event_id:eventId(3)});expect(codes(evaluateStudy(v))).toContain('CONFLICTING_RESULT');
 });
 it('linear corrections use latest valid result while preserving prior events',()=>{
  const v=studyInput();v.observations.push({...row(v),event_id:eventId(3),supersedes_event_id:row(v).event_id,recorded_at:'2026-10-28T06:00:00Z',suitability:'偏困难'});
  expect(evaluateStudy(v)).toMatchObject({status:'VALID',counts:{raw:3,valid:3,superseded:1,latest:2,paired:1}});
  expect(evaluateStudy(v).metrics.find(m=>m.metric==='suitability')?.medianDifference).toBe(0);
 });
 it.each(['missing','branch','cycle','owner'])('rejects %s correction lineage without falling back to a convenient prior value',kind=>{
  const v=studyInput();const next={...row(v),event_id:eventId(3),supersedes_event_id:kind==='missing'?eventId(99):row(v).event_id,recorded_at:'2026-10-28T06:00:00Z'};
  if(kind==='owner')next.reviewer='another';if(kind==='cycle')row(v).supersedes_event_id=next.event_id;
  v.observations.push(next);if(kind==='branch')v.observations.push({...next,event_id:eventId(4)});
  expect(['INCOMPLETE','INVALID']).toContain(evaluateStudy(v).status);expect(evaluateStudy(v).counts?.paired).toBe(0);
 });
 it('unregistered reviewers, owners and study objects cannot authorize observations',()=>{
  for(const update of [{reviewer:'unknown'},{problem_key:'99999/A'},{participant_id:'P999'}]){const v=studyInput();v.observations[0]={...row(v),...update};expect(evaluateStudy(v).status).toBe('INVALID');}
  const v=studyInput();v.reviewers[0]!.participant_id='P002';expect(codes(evaluateStudy(v))).toContain('REVIEWER_OWNER_MISMATCH');
 });
 it('AI/unverified declarations do not enter human participant analysis',()=>{
  for(const patch of [{kind:'ai' as const},{verified:false}]){const v=studyInput();Object.assign(v.reviewers[0]!,patch);const r=evaluateStudy(v);expect(r.status).toBe('NON_COMPARABLE');expect(r.counts?.paired).toBe(0);}
  const v=studyInput();v.data_source='declared_human';expect(evaluateStudy(v)).toMatchObject({humanEvidence:'OPERATOR_DECLARED_NOT_INDEPENDENTLY_VERIFIED'});
 });
 it('teacher observations remain separate and do not replace the participant',()=>{
  const v=studyInput();v.reviewers.push({id:'T001',kind:'teacher',participant_id:null,verified:true});v.observations.push({...row(v),reviewer:'T001',event_id:eventId(3),suitability:'偏困难'});
  expect(evaluateStudy(v)).toMatchObject({status:'VALID',counts:{teacherObservations:1,paired:1}});expect(evaluateStudy(v).metrics[0]!.medianDifference).toBe(1);
 });
 it('excludes a withdrawn participant across all events; a later false does not reconsent',()=>{
  const v=studyInput();v.observations.push({...row(v),event_id:eventId(3),supersedes_event_id:row(v).event_id,recorded_at:'2026-10-28T06:00:00Z',withdrawal:true},{...row(v),event_id:eventId(4),supersedes_event_id:eventId(3),recorded_at:'2026-10-28T07:00:00Z',withdrawal:false});
  expect(evaluateStudy(v)).toMatchObject({status:'NON_COMPARABLE',counts:{paired:0,withdrawnParticipants:1}});
  const w=studyInput();w.blocks[0]!.consent_status='withdrawn';expect(evaluateStudy(w).counts?.paired).toBe(0);
 });
 it('input mismatch of version, consent, pool, metadata, conditions and evidence is non-comparable',()=>{
  for(const update of [{consent_version:'other'},{pool_hash:'f'.repeat(64)},{metadata_time:'2026-10-27T00:00:00Z'},{conditions_hash:'f'.repeat(64)},{evidence_revision:3},{official_revision:9},{order:row().order==='AB'?'BA':'AB'},{masked_arm:'Y'}]){const v=studyInput();v.observations[0]={...row(v),...update};expect(codes(evaluateStudy(v))).toContain('CONTEXT_MISMATCH');expect(evaluateStudy(v).counts?.paired).toBe(0);}
 });
 it('semantic prepared-block conflicts and repeated registry keys fail the batch',()=>{
  const v=studyInput();v.blocks.push(structuredClone(v.blocks[0]!));expect(evaluateStudy(v).status).toBe('INVALID');
  const x=studyInput();x.blocks[0]!.prepared.sharedIds=[eventId(900)];expect(evaluateStudy(x).status).toBe('INVALID');
  const w=studyInput();w.reviewers.push({...w.reviewers[0]!});expect(evaluateStudy(w).status).toBe('INVALID');
 });
 it('a selected pair must be present in frozen arm lists; no forced association',()=>{
  const v=studyInput();v.blocks[0]!.pair.A='99999/A';expect(evaluateStudy(v).inputIssues).toContainEqual({code:'PAIR_NOT_IN_FROZEN_LIST',path:'blocks.pair'});
 });
 it('actual hint-policy deviations are rejected without changing the policy',()=>{const v=studyInput();row(v).highest_hint_seen=5;expect(codes(evaluateStudy(v))).toContain('HINT_POLICY_DEVIATION');expect(evaluateStudy(v).counts?.paired).toBe(0);});
 it('conditions hash is deterministic for object key order',()=>{const b=studyBlock();expect(conditionsHash(b.conditions)).toBe(conditionsHash({...b.conditions,time_limit_minutes:45}));expect(studyObservation().conditions_hash).toMatch(/^[a-f0-9]{64}$/);});
 it('missing and malformed fields together are INVALID rather than hiding the malformed value',()=>{const v=studyInput();delete (v.observations[0] as Record<string,unknown>).reviewer;Object.assign(row(v),{highest_hint_seen:8});expect(evaluateStudy(v).status).toBe('INVALID');});
 it('one database ID cannot refer to different CF objects in the frozen lists',()=>{const v=studyInput();v.blocks[0]!.prepared.baseline[0]!.id=v.blocks[0]!.prepared.personalized[0]!.id;v.blocks[0]!.prepared.sharedIds=[v.blocks[0]!.prepared.baseline[0]!.id];expect(evaluateStudy(v).inputIssues).toContainEqual({code:'CONFLICTING_PROBLEM_ID',path:'blocks.prepared'});expect(evaluateStudy(v).counts?.paired).toBe(0);});
 it('a recorded time-budget deviation cannot silently remain comparable',()=>{const v=studyInput();row(v).duration_minutes=46;expect(codes(evaluateStudy(v))).toContain('DURATION_POLICY_DEVIATION');expect(evaluateStudy(v).counts?.paired).toBe(0);});
 it('UTC fractional formatting does not create a false time-order error',()=>{const v=studyInput();v.blocks[0]!.frozen_at='2026-10-28T05:00:00.000Z';v.blocks[0]!.unblinded_at='2026-10-28T06:00:00Z';expect(evaluateStudy(v).status).toBe('VALID');});
});
