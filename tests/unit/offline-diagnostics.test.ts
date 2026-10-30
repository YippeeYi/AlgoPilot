import {afterAll, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {collectOfflineAudit} from '../../scripts/offline-audit';
import {collectOfflineDiagnostics} from '../../scripts/offline-diagnostics';

const directories:string[]=[];
async function directory() {
  const root=await mkdtemp(join(tmpdir(),'offline-diagnostics-fixture-'));directories.push(root);
  const d=join(root,'probe');await mkdir(d,{mode:0o700});return d;
}
function child(d:string,code='') {
  return spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:8000,
    env:{PATH:'/usr/bin:/bin',NODE_ENV:'test',NODE_OPTIONS:'--require='+resolve('scripts/offline-diagnostic-preload.cjs'),M353_B3_AUDIT_DIRECTORY:d}});
}
afterAll(async()=>{for(const d of directories)await rm(d,{recursive:true,force:true});});
it('correlates normal process identity and phase with the unchanged durable audit',async()=>{
  const d=await directory();expect(child(d).status).toBe(0);
  expect(await collectOfflineAudit(d)).toMatchObject({status:'PASS',started:1,completed:1});
  const r=await collectOfflineDiagnostics(d);expect(r).toMatchObject({state:'CORRELATED',issues:[],events:[]});
  expect(r.contexts).toEqual([expect.objectContaining({phase:'probe',threadId:0,isMainThread:true,pid:expect.any(Number),ppid:expect.any(Number),startedNs:expect.stringMatching(/^\d+$/)})]);
});
it('preserves every network/DNS/credential denial and counts; arguments and arbitrary source URLs never enter diagnostics',async()=>{
  const d=await directory();
  const p=child(d,`
    const b=process.getBuiltinModule.bind(process), marker='PRIVATE_DIAGNOSTIC_SENTINEL';
    const destination='https://'+marker+'.invalid/path?token='+marker;
    const calls=[
      ()=>b('http').request(destination),()=>b('http').get(destination),
      ()=>b('https').request(destination),()=>b('https').get(destination),
      ()=>b('net').connect({host:marker,port:443}),()=>b('net').createConnection({host:marker,port:443}),
      ()=>new (b('net').Socket)().connect({host:marker,port:443}),()=>b('tls').connect({host:marker,port:443}),
      ()=>fetch(destination,{headers:{Authorization:marker},body:marker}),
      ()=>b('dns').lookup(marker),()=>b('dns').promises.resolve4(marker),
      ()=>b('fs').readFileSync('/synthetic/.env'),()=>b('fs/promises').readFile('/synthetic/.env')
    ];
    for(const call of calls){try{call();throw Error('not denied');}catch(e){if(e.message!=='b3_offline_policy_denied')throw e;}}
    b('vm').runInThisContext('try { fetch("'+destination+'") } catch {}',{filename:destination});
  `);
  expect(p.status).toBe(91);expect(p.stdout+p.stderr).not.toContain('PRIVATE_DIAGNOSTIC_SENTINEL');
  expect(await collectOfflineAudit(d)).toMatchObject({status:'FAIL',counters:{networkBlocked:10,dnsBlocked:2,credentialReadBlocked:2,externalHTTP:0,realDNS:0,realCredentialReads:0}});
  const r=await collectOfflineDiagnostics(d);expect(r.state).toBe('CORRELATED');expect(r.events).toHaveLength(14);
  expect(JSON.stringify(r)).not.toMatch(/PRIVATE_DIAGNOSTIC_SENTINEL|https:\/\/|Authorization|synthetic\/\.env/);
  expect(r.events[0]).toMatchObject({sequence:1,kind:'networkBlocked',operation:'http.request',stack:expect.any(Array)});
  expect(r.events.some(e=>(e.stack as {source:string}[]).some(s=>s.source==='unmapped'))).toBe(true);
});
it('captures a useful local source frame without function names or source text',async()=>{
  for(const prefix of ['', 'file://']) {
    const d=await directory();const filename=prefix+resolve('scripts/offline-diagnostic-synthetic.cjs');
    expect(child(d,`process.getBuiltinModule('vm').runInThisContext('try { fetch("https://fixture.invalid") } catch {}',{filename:${JSON.stringify(filename)}})`).status).toBe(91);
    const r=await collectOfflineDiagnostics(d);expect(r.state).toBe('CORRELATED');
    expect((r.events[0]!.stack as {source:string}[]).some(s=>s.source==='scripts/offline-diagnostic-synthetic.cjs')).toBe(true);
  }
});
it('forks and worker threads inherit the guard and can be linked to their parent and audit record',async()=>{
  const d=await directory();
  expect(child(d,`
    const {Worker}=process.getBuiltinModule('worker_threads');
    const {spawnSync}=process.getBuiltinModule('child_process');
    if(spawnSync(process.execPath,['-e',''],{env:process.env}).status!==0)process.exitCode=1;
    new Worker('setImmediate(()=>{})',{eval:true});
  `).status).toBe(0);
  expect(await collectOfflineAudit(d)).toMatchObject({status:'PASS',started:3,completed:3});
  const r=await collectOfflineDiagnostics(d);expect(r.state).toBe('CORRELATED');expect(r.contexts).toHaveLength(3);
  const worker=r.contexts.find(c=>c.isMainThread===false)!;
  expect(r.contexts.some(c=>c.pid===worker.pid&&c.threadId===0)).toBe(true);
  expect(r.contexts.some(c=>c.ppid===worker.pid&&c.pid!==worker.pid)).toBe(true);
});
it('a killed process remains UNKNOWN in both collections',async()=>{
  const d=await directory();expect(child(d,'process.kill(process.pid,"SIGKILL")').signal).toBe('SIGKILL');
  expect(await collectOfflineAudit(d)).toMatchObject({status:'FAIL',state:'UNKNOWN',counters:null});
  expect(await collectOfflineDiagnostics(d)).toMatchObject({state:'UNKNOWN',issues:['MISSING_FINAL_FOR_DIAGNOSTICS']});
});
it('missing or tampered diagnostic events cannot erase the original failing audit',async()=>{
  const d=await directory();expect(child(d,'try { fetch("https://fixture.invalid") } catch {}').status).toBe(91);
  const event=(await readdir(d+'-diagnostics')).find(n=>n.endsWith('.event.json'))!;
  await rm(join(d+'-diagnostics',event));
  expect(await collectOfflineDiagnostics(d)).toMatchObject({state:'UNKNOWN',issues:['DENIAL_COUNT_MISMATCH']});
  expect(await collectOfflineAudit(d)).toMatchObject({status:'FAIL',counters:{networkBlocked:1}});
});
it('bounds diagnostic output while keeping every denial in the guard counter',async()=>{
  const d=await directory();expect(child(d,'for(let i=0;i<33;i++){try{fetch("https://fixture.invalid")}catch{}}').status).toBe(93);
  expect(await collectOfflineAudit(d)).toMatchObject({status:'FAIL',counters:{networkBlocked:33}});
  const r=await collectOfflineDiagnostics(d);expect(r.events).toHaveLength(32);expect(r).toMatchObject({state:'UNKNOWN',issues:['DENIAL_COUNT_MISMATCH']});
});
it('invalid, orphan or absent diagnostics are unknown and do not echo arbitrary content',async()=>{
  const d=await directory();expect(await collectOfflineDiagnostics(d)).toMatchObject({state:'UNKNOWN',issues:['MISSING_DIAGNOSTICS']});
  expect(child(d).status).toBe(0);const folder=d+'-diagnostics';
  const context=(await readdir(folder)).find(n=>n.endsWith('.context.json'))!;
  const original=await readFile(join(folder,context),'utf8');
  await writeFile(join(folder,context),original.replace('"phase":"probe"','"phase":"PRIVATE_SENTINEL"'));
  await writeFile(join(folder,'PRIVATE_SENTINEL.json'),'PRIVATE_SENTINEL');
  const r=await collectOfflineDiagnostics(d);expect(r.state).toBe('UNKNOWN');expect(JSON.stringify(r)).not.toContain('PRIVATE_SENTINEL');
});
