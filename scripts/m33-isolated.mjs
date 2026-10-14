// Fresh loopback cluster only. No environment/production database URL is consumed.
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
if (process.env.M33_ALLOW_DATABASE_TESTS !== 'isolated') throw new Error('Set M33_ALLOW_DATABASE_TESTS=isolated; dedicated temporary cluster only');
const runtime=resolve(process.env.M321_RUNTIME_DIR??'/tmp/algopilot-m321-runtime');
const {default:EmbeddedPostgres}=await import(pathToFileURL(join(runtime,'node_modules/embedded-postgres/dist/index.js')).href);
const directory=await mkdtemp(join(tmpdir(),'algopilot-m33-'));
const port=await new Promise((r,j)=>{const s=createServer();s.once('error',j);s.listen(0,'127.0.0.1',()=>{const a=s.address();s.close(()=>r(a.port));});});
const pg=new EmbeddedPostgres({databaseDir:join(directory,'cluster'),user:'postgres',password:randomUUID(),port,persistent:true,createPostgresUser:false,postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[],checks=[],alice=randomUUID(),bob=randomUUID(),secret='ce'.repeat(32);
async function connect(){const c=pg.getPgClient('m33','127.0.0.1');await c.connect();clients.push(c);return c;}
async function begin(c,u){await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('statement_timeout','8000',true)",[u]);}
async function user(c,u,fn){await begin(c,u);try{const r=await fn();await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}}
function payload(u,operation,v){const p=JSON.stringify({operation,...v,userId:u,expiresAt:new Date(Date.now()+300000).toISOString()});return [p,createHmac('sha256',secret).update(p).digest('hex')];}
async function signed(c,u,v,name='cf_account_command',operation='cf_account'){return user(c,u,async()=>(await c.query(`select public.${name}($1,$2) v`,payload(u,operation,v))).rows[0].v);}
const state=(c,u)=>user(c,u,async()=>(await c.query('select public.cf_account_state() v')).rows[0].v);
async function code(fn,expected){try{await fn();assert.fail('Expected '+expected);}catch(e){assert.equal(e.code,expected);}}
async function blocked(admin,pid){for(let i=0;i<100;i++){if((await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}assert.fail('No independent backend lock wait');}
const output=process.env.M33_EVALUATION_OUTPUT??'/tmp/algopilot-m33-evaluation';
let stopped=false;
try{
 await pg.initialise();await pg.start();await pg.createDatabase('m33');const admin=await connect(),a=await connect(),b=await connect(),c=await connect();
 await admin.query("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;");
 const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();for(const f of files.filter(f=>f<'202610120006'))await admin.query(await readFile('supabase/migrations/'+f,'utf8'));
 await admin.query("insert into auth.users values($1,'a@fixture.invalid'),($2,'b@fixture.invalid')",[alice,bob]);
 const legacy=(await user(a,alice,()=>a.query("select id from public.create_custom_problem('[FIXTURE] legacy','statement',$1)",[randomUUID()]))).rows[0].id;
 const legacySession=(await user(a,alice,()=>a.query("select id from public.create_training_session($1,null,'practice',$2)",[legacy,randomUUID()]))).rows[0].id;
 const legacySnapshot=(await admin.query('select to_jsonb(s) v from public.training_sessions s where id=$1',[legacySession])).rows[0].v;
 for(const f of files.filter(f=>f>='202610120006'&&f<'202610150010'))await admin.query(await readFile('supabase/migrations/'+f,'utf8'));
 assert.deepEqual((await admin.query('select to_jsonb(s) v from public.training_sessions s where id=$1',[legacySession])).rows[0].v,legacySnapshot);
 await admin.query('insert into algopilot_private.cf_settings(signing_secret) values($1)',[secret]);
 const pids=(await Promise.all([a,b,c].map(x=>x.query('select pg_backend_pid() pid')))).map(r=>r.rows[0].pid);assert.equal(new Set(pids).size,3);
 // Prove the historical pre-lock clock bug without editing migration 006.
 const catalog=await signed(a,alice,{action:'reserve',force:true},'cf_sync','cf_sync');
 await admin.query('begin');await admin.query('select * from algopilot_private.cf_cache_state for update');
 const stale=signed(b,bob,{action:'slot',nonce:catalog.nonce},'cf_sync','cf_sync');await blocked(admin,pids[1]);await new Promise(r=>setTimeout(r,3200));await admin.query('commit');await stale;
 const oldImmediate=await signed(c,alice,{action:'slot',nonce:catalog.nonce},'cf_sync','cf_sync');assert.equal(oldImmediate.waitMs,0);checks.push('006 clock captured before 3.2s lock wait permits consecutive slots: reproduced');
 const legacyBefore=(await admin.query("select jsonb_agg(to_jsonb(s)) v from public.training_sessions s")).rows[0].v;
 const migration=await readFile('supabase/migrations/202610150010_cf_official_evidence.sql','utf8');await admin.query(migration);
 const defs=async()=>JSON.stringify((await admin.query("select oid::regprocedure::text n,pg_get_functiondef(oid) d from pg_proc where pronamespace='public'::regnamespace order by oid::regprocedure::text")).rows);
 const original=await defs();try{await admin.query(migration);assert.fail('Unexpected 010 replay');}catch(e){assert(['42P07','42723'].includes(e.code));await admin.query('rollback');}assert.equal(await defs(),original);checks.push('010 replay rejected atomically; legacy history unchanged');
 assert.deepEqual((await admin.query("select jsonb_agg(to_jsonb(s)) v from public.training_sessions s")).rows[0].v,legacyBefore);
 for(const [client,uid] of [[a,alice],[b,bob]]){const r=await signed(client,uid,{action:'reserve',kind:'bind',handle:'Public_Handle',revision:0,requestId:randomUUID()});await signed(client,uid,{action:'bind',nonce:r.nonce,scope:r.scope,handle:'Public_Handle',registrationSeconds:10});const enable=await signed(client,uid,{action:'reserve',kind:'enable',revision:1,requestId:randomUUID()});await signed(client,uid,{action:'enable',nonce:enable.nonce,scope:enable.scope,handle:'Public_Handle',registrationSeconds:10});}
 const intent={action:'reserve',kind:'sync',revision:2,requestId:randomUUID()};await begin(a,alice);const run=(await a.query('select public.cf_account_command($1,$2) v',payload(alice,'cf_account',intent))).rows[0].v;
 const competing=signed(b,alice,{...intent,requestId:randomUUID()});await blocked(admin,pids[1]);await a.query('commit');assert.equal((await competing).acquired,false);checks.push('3 independent backends; same-user lease serializes without duplicate run');
 const page={action:'page',nonce:run.nonce,scope:run.scope,requestId:randomUUID(),purpose:'pending',from:1,resetCycle:randomUUID(),submissions:[{submissionId:100,contestId:1,index:'A',createdSeconds:10,verdict:'OK'}]};
 await begin(a,alice);await a.query('select public.cf_account_command($1,$2)',payload(alice,'cf_account',page));const repeat=signed(b,alice,page);await blocked(admin,pids[1]);await a.query('commit');await repeat;assert.equal((await state(c,alice)).observedSubmissions,1);assert.equal((await state(b,bob)).observedSubmissions,0);checks.push('concurrent identical batch stores once; same public Handle has private independent evidence');
 const old=(await state(c,alice)).evidenceRevision;await begin(a,alice);await a.query('select public.cf_account_command($1,$2)',payload(alice,'cf_account',{action:'consent',enabled:false,revision:2,requestId:randomUUID()}));
 const guard=user(b,alice,()=>b.query('select public.learning_evidence_guard(0,$1)',[old])).then(()=>({code:'unexpected'}),e=>({code:e.code}));await blocked(admin,pids[1]);await a.query('commit');assert.equal((await guard).code,'PT409');assert.equal((await state(c,alice)).enabled,false);checks.push('cross-connection consent invalidates in-flight snapshot; old worker cannot return official facts');
 await code(()=>signed(c,alice,{...page,requestId:randomUUID()}),'PT409');
 for(const table of ['cf_accounts','cf_submissions','cf_account_receipts']){await code(()=>user(b,bob,()=>b.query('select * from algopilot_private.'+table)),'42501');await code(()=>user(b,bob,()=>b.query('delete from algopilot_private.'+table)),'42501');}
 await code(()=>user(b,bob,()=>b.query('select public.cf_account_command($1,$2)',payload(alice,'cf_account',page))),'42501');checks.push('private RLS/ACL tables deny direct read/write; cross-user signed payload rejected');
 // Compare the appended clock fix under the same real lock wait.
 await admin.query("update algopilot_private.cf_cache_state set next_slot_at='-infinity'");await admin.query('begin');await admin.query('select * from algopilot_private.cf_cache_state for update');
 const fresh=signed(b,bob,{action:'slot',nonce:catalog.nonce},'cf_sync','cf_sync');await blocked(admin,pids[1]);await new Promise(r=>setTimeout(r,3200));await admin.query('commit');assert.equal((await fresh).waitMs,0);
 const wait=await signed(c,alice,{action:'slot',nonce:catalog.nonce},'cf_sync','cf_sync');assert(wait.waitMs>2500&&wait.waitMs<=3000);checks.push('010 re-reads clock after global lock; shared catalog slot remains >=2.5s after 3.2s contention');
 const bobRun=await signed(b,bob,{action:'reserve',kind:'sync',revision:2,requestId:randomUUID()});const accountWait=await signed(b,bob,{action:'slot',nonce:bobRun.nonce,scope:bobRun.scope});assert(accountWait.waitMs>0);checks.push('catalog and account share one global clock across distinct users/connections');
 await signed(c,alice,{action:'delete',revision:3,requestId:randomUUID()});assert.equal((await state(a,alice)).observedSubmissions,0);assert.equal((await state(b,bob)).handle,'Public_Handle');checks.push('deletion clears collection and scope only for owner');
 const security=(await admin.query("select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon_execute from pg_proc where pronamespace='public'::regnamespace and proname in('cf_account_state','cf_account_command','learning_evidence_guard','cf_sync')")).rows;for(const r of security){assert.equal(r.prosecdef,true);assert.deepEqual(r.proconfig,['search_path=""']);assert.equal(r.anon_execute,false);}
 const report={boundary:'Native isolated PostgreSQL; auth.uid fixture, not hosted Supabase/JWT/PostgREST',version:(await admin.query('select version() v')).rows[0].v,independentBackends:3,migrations:files,checks,security};await mkdir(output,{recursive:true});await writeFile(join(output,'isolated-postgres.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,independentBackends:3,output:join(output,'isolated-postgres.json')}));
}catch(e){console.error(JSON.stringify({operation:'m33_isolated',code:e.code??e.name,checks,message:e.name==='AssertionError'?e.message:'Isolated validation failed; no production URL used'}));process.exitCode=1;}
finally{for(const c of clients)await c.end().catch(()=>{});try{await pg.stop();stopped=true;}catch{process.exitCode=1;}if(stopped)await rm(directory,{recursive:true,force:true});}
