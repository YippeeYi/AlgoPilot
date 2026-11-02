// Explicit local-only launcher. Install/platform provisioning remains an operator step.
// No login/link/remote command, no production Provider replacement, no service-role SDK.
import { readFile, writeFile, mkdir, mkdtemp, copyFile, symlink, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { localManifest, prepareLocalAudit } from './r2c-local-boundary.mjs';
import { collectOfflineAudit } from './offline-audit.ts';
process.umask(0o077);
const root=process.cwd(),directory=process.argv[2],manifest=await localManifest(directory);
if(process.argv[3]&&process.argv[3]!=='--expiry-only')throw Error('r2c_unknown_mode');
const config=JSON.parse(await readFile(join(directory,'local-synthetic.json'),'utf8'));
if(config.api!==`http://127.0.0.1:${manifest.ports.api}`)throw Error('r2c_api_mismatch');
const attempt=await mkdtemp(join(directory,'attempt-'));
const apps=[join(attempt,'app1'),join(attempt,'app2')],audit=join(attempt,'node-audit');
await mkdir(audit,{mode:0o700});await mkdir(join(directory,'driver'),{mode:0o700,recursive:true});
const lifecycle=await prepareLocalAudit(root,attempt,Object.values(manifest.ports));
const env={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:join(directory,'home'),TMPDIR:join(directory,'cache'),CI:'1',NEXT_TELEMETRY_DISABLED:'1',
  NODE_OPTIONS:`--require=${lifecycle}`,M353_B3_AUDIT_DIRECTORY:audit,NEXT_PUBLIC_SUPABASE_URL:config.api,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:config.anon,
  TUTOR_RPC_SIGNING_SECRET:config.tutorSecret,CODEFORCES_RPC_SIGNING_SECRET:config.cfSecret,LLM_PROVIDER:'openai-compatible',LLM_BASE_URL:'https://r2c-provider.invalid/v1',
  LLM_API_KEY:'synthetic-not-a-provider-key',LLM_MODEL:'synthetic-no-provider',R2C_DRIVER_DIRECTORY:join(directory,'driver'),R2C_RUN_DIRECTORY:attempt,
  PLAYWRIGHT_BROWSERS_PATH:join(userInfo().homedir,'Library/Caches/ms-playwright')};
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,env:{PATH:'/usr/bin:/bin'}}).toString().split('\0').filter(Boolean);
await mkdir(apps[0],{mode:0o700});
for(const file of files){if(/(^|\/)\.env($|\.)/.test(file))continue;const dest=join(apps[0],file);await mkdir(dirname(dest),{recursive:true,mode:0o700});await copyFile(join(root,file),dest);}
await symlink(join(root,'node_modules'),join(apps[0],'node_modules'),'dir');
const route=join(apps[0],'src/app/api/v1/r2c-private/route.ts');await mkdir(dirname(route),{recursive:true,mode:0o700});await copyFile(join(root,'tests/fixtures/r2c-private-route.ts'),route);
const children=[],runs=[],processes=[];
const publishProcesses=()=>writeFile(join(attempt,'processes.json'),JSON.stringify(processes,null,2),{mode:0o600});
async function run(args,cwd,label,extra={}){
  const {open}=await import('node:fs/promises');const log=await open(join(attempt,label+'.log'),'wx',0o600);
  const child=spawn(process.execPath,args,{cwd,env:{...env,...extra},stdio:label==='local-integration'?['ignore',log.fd,log.fd,'ipc']:['ignore',log.fd,log.fd]});children.push(child);
  const row={phase:label,pid:child.pid,ppid:process.pid,startedNs:process.hrtime.bigint().toString(),finishedNs:null,exitCode:null,signal:null};processes.push(row);
  const done=new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('exit',(code,signal)=>{Object.assign(row,{finishedNs:process.hrtime.bigint().toString(),exitCode:code,signal});resolve(signal?1:code??1);});}).then(async code=>{await publishProcesses();return code;}).finally(()=>log.close());runs.push(done);
  await publishProcesses();return {child,done};
}
let outcome=1;
try {
  const build=await run([join(root,'node_modules/next/dist/bin/next'),'build','--webpack'],apps[0],'local-build',{APP_URL:`http://127.0.0.1:${manifest.ports.instance1}`});
  if(await build.done)throw Error('r2c_build_failed');
  await cp(apps[0],apps[1],{recursive:true,dereference:false,filter:p=>!p.endsWith('/node_modules')});await symlink(join(root,'node_modules'),join(apps[1],'node_modules'),'dir');
  const instances=[],servers=[];
  for(let i=0;i<2;i++){
    const port=manifest.ports[i?'instance2':'instance1'];
    const {child}=await run([join(root,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],apps[i],`instance${i+1}`,{APP_URL:`http://127.0.0.1:${port}`});
    instances.push({pid:child.pid,port,workspace:apps[i]});
    servers.push(child);
  }
  await writeFile(join(directory,'evidence/instances.json'),JSON.stringify(instances,null,2),{mode:0o600});
  const flow=await run([join(apps[0],'tests/live',process.argv[3]==='--expiry-only'?'r2c-expiry-flow.mjs':'r2c-auth-flow.mjs'),directory],apps[0],'local-integration');
  flow.child.on('message',message=>{
    if(message?.action!=='stop-instance1')return;
    const owned=servers[0];
    owned.once('exit',()=>flow.child.connected&&flow.child.send({action:'instance1-stopped',pid:owned.pid}));
    owned.kill('SIGTERM');
  });
  outcome=await flow.done;
} catch(error) {console.error(error.message);}
finally {
  for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGTERM');
  await Promise.all(children.map(c=>c.exitCode!==null||c.signalCode!==null?undefined:new Promise(resolve=>c.once('exit',resolve))));
  await Promise.all(runs);
  const result=await collectOfflineAudit(audit);await writeFile(join(attempt,'node-audit.json'),JSON.stringify(result,null,2),{mode:0o600});await writeFile(join(directory,'evidence/node-audit.json'),JSON.stringify({attempt,...result},null,2),{mode:0o600});
  console.log(JSON.stringify({functionalExit:outcome,audit:result}));
  if(result.status!=='PASS')outcome=1;
}
process.exitCode=outcome;
