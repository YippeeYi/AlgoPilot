// Offline M3.4 observations only. Never imported into the product or used as ability evidence.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
export const criteriaVersion='m34-observation/1';
const token=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), participant=z.string().regex(/^P[0-9]{3,6}$/);
const time=z.iso.datetime(), revision=z.number().int().nonnegative();
const key=z.string().regex(/^[1-9][0-9]*\/[A-Z0-9]{1,12}$/), arm=z.enum(['A','B']);
const problem=z.object({id:z.uuid(),contestId:z.number().int().positive(),index:z.string().regex(/^[A-Z0-9]{1,12}$/),rating:z.number().int().min(800).max(3500),tags:z.array(z.string().max(80)).max(50)}).strict();
// The existing study-preparation/1 output is accepted unchanged. Semantic checks below are necessary too.
const prepared=z.object({version:z.literal('study-preparation/1'),participantId:participant,consentId:z.string().min(1).max(80),engineVersion:z.literal('deterministic/1.3-official'),order:z.enum(['AB','BA']),block:z.number().int().min(0).max(1),range:z.tuple([z.number().int().min(800),z.number().int().max(3500)]),target:z.number().int(),themes:z.array(z.string().max(80)).max(5),goal:z.enum(['balanced','independence','explore']),sharedCandidateCount:z.number().int().positive(),sharedCandidateSha256:z.string().regex(/^[a-f0-9]{64}$/),evidenceRevision:revision,officialRevision:revision,eligibilitySource:z.literal('authorized_current_learning_candidates_snapshot'),personalized:z.array(problem).min(1).max(5),baseline:z.array(problem).min(1).max(5),sharedIds:z.array(z.uuid()).max(5),boundary:z.string().max(1000)}).strict();
const blockSchema=z.object({prepared,consent_version:token,consent_status:z.enum(['active','withdrawn']),provenance_verified:z.boolean(),scenario:token,metadata_time:time,frozen_at:time,unblinded_at:time.nullable(),masked_arms:z.object({X:arm,Y:arm}).strict(),conditions:z.object({time_limit_minutes:z.number().int().min(1).max(120),highest_allowed_hint:z.number().int().min(0).max(5),tutor_policy:token,review_opportunity:z.literal('equal')}).strict(),pair:z.object({pair_id:token,A:key,B:key,theme:z.string().min(1).max(80)}).strict().nullable()}).strict();
export const resultsInputSchema=z.object({version:z.literal('m34-results-input/1'),criteria_version:z.literal(criteriaVersion),study_id:token,data_source:z.enum(['synthetic','declared_human']),reviewers:z.array(z.object({id:token,kind:z.enum(['participant','teacher','ai']),participant_id:participant.nullable(),verified:z.boolean()}).strict()).max(1000),blocks:z.array(blockSchema).max(1000),observations:z.array(z.unknown()).max(10000)}).strict();
// No ordinal scale was registered in M3.4. Reuse the five existing assessment categories, not invented 1–5 scores.
export const observationSchema=z.object({criteria_version:z.literal(criteriaVersion),event_id:z.uuid(),supersedes_event_id:z.uuid().nullable(),conditions_hash:z.string().regex(/^[a-f0-9]{64}$/),recorded_at:time,reviewer:token,review_type:z.enum(['human','ai']),participant_id:participant,consent_id:z.string().min(1).max(80),consent_version:token,block:z.number().int().min(0).max(1),order:z.enum(['AB','BA']),masked_arm:z.enum(['X','Y']),actual_arm:arm,engine_version:z.literal('deterministic/1.3-official'),pool_hash:z.string().regex(/^[a-f0-9]{64}$/),metadata_time:time,evidence_revision:revision,official_revision:revision,scenario:token,problem_key:key,pair_id:token.nullable(),previously_seen:z.boolean().nullable(),suitability:z.enum(['适合','偏简单','偏困难','方向不符','理由缺乏证据']).nullable(),difficulty:z.enum(['偏简单','适中','偏困难']).nullable(),goal_match:z.boolean().nullable(),reason_supported:z.boolean().nullable(),evidence_refs:z.array(token).max(100),missing_prerequisite:z.boolean().nullable(),outcome_self_report:z.enum(['not_recorded','solved_self_reported','unsolved','abandoned']).nullable(),official_verdict:z.enum(['OK','not_observed','not_synced']).nullable(),source_match:z.literal('unverified'),highest_hint_seen:z.number().int().min(0).max(5).nullable(),external_help:z.boolean().nullable(),stopped:z.boolean().nullable(),duration_minutes:z.number().finite().min(0).max(1440).nullable(),review_source:z.enum(['human','ai','none']).nullable(),new_issue:z.string().max(1000).nullable(),issue_confidence:z.enum(['unknown','tentative','supported']).nullable(),withdrawal:z.boolean().nullable(),protocol_deviation:z.string().max(1000).nullable(),suggestion:z.string().max(1000).nullable()}).strict();
export type StudyObservation=z.infer<typeof observationSchema>;
type Block=z.infer<typeof blockSchema>;
export type ResultStatus='VALID'|'INVALID'|'INCOMPLETE'|'NON_COMPARABLE';
type Issue={code:string;path:string};
type Checked={ref:string;status:ResultStatus;issues:Issue[];row?:StudyObservation};
export function canonicalJson(v:unknown):string {
  if(Array.isArray(v))return '['+v.map(canonicalJson).join(',')+']';
  if(v!==null&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>compare(a,b)).map(([k,x])=>JSON.stringify(k)+':'+canonicalJson(x)).join(',')+'}';
  return JSON.stringify(v)??'null';
}
const hash=(v:unknown)=>createHash('sha256').update(canonicalJson(v)).digest('hex');
export const conditionsHash=(v:unknown)=>hash(v); // Internal consistency only, never authentication.
const identity=(b:Block)=>`${b.prepared.participantId}/${b.prepared.block}`;
const problemKey=(p:z.infer<typeof problem>)=>`${p.contestId}/${p.index}`;
const slot=(r:StudyObservation)=>`${r.participant_id}/${r.block}/${r.problem_key}/${r.reviewer}`;
const metrics={suitability:(r:StudyObservation)=>r.suitability===null?null:Number(r.suitability==='适合'),goalMatch:(r:StudyObservation)=>r.goal_match===null?null:Number(r.goal_match),highHint:(r:StudyObservation)=>r.highest_hint_seen===null?null:Number(r.highest_hint_seen>=3),tooEasy:(r:StudyObservation)=>r.difficulty===null?null:Number(r.difficulty==='偏简单'),tooHard:(r:StudyObservation)=>r.difficulty===null?null:Number(r.difficulty==='偏困难'),reasonSupported:(r:StudyObservation)=>r.reason_supported===null?null:Number(r.reason_supported)};
const median=(v:number[])=>{const a=[...v].sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length?a.length%2?a[m]!:(a[m-1]!+a[m]!)/2:null;};
function issueValue(raw:unknown,path:PropertyKey[]){let v:unknown=raw;for(const p of path){if(!v||typeof v!=='object')return undefined;v=(v as Record<string,unknown>)[String(p)];}return v;}
function isMissing(i:z.core.$ZodIssue,raw:unknown){const value=issueValue(raw,i.path);return (i.code==='invalid_type'||i.code==='invalid_value')&&(value===undefined||value===null);}
function schemaIssues(error:z.ZodError,raw:unknown):Issue[]{return error.issues.map(i=>({code:isMissing(i,raw)?'MISSING_FIELD':i.code==='unrecognized_keys'?'UNKNOWN_FIELDS':'INVALID_FIELD',path:i.path.length?i.path.join('.'):'$'}));}
function schemaStatus(error:z.ZodError,raw:unknown):'INVALID'|'INCOMPLETE'{return error.issues.some(i=>!isMissing(i,raw))?'INVALID':'INCOMPLETE';}

export type StudyLedger={input:z.infer<typeof resultsInputSchema>;records:Checked[];latest:Checked[];inputIssues:Issue[];cases:{ref:string;participantRef:string;block:number;order:string;scenarioRef:string;reasons:string[];A:StudyObservation|undefined;B:StudyObservation|undefined}[]};
function analyseStudy(raw:unknown,capture?:(ledger:StudyLedger)=>void){
  const sourceHash=hash(raw);
  const envelope=resultsInputSchema.safeParse(raw);
  if(!envelope.success)return {version:'m34-results/1' as const,criteriaVersion,sourceHash,status:schemaStatus(envelope.error,raw),inputIssues:schemaIssues(envelope.error,raw),counts:null,records:[],pairs:[],metrics:[],boundary:'Invalid or incomplete envelope: no observations analyzed.'};
  const v=envelope.data;
  // Collection order has no statistical meaning; list ranking inside prepared blocks does.
  const inputHash=hash({...v,reviewers:[...v.reviewers].sort((a,b)=>compare(canonicalJson(a),canonicalJson(b))),blocks:[...v.blocks].sort((a,b)=>compare(canonicalJson(a),canonicalJson(b))),observations:[...v.observations].sort((a,b)=>compare(canonicalJson(a),canonicalJson(b)))});
  const checked:Checked[]=v.observations.map(raw=>{const parsed=observationSchema.safeParse(raw);return parsed.success?{ref:hash(raw),status:'VALID',issues:[],row:parsed.data}:{ref:hash(raw),status:schemaStatus(parsed.error,raw),issues:schemaIssues(parsed.error,raw)};});
  const issues:Issue[]=[];
  const add=(r:Checked,code:string,status:ResultStatus='INVALID',path='$')=>{r.issues.push({code,path});if(r.status==='VALID'||status==='INVALID')r.status=status;};
  const reviewerMap=new Map(v.reviewers.map(r=>[r.id,r]));
  if(reviewerMap.size!==v.reviewers.length)issues.push({code:'DUPLICATE_REVIEWER',path:'reviewers'});
  const blocks=new Map(v.blocks.map(b=>[identity(b),b]));
  if(blocks.size!==v.blocks.length)issues.push({code:'DUPLICATE_BLOCK',path:'blocks'});
  const blockProblems=new Map<string,string[]>();
  const blockReasons=new Map<string,string[]>();
  const reason=(b:Block,code:string)=>blockReasons.set(identity(b),[...(blockReasons.get(identity(b))??[]),code]);
  const pairIds=v.blocks.flatMap(b=>b.pair?[b.pair.pair_id]:[]);
  if(new Set(pairIds).size!==pairIds.length)issues.push({code:'PAIR_ID_CONFLICT',path:'blocks.pair'});
  for(const b of v.blocks){
    const p=b.prepared,A=p.personalized,B=p.baseline;
    const shared=A.filter(a=>B.some(x=>x.id===a.id)).map(a=>a.id).sort();
    if(A.length!==B.length||new Set(A.map(a=>a.id)).size!==A.length||new Set(B.map(a=>a.id)).size!==B.length||canonicalJson(shared)!==canonicalJson([...p.sharedIds].sort())||p.sharedCandidateCount<new Set([...A,...B].map(x=>x.id)).size||p.range[0]>p.target||p.target>p.range[1]||[...A,...B].some(x=>x.rating<p.range[0]||x.rating>p.range[1]||x.tags.includes('interactive')||(p.themes.length&&!x.tags.some(t=>p.themes.includes(t)))))issues.push({code:'INVALID_PREPARATION',path:'blocks.prepared'});
    const catalog=new Map<string,string>(),ids=new Map<string,string>();for(const x of [...A,...B]){const k=problemKey(x),prior=catalog.get(k);if(prior&&prior!==canonicalJson(x))issues.push({code:'CONFLICTING_PROBLEM_METADATA',path:'blocks.prepared'});catalog.set(k,canonicalJson(x));const old=ids.get(x.id);if(old&&old!==canonicalJson(x))issues.push({code:'CONFLICTING_PROBLEM_ID',path:'blocks.prepared'});ids.set(x.id,canonicalJson(x));}
    if(b.masked_arms.X===b.masked_arms.Y||Date.parse(b.metadata_time)>Date.parse(b.frozen_at)||(b.unblinded_at!==null&&Date.parse(b.unblinded_at)<Date.parse(b.frozen_at)))issues.push({code:'INVALID_BLOCK_CONDITIONS',path:'blocks'});
    if(!b.provenance_verified)reason(b,'UNVERIFIED_PROVENANCE');
    if(!b.unblinded_at)reason(b,'NOT_UNBLINDED');
    if(!b.pair){reason(b,'NO_REGISTERED_PAIR');continue;}
    const a=A.find(x=>problemKey(x)===b.pair!.A),bb=B.find(x=>problemKey(x)===b.pair!.B);
    if(!a||!bb){issues.push({code:'PAIR_NOT_IN_FROZEN_LIST',path:'blocks.pair'});continue;}
    if(b.pair.A===b.pair.B)reason(b,'SHARED_PROBLEM');
    if(Math.abs(a.rating-bb.rating)>100)reason(b,'RATING_GAP');
    if(!a.tags.includes(b.pair.theme)||!bb.tags.includes(b.pair.theme)||(p.themes.length&&!p.themes.includes(b.pair.theme)))reason(b,'THEME_MISMATCH');
    for(const k of [b.pair.A,b.pair.B]){const id=p.participantId+'/'+k;blockProblems.set(id,[...(blockProblems.get(id)??[]),identity(b)]);}
  }
  for(const ids of blockProblems.values())if(new Set(ids).size>1)for(const id of ids)blockReasons.set(id,[...(blockReasons.get(id)??[]),'REPEATED_PROBLEM']);
  for(const b of v.blocks){const other=blocks.get(`${b.prepared.participantId}/${1-b.prepared.block}`);if(other&&other.prepared.order===b.prepared.order)reason(b,'ORDER_NOT_COUNTERBALANCED');}
  const eventGroups=new Map<string,Checked[]>();for(const r of checked)if(r.row)eventGroups.set(r.row.event_id,[...(eventGroups.get(r.row.event_id)??[]),r]);
  for(const rs of eventGroups.values())if(rs.length>1){const code=new Set(rs.map(r=>canonicalJson(r.row))).size===1?'DUPLICATE_EVENT':'CONFLICTING_EVENT';for(const r of rs)add(r,code);}
  const children=new Map<string,Checked[]>();
  for(const r of checked){
    if(!r.row)continue;const row=r.row,b=blocks.get(`${row.participant_id}/${row.block}`),reviewer=reviewerMap.get(row.reviewer);
    if(!b){add(r,'UNKNOWN_BLOCK');continue;}
    if(!reviewer){add(r,'UNKNOWN_REVIEWER');continue;}
    if(!reviewer.verified||reviewer.kind==='ai'||row.review_type!=='human')add(r,'NON_HUMAN_OR_UNVERIFIED_SOURCE','NON_COMPARABLE','reviewer');
    if(reviewer.kind==='participant'&&reviewer.participant_id!==row.participant_id)add(r,'REVIEWER_OWNER_MISMATCH');
    if(row.withdrawal&&reviewer.kind!=='participant')add(r,'WITHDRAWAL_REQUIRES_OWNER');
    const p=b.prepared;
    if(row.conditions_hash!==conditionsHash(b.conditions)||row.consent_id!==p.consentId||row.consent_version!==b.consent_version||row.order!==p.order||row.pool_hash!==p.sharedCandidateSha256||row.evidence_revision!==p.evidenceRevision||row.official_revision!==p.officialRevision||Date.parse(row.metadata_time)!==Date.parse(b.metadata_time)||row.scenario!==b.scenario||b.masked_arms[row.masked_arm]!==row.actual_arm)add(r,'CONTEXT_MISMATCH','NON_COMPARABLE');
    if(!p[row.actual_arm==='A'?'personalized':'baseline'].some(x=>problemKey(x)===row.problem_key))add(r,'UNKNOWN_STUDY_OBJECT');
    if(Date.parse(row.recorded_at)<Date.parse(b.frozen_at))add(r,'OBSERVATION_BEFORE_FREEZE','NON_COMPARABLE');
    if(b.pair&&row.problem_key!==b.pair[row.actual_arm])add(r,'NOT_SELECTED_FOR_TRAINING_PAIR','NON_COMPARABLE');
    if(row.pair_id!==b.pair?.pair_id && !(row.pair_id===null&&b.pair===null))add(r,'PAIR_REFERENCE_MISMATCH','NON_COMPARABLE');
    if(row.duration_minutes!==null&&row.duration_minutes>b.conditions.time_limit_minutes)add(r,'DURATION_POLICY_DEVIATION','NON_COMPARABLE');
    if(row.highest_hint_seen!==null&&row.highest_hint_seen>b.conditions.highest_allowed_hint)add(r,'HINT_POLICY_DEVIATION','NON_COMPARABLE');
    if(row.supersedes_event_id){
      const parents=eventGroups.get(row.supersedes_event_id);
      if(!parents?.length)add(r,'MISSING_SUPERSEDED_EVENT','INCOMPLETE','supersedes_event_id');
      else if(parents.length===1){const parent=parents[0]!.row!;if(slot(parent)!==slot(row)||parent.actual_arm!==row.actual_arm||parent.pair_id!==row.pair_id||parent.consent_id!==row.consent_id||parent.consent_version!==row.consent_version||Date.parse(parent.recorded_at)>=Date.parse(row.recorded_at))add(r,'INVALID_SUPERSESSION');}
      children.set(row.supersedes_event_id,[...(children.get(row.supersedes_event_id)??[]),r]);
    }
  }
  for(const rs of children.values())if(rs.length>1)for(const r of rs)add(r,'SUPERSESSION_BRANCH');
  // Multiple roots for the same reviewer/case cannot silently overwrite one another.
  const roots=new Map<string,Checked[]>();for(const r of checked)if(r.row&&!r.row.supersedes_event_id)roots.set(slot(r.row),[...(roots.get(slot(r.row))??[]),r]);
  for(const rs of roots.values())if(rs.length>1)for(const r of rs)add(r,'CONFLICTING_RESULT');
  const withdrawn=new Set(v.blocks.filter(b=>b.consent_status==='withdrawn').map(b=>b.prepared.participantId));
  for(const r of checked)if(r.row?.withdrawal&&reviewerMap.get(r.row.reviewer)?.kind==='participant'&&reviewerMap.get(r.row.reviewer)?.participant_id===r.row.participant_id)withdrawn.add(r.row.participant_id);
  const suppressed=issues.length>0||checked.some(r=>!r.row||r.status==='INVALID'||r.status==='INCOMPLETE');
  const latest=checked.filter(r=>r.row&&r.status==='VALID'&&!children.has(r.row.event_id));
  const pairResults=[...v.blocks].sort((a,b)=>compare(identity(a),identity(b))).map(b=>{
    const reasons=[...(blockReasons.get(identity(b))??[])];const pid=b.prepared.participantId;
    for(const r of checked)if(r.row?.participant_id===pid&&r.row.block===b.prepared.block&&r.row.problem_key===b.pair?.[r.row.actual_arm]&&reviewerMap.get(r.row.reviewer)?.kind==='participant'&&r.status!=='VALID')reasons.push(...r.issues.map(i=>i.code));
    if(suppressed)reasons.push('BATCH_VALIDATION_FAILED');if(withdrawn.has(pid))reasons.push('CONSENT_WITHDRAWN');
    const rows=latest.flatMap(r=>r.row?.participant_id===pid&&r.row.block===b.prepared.block&&r.row.pair_id===b.pair?.pair_id&&reviewerMap.get(r.row.reviewer)?.kind==='participant'?[r.row]:[]);
    const a=rows.filter(r=>r.actual_arm==='A'&&r.problem_key===b.pair?.A),bb=rows.filter(r=>r.actual_arm==='B'&&r.problem_key===b.pair?.B);
    if(a.length!==1||bb.length!==1)reasons.push(a.length>1||bb.length>1?'AMBIGUOUS_ARM':'MISSING_ARM');
    for(const row of [...a,...bb]){if(row.previously_seen===null||row.stopped===null)reasons.push('UNKNOWN_TRAINING_ELIGIBILITY');if(row.previously_seen)reasons.push('PREVIOUSLY_SEEN');if(row.stopped)reasons.push('STOPPED');if(row.protocol_deviation!==null)reasons.push('PROTOCOL_DEVIATION');if(row.missing_prerequisite===null)reasons.push('UNKNOWN_PREREQUISITE');if(row.missing_prerequisite)reasons.push('MISSING_PREREQUISITE');}
    return {ref:hash({study:v.study_id,case:identity(b)}),participantRef:hash({study:v.study_id,participant:pid}),block:b.prepared.block,order:b.prepared.order,scenarioRef:hash(b.scenario),reasons:[...new Set(reasons)].sort(),A:a[0],B:bb[0]};
  });
  capture?.({input:v,records:checked,latest,inputIssues:issues,cases:pairResults});
  const pairs=pairResults.filter(p=>p.reasons.length===0);
  const summaries=Object.entries(metrics).map(([name,value])=>{
    const available=pairs.filter(p=>value(p.A!)!==null&&value(p.B!)!==null),byParticipant=new Map<string,typeof available>();
    for(const p of available)byParticipant.set(p.participantRef,[...(byParticipant.get(p.participantRef)??[]),p]);
    const participants=[...byParticipant].sort(([a],[b])=>compare(a,b)).map(([ref,ps])=>{const a=ps.reduce((n,p)=>n+value(p.A!)!,0),b=ps.reduce((n,p)=>n+value(p.B!)!,0);return {ref,pairs:ps.length,A:{numerator:a,denominator:ps.length},B:{numerator:b,denominator:ps.length},difference:(a-b)/ps.length};});
    const differences=participants.map(p=>p.difference);
    return {metric:name,A:{numerator:available.reduce((n,p)=>n+value(p.A!)!,0),denominator:available.length},B:{numerator:available.reduce((n,p)=>n+value(p.B!)!,0),denominator:available.length},pairs:available.length,participants:participants.length,missingPairs:pairs.length-available.length,missingA:pairs.filter(p=>value(p.A!)===null).length,missingB:pairs.filter(p=>value(p.B!)===null).length,medianDifference:median(differences),range:differences.length?[Math.min(...differences),Math.max(...differences)]:null,byParticipant:participants};
  });
  const reasonCounts=new Map<string,number>();for(const p of pairResults)for(const code of p.reasons)reasonCounts.set(code,(reasonCounts.get(code)??0)+1);
  const exclusions=Object.fromEntries([...reasonCounts].sort(([a],[b])=>compare(a,b)));
  const status:ResultStatus=!checked.length?'INCOMPLETE':suppressed?checked.some(r=>r.status==='INVALID')||issues.length?'INVALID':'INCOMPLETE':summaries.some(s=>s.participants)?'VALID':pairs.length?'INCOMPLETE':'NON_COMPARABLE';
  return {version:'m34-results/1' as const,criteriaVersion,inputHash,status,dataSource:v.data_source,humanEvidence:v.data_source==='synthetic'?'SYNTHETIC_NOT_HUMAN_RESEARCH':'OPERATOR_DECLARED_NOT_INDEPENDENTLY_VERIFIED',inputIssues:issues.sort((a,b)=>compare(a.code,b.code)),
    counts:{raw:checked.length,valid:checked.filter(r=>r.status==='VALID').length,invalid:checked.filter(r=>r.status==='INVALID').length,incomplete:checked.filter(r=>r.status==='INCOMPLETE').length,nonComparable:checked.filter(r=>r.status==='NON_COMPARABLE').length,superseded:checked.filter(r=>r.row&&children.has(r.row.event_id)).length,latest:latest.length,teacherObservations:latest.filter(r=>reviewerMap.get(r.row!.reviewer)?.kind==='teacher').length,withdrawnParticipants:withdrawn.size,registeredBlocks:v.blocks.length,expectedBlocks:new Set(v.blocks.map(b=>b.prepared.participantId)).size*2,paired:pairs.length,unpaired:pairResults.length-pairs.length,excludedRecords:checked.length-latest.length,pairedObservations:pairs.length*2,notInPairedAnalysis:checked.length-pairs.length*2,sharedRecommendations:v.blocks.reduce((n,b)=>n+b.prepared.sharedIds.length,0)},
    records:checked.map(({ref,status,issues})=>({ref,status,issues:[...issues].sort((a,b)=>compare(a.code,b.code)||compare(a.path,b.path))})).sort((a,b)=>compare(a.ref,b.ref)),
    pairs:pairResults.map(({ref,participantRef,block,order,scenarioRef,reasons})=>({ref,participantRef,block,order,scenarioRef,status:reasons.length?'NON_COMPARABLE':'VALID',reasons})).sort((a,b)=>compare(a.ref,b.ref)),exclusions,metrics:summaries,
    boundary:'Participant is the paired unit. A is personalized ranking; B is Rating/Tags. Different blocks share a participant, not independent samples. No significance, predictive validity, causal teaching benefit, model-quality or real consent claim.'};
}

// The result DTO and old CLI stay unchanged. The private offline verifier also needs admission evidence.
export function evaluateStudy(raw:unknown){return analyseStudy(raw);}
export function inspectStudy(raw:unknown):{result:ReturnType<typeof evaluateStudy>;ledger:StudyLedger|null}{let ledger:StudyLedger|null=null;const result=analyseStudy(raw,value=>{ledger=value;});return {result,ledger};}

export function renderStudyReport(r:ReturnType<typeof evaluateStudy>){
  const lines=['# M3.4 离线研究结果校验与配对观察','',`版本：${r.version}；标准：${r.criteriaVersion}；状态：${r.status}。`,'',`输入指纹：${'inputHash' in r?r.inputHash:r.sourceHash}`,'','研究目标：A 个性化排序 vs B Rating/Tags共同候选基线。Tutor权限与复盘机会保持相同，不是独立AI效果实验。'];
  if(r.counts){lines.push('',`数据来源：${r.dataSource}；${r.humanEvidence}。声明不能证明真实同意或人工身份。`,'',`原始记录 ${r.counts.raw}，VALID ${r.counts.valid}，INVALID ${r.counts.invalid}，INCOMPLETE ${r.counts.incomplete}，NON_COMPARABLE ${r.counts.nonComparable}。`,`冻结block ${r.counts.registeredBlocks}/${r.counts.expectedBlocks}；有效题对 ${r.counts.paired}，未配对/排除 ${r.counts.unpaired}；修正历史 ${r.counts.superseded}；撤权选手 ${r.counts.withdrawnParticipants}。`,'','配对必须对应同一选手/block/预登记pair、兼容版本/证据/共同条件、不同且未见过的题、Rating差≤100、主题一致。缺组/重复/冲突不强配；INVALID或必要信息缺失整批停止比较。','','## 排除原因（可重叠）','');for(const [code,count] of Object.entries(r.exclusions??{}))lines.push(`- ${code}: ${count}`);lines.push('','## 按选手汇总 A−B','', '| 指标 | A命中/题对 | B命中/题对 | 可用题对 | 选手数 | 缺失题对 | 差值中位数 | 差值范围 |','| --- | --- | --- | --- | --- | --- | --- | --- |');for(const m of r.metrics)lines.push(`| ${m.metric} | ${m.A.denominator?m.A.numerator+'/'+m.A.denominator:'UNKNOWN'} | ${m.B.denominator?m.B.numerator+'/'+m.B.denominator:'UNKNOWN'} | ${m.pairs} | ${m.participants} | ${m.missingPairs} | ${m.medianDifference??'UNKNOWN'} | ${m.range?.join(' 至 ')??'UNKNOWN'} |`);}
  lines.push('','## 校验定位','');for(const i of r.inputIssues)lines.push(`- input: ${i.code} (${i.path})`);for(const row of r.records)for(const i of row.issues)lines.push(`- record-sha256:${row.ref}: ${i.code} (${i.path})`);
  lines.push('','## 口径与边界','','A−B为所述记录比例之差，不是综合质量分；高提示/偏简单/偏困难更高不表示更好。指标为二元记录比例：适合、目标匹配、L3+、偏简单、偏困难、理由有据。各指标只使用两组均非NULL的题对，先在选手内汇总，再列选手差中位数/范围；题目不是独立选手。缺失不填0，未观察官方OK不当失败，无完整题对/评分时UNKNOWN。','所有数字仅描述声明来源；教师意见不覆盖选手，AI评价不进入人工主分析。自报、官方和代码一致性分开，不复制自由文字/代码/原始响应或同意材料。','不输出显著性、置信区间或因果收益。高提示比例、满意度或理由可信度不等于教学效果。无真实研究数据时不得把合成统计计入真人结果。','B4、原生PostgreSQL20项、托管JWT/部署和真实选手试验均独立待验；本报告不提升其状态。','');
  return lines.join('\n');
}
async function run(){
  const [source,destination,...extra]=process.argv.slice(2);if(!source||!destination||extra.length||extname(source)!=='.json')throw Error('arguments');
  const info=await stat(source);if(!info.isFile()||info.size>5_000_000)throw Error('input_size');
  const result=evaluateStudy(JSON.parse(await readFile(source,'utf8')));
  await mkdir(destination,{mode:0o700}); // Exclusive directory: never overwrite a prior report or raw input.
  await writeFile(resolve(destination,'results.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(resolve(destination,'report.md'),renderStudyReport(result),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({operation:'m34_results',written:true,status:result.status}));process.exitCode=result.status==='VALID'?0:result.status==='INVALID'?3:2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(()=>{console.error(JSON.stringify({operation:'m34_results',written:false,error:'INPUT_OR_OUTPUT_ERROR'}));process.exitCode=4;});
