// Anonymous, read-only schema existence probe. No user JWT, data reads, DDL or writes.
// RPCs check auth.uid before touching evidence; never probe write RPCs.
import nextEnv from '@next/env';
import { mkdir, writeFile } from 'node:fs/promises';
if(process.env.M322_ALLOW_TARGET_READS !== 'read-only') throw new Error('Set M322_ALLOW_TARGET_READS=read-only');
nextEnv.loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const origin=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const result=[];
if(origin&&key){
 const url=new URL(origin);if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co'))throw new Error('Expected configured hosted Supabase origin');
 for(const name of ['learning_evidence','learning_candidates']){
  try{
   const response=await fetch(new URL('/rest/v1/rpc/'+name,origin),{method:'POST',headers:{apikey:key,...(key.startsWith('ey')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},body:JSON.stringify(name==='learning_candidates'?{p_query:{min:800,max:1200,target:1000,themes:[],repeat:false}}:{}),signal:AbortSignal.timeout(12000)});
   const data=await response.json();result.push({operation:name,status:response.status,code:typeof data.code==='string'?data.code:'unavailable'});
  }catch{result.push({operation:name,category:'network_unavailable'});}
 }
}
const report={checkedAt:new Date().toISOString(),configured:Boolean(origin&&key),boundary:'Anonymous read-only probe; cannot verify complete migrations, 008 definition/hash, JWT or isolation. No user data or production changes.',result};
const out=process.env.M322_READONLY_OUTPUT??'/tmp/algopilot-m322-readonly';await mkdir(out,{recursive:true});await writeFile(`${out}/target-readonly.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
