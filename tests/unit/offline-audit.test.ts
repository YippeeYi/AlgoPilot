import {it,expect,afterAll} from 'vitest';import {mkdtemp,writeFile,rm,readFile,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {collectOfflineAudit} from '../../scripts/offline-audit';
const dirs:string[]=[];
async function directory(){const d=await mkdtemp(join(tmpdir(),'offline-audit-fixture-'));dirs.push(d);return d;}
const record={version:'m353-b3-guard/1',networkBlocked:0,dnsBlocked:0,credentialReadBlocked:0,externalHTTP:0,realDNS:0,realCredentialReads:0};
async function complete(d:string,id='123-0',changes={}){const [pid,threadId]=id.split('-').map(Number);await writeFile(join(d,id+'.started'),JSON.stringify({version:'offline-audit-lifecycle/1',pid,threadId}));await writeFile(join(d,id+'.json'),JSON.stringify({...record,...changes}));}
const child=(d:string,code='')=>spawnSync(process.execPath,['-e',code],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',NODE_ENV:'test',NODE_OPTIONS:'--require='+resolve('scripts/offline-audit-lifecycle.cjs'),M353_B3_AUDIT_DIRECTORY:d}});
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true});});
it('a genuine normal child has a durable start and a final counter record',async()=>{const d=await directory();expect(child(d).status).toBe(0);expect(await collectOfflineAudit(d)).toMatchObject({status:'PASS',state:'COLLECTED',started:1,completed:1,counters:{externalHTTP:0,realDNS:0,realCredentialReads:0}});});
it.each([['SIGTERM',143],['SIGINT',130]])('catchable %s shutdown publishes real counters and preserves interruption status',async(signal,status)=>{const d=await directory();const p=child(d,`process.kill(process.pid,${JSON.stringify(signal)});setInterval(()=>{},1000);`);expect(p.status).toBe(status);expect(await collectOfflineAudit(d)).toMatchObject({status:'PASS',started:1,completed:1});});
it('reproduces the old blind spot: a killed child before publication has no pending file, but must not become zero',async()=>{
 const d=await directory();expect(child(d).status).toBe(0);expect(child(d,'process.kill(process.pid,"SIGKILL")').signal).toBe('SIGKILL');const names=await readdir(d);expect(names.filter(f=>f.endsWith('.json'))).toHaveLength(1);expect(names.some(f=>f.endsWith('.pending'))).toBe(false);
 const r=await collectOfflineAudit(d);expect(r).toMatchObject({status:'FAIL',state:'UNKNOWN',started:2,completed:1,counters:null});expect(r.issues.some(i=>i.code==='MISSING_FINAL_RECORD')).toBe(true);
});
it('empty, missing, malformed, negative, overflow and orphan records remain unknown',async()=>{
 for(const kind of ['empty','missing','malformed','negative','overflow','orphan']){const d=await directory();if(kind!=='empty')await complete(d);
  if(kind==='missing')await rm(join(d,'123-0.json'));if(kind==='malformed')await writeFile(join(d,'123-0.json'),'{}');if(kind==='negative')await writeFile(join(d,'123-0.json'),JSON.stringify({...record,externalHTTP:-1}));if(kind==='overflow'){await complete(d,'124-0',{networkBlocked:Number.MAX_SAFE_INTEGER});await writeFile(join(d,'123-0.json'),JSON.stringify({...record,networkBlocked:1}));}if(kind==='orphan')await rm(join(d,'123-0.started'));
  expect(await collectOfflineAudit(d)).toMatchObject({status:'FAIL',state:'UNKNOWN',counters:null});
 }
});
it('a complete or empty unpublished record is never promoted or deleted',async()=>{for(const text of ['',JSON.stringify(record)]){const d=await directory();await complete(d);await writeFile(join(d,'456-0.pending'),text);const r=await collectOfflineAudit(d);expect(r).toMatchObject({status:'FAIL',counters:null});expect(await readFile(join(d,'456-0.pending'),'utf8')).toBe(text);}});
it('fully observed violation counts cannot be masked by successful test exits',async()=>{const d=await directory();await complete(d,'123-0',{networkBlocked:1});expect(await collectOfflineAudit(d)).toMatchObject({status:'FAIL',state:'COLLECTED',counters:{networkBlocked:1}});});
it('browser starts and finals must correspond; native background counts stay unknown',async()=>{
 const d=await directory();await complete(d);await writeFile(join(d,'444.browser.started'),JSON.stringify({version:'offline-browser-lifecycle/1',pid:444}));expect(await collectOfflineAudit(d)).toMatchObject({status:'FAIL',counters:null});
 await writeFile(join(d,'444.browser.json'),JSON.stringify({version:'review-browser-routing/1',allowed:12,denied:0,nativeBackgroundHTTP:null,nativeBackgroundDNS:null}));expect(await collectOfflineAudit(d)).toMatchObject({status:'PASS',browserStarted:1,browserCompleted:1,browser:{allowed:12,nativeHTTP:'UNKNOWN',nativeDNS:'UNKNOWN'}});
});
it('unknown artifact names and secret contents are not echoed into diagnostics',async()=>{const d=await directory();await complete(d);await writeFile(join(d,'PRIVATE_KEY.json'),'SECRET_CONTENT');const r=await collectOfflineAudit(d);expect(r.status).toBe('FAIL');expect(JSON.stringify(r)).not.toMatch(/PRIVATE_KEY|SECRET_CONTENT/);});
