// Verification of the existing study tools, never an alternative recommendation or study policy.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {StudyLedger,evaluateStudy} from './m34-results';
type Result=ReturnType<typeof evaluateStudy>;
export type ReplayTools={prepareStudy:(raw:unknown)=>unknown;inspectStudy:(raw:unknown)=>{result:Result;ledger:StudyLedger|null};renderStudyReport:(result:Result)=>string};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function stableJson(v:unknown):string{if(Array.isArray(v))return '['+v.map(stableJson).join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>compare(a,b)).map(([k,x])=>JSON.stringify(k)+':'+stableJson(x)).join(',')+'}';return JSON.stringify(v)??'null';}
export const semanticDigest=(v:unknown)=>createHash('sha256').update(stableJson(v)).digest('hex');
export const byteDigest=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
export const freezeSchema=z.object({version:z.literal('m34-freeze/1'),rules:z.object({preparation:z.literal('study-preparation/1'),results:z.literal('m34-results/1'),criteria:z.literal('m34-observation/1')}).strict(),preparations:z.array(z.object({case_id:z.string().regex(/^P[0-9]{3,6}\/[01]$/),input:z.unknown()}).strict()).max(1000),frozen:z.unknown()}).strict();
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const ordered=(v:unknown)=>Array.isArray(v)?[...v].sort((a,b)=>compare(stableJson(a),stableJson(b))):v;
export function resultSemantics(v:unknown){const r=obj(v);return {...r,blocks:ordered(r.blocks),reviewers:ordered(r.reviewers),observations:ordered(r.observations)};}
export function freezeSemantics(v:unknown){const r=obj(v);return {...r,frozen:resultSemantics(r.frozen),preparations:ordered(Array.isArray(r.preparations)?r.preparations.map(x=>{const c=obj(x),i=obj(c.input);return {...c,input:{...i,eligiblePool:ordered(i.eligiblePool)}};}):r.preparations)};}
type Difference={code:string;path:string;ref:string;beforeHash?:string;afterHash?:string};
function differences(a:unknown,b:unknown,path:string,ref:string):Difference[]{
 if(stableJson(a)===stableJson(b)&&typeof a===typeof b)return [];
 const base={code:b===undefined?'MISSING_FIELD':a===undefined?'UNEXPECTED_FIELD':'CONTENT_CHANGED',path,ref,beforeHash:semanticDigest({present:a!==undefined,value:a??null}),afterHash:semanticDigest({present:b!==undefined,value:b??null})};
 if(Array.isArray(a)&&Array.isArray(b)){if(a.length!==b.length)return [base];return a.flatMap((x,i)=>differences(x,b[i],path+'.'+i,ref));}
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
  const aa=obj(a),bb=obj(b);return [...new Set([...Object.keys(aa),...Object.keys(bb)])].sort(compare).flatMap(k=>differences(aa[k],bb[k],path+'.'+(Object.hasOwn(aa,k)?k:'$extra'),ref));
 }
 return [base];
}
const missingSchema=(e:z.ZodError,raw:unknown)=>e.issues.every(i=>{let v=raw;for(const k of i.path)v=obj(v)[String(k)];return (i.code==='invalid_type'||i.code==='invalid_value')&&(v===undefined||v===null);});
const reference=(v:unknown)=>semanticDigest(v);

// Independent arithmetic: integer counts, rational differences/medians; no producer metric or median helper.
type Fraction={n:bigint;d:bigint};
const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a<0n?-a:a;
const fraction=(n:bigint,d:bigint):Fraction=>{const g=gcd(n,d);return {n:n/g,d:d/g};};
const numeric=(f:Fraction)=>Number(f.n)/Number(f.d);
const exact=(f:Fraction)=>({numerator:f.n.toString(),denominator:f.d.toString()});
export function rationalMedian(values:{numerator:number;denominator:number}[]){
 const list=values.map(x=>fraction(BigInt(x.numerator),BigInt(x.denominator))).sort((a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0);
 if(!list.length)return null;const m=Math.floor(list.length/2),right=list[m]!;
 return exact(list.length%2?right:fraction(list[m-1]!.n*right.d+right.n*list[m-1]!.d,2n*list[m-1]!.d*right.d));
}
export function independentRecount(ledger:StudyLedger){
 const {input:v,records}=ledger,rows=records.flatMap(x=>x.row?[x.row]:[]),reviewers=v.reviewers;
 const revoked=new Set(v.blocks.filter(b=>b.consent_status==='withdrawn').map(b=>b.prepared.participantId));
 for(const r of rows)if(r.withdrawal&&reviewers.some(x=>x.id===r.reviewer&&x.kind==='participant'&&x.participant_id===r.participant_id))revoked.add(r.participant_id);
 const edges=rows.filter(r=>r.supersedes_event_id&&v.blocks.some(b=>b.prepared.participantId===r.participant_id&&b.prepared.block===r.block)&&reviewers.some(x=>x.id===r.reviewer));
 const latest=records.filter(r=>r.row&&r.status==='VALID'&&!edges.some(x=>x.supersedes_event_id===r.row!.event_id));
 const blocked=ledger.inputIssues.length>0||records.some(r=>!r.row||r.status==='INVALID'||r.status==='INCOMPLETE');
 const selected=v.blocks.map(b=>{
  const p=b.prepared,pair=b.pair;
  const candidates=latest.flatMap(r=>r.row?.participant_id===p.participantId&&r.row.block===p.block&&r.row.pair_id===pair?.pair_id&&reviewers.some(x=>x.id===r.row!.reviewer&&x.kind==='participant')?[r.row]:[]);
  const A=candidates.filter(r=>r.actual_arm==='A'&&r.problem_key===pair?.A),B=candidates.filter(r=>r.actual_arm==='B'&&r.problem_key===pair?.B);
  const aa=p.personalized.find(x=>`${x.contestId}/${x.index}`===pair?.A),bb=p.baseline.find(x=>`${x.contestId}/${x.index}`===pair?.B);
  const reused=pair&&v.blocks.some(other=>other!==b&&other.prepared.participantId===p.participantId&&other.pair&&[pair.A,pair.B].some(k=>[other.pair!.A,other.pair!.B].includes(k)));
  const primaryBad=records.some(r=>r.row?.participant_id===p.participantId&&r.row.block===p.block&&r.row.problem_key===pair?.[r.row.actual_arm]&&reviewers.some(x=>x.id===r.row!.reviewer&&x.kind==='participant')&&r.status!=='VALID');
  let eligible=!blocked&&!revoked.has(p.participantId)&&!primaryBad&&b.provenance_verified&&b.unblinded_at!==null&&pair!==null&&pair.A!==pair.B&&A.length===1&&B.length===1&&!!aa&&!!bb&&Math.abs(aa.rating-bb.rating)<=100&&aa.tags.includes(pair.theme)&&bb.tags.includes(pair.theme)&&(!p.themes.length||p.themes.includes(pair.theme))&&!reused&&!v.blocks.some(o=>o.prepared.participantId===p.participantId&&o.prepared.block!==p.block&&o.prepared.order===p.order);
  for(const r of [...A,...B]){
   const owner=reviewers.find(x=>x.id===r.reviewer);
   eligible=eligible&&owner?.kind==='participant'&&owner.verified&&owner.participant_id===r.participant_id&&r.review_type==='human'&&r.previously_seen===false&&r.stopped===false&&r.missing_prerequisite===false&&r.protocol_deviation===null&&r.conditions_hash===semanticDigest(b.conditions)&&r.consent_id===p.consentId&&r.consent_version===b.consent_version&&r.order===p.order&&b.masked_arms[r.masked_arm]===r.actual_arm&&r.pool_hash===p.sharedCandidateSha256&&r.evidence_revision===p.evidenceRevision&&r.official_revision===p.officialRevision&&r.scenario===b.scenario&&Date.parse(r.metadata_time)===Date.parse(b.metadata_time)&&Date.parse(r.recorded_at)>=Date.parse(b.frozen_at)&&(r.duration_minutes===null||r.duration_minutes<=b.conditions.time_limit_minutes)&&(r.highest_hint_seen===null||r.highest_hint_seen<=b.conditions.highest_allowed_hint);
  }
  return {ref:reference({study:v.study_id,case:p.participantId+'/'+p.block}),participantRef:reference({study:v.study_id,participant:p.participantId}),eligible:Boolean(eligible),A:A[0],B:B[0]};
 });
 const admitted=selected.filter(x=>x.eligible);
 const definitions=['suitability','goalMatch','highHint','tooEasy','tooHard','reasonSupported'];
 const value=(r:NonNullable<typeof selected[number]['A']>,name:string):number|null=>{
  switch(name){case 'suitability':return r.suitability===null?null:r.suitability==='适合'?1:0;case 'goalMatch':return r.goal_match===null?null:r.goal_match?1:0;case 'highHint':return r.highest_hint_seen===null?null:r.highest_hint_seen>=3?1:0;case 'tooEasy':return r.difficulty===null?null:r.difficulty==='偏简单'?1:0;case 'tooHard':return r.difficulty===null?null:r.difficulty==='偏困难'?1:0;default:return r.reason_supported===null?null:r.reason_supported?1:0;}
 };
 const exactFractions:Record<string,unknown>={};
 const metrics=definitions.map(metric=>{
  const available=admitted.filter(p=>value(p.A!,metric)!==null&&value(p.B!,metric)!==null),ids=[...new Set(available.map(p=>p.participantRef))].sort(compare);
  const byParticipant=ids.map(ref=>{const ps=available.filter(p=>p.participantRef===ref),a=ps.map(p=>value(p.A!,metric)!).reduce((x,y)=>x+y,0),b=ps.map(p=>value(p.B!,metric)!).reduce((x,y)=>x+y,0);return {ref,pairs:ps.length,A:{numerator:a,denominator:ps.length},B:{numerator:b,denominator:ps.length},difference:numeric(fraction(BigInt(a-b),BigInt(ps.length)))};});
  const ratios=byParticipant.map(p=>({numerator:p.A.numerator-p.B.numerator,denominator:p.pairs})),m=rationalMedian(ratios);
  exactFractions[metric]={median:m,participants:byParticipant.map((p,i)=>({ref:p.ref,...exact(fraction(BigInt(ratios[i]!.numerator),BigInt(ratios[i]!.denominator)))}))};
  const ds=byParticipant.map(p=>p.difference);
  return {metric,A:{numerator:available.filter(p=>value(p.A!,metric)===1).length,denominator:available.length},B:{numerator:available.filter(p=>value(p.B!,metric)===1).length,denominator:available.length},pairs:available.length,participants:ids.length,missingPairs:admitted.length-available.length,missingA:admitted.filter(p=>value(p.A!,metric)===null).length,missingB:admitted.filter(p=>value(p.B!,metric)===null).length,medianDifference:m?Number(m.numerator)/Number(m.denominator):null,range:ds.length?[Math.min(...ds),Math.max(...ds)]:null,byParticipant};
 });
 const counts={raw:records.length,valid:records.filter(r=>r.status==='VALID').length,invalid:records.filter(r=>r.status==='INVALID').length,incomplete:records.filter(r=>r.status==='INCOMPLETE').length,nonComparable:records.filter(r=>r.status==='NON_COMPARABLE').length,superseded:records.filter(r=>r.row&&edges.some(x=>x.supersedes_event_id===r.row!.event_id)).length,latest:latest.length,teacherObservations:latest.filter(r=>reviewers.some(x=>x.id===r.row!.reviewer&&x.kind==='teacher')).length,withdrawnParticipants:revoked.size,registeredBlocks:v.blocks.length,expectedBlocks:new Set(v.blocks.map(b=>b.prepared.participantId)).size*2,paired:admitted.length,unpaired:v.blocks.length-admitted.length,excludedRecords:records.length-latest.length,pairedObservations:admitted.length*2,notInPairedAnalysis:records.length-admitted.length*2,sharedRecommendations:v.blocks.map(b=>b.prepared.sharedIds.length).reduce((x,y)=>x+y,0)};
 const exclusions:Record<string,number>={};for(const c of ledger.cases)for(const r of c.reasons)exclusions[r]=(exclusions[r]??0)+1;
 const recordStates=records.map(r=>({ref:r.ref,validation:r.status,correction:Boolean(r.row?.supersedes_event_id),latestValid:latest.some(x=>x.ref===r.ref),withdrawn:Boolean(r.row&&revoked.has(r.row.participant_id)),statistical:Boolean(r.row&&admitted.some(p=>p.A?.event_id===r.row!.event_id||p.B?.event_id===r.row!.event_id))})).sort((a,b)=>compare(a.ref,b.ref));
 return {counts,metrics,exclusions,exactFractions,recordStates,selection:selected.map(({ref,eligible})=>({ref,eligible})).sort((a,b)=>compare(a.ref,b.ref))};
}
function numericDifferences(a:unknown,b:unknown,path='$'):string[]{
 if(stableJson(a)===stableJson(b))return [];
 if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length)return a.flatMap((x,i)=>numericDifferences(x,b[i],path+'.'+i));
 if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(obj(a)),...Object.keys(obj(b))])].flatMap(k=>numericDifferences(obj(a)[k],obj(b)[k],path+'.'+(Object.hasOwn(obj(a),k)?k:'$extra')));
 return [path];
}

export function verifyReplay(freezeRaw:unknown,currentRaw:unknown,artifact:unknown,markdown:string,tools:ReplayTools){
 const diffs:Difference[]=[],f=freezeSchema.safeParse(freezeRaw),current=tools.inspectStudy(currentRaw);
 let recount:ReturnType<typeof independentRecount>|null=null;
 let lineage:{original:number;appended:number;records:(ReturnType<typeof independentRecount>['recordStates'][number]&{frozenOriginal:boolean;appended:boolean})[]}|null=null;
 const checks:{freeze:'PASS'|'FAIL';independent:'PASS'|'FAIL'|'NOT_RUN';json:'PASS'|'FAIL'|'NOT_RUN';markdown:'PASS'|'FAIL'|'NOT_RUN'}={freeze:'FAIL',independent:'NOT_RUN',json:'NOT_RUN',markdown:'NOT_RUN'};
 if(!f.success){diffs.push({code:missingSchema(f.error,freezeRaw)?'FREEZE_INCOMPLETE':'FREEZE_INVALID',path:'freeze',ref:reference(freezeRaw)});}
 else {
  const frozen=tools.inspectStudy(f.data.frozen),ref=reference(f.data.frozen);
  if(!frozen.ledger||frozen.ledger.inputIssues.length||frozen.ledger.records.some(r=>r.status==='INVALID'||r.status==='INCOMPLETE'))diffs.push({code:'FROZEN_INPUT_INVALID',path:'freeze.frozen',ref});
  else if(!current.ledger)diffs.push({code:'CURRENT_INPUT_INVALID',path:'current',ref:reference(currentRaw)});
  else {
   const original=frozen.ledger.input,next=current.ledger.input;
   for(const k of ['version','criteria_version','study_id','data_source','reviewers'] as const)diffs.push(...differences(k==='reviewers'?ordered(original[k]):original[k],k==='reviewers'?ordered(next[k]):next[k],'current.'+k,ref));
   const entries=f.data.preparations,caseIds=entries.map(p=>p.case_id),ids=original.blocks.map(b=>b.prepared.participantId+'/'+b.prepared.block);
   if(new Set(caseIds).size!==caseIds.length)diffs.push({code:'DUPLICATE_PREPARATION_CASE',path:'preparations',ref});
   for(const b of original.blocks){const id=b.prepared.participantId+'/'+b.prepared.block,c=entries.filter(e=>e.case_id===id),caseRef=reference({study:original.study_id,case:id});
    if(c.length!==1){diffs.push({code:'MISSING_PREPARATION_CASE',path:'preparations',ref:caseRef});continue;}
    try{const prepared=tools.prepareStudy(c[0]!.input);diffs.push(...differences(prepared,b.prepared,'frozen.prepared',caseRef));}catch{diffs.push({code:'PREPARATION_INPUT_INVALID',path:'preparations.input',ref:caseRef});}
   }
   for(const e of entries)if(!ids.includes(e.case_id))diffs.push({code:'UNKNOWN_PREPARATION_CASE',path:'preparations',ref:reference(e.case_id)});
   for(const b of original.blocks){const id=b.prepared.participantId+'/'+b.prepared.block,caseRef=reference({study:original.study_id,case:id}),cs=next.blocks.filter(x=>x.prepared.participantId+'/'+x.prepared.block===id);
    if(cs.length!==1){diffs.push({code:cs.length?'DUPLICATE_CURRENT_CASE':'MISSING_CURRENT_CASE',path:'current.blocks',ref:caseRef});continue;}
    const n=cs[0]!;
    // Only lifecycle transitions already allowed by M3.4 can change after freezing.
    const consent=b.consent_status==='active'&&n.consent_status==='withdrawn'?n.consent_status:b.consent_status;
    const unblinded=b.unblinded_at===null&&n.unblinded_at!==null&&Date.parse(n.unblinded_at)>=Date.parse(b.frozen_at)?n.unblinded_at:b.unblinded_at;
    diffs.push(...differences({...b,consent_status:consent,unblinded_at:unblinded},n,'current.blocks',caseRef));
   }
   for(const b of next.blocks)if(!ids.includes(b.prepared.participantId+'/'+b.prepared.block))diffs.push({code:'UNKNOWN_CURRENT_CASE',path:'current.blocks',ref:reference(b.prepared)});
   for(const record of frozen.ledger.records){const row=record.row!;const matches=current.ledger.records.filter(r=>r.row?.event_id===row.event_id);
    if(matches.length!==1)diffs.push({code:matches.length?'DUPLICATE_ORIGINAL_EVENT':'MISSING_ORIGINAL_EVENT',path:'current.observations',ref:record.ref});
    else diffs.push(...differences(row,matches[0]!.row,'current.observations',record.ref));
   }
   if(!diffs.length){checks.freeze='PASS';recount=independentRecount(current.ledger);
    const originalRefs=new Set(frozen.ledger.records.map(r=>r.ref));const records=recount.recordStates.map(r=>({...r,frozenOriginal:originalRefs.has(r.ref),appended:!originalRefs.has(r.ref)}));lineage={original:records.filter(r=>r.frozenOriginal).length,appended:records.filter(r=>r.appended).length,records};
    const expectedSelection=current.ledger.cases.map(c=>({ref:c.ref,eligible:c.reasons.length===0})).sort((a,b)=>compare(a.ref,b.ref));
    const paths=[...numericDifferences(recount.counts,current.result.counts,'counts'),...numericDifferences(recount.metrics,current.result.metrics,'metrics'),...numericDifferences(recount.exclusions,'exclusions' in current.result?current.result.exclusions:{},'exclusions'),...numericDifferences(recount.selection,expectedSelection,'selection')];
    if(current.result.version!==f.data.rules.results||current.result.criteriaVersion!==f.data.rules.criteria)paths.push('rules');
    if(!('inputHash' in current.result)||current.result.inputHash!==semanticDigest(resultSemantics(currentRaw)))paths.push('inputHash');
    checks.independent=paths.length?'FAIL':'PASS';for(const path of paths)diffs.push({code:'INDEPENDENT_RECOUNT_MISMATCH',path,ref:reference(currentRaw)});
    const jsonDiffs=differences(current.result,artifact,'artifact.json',reference(artifact));checks.json=jsonDiffs.length?'FAIL':'PASS';diffs.push(...jsonDiffs.map(d=>({...d,code:'RESULT_JSON_MISMATCH'})));
    const expectedMarkdown=tools.renderStudyReport(current.result);checks.markdown=markdown===expectedMarkdown?'PASS':'FAIL';if(checks.markdown==='FAIL')diffs.push({code:'RESULT_MARKDOWN_MISMATCH',path:'artifact.markdown',ref:byteDigest(markdown),beforeHash:byteDigest(expectedMarkdown),afterHash:byteDigest(markdown)});
   }
  }
 }
 const incomplete=diffs.length&&diffs.every(d=>/MISSING_|INCOMPLETE/.test(d.code));
 return {version:'m34-replay/1',rules:{preparation:'study-preparation/1',results:'m34-results/1',criteria:'m34-observation/1',arithmetic:'integer-rational/1'},freezeHash:semanticDigest(freezeSemantics(freezeRaw)),currentHash:semanticDigest(resultSemantics(currentRaw)),dataSource:current.ledger?.input.data_source??'UNKNOWN',integrity:diffs.length?'FAIL':'PASS',status:diffs.length?incomplete?'INCOMPLETE':'INVALID':current.result.status,dataStatus:current.result.status,checks,differenceCount:diffs.length,differences:diffs.sort((a,b)=>compare(a.ref,b.ref)||compare(a.path,b.path)||compare(a.code,b.code)).slice(0,200),differencesTruncated:diffs.length>200,independent:recount,lineage,boundary:'Synthetic/declaration-only verification. Admission schemas/diagnostics shared; case eligibility, counting and rational arithmetic independently rechecked. Neither hashes nor offline replay authenticate consent, actual freeze time or teaching benefit.'};
}
export function renderReplay(r:ReturnType<typeof verifyReplay>){return ['# M3.4 冻结输入与结果复算','',`版本 ${r.version}；状态 ${r.status}；一致性 ${r.integrity}；数据状态 ${r.dataStatus}。`,`来源 ${r.dataSource}（synthetic只作合成验证；declared_human仍未经独立证实）。`,`冻结语义摘要 ${r.freezeHash}`,`当前语义摘要 ${r.currentHash}`,'','## 一致性检查','',...Object.entries(r.checks).map(([k,v])=>`- ${k}: ${v}`),'',`差异 ${r.differenceCount}；仅列最多200项。`,...r.differences.map(d=>`- ${d.code} · ${d.path} · sha256:${d.ref}`),'','## 独立复算','',r.lineage?`冻结原记录 ${r.lineage.original}；追加 ${r.lineage.appended}（追加/修正/当前有效/撤权/统计状态按SHA逐记录列于JSON，不混为同一数量）。`:'原记录与追加归类 UNKNOWN。',r.independent?`原始 ${r.independent.counts.raw}；当前有效 ${r.independent.counts.latest}；撤权 ${r.independent.counts.withdrawnParticipants}；题对 ${r.independent.counts.paired}；未配对 ${r.independent.counts.unpaired}。`:'UNKNOWN（冻结或输入未通过，不复算统计）。',...(r.independent?.metrics??[]).map(m=>`${m.metric}：题对 ${m.pairs}，选手 ${m.participants}，缺失题对 ${m.missingPairs}，A/B缺失 ${m.missingA}/${m.missingB}；选手差中位数 ${m.medianDifference??'UNKNOWN'}。`),'','原始字节摘要独立保存在sources.json，不参与样本或统计。仅JSON空白/键顺序、已声明集合顺序可语义等价；时间、版本、条件、排名与NULL不删除。','计数/分母精确整数；差值和中位数独立采用BigInt有理数。旧版JSON保持原binary64输出；既定每人两个block的差值/中位数可精确二进制表示，全部严格相等核对，不加容差；报告文件须与原生成器逐值/逐字节一致。','不会修改输入/冻结/原报告；哈希不是签名或授权，不能证明实际真人、盲化或研究效果。原生20项、B4、托管及真实教学效果保持未验。',''].join('\n');}

// Reject ambiguous JSON rather than accepting last-key-wins or silent integer overflow.
export function parseReplayJson(text:string):unknown{
 const parsed:unknown=JSON.parse(text);let at=0;
 const space=()=>{while(/\s/.test(text[at]??'')&&at<text.length)at++;};
 const string=()=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')break;}return JSON.parse(text.slice(start,at)) as string;};
 const value=(depth:number)=>{if(depth>256)throw Error('json_depth');space();const c=text[at];
  if(c==='{'){at++;space();const keys=new Set<string>();while(text[at]!=='}'){const key=string();if(keys.has(key))throw Error('duplicate_json_key');keys.add(key);space();at++;value(depth+1);space();if(text[at]!==',')break;at++;space();}at++;}
  else if(c==='['){at++;space();while(text[at]!==']'){value(depth+1);space();if(text[at]!==',')break;at++;space();}at++;}
  else if(c==='"')string();else{const start=at;while(at<text.length&&!/[\s,\]}]/.test(text[at]!))at++;const item:unknown=JSON.parse(text.slice(start,at));if(typeof item==='number'&&(!Number.isFinite(item)||(Number.isInteger(item)&&!Number.isSafeInteger(item))))throw Error('unsafe_json_number');}
 };
 value(0);space();if(at!==text.length)throw Error('json_tail');return parsed;
}
