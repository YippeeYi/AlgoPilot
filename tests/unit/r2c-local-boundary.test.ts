import { it, expect } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const boundary = await import(pathToFileURL(join(process.cwd(),'scripts/r2c-local-boundary.mjs')).href);
const source = await readFile(join(process.cwd(),'scripts/m353-b3-offline-guard.cjs'),'utf8');
it('requires the reviewed guard source and bounded nonprivileged ports',()=>{
  expect(()=>boundary.localGuard('changed',[12345])).toThrow('source_changed');
  for(const p of [[],[443],[65536],[NaN]])expect(()=>boundary.localGuard(source,p)).toThrow('ports_invalid');
});
it('refuses arbitrary, nonprivate and substituted manifests',async()=>{
  await expect(boundary.localManifest('/Users/example')).rejects.toThrow('private_root_required');
  const dir=await mkdtemp('/private/tmp/algopilot-r2c-boundary-');await chmod(dir,0o755);
  await expect(boundary.localManifest(dir)).rejects.toThrow('private_mode_required');
  await chmod(dir,0o700);
  await writeFile(join(dir,'manifest.json'),JSON.stringify({root:dir,projectId:'production',network:'production',ports:{}}),{mode:0o600});
  await expect(boundary.localManifest(dir)).rejects.toThrow('target_mismatch');
});
it.each([
  ['external fetch',"fetch('https://provider.invalid/v1')",'networkBlocked'],
  ['wrong loopback port',"fetch('http://127.0.0.1:12346')",'networkBlocked'],
  ['real DNS',"require('node:dns').lookup('provider.invalid',()=>{})",'dnsBlocked'],
  ['credential read',"require('node:fs').readFileSync('/not-present/.env')",'credentialReadBlocked'],
])('preserves fail-closed %s counts without attempting a connection',async(_name,operation,counter)=>{
  const dir=await mkdtemp(join(tmpdir(),'r2c-guard-'));await chmod(dir,0o700);const audits=join(dir,'audit');await mkdir(audits,{mode:0o700});
  const guard=join(dir,'guard.cjs');await writeFile(guard,boundary.localGuard(source,[12345]),{mode:0o600});
  const result=spawnSync(process.execPath,['--require',guard,'-e',`try {${operation}} catch {}`],{env:{PATH:'/usr/bin:/bin',HOME:dir,NODE_ENV:'test',M353_B3_AUDIT_DIRECTORY:audits},encoding:'utf8'});
  expect(result.status).toBe(91);
  const audit=JSON.parse(await readFile(join(audits,`${result.pid}-0.json`),'utf8'));
  expect(audit[counter]).toBe(1);expect(audit.externalHTTP+audit.realDNS+audit.realCredentialReads).toBe(0);
  expect(JSON.stringify(audit)).not.toContain('provider.invalid');
});
