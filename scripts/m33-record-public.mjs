// Explicit public recording only; no Supabase connection or CF private credentials.
// Preserve source URL/hash and only fields needed by the evidence parser, never source code.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const handle='Fefer_Ivan'; // Public example named in the official API documentation.
const out=process.env.M33_RECORD_OUTPUT??'/tmp/algopilot-m33-public';
const calls=[];let lastStart=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const [method,params] of [['user.info',{handles:handle,checkHistoricHandles:'false'}],['user.status',{handle,from:'1',count:'200',includeSources:'false'}],['user.status',{handle,from:'161',count:'200',includeSources:'false'}]]){
 const url=new URL('https://codeforces.com/api/'+method);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 for(let attempt=0;attempt<2;attempt++){
  await sleep(Math.max(0,3000-(Date.now()-lastStart)));lastStart=Date.now();
  try{
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(18000),headers:{Accept:'application/json'}});
   const raw=await response.text();const sha256=createHash('sha256').update(raw).digest('hex');
   if(!response.ok){calls.push({url:url.toString(),method,attempt,httpStatus:response.status,sha256,category:'http'});if(attempt===1)break;continue;}
   const data=JSON.parse(raw);
   const result=data.status==='OK'?(method==='user.info'?data.result.map(x=>({handle:x.handle,registrationTimeSeconds:x.registrationTimeSeconds})):data.result.map(x=>({id:x.id,creationTimeSeconds:x.creationTimeSeconds,problem:{...(x.problem.contestId?{contestId:x.problem.contestId}:{}),index:x.problem.index},author:{members:x.author.members.map(m=>({handle:m.handle})),...(x.author.ghost?{ghost:true}:{})},...(x.verdict?{verdict:x.verdict}:{})}))):undefined;
   calls.push({url:url.toString(),method,attempt,httpStatus:response.status,sha256,response:{status:data.status,...(result?{result}:{}),...(data.status==='FAILED'?{comment:data.comment}:{})}});
   if(data.status==='OK'||attempt===1)break;
  }catch{calls.push({url:url.toString(),method,attempt,category:'network_or_invalid_json'});}
 }
}
const report={recordedAt:new Date().toISOString(),source:'Actual anonymous public CF API, minimized fields; no private source, contact, Rating or resource fields persisted',handle,calls};
await mkdir(out,{recursive:true});await writeFile(`${out}/public-api.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:out,calls:calls.map(c=>({method:c.method,attempt:c.attempt,status:c.httpStatus??c.category,apiStatus:c.response?.status,rows:c.response?.result?.length}))}));
