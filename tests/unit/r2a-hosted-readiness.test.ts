import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {r2bPreflight,migrationManifest} from '../../scripts/r2a-hosted-readiness';

const target={projectRef:'aaaaaaaaaaaaaaaaaaaa',url:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',environment:'TEST'};
const complete={proposed:target,approvedTarget:target,observedTarget:target,scopes:['metadata','auth','fixtures','migration','cleanup'],accounts:['A','B'],backupReference:'synthetic-backup',restoreReference:'synthetic-restore',migrationState:'REVIEWED',useExistingUserData:false};
function cliEnvironment(home:string){
  const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:home,NODE_ENV:'test'};
  // Only inherit the controlled offline harness, never the caller's credentials.
  for(const name of ['NODE_OPTIONS','M353_B3_AUDIT_DIRECTORY'])if(process.env[name])env[name]=process.env[name];
  return env;
}
it('never issues execution permission from a matching self-authored target/approval document',()=>{
  expect(r2bPreflight(complete)).toMatchObject({status:'BLOCKED',executionEnabled:false,action:'NONE',blockers:['REMOTE_IDENTITY_VERIFIER_NOT_CONNECTED','CURRENT_OWNER_AUTHORIZATION_NOT_VERIFIED']});
});
it.each([
  [{...complete,approvedTarget:undefined},'APPROVED_TARGET_MISMATCH'],
  [{...complete,observedTarget:undefined},'REMOTE_OBSERVATION_MISSING_OR_MISMATCH'],
  [{...complete,observedTarget:{...target,projectRef:'bbbbbbbbbbbbbbbbbbbb'}},'REMOTE_OBSERVATION_MISSING_OR_MISMATCH'],
  [{...complete,proposed:{...target,url:target.url+'.attacker.invalid'}},'PROJECT_URL_MISMATCH'],
  [{...complete,proposed:{...target,environment:'PRODUCTION'}},'WRITES_REQUIRE_DEDICATED_TEST'],
  [{...complete,proposed:{...target,environment:'STAGING'}},'WRITES_REQUIRE_DEDICATED_TEST'],
  [{...complete,accounts:['A']},'TEST_ACCOUNTS_AND_CLEANUP_SCOPE_REQUIRED'],
  [{...complete,scopes:['fixtures']},'TEST_ACCOUNTS_AND_CLEANUP_SCOPE_REQUIRED'],
  [{...complete,backupReference:undefined},'BACKUP_AND_RESTORE_REQUIRED'],
  [{...complete,restoreReference:undefined},'BACKUP_AND_RESTORE_REQUIRED'],
  [{...complete,migrationState:'UNKNOWN'},'MIGRATION_STATE_UNKNOWN'],
  [{...complete,useExistingUserData:true},'EXISTING_USER_DATA_PROHIBITED'],
  [{...complete,TEST:true},'INVALID_OR_UNTRUSTED_INPUT'],
  [{...complete,remoteEvidenceVerified:true},'INVALID_OR_UNTRUSTED_INPUT'],
])('fails closed for missing, mismatched, unsafe or self-verified evidence %#',(input,reason)=>{
  expect(r2bPreflight(input)).toMatchObject({status:'BLOCKED',executionEnabled:false});expect(r2bPreflight(input).blockers).toContain(reason);
});
it('keeps all 13 immutable versions and hashes distinct from execution history',async()=>{
  const manifest=await migrationManifest();expect(manifest).toHaveLength(13);expect(new Set(manifest.map(m=>m.sha256)).size).toBe(13);
  expect(manifest.slice(-3).map(m=>m.version)).toEqual(['202610260011','202610270012','202610280013']);
});
it('CLI errors are redacted and cannot execute SQL or expose supplied metadata',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'r2a-cli-'));
  const env=cliEnvironment(dir);
  const result=spawnSync(process.execPath,['scripts/r2a-hosted-readiness.ts','db-push','PRIVATE_SYNTHETIC_SENTINEL'],{encoding:'utf8',env});
  expect(result.status).not.toBe(0);expect(result.stdout+result.stderr).not.toContain('PRIVATE_SYNTHETIC_SENTINEL');
  expect(result.stderr).toContain('INVALID_METADATA_OR_IO');
  const file=join(dir,'manifest.json'),ok=spawnSync(process.execPath,['scripts/r2a-hosted-readiness.ts','manifest',file],{encoding:'utf8',env});
  expect(ok.status).toBe(0);expect(JSON.parse(await readFile(file,'utf8')).remote).toBe('NOT_RUN');
  const again=spawnSync(process.execPath,['scripts/r2a-hosted-readiness.ts','manifest',file],{encoding:'utf8',env});
  expect(again.status).not.toBe(0); // Exclusive output never overwrites an earlier report.
});
it('CLI preflight exits blocked even with a complete synthetic document',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'r2a-cli-blocked-')),input=join(dir,'input.json'),output=join(dir,'output.json');await writeFile(input,JSON.stringify(complete));
  const result=spawnSync(process.execPath,['scripts/r2a-hosted-readiness.ts','preflight',input,output],{encoding:'utf8',env:cliEnvironment(dir)});
  expect(result.status).toBe(2);expect(JSON.parse(await readFile(output,'utf8'))).toMatchObject({status:'BLOCKED',executionEnabled:false,action:'NONE'});
});
