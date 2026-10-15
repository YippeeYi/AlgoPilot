// Explicit authorization: public YippeeYi, at most 3 calls, local output only.
// No Supabase access, private auth, source code, contact data or Rating collection.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const handle='YippeeYi',out=process.env.M34_CF_OUTPUT??'/tmp/algopilot-m34-cf';
const prior=process.argv.includes('--resume')?JSON.parse(await readFile(`${out}/public-cf.json`,'utf8')):null;
if(prior&&(prior.handle!==handle||prior.calls.length>3))throw new Error('Invalid local recording checkpoint');
const calls=prior?.calls??[];let last=calls.length?Date.parse(calls.at(-1).startedAt):0;
const steps=[['user.info',{handles:handle,checkHistoricHandles:'false'}],['user.status',{handle,from:'1',count:'200',includeSources:'false'}],['user.status',{handle,from:'161',count:'200',includeSources:'false'}]];
for(let step=calls.length;step<steps.length;step++){
 const [method,params]=steps[step];
 if(step===2){const n=calls.at(-1)?.response?.result?.length;if(n===undefined)break;params.from=String(n<200?n+1:161);}
 const url=new URL('https://codeforces.com/api/'+method);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 await new Promise(r=>setTimeout(r,Math.max(0,3100-(Date.now()-last))));last=Date.now();
 const startedAt=new Date(last).toISOString();
 try{
  const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(18000),headers:{Accept:'application/json'}});
  const reader=r.body?.getReader(),chunks=[];let size=0;if(!reader)throw new Error('No body');
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>3000000)throw new Error('Size limit');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
  const raw=Buffer.concat(chunks),sha256=createHash('sha256').update(raw).digest('hex');
  if(!r.ok){calls.push({method,url:url.toString(),startedAt,httpStatus:r.status,sha256,category:'http'});break;}
  const data=JSON.parse(raw.toString('utf8'));
  if(data.status!=='OK'){calls.push({method,url:url.toString(),startedAt,httpStatus:r.status,sha256,category:'api_failed'});break;}
  const result=method==='user.info'?data.result.map(x=>({handle:x.handle,registrationTimeSeconds:x.registrationTimeSeconds})):data.result.map(x=>({id:x.id,creationTimeSeconds:x.creationTimeSeconds,problem:{...(x.problem.contestId?{contestId:x.problem.contestId}:{}),index:x.problem.index},author:{members:x.author.members.map(m=>({handle:m.handle})),...(x.author.ghost?{ghost:true}:{})},...(x.verdict?{verdict:x.verdict}:{})}));
  calls.push({method,url:url.toString(),startedAt,httpStatus:r.status,sha256,response:{status:'OK',result}});
 }catch{calls.push({method,url:url.toString(),startedAt,category:'network_or_invalid_response'});break;}
}
const report={recordedAt:new Date().toISOString(),handle,authorization:'M3.4 explicit public read only; local/isolated storage only',boundary:'Actual public responses minimized; no hosted writes, no ownership proof, not a complete history',maxCalls:3,calls};
await mkdir(out,{recursive:true});await writeFile(`${out}/public-cf.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:out,calls:calls.map(c=>({method:c.method,status:c.httpStatus??c.category,rows:c.response?.result?.length}))}));
