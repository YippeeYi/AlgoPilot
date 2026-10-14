// Creates a fresh loopback-only PostgreSQL cluster. Never reads a production connection URL.
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";
if (process.env.M321_ALLOW_DATABASE_TESTS !== "isolated") {
  console.error("Refused: set M321_ALLOW_DATABASE_TESTS=isolated. This runner only creates its own temporary cluster."); process.exit(1);
}
const runtime = resolve(process.env.M321_RUNTIME_DIR ?? '/tmp/algopilot-m321-runtime');
const { default: EmbeddedPostgres } = await import(pathToFileURL(join(runtime,'node_modules/embedded-postgres/dist/index.js')).href);
const directory = await mkdtemp(join(tmpdir(),'algopilot-m321-'));
const port = await new Promise((res,rej)=>{const s=createServer();s.once('error',rej);s.listen(0,'127.0.0.1',()=>{const address=s.address();s.close(()=>res(address.port));});});
const pg = new EmbeddedPostgres({databaseDir:join(directory,'cluster'),user:'postgres',password:randomUUID(),port,persistent:true,createPostgresUser:false,postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[];const checks=[];
const alice=randomUUID(),bob=randomUUID(),secret='ce'.repeat(32);
const output=process.env.M321_EVALUATION_OUTPUT??'/tmp/algopilot-m321-evaluation';
let stopped=false;
async function connect(){const c=pg.getPgClient('algopilot_m321','127.0.0.1');await c.connect();clients.push(c);return c;}
async function begin(c,uid){await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('statement_timeout','5000',true)",[uid]);}
async function asUser(c,uid,fn){await begin(c,uid);try{const r=await fn();await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}}
async function expectCode(fn,code){try{await fn();assert.fail(`Expected SQLSTATE ${code}`);}catch(e){assert.equal(e.code,code);}}
const body=(requestId,revision,reviewEvidence=false)=>({action:'preferences',requestId,revision,preferences:{min:1400,max:1800,themes:[],goal:'independence',repeat:false,reviewEvidence}});
const write=(c,uid,v)=>asUser(c,uid,()=>c.query('select public.learning_write($1::jsonb)',[JSON.stringify(v)]));
const evidence=(c,uid)=>asUser(c,uid,async()=> (await c.query('select public.learning_evidence() v')).rows[0].v);
async function signed(c,uid,name,v){const payload=JSON.stringify({...v,userId:uid,expiresAt:new Date(Date.now()+300000).toISOString()});return asUser(c,uid,async()=> (await c.query(`select public.${name}($1,$2) v`,[payload,createHmac('sha256',secret).update(payload).digest('hex')])).rows[0].v);}
async function blocked(admin,pid){const until=Date.now()+3000;while(Date.now()<until){const r=await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);if(r.rows[0]?.wait_event_type==='Lock')return true;await new Promise(r=>setTimeout(r,10));}return false;}
function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);if(p===.5&&sorted.length%2===0)return (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];}
try {
 await pg.initialise();await pg.start();await pg.createDatabase('algopilot_m321');const admin=await connect();
 await admin.query("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;");
 const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>f<'202610120006'))await admin.query(await readFile(`supabase/migrations/${f}`,'utf8'));
 await admin.query("insert into auth.users values($1,'a@fixture.invalid'),($2,'b@fixture.invalid')",[alice,bob]);
 const a=await connect(), b=await connect(), c=await connect();
 const legacy=(await asUser(a,alice,()=>a.query("select id from public.create_custom_problem('[FIXTURE] legacy','statement',$1)",[randomUUID()]))).rows[0].id;
 const legacySession=(await asUser(a,alice,()=>a.query("select id from public.create_training_session($1,null,'practice',$2)",[legacy,randomUUID()]))).rows[0].id;
 const legacyBefore=(await admin.query('select to_jsonb(s) v from public.training_sessions s where id=$1',[legacySession])).rows[0].v;
 for(const f of files.filter(f=>f>='202610120006'&&f<='202610140007_learning_recommendations.sql'))await admin.query(await readFile(`supabase/migrations/${f}`,'utf8'));
 const functions=async()=> (await admin.query("select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace order by proname,oid")).rows;
 const beforeReplay=JSON.stringify(await functions());
 // Raw historical DDL is not repeatable; the transaction must fail without partial changes.
 try{await admin.query(await readFile('supabase/migrations/202610140007_learning_recommendations.sql','utf8'));assert.fail('007 unexpectedly replayed');}catch(e){assert.equal(e.code,'42P07');await admin.query('rollback');}
 assert.equal(JSON.stringify(await functions()),beforeReplay);checks.push('007 replay rejected atomically (42P07), function definitions preserved');
 const patch=await readFile('supabase/migrations/202610140008_recommendation_audit.sql','utf8');await admin.query(patch);const patched=JSON.stringify(await functions());const previous=JSON.parse(beforeReplay);assert.deepEqual(JSON.parse(patched).filter((r,i)=>r.definition!==previous[i].definition).map(r=>r.proname),['learning_candidates']);await admin.query(patch);assert.equal(JSON.stringify(await functions()),patched);checks.push('008 replay stable; only candidate function replaced');
 const fitPatch=await readFile('supabase/migrations/202610140009_recommendation_fit.sql','utf8');await admin.query(fitPatch);
 const afterFit=JSON.stringify(await functions());assert.deepEqual(JSON.parse(afterFit).filter((r,i)=>r.definition!==JSON.parse(patched)[i].definition).map(r=>r.proname),['learning_candidates']);
 await expectCode(()=>asUser(b,bob,()=>b.query("update algopilot_private.recommendation_restrictions set language='C++'")),'42501');
 assert((await admin.query("select relrowsecurity from pg_class where oid='algopilot_private.recommendation_restrictions'::regclass")).rows[0].relrowsecurity);
 checks.push('009 changes only candidate RPC; exception metadata RLS/ACL rejects user edits');
 assert.deepEqual((await admin.query('select to_jsonb(s) v from public.training_sessions s where id=$1',[legacySession])).rows[0].v,legacyBefore);checks.push('legacy custom/session data unchanged across 006–009');
 await admin.query('insert into algopilot_private.tutor_settings(signing_secret) values($1)',[secret]);await admin.query('insert into algopilot_private.cf_settings(signing_secret) values($1)',[secret]);
 const source=process.env.CF_REAL_RESPONSE_PATH??'tests/fixtures/cf-problemset-20261012.json.gz',recordedBytes=await readFile(source),raw=(source.endsWith('.gz')?gunzipSync(recordedBytes):recordedBytes).toString('utf8'),recording=JSON.parse(raw).result;
 const statistics=new Map(recording.problemStatistics.map(p=>[`${p.contestId}/${p.index}`,p.solvedCount]));
 const problems=recording.problems.filter(p=>p.contestId).map(p=>({contestId:p.contestId,index:p.index,name:p.name,rating:p.rating??null,tags:p.tags??[],solvedCount:statistics.get(`${p.contestId}/${p.index}`)??null}));
 const lease=await signed(a,alice,'cf_sync',{operation:'cf_sync',action:'reserve'});await signed(a,alice,'cf_sync',{operation:'cf_sync',action:'slot',nonce:lease.nonce});await signed(a,alice,'cf_sync',{operation:'cf_sync',action:'publish',nonce:lease.nonce,problems});
 const fitPool=(await asUser(a,alice,()=>a.query('select public.learning_candidates($1::jsonb) v',[JSON.stringify({min:2000,max:2600,target:2300,themes:[],repeat:false})]))).rows[0].v;
 assert.equal(fitPool.policyVersion,'training-fit/1');assert(fitPool.items.every(p=>p.contestId!==130&&!p.tags.includes('interactive')));assert.equal(fitPool.items.length,600);checks.push('009 real recorded catalog suitability before 600 shortlist');
 const pid=(await admin.query("select id from public.problems where rating between 1400 and 1800 order by contest_id,problem_index limit 1")).rows[0].id;
 const pids=(await Promise.all([a,b,c].map(x=>x.query('select pg_backend_pid() pid')))).map(r=>r.rows[0].pid);assert.equal(new Set(pids).size,3);
 // Independent connections contend on the same user's CAS, verified through pg_stat_activity.
 await begin(a,alice);await a.query('select public.learning_write($1::jsonb)',[JSON.stringify(body(randomUUID(),0))]);
 const competing=write(b,alice,body(randomUUID(),0)).then(()=>({code:'unexpected'}),e=>({code:e.code}));assert.equal(await blocked(admin,pids[1]),true);await a.query('commit');assert.equal((await competing).code,'PT409');checks.push('independent backend preference CAS: lock wait then PT409, no overwrite');
 const first={action:'feedback',requestId:randomUUID(),problemId:pid,kind:'too_easy'},second={...first,requestId:randomUUID(),kind:'too_hard'};
 await begin(a,alice);await a.query('select public.learning_write($1::jsonb)',[JSON.stringify(first)]);
 const later=write(b,alice,second);assert.equal(await blocked(admin,pids[1]),true);await a.query('commit');await later;
 assert.equal((await evidence(c,alice)).feedback[0].kind,'too_hard');await write(a,alice,first);assert.equal((await evidence(c,alice)).feedback[0].kind,'too_hard');
 await write(a,alice,{...first,requestId:randomUUID()});assert.equal((await evidence(c,alice)).feedback[0].kind,'too_easy');
 assert.equal((await admin.query('select count(*)::int n from public.recommendation_feedback where user_id=$1',[alice])).rows[0].n,3);
 checks.push('feedback concurrent append preserves both events; late retry does not resurrect old choice; A/B/A new intent persists');
 const held={...first,requestId:randomUUID()},timed={...second,requestId:randomUUID()};
 await begin(a,alice);await a.query('select public.learning_write($1::jsonb)',[JSON.stringify(held)]);
 await expectCode(()=>asUser(b,alice,async()=>{await b.query("set local statement_timeout='100ms'");return b.query('select public.learning_write($1::jsonb)',[JSON.stringify(timed)]);}), '57014');
 await a.query('commit');await write(b,alice,timed);await write(b,alice,timed);
 assert.equal((await admin.query('select count(*)::int n from public.recommendation_feedback where id=$1',[timed.requestId])).rows[0].n,1);checks.push('real statement timeout rolls back cleanly; same request retries exactly once');
 await expectCode(()=>write(a,alice,{...first,kind:'off_goal'}),'PT409');
 await write(b,bob,body(randomUUID(),0));const eb=await evidence(b,bob);assert.equal(eb.feedback.length,0);assert.equal(eb.sessions.length,0);assert.equal(eb.reviews.length,0);assert.equal((await asUser(b,bob,()=>b.query('select user_id from public.learning_preferences where user_id=$1',[alice]))).rows.length,0);
 for(const table of ['learning_preferences','recommendation_feedback','training_sessions','code_reviews'])await expectCode(()=>asUser(b,bob,()=>b.query(`update public.${table} set ${table==='learning_preferences'?'revision=99':table==='recommendation_feedback'?"kind='too_easy'":table==='training_sessions'?'max_hint_seen=5':"official_verdict='OK'"}`)),'42501');
 await expectCode(()=>write(b,bob,{...body(randomUUID(),1),userId:alice}),'23514');checks.push('two-user read/RLS and mass-assignment/DML forgery isolation');
 await expectCode(()=>asUser(a,alice,()=>a.query("select public.tutor_finish('{}',$1)",['0'.repeat(64)])),'42501');checks.push('unsigned model/hint evidence rejected');
 const sid=(await asUser(a,alice,()=>a.query('select id from public.start_cf_session($1::jsonb)',[JSON.stringify({problemId:pid,requestId:randomUUID()})]))).rows[0].id;
 for(let rev=0;rev<3;rev++)await asUser(a,alice,()=>a.query("select public.tutor_hint($1,'upgrade',$2,$3,null)",[sid,rev,randomUUID()]));
 assert.equal((await evidence(c,alice)).sessions.find(s=>s.id===sid).maxHint,0);
 const tid=randomUUID(),admit=await signed(a,alice,'tutor_reserve',{operation:'reserve',sessionId:sid,requestId:tid,action:'chat',fingerprint:'a'.repeat(64),dailyLimit:100});
 await signed(a,alice,'tutor_finish',{operation:'finish',sessionId:sid,requestId:tid,leaseNonce:admit.leaseNonce,success:true,disclosureLevel:3,userMessage:'[FIXTURE] thought',content:'[FIXTURE] authorized direction',promptVersion:'fixture/m321',thoughtRevision:0,codeRevision:0,usage:[]});
 const confirmation='我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘';
 const reviewId=(await asUser(a,alice,()=>a.query('select public.create_cf_review($1,$2::jsonb) id',[pid,JSON.stringify({sessionId:sid,requestId:randomUUID(),code:'int main(){}',source:'paste',fileName:null,problemUrl:'',statement:'[FIXTURE] constraints',submissionId:null,confirmation})]))).rows[0].id;
 await write(a,alice,body(randomUUID(),1,true));assert.equal((await evidence(c,alice)).reviews.length,0);
 const rrid=randomUUID(),reviewAdmit=await signed(a,alice,'review_reserve',{operation:'review_reserve',reviewId,requestId:rrid,fingerprint:'b'.repeat(64),dailyLimit:100,question:''});
 const hash=(await admin.query('select code_hash from public.code_reviews where id=$1',[reviewId])).rows[0].code_hash;
 const analysis={summary:'[FIXTURE] static review',correctness:'[FIXTURE] no execution',assumptions:'[FIXTURE] unproved',timeComplexity:'O(1)',spaceComplexity:'O(1)',lineAnalysis:[{start:1,end:1,analysis:'[FIXTURE] entry'}],risks:'边界问题（测试固定输出）',improvements:'[FIXTURE]',alternatives:'',transferableKnowledge:'图论、动态规划（固定测试输出，不是该真实题的解法）',revisionQuestions:['[FIXTURE] question'],answer:''};
 await signed(a,alice,'review_finish',{operation:'review_finish',reviewId,requestId:rrid,leaseNonce:reviewAdmit.leaseNonce,codeHash:hash,success:true,analysis,model:'fixture-not-provider',promptVersion:'fixture/m321',usage:[]});
 const authorized=await evidence(c,alice);assert.equal(authorized.reviews[0].id,rrid);assert.equal(authorized.sessions.find(s=>s.id===sid).maxHint,3);assert.equal((await evidence(b,bob)).reviews.length,0);assert.equal((await asUser(b,bob,()=>b.query('select id from public.code_reviews'))).rows.length,0);assert.equal((await asUser(b,bob,()=>b.query('select id from public.review_requests'))).rows.length,0);
 await write(b,alice,body(randomUUID(),2,false));assert.equal((await evidence(c,alice)).reviews.length,0);assert.equal((await evidence(c,alice)).revision,3);assert.equal(authorized.revision,2);checks.push('cross-connection consent revocation suppresses new review evidence; old snapshot revision detected');
 await expectCode(()=>asUser(c,'',()=>c.query('select public.learning_evidence()')),'28000');
 const security=(await admin.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon_execute from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('learning_write','learning_evidence','learning_candidates') order by p.proname")).rows;
 assert.equal(security.length,3);for(const s of security){assert.equal(s.prosecdef,true);assert.deepEqual(s.proconfig,['search_path=""']);assert.equal(s.anon_execute,false);}
 const rls=(await admin.query("select relname,relrowsecurity from pg_class where oid in('public.learning_preferences'::regclass,'public.recommendation_feedback'::regclass,'algopilot_private.learning_receipts'::regclass)")).rows;assert(rls.every(t=>t.relrowsecurity));
 const indexes=(await admin.query("select indexname from pg_indexes where indexname in('sessions_learning_problem','reviews_learning_problem','recommendation_feedback_owner')")).rows;assert.equal(indexes.length,3);checks.push('RLS 3/3, controlled RPC/search_path/anon GRANT 3/3, expected indexes 3/3');
 // Isolated synthetic benchmark history, never production user data.
 await admin.query("insert into public.training_sessions(user_id,problem_id,statement_snapshot,phase,status,started_at,resumed_at,ended_at,outcome,max_hint_seen,create_request_id) select $1,p.id,'[FIXTURE] benchmark history','finished','completed',clock_timestamp()-interval '1 second',null,clock_timestamp(),'solved_self_reported',3,gen_random_uuid() from (select id from public.problems where rating between 1400 and 1800 and id<>$2 order by contest_id,problem_index limit 500) p",[alice,pid]);
 await admin.query('analyze');
 const timings={evidence:[],candidates:[]};const input={min:1400,max:1800,target:1600,themes:[],repeat:false};
 let e,pool;
 for(let i=0;i<12;i++){let start=performance.now();e=await evidence(c,alice);if(i>=2)timings.evidence.push(performance.now()-start);start=performance.now();pool=(await asUser(c,alice,()=>c.query('select public.learning_candidates($1::jsonb) v',[JSON.stringify(input)]))).rows[0].v;if(i>=2)timings.candidates.push(performance.now()-start);}
 const definition=(await admin.query("select pg_get_functiondef('public.learning_candidates(jsonb)'::regprocedure) f")).rows[0].f;
 const inner=definition.match(/with filtered as \([\s\S]*?into n,result from shortlist s;/i)[0].replace('into n,result','').replace(/\bp_query\b/g,'($1::jsonb)').replace(/\buid\b/g,'auth.uid()');
 // EXPLAIN the definer's internal query as its owner, with the same test identity.
 await admin.query('begin');await admin.query("select set_config('request.jwt.claim.sub',$1,true)",[alice]);
 const plan=(await admin.query('explain (analyze,buffers,format json) '+inner,[JSON.stringify(input)])).rows[0]['QUERY PLAN'][0];await admin.query('commit');
 const version=(await admin.query('select version() v')).rows[0].v;
 const report={boundary:'Native isolated PostgreSQL; auth.uid/JWT claims fixture, not hosted Supabase or real JWT validation',postgres:version,independentBackends:new Set(pids).size,migrations:files,checks,security,rls,indexes,catalog:{source,sha256:createHash('sha256').update(raw).digest('hex'),count:problems.length},readWindow:{sessions:e.sessions.length,totalSessions:e.totalSessions,reviews:e.reviews.length},pool:{eligible:pool.total,selected:pool.items.length,coverage:pool.items.length/Math.max(pool.total,1)},timings:Object.fromEntries(Object.entries(timings).map(([k,v])=>[k,{samples:v.length,medianMs:percentile(v,.5),p95Ms:percentile(v,.95)}])),sqlPlan:plan};
 await mkdir(output,{recursive:true});await writeFile(join(output,'isolated-postgres.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,independentBackends:report.independentBackends,catalog:problems.length,timings:report.timings,output:join(output,'isolated-postgres.json')}));
} catch(e) {
 console.error(JSON.stringify({operation:'m321_isolated_validation',code:e.code??e.name,completedChecks:checks,message:e.name==='AssertionError'?e.message:'Isolated validation failed; no production database was contacted.'}));process.exitCode=1;
} finally {
 for(const c of clients)await c.end().catch(()=>{});
 try{await pg.stop();stopped=true;}catch{console.error('Temporary cluster shutdown failed; retain directory for inspection: '+directory);process.exitCode=1;}
 if(stopped)await rm(directory,{recursive:true,force:true});
}
