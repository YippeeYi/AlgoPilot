// Copied ONLY into an ephemeral R2C app. No source-tree route imports this driver.
// Identity is genuine local Auth getUser(); all business calls use that user's JWT.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { requireContext } from '@/server/auth';
import { handle, json, readJson } from '@/server/http';
import { tutorRepository } from '@/server/tutor/repository';
import { reviewRepository } from '@/server/review/repository';
import { cfRepository } from '@/server/codeforces/repository';
import { synchronize } from '@/server/codeforces/catalog';
import { learningRepository } from '@/server/learning/repository';
import { trainingFeedbackRepository } from '@/server/learning/training-feedback';
import { cfAccountRepository } from '@/server/codeforces/account-repository';
import { mutateCfAccount } from '@/server/codeforces/account-service';
import { trainingRepository } from '@/server/db/training';

const inputSchema = z.object({ action: z.enum(['identity','cf','cf-bind','cf-enable','record','reserve-tutor','reserve-review','finish','evidence-wait','cas-wait','release']),
  id: z.uuid().optional(), requestId: z.uuid().optional(), question: z.string().max(100).default(''),
  barrier: z.uuid().optional(), success: z.boolean().default(false) }).strict();
const receipts = new Map<string, { kind: 'tutor'|'review'; payload: Record<string, unknown> }>();
const syntheticAnalysis = { summary:'[SYNTHETIC] transport receipt, no model', correctness:'Not executed or verified', assumptions:'Synthetic only',
  timeComplexity:'Not assessed',spaceComplexity:'Not assessed',lineAnalysis:[{start:1,end:1,analysis:'Synthetic fixture'}],risks:'No quality evidence',
  improvements:'No model used',alternatives:'',transferableKnowledge:'Synthetic only',revisionQuestions:['Fixture only?'],answer:'' };
export async function POST(request: Request) { return handle(async () => {
  const {client,user}=await requireContext();
  if(!user.email?.endsWith('@r2c.invalid')) throw Error('r2c_synthetic_identity_required');
  const input=await readJson(request,inputSchema);
  const tutor=tutorRepository(client,user.id),review=reviewRepository(client,user.id);
  const secret=process.env.TUTOR_RPC_SIGNING_SECRET!;
  const directory=process.env.R2C_DRIVER_DIRECTORY;
  if(!directory?.startsWith('/private/tmp/algopilot-r2c-'))throw Error('r2c_private_driver_required');
  if(input.action==='identity') return json({userId:user.id,pid:process.pid});
  if(input.action==='record') {
    const evidence=await learningRepository(client).evidence();
    return json(await trainingFeedbackRepository(client,user.id).record({runId:input.requestId,revision:evidence.revision,officialRevision:evidence.official?.revision??0,
      repeat:false,focus:null,baseline:null,problemIds:[input.id]}));
  }
  if(input.action==='cf-bind'||input.action==='cf-enable') {
    const repo=cfAccountRepository(client,user.id),state=await repo.state();
    const runtime={fetcher:async()=>{
      await writeFile(join(directory,`cf-${process.pid}-${process.hrtime.bigint()}.json`),JSON.stringify({pid:process.pid,at:Date.now(),monotonic:process.hrtime.bigint().toString()}),{mode:0o600,flag:'wx'});
      return Response.json({status:'OK',result:[{handle:'R2CSynthetic',registrationTimeSeconds:1600000000}]});
    }};
    let result=await mutateCfAccount(repo,{action:'bind',handle:'R2CSynthetic',revision:state.revision,requestId:input.requestId!},runtime);
    if(input.action==='cf-enable')result=await mutateCfAccount(repo,{action:'consent',enabled:true,revision:result.state.revision,requestId:randomUUID()},runtime);
    return json({bound:result.state.handle==='R2CSynthetic',enabled:result.state.enabled,revision:result.state.revision,pid:process.pid});
  }
  if(input.action==='cf') {
    const result=await synchronize(cfRepository(client,user.id),true,async()=>{
      await writeFile(join(directory,`cf-${process.pid}-${process.hrtime.bigint()}.json`),JSON.stringify({pid:process.pid,at:Date.now(),monotonic:process.hrtime.bigint().toString()}),{mode:0o600,flag:'wx'});
      return Response.json({status:'OK',result:{problems:Array.from({length:12},(_,i)=>({contestId:990001+i,index:'A',name:'[SYNTHETIC] R2C '+i,type:'PROGRAMMING',rating:1200+i*100,tags:['implementation']})),problemStatistics:[]}});
    });return json({result,pid:process.pid});
  }
  if(input.action==='release') {await mkdir(join(directory,input.barrier!),{mode:0o700,recursive:true});await writeFile(join(directory,input.barrier!,'release'),'1',{mode:0o600});return json({released:true,pid:process.pid});}
  if(input.action==='cas-wait') {
    await tutor.getSession(input.id!);
    const path=join(directory,input.barrier!);await mkdir(path,{mode:0o700,recursive:true});
    await writeFile(join(path,`ready-${process.pid}`),'1',{mode:0o600});
    const deadline=Date.now()+15000;
    for(;;){try{await readFile(join(path,'release'));break;}catch{if(Date.now()>deadline)throw Error('r2c_barrier_timeout');await new Promise(r=>setTimeout(r,20));}}
    const session=await trainingRepository(client,user.id).draft(input.id!,'thought',{content:input.question,expectedRevision:0});
    return json({session,pid:process.pid});
  }
  if(input.action==='evidence-wait') {
    const repo=learningRepository(client),evidence=await repo.evidence();
    const path=join(directory,input.barrier!);await mkdir(path,{mode:0o700,recursive:true});
    await writeFile(join(path,'ready'),'1',{mode:0o600});
    const deadline=Date.now()+15000;
    for(;;){try{await readFile(join(path,'release'));break;}catch{if(Date.now()>deadline)throw Error('r2c_barrier_timeout');await new Promise(r=>setTimeout(r,20));}}
    await repo.assertRevision(evidence.revision,evidence.official?.revision??0);
    return json({accepted:true,pid:process.pid});
  }
  if(!input.requestId)throw Error('r2c_request_required');
  const key=user.id+':'+input.requestId;
  if(input.action==='finish') {
    const receipt=receipts.get(key);if(!receipt)throw Error('r2c_server_receipt_missing');
    const payload={...receipt.payload,success:input.success,usage:[],analysis:syntheticAnalysis,model:'synthetic-no-provider',
      promptVersion:'r2c-synthetic/1',content:'[SYNTHETIC] no model',userMessage:'synthetic',disclosureLevel:0,thoughtRevision:0,codeRevision:0};
    const result=receipt.kind==='review'?await review.finish(payload,secret):await tutor.finish(payload,secret);
    return json({...result,pid:process.pid});
  }
  if(!input.id)throw Error('r2c_resource_required');
  if(input.action==='reserve-review') {
    const snapshot=await review.get(input.id);
    const fingerprint=createHash('sha256').update(JSON.stringify({requestId:input.requestId,question:input.question})).digest('hex');
    const r=await review.reserve({operation:'review_reserve',reviewId:input.id,requestId:input.requestId,question:input.question,fingerprint,dailyLimit:30},secret);
    if(!r.cached)receipts.set(key,{kind:'review',payload:{operation:'review_finish',reviewId:input.id,requestId:input.requestId,leaseNonce:r.leaseNonce,codeHash:snapshot.code_hash}});
    return json({cached:r.cached,pid:process.pid});
  }
  await tutor.getSession(input.id);
  const r=await tutor.reserve({operation:'reserve',sessionId:input.id,requestId:input.requestId,action:'chat',fingerprint:createHash('sha256').update(input.requestId).digest('hex'),dailyLimit:30},secret);
  if(!r.cached)receipts.set(key,{kind:'tutor',payload:{operation:'finish',sessionId:input.id,requestId:input.requestId,leaseNonce:r.leaseNonce}});
  return json({cached:r.cached,pid:process.pid});
}); }
