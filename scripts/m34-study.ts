// Offline study preparation only. No network, model calls, Auth, SQL writes or code input.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const problem=z.object({id:z.uuid(),contestId:z.number().int().positive(),index:z.string().regex(/^[A-Z0-9]{1,12}$/),rating:z.number().int().min(800).max(3500),tags:z.array(z.string())}).strict();
const input=z.object({participantId:z.string().regex(/^P[0-9]{3,6}$/),consentId:z.string().min(1).max(80),consented:z.literal(true),
 seed:z.string().min(1).max(80),enrollmentIndex:z.number().int().nonnegative(),block:z.number().int().nonnegative(),
 engineVersion:z.literal('deterministic/1.3-official'),policyVersion:z.literal('training-fit/1'),
 evidenceRevision:z.number().int().nonnegative(),officialRevision:z.number().int().nonnegative(),
 min:z.number().int().min(800),max:z.number().int().max(3500),target:z.number().int(),themes:z.array(z.string()).max(5),goal:z.enum(['balanced','independence','explore']),
 eligiblePool:z.array(problem).min(1),personalizedIds:z.array(z.uuid()).min(1).max(5),
 // Full-history eligibility must be attested by the authorized RPC snapshot, never a 500-item portrait.
 eligibilitySource:z.literal('authorized_current_learning_candidates_snapshot'),
}).strict().refine(v=>v.min<=v.target&&v.target<=v.max);
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function allocation(enrollmentIndex:number,block:number,seed:string){
 const first=parseInt(digest(`${seed}:block:${Math.floor(enrollmentIndex/2)}`).slice(0,2),16)%2;
 return (first+enrollmentIndex%2+block%2)%2===0?'AB':'BA';
}
export function prepareStudy(raw:unknown){
 const v=input.parse(raw),ids=new Set(v.eligiblePool.map(p=>p.id)),keys=new Set(v.eligiblePool.map(p=>`${p.contestId}/${p.index}`));
 if(ids.size!==v.eligiblePool.length||keys.size!==v.eligiblePool.length||new Set(v.personalizedIds).size!==v.personalizedIds.length||v.personalizedIds.some(id=>!ids.has(id)))throw new Error('Duplicate or mismatched candidate snapshot');
 if(v.eligiblePool.some(p=>p.rating<v.min||p.rating>v.max||p.tags.includes('interactive')||(v.themes.length&&!p.tags.some(t=>v.themes.includes(t)))))throw new Error('Inconsistent shared eligibility');
 const canonical=[...v.eligiblePool].sort((a,b)=>a.id.localeCompare(b.id));
 const baseline=[...canonical].sort((a,b)=>Math.abs(a.rating-v.target)-Math.abs(b.rating-v.target)||digest(`${v.seed}:${a.contestId}/${a.index}`).localeCompare(digest(`${v.seed}:${b.contestId}/${b.index}`))||a.id.localeCompare(b.id)).slice(0,v.personalizedIds.length);
 const personalized=v.personalizedIds.map(id=>canonical.find(p=>p.id===id)!);
 return {version:'study-preparation/1',participantId:v.participantId,consentId:v.consentId,engineVersion:v.engineVersion,
  order:allocation(v.enrollmentIndex,v.block,v.seed),block:v.block,range:[v.min,v.max],target:v.target,themes:v.themes,goal:v.goal,
  sharedCandidateCount:canonical.length,sharedCandidateSha256:digest(JSON.stringify(canonical)),evidenceRevision:v.evidenceRevision,officialRevision:v.officialRevision,
  eligibilitySource:v.eligibilitySource,personalized,baseline,sharedIds:personalized.filter(p=>baseline.some(b=>b.id===p.id)).map(p=>p.id),
  boundary:'Participant consent declaration and RPC provenance require operator verification. Same pool/target/count; no teaching outcome measured. Shared items cannot be trained twice as independent A/B outcomes.'};
}
async function run(){
 const [source,out]=process.argv.slice(2);if(!source||!out)throw new Error('Usage: node scripts/m34-study.ts private-input.json private-output.json');
 const result=prepareStudy(JSON.parse(await readFile(source,'utf8')));await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({operation:'study_preparation',written:true})); // No participant history or consent details in logs.
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await run();}catch{console.error(JSON.stringify({operation:'study_preparation',written:false,error:'invalid_input_or_io'}));process.exitCode=1;}
}
