// No install/download, existing server, connection URL, or production settings are supported.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readdir, realpath, access, copyFile, symlink, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { PsqlConnection, nativeEnvironment, applyMigration } from '../tests/native/psql.ts';

const root=process.cwd();
const temporary=await mkdtemp('/private/tmp/algopilot-m353-native-');
await mkdir(join(temporary,'home'),{mode:0o700});
const report={boundary:'Native local PostgreSQL, synthetic JWT claims; NOT hosted Supabase/JWT/PostgREST',
  status:'NOT_RUN',reason:null,temporary,migrations:[],target:null,regressionExitCode:null};
const reportPath=join(temporary,'native-postgres.json');
console.log('NATIVE_REPORT='+reportPath);
const args=process.argv.slice(2);
let pgStarted=false,target,admin;
const plainEnv={PATH:'/usr/bin:/bin',HOME:join(temporary,'home'),TMPDIR:temporary,LC_ALL:'C'};
async function execute(file,args,env=plainEnv,options={}) {
  return await new Promise((resolve,reject)=>{
    const child=spawn(file,args,{env,stdio:options.inherit?'inherit':['ignore','pipe','pipe'],...options});
    let output='';child.stdout?.on('data',s=>{output+=s;if(output.length>1_000_000)child.kill();});
    child.stderr?.resume();child.once('error',()=>reject(Error('Isolated subprocess unavailable')));
    child.once('exit',(code,signal)=>resolve({code:signal?1:code??1,output}));
  });
}
async function attest() {
  const v=await admin.value(`select json_build_object('database',current_database(),'directory',current_setting('data_directory'),'host',inet_server_addr()::text,'port',inet_server_port(),'listen',current_setting('listen_addresses'),'role',current_user)`);
  assert.deepEqual(v,{database:target.database,directory:target.directory,host:'127.0.0.1',port:target.port,listen:'127.0.0.1',role:'fixture_admin'});
  return v;
}
try {
  if(process.env.M353_ALLOW_DATABASE_TESTS!=='isolated')throw Object.assign(Error(),{blocked:'EXPLICIT_ISOLATION_SWITCH_REQUIRED'});
  if(args.length!==2||args[0]!=='--bin-dir'||!args[1].startsWith('/'))throw Object.assign(Error(),{blocked:'LOCAL_POSTGRES_BINARIES_REQUIRED: pass --bin-dir /absolute/existing/bin'});
  const bin=await realpath(args[1]);const versions=[];
  for(const name of ['postgres','initdb','pg_ctl','psql']) {
    await access(join(bin,name),constants.X_OK);
    const v=await execute(join(bin,name),['--version']);assert.equal(v.code,0);
    const version=v.output.match(/PostgreSQL\) (\d+(?:\.\d+)+)/)?.[1];assert(version);versions.push(version);
  }
  assert.equal(new Set(versions).size,1);assert(Number(versions[0].split('.')[0])>=16);
  const port=await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  target={bin,directory:join(temporary,'cluster'),port,database:'m353_'+randomBytes(8).toString('hex'),home:join(temporary,'home')};
  const env=nativeEnvironment(target);
  assert.equal((await execute(join(bin,'initdb'),['-D',target.directory,'-U','fixture_admin','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale'],env)).code,0);
  assert.equal((await execute(join(bin,'pg_ctl'),['-D',target.directory,'-l',join(temporary,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${temporary} -c unix_socket_permissions=0700 -c max_connections=12 -c statement_timeout=8000`,'-w','start'],env)).code,0);pgStarted=true;
  // Bootstrap is the sole connection to postgres; every subsequent connection is to our random DB.
  assert.equal((await execute(join(bin,'psql'),['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','fixture_admin','-d','postgres','-c',`create database ${target.database}`],env)).code,0);
  admin=new PsqlConnection(target,'fixture_admin');report.target=await attest();report.version=versions[0];
  for(const sql of ["create role anon nologin nosuperuser nobypassrls", "create role authenticated login noinherit nosuperuser nobypassrls", "create schema auth", "create table auth.users(id uuid primary key,email text)", "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$", "grant usage on schema auth to anon,authenticated", "grant execute on function auth.uid() to anon,authenticated"])await admin.query(sql);
  // Seed before 006 through the old, still-authorized API, then prove 006–012 preserve it.
  const files=(await readdir(join(root,'supabase/migrations'))).filter(f=>/^\d{12}_.+\.sql$/.test(f)).sort();
  assert.equal(files.length,12);
  const workspace=join(temporary,'workspace');await mkdir(workspace,{mode:0o700});
  const tracked=execFileSync('/usr/bin/git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,env:plainEnv,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const file of tracked){if(/(^|\/)\.env($|\.)/.test(file))continue;const dest=join(workspace,file);await mkdir(dirname(dest),{recursive:true});await copyFile(join(root,file),dest);}
  await symlink(join(root,'node_modules'),join(workspace,'node_modules'),'dir');
  let before;
  for(const file of files) {
    await attest();
    await applyMigration(target,join(workspace,'supabase/migrations',file));report.migrations.push(file);
    if(file.startsWith('202610120005')) {
      await admin.query("insert into auth.users values('10000000-0000-4000-8000-000000000001','legacy@fixture.invalid')");
      await admin.query('begin');await admin.query('set local role authenticated');await admin.query("set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001'");
      const sid=await admin.value("select to_json(id) from public.create_training_session(null,'synthetic legacy statement','practice','10000000-0000-4000-8000-000000000002')");
      await admin.query('commit');before=await admin.value(`select to_jsonb(s) from public.training_sessions s where id='${sid}'`);
    }
  }
  report.historyPreserved=JSON.stringify(await admin.value(`select to_jsonb(s) from public.training_sessions s where id='${before.id}'`))===JSON.stringify(before);assert(report.historyPreserved);
  report.roles=await admin.value("select json_agg(json_build_object('role',rolname,'superuser',rolsuper,'bypassrls',rolbypassrls,'inherit',rolinherit,'login',rolcanlogin)) from pg_roles where rolname in('anon','authenticated')");
  const audits=join(temporary,'audits');await mkdir(audits,{mode:0o700});
  const childEnv={...env,PATH:dirname(process.execPath)+':/usr/bin:/bin',CI:'1',M353_NATIVE_TARGET:JSON.stringify(target),NODE_OPTIONS:`--require=${join(workspace,'scripts/m353-b3-offline-guard.cjs')}`,M353_B3_AUDIT_DIRECTORY:audits};
  const v=await execute(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run','--config','vitest.native.config.ts','--reporter=default','--reporter=json',`--outputFile=${join(temporary,'vitest.json')}`],childEnv,{cwd:workspace,inherit:true});
  report.regressionExitCode=v.code;report.status=v.code===0?'PASS':'FAIL';if(v.code)process.exitCode=1;
} catch(error) {
  report.status=error.blocked||error.code==='ENOENT'?'BLOCKED':'FAIL';
  report.reason=error.blocked??(error.code==='ENOENT'?'LOCAL_POSTGRES_BINARIES_UNAVAILABLE':'ISOLATED_VALIDATION_FAILED');
  process.exitCode=report.status==='BLOCKED'?2:1;
} finally {
  if(pgStarted){
    try {await attest();await admin.close();admin=undefined;
      const stopped=await execute(join(target.bin,'pg_ctl'),['-D',target.directory,'-w','-m','immediate','stop'],nativeEnvironment(target));assert.equal(stopped.code,0);
      // Directory is exclusively created by this process, and the actual target was attested above.
      await rm(target.directory,{recursive:true});report.clusterRemoved=true;
    }catch{report.status='FAIL';report.cleanup='TARGET_OR_STOP_UNCONFIRMED: retained';process.exitCode=1;}
  }
  await admin?.close();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
