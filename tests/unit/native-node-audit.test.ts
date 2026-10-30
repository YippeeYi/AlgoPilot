import {it,expect,afterAll} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runNativeNodePhase,readNativeTestSummary,nativePhaseVerdict,nativeAuditBoundary} from '../../scripts/native-node-audit';
import {collectOfflineAudit} from '../../scripts/offline-audit';
import {collectOfflineDiagnostics} from '../../scripts/offline-diagnostics';
const roots:string[]=[];
async function run(code:string,phase:'native-state'|'native-feedback'='native-state'){
  const root=await mkdtemp(join(tmpdir(),'r1-native-audit-'));roots.push(root);await mkdir(join(root,'home'),{mode:0o700});
  return runNativeNodePhase({phase,workspace:process.cwd(),directory:join(root,phase),args:['-e',code],
    environment:{PATH:'/usr/bin:/bin',HOME:join(root,'home'),NODE_ENV:'test'},collectors:{audit:collectOfflineAudit,diagnostics:collectOfflineDiagnostics}});
}
afterAll(async()=>{for(const d of roots)await rm(d,{recursive:true,force:true});});
it.each(['native-state','native-feedback'] as const)('normal %s root/fork/worker retain their actual phase and lifecycle',async phase=>{
  const r=await run(`const {spawnSync}=process.getBuiltinModule('child_process');if(spawnSync(process.execPath,['-e',''],{env:process.env}).status)throw Error('child');new (process.getBuiltinModule('worker_threads').Worker)('setImmediate(()=>{})',{eval:true});`,phase);
  expect(r).toMatchObject({status:'PASS',functionalStatus:'PASS',auditStatus:'PASS',rootObserved:true,audit:{started:3,completed:3,status:'PASS'},diagnostics:{state:'CORRELATED'}});
  expect(r.diagnostics.contexts.every(c=>c.phase===phase)).toBe(true);
});
it('a successful functional exit cannot conceal an actual caught denial',async()=>{
  const r=await run(`try{fetch('https://fixture.invalid',{headers:{Authorization:'synthetic-private-sentinel'}})}catch{}process.on('exit',()=>{process.exitCode=0;});`);
  expect(r).toMatchObject({status:'FAIL',functionalStatus:'PASS',auditStatus:'FAIL',audit:{state:'COLLECTED',counters:{networkBlocked:1,externalHTTP:0}}});
  expect(JSON.stringify(r)).not.toMatch(/fixture\.invalid|synthetic-private-sentinel|Authorization|https:\/\//);
});
it('Node loopback sockets remain denied; legitimate database transport stays in validated native psql',async()=>{
  const r=await run(`try{process.getBuiltinModule('net').connect({host:'127.0.0.1',port:1})}catch{}`);
  expect(r).toMatchObject({auditStatus:'FAIL',audit:{counters:{networkBlocked:1,externalHTTP:0}}});
  expect(JSON.stringify(r)).not.toContain('127.0.0.1');
});
it.each([['dns','process.getBuiltinModule("dns").lookup("fixture.invalid")','dnsBlocked'],['credential','process.getBuiltinModule("fs").readFileSync("/synthetic/.env")','credentialReadBlocked']])('retains %s denials without reading a target or credential',async(_name,call,counter)=>{
  const r=await run(`try{${call}}catch{}`);expect(r.auditStatus).toBe('FAIL');expect(r.audit.counters?.[counter as 'dnsBlocked'|'credentialReadBlocked']).toBe(1);expect(r.diagnostics.state).toBe('CORRELATED');
});
it.each(['SIGTERM','SIGINT'])('catchable %s reports functional interruption and complete zero audit separately',async signal=>{
  const r=await run(`process.kill(process.pid,${JSON.stringify(signal)});setInterval(()=>{},1000);`);
  expect(r).toMatchObject({status:'FAIL',functionalStatus:'FAIL',auditStatus:'PASS',audit:{state:'COLLECTED',started:1,completed:1}});
});
it('SIGKILL retains a missing final record and never substitutes zero',async()=>{
  const r=await run('process.kill(process.pid,"SIGKILL")');expect(r).toMatchObject({functionalStatus:'FAIL',auditStatus:'FAIL',audit:{state:'UNKNOWN',counters:null,started:1,completed:0}});
});
it.each(['missing','corrupt','pending'])('%s artifacts fail audit even when the root exits zero',async kind=>{
  const mutation=kind==='missing'?'fs.unlinkSync(p+".started")':kind==='corrupt'?'fs.writeFileSync(p+".started","{}")':'fs.writeFileSync(d+"/999999-0.pending","")';
  const r=await run(`const fs=process.getBuiltinModule('fs'),d=process.env.M353_B3_AUDIT_DIRECTORY,p=d+'/'+process.pid+'-0';${mutation};`);
  expect(r).toMatchObject({functionalStatus:'PASS',auditStatus:'FAIL',audit:{state:'UNKNOWN',counters:null}});
});
it('a valid context assigned to a different phase cannot certify the native stage',async()=>{
  const r=await run(`const fs=process.getBuiltinModule('fs'),f=process.env.M353_B3_AUDIT_DIRECTORY+'-diagnostics/'+process.pid+'-0.context.json',c=JSON.parse(fs.readFileSync(f,'utf8'));c.phase='probe';fs.writeFileSync(f,JSON.stringify(c));`);
  expect(r).toMatchObject({functionalStatus:'PASS',auditStatus:'FAIL',phaseAssociated:false,audit:{status:'PASS'},diagnostics:{state:'CORRELATED'}});
});
it('a killed inherited child is visible even if its parent ignores the signal',async()=>{
  const r=await run(`process.getBuiltinModule('child_process').spawnSync(process.execPath,['-e','process.kill(process.pid,"SIGKILL")'],{env:process.env});`);
  expect(r).toMatchObject({functionalStatus:'PASS',auditStatus:'FAIL',audit:{started:2,completed:1,counters:null}});
});
it('functional failure stays FAIL even when every observed safety counter is zero',async()=>{
  const r=await run('process.exitCode=7');expect(r).toMatchObject({functionalStatus:'FAIL',auditStatus:'PASS',status:'FAIL'});
  expect(nativePhaseVerdict(0,null,{status:'PASS'},{state:'CORRELATED',contexts:[]},123,'native-state')).toMatchObject({status:'FAIL',rootObserved:false});
  expect(nativeAuditBoundary).toMatchObject({nativeHTTP:'UNKNOWN',nativeDNS:'UNKNOWN',nativeCredentialReads:'UNKNOWN'});
});
it('test JSON counts must prove the expected complete suite, never skip/partial success or malformed output',async()=>{
  const root=await mkdtemp(join(tmpdir(),'r1-native-summary-'));roots.push(root);const file=join(root,'summary.json');
  const good={numTotalTests:20,numPassedTests:20,numFailedTests:0,numPendingTests:0,numTodoTests:0};
  await writeFile(file,JSON.stringify(good));expect(await readNativeTestSummary(file,20)).toMatchObject({complete:true});
  for(const changes of [{numTotalTests:19,numPassedTests:19},{numPassedTests:19,numPendingTests:1},{numPassedTests:19,numTodoTests:1},{numPassedTests:19,numFailedTests:1}]){
    await writeFile(file,JSON.stringify({...good,...changes}));expect(await readNativeTestSummary(file,20)).toMatchObject({complete:false});
  }
  await writeFile(file,'PRIVATE_BROKEN_SENTINEL');const result=await readNativeTestSummary(file,20);expect(result).toMatchObject({state:'UNKNOWN',counts:null,complete:false});expect(JSON.stringify(result)).not.toContain('PRIVATE_BROKEN_SENTINEL');
});
