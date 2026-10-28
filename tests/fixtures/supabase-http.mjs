// E2E 专用 HTTP 契约替身。没有真实邮件、Supabase JWT 验签或数据库 RLS。
// 生产应用完全不包含此脚本；真实 SQL/RLS 由独立 PostgreSQL 测试覆盖。
import {readFileSync} from "node:fs";
import { createServer } from "node:http";
import { randomUUID, createHmac, createHash } from "node:crypto";

const fitRegistry = JSON.parse(readFileSync(new URL('../../src/features/learning/problem-annotations.json', import.meta.url), 'utf8'));
const users = new Map();
const tokens = new Map();
const sessions = new Map();
const problems = new Map();
const thoughts = new Map();
const reviews = new Map();
const reviewRequests = new Map();
const metrics = { auth: 0, data: 0 };
const tutorStates = new Map();
const tutorMessages = new Map();
const tutorRequests = new Map();
const challenges = new Map();
const fixtureSigningSecret = "ab".repeat(32);
const now = () => new Date().toISOString();
function user(email) {
  const entry = {
    id: randomUUID(),
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: now(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: now(),
  };
  users.set(email, entry);
  return entry;
}
user("alice@fixture.test");
user("bob@fixture.test");
function sessionFor(entry) {
  const payload = {
    sub: entry.id,
    aud: "authenticated",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  };
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.fixture-signature`;
  tokens.set(token, entry);
  return {
    access_token: token,
    refresh_token: token,
    expires_in: 3600,
    expires_at: payload.exp,
    token_type: "bearer",
    user: entry,
  };
}
function failure(code, message = "fixture error") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function owned(id, uid) {
  const row = sessions.get(id);
  if (!row || row.user_id !== uid) failure("P0002");
  return row;
}
const plans=new Map(),planItems=new Map(),planReceipts=new Map(),planSessions=new Set();
const learningPrefs=new Map(),learningFeedback=new Map(),learningReceipts=new Map();
const recommendationTrials=new Map();
const cfFixture=JSON.parse(readFileSync(new URL('./cf-problemset.json',import.meta.url),'utf8'));
cfFixture.result.problems.forEach((p,n)=>{const id=`50000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`;const stat=cfFixture.result.problemStatistics.find(s=>s.contestId===p.contestId&&s.index===p.index);problems.set(id,{id,owner_id:null,platform:'codeforces',contest_id:p.contestId,problem_index:p.index,title:p.name,rating:p.rating??null,tags:p.tags??[],statement:null,canonical_url:`https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,solved_count:stat?.solvedCount??null,metadata_synced_at:'2026-10-12T05:22:10.562Z',created_at:'2026-10-12T05:22:10.562Z'});});
function cfProblem(r){return {id:r.id,contestId:r.contest_id,index:r.problem_index,name:r.title,rating:r.rating,tags:r.tags,solvedCount:r.solved_count};}
function rpc(name, p, uid) {
  if(name==='learning_evidence_guard'){if((learningPrefs.get(uid)?.revision??0)!==p.p_revision||p.p_official_revision!==0)failure('PT409');return true;}
  if(name==='record_recommendation_run'){
    const key=createHmac('sha256',fixtureSigningSecret).update('algopilot/cf/v1').digest('hex');
    if(createHmac('sha256',key).update(p.p_payload??'').digest('hex')!==p.p_signature)failure('42501');
    const v=JSON.parse(p.p_payload);if(v.userId!==uid||v.operation!=='recommendation_record'||Date.parse(v.expiresAt)<Date.now())failure('42501');
    const fp=JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k])=>!['expiresAt','userId'].includes(k))));
    const old=[...recommendationTrials.values()].filter(r=>r.userId===uid&&r.runId===v.runId);
    if(old.length){if(old[0].fp!==fp)failure('PT409');return {available:true,items:old.map(r=>({id:r.id,problemId:r.problemId}))};}
    if((learningPrefs.get(uid)?.revision??0)!==v.revision)failure('PT409');
    if(v.problemIds.some(id=>problems.get(id)?.platform!=='codeforces'))failure('23514');
    for(const problemId of v.problemIds){const r={id:randomUUID(),userId:uid,runId:v.runId,problemId,issuedAt:now(),source:{focus:v.focus,baseline:v.baseline,revision:v.revision,repeat:v.repeat},fp,skippedAt:null,chosenAt:null,sessionId:null,originated:false};recommendationTrials.set(r.id,r);}
    return {available:true,items:[...recommendationTrials.values()].filter(r=>r.userId===uid&&r.runId===v.runId).map(r=>({id:r.id,problemId:r.problemId}))};
  }
  if(name==='recommendation_choice'){
    const r=recommendationTrials.get(p.p_id);if(!r||r.userId!==uid)failure('P0002');
    if(p.p_action==='skip'){if(r.sessionId)failure('PT409');r.skippedAt??=now();return {sessionId:null,resumed:false};}
    if(p.p_action!=='start')failure('23514');if(r.sessionId)return {sessionId:r.sessionId,resumed:true};
    if((learningPrefs.get(uid)?.revision??0)!==r.source.revision)failure('PT409');
    if(!r.source.repeat&&([...sessions.values()].some(s=>s.user_id===uid&&s.problem_id===r.problemId&&s.outcome==='solved_self_reported')||[...reviews.values()].some(s=>s.user_id===uid&&s.problem_id===r.problemId)))failure('PT409');
    let s=[...sessions.values()].filter(s=>s.user_id===uid&&s.problem_id===r.problemId&&s.mode==='practice'&&s.status!=='completed').sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id))[0];
    const resumed=Boolean(s);if(!s)[s]=rpc('start_cf_session',{p_input:{problemId:r.problemId,requestId:r.id,mode:'practice',timerEnabled:false}},uid);
    r.sessionId=s.id;r.chosenAt=now();r.originated=!resumed;return {sessionId:s.id,resumed};
  }
  if(name==='recommendation_training_evidence'){
    if(!['7','30','90','all'].includes(p.p_window))failure('23514');if(p.p_session_id)owned(p.p_session_id,uid);
    const since=p.p_window==='all'?-Infinity:Date.now()-Number(p.p_window)*86400000;
    const rows=[...recommendationTrials.values()].filter(r=>r.userId===uid&&Date.parse(r.issuedAt)>since&&(!p.p_session_id||r.sessionId===p.p_session_id)).sort((a,b)=>b.issuedAt.localeCompare(a.issuedAt)||a.id.localeCompare(b.id));
    return {available:true,total:rows.length,asOf:now(),revision:learningPrefs.get(uid)?.revision??0,officialRevision:0,items:rows.slice(0,200).map(r=>{const s=r.sessionId?sessions.get(r.sessionId):null,problem=problems.get(r.problemId);return {id:r.id,runId:r.runId,problemId:r.problemId,contestId:problem.contest_id,index:problem.problem_index,issuedAt:r.issuedAt,focus:r.source.focus,baseline:r.source.baseline,skippedAt:r.skippedAt,chosenAt:r.chosenAt,sessionId:r.sessionId,originated:r.originated,sessionStatus:s?.status??null,outcome:s?.outcome??null,endedAt:s?.ended_at??null,official:'disabled',officialSyncedAt:null};})};
  }
  if(name==='learning_write'){
    const v=p.p_input,key=`${uid}/${v.requestId}`,fp=JSON.stringify(v),old=learningReceipts.get(key);
    if(old){if(old!==fp)failure('PT409');return {saved:true};}
    if(v.action==='preferences'){
      const existing=learningPrefs.get(uid);if((existing?.revision??0)!==v.revision)failure('PT409');
      learningPrefs.set(uid,{preferences:v.preferences,revision:(existing?.revision??0)+1});
    }else if(v.action==='feedback'){
      if(problems.get(v.problemId)?.platform!=='codeforces')failure('P0002');
      learningFeedback.set(v.requestId,{id:v.requestId,user_id:uid,problemId:v.problemId,kind:v.kind,createdAt:now()});
    }else failure('23514');
    learningReceipts.set(key,fp);return {saved:true};
  }
  if(name==='learning_evidence'){
    const pref=learningPrefs.get(uid),all=[...sessions.values()].filter(s=>s.user_id===uid).sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
    const lastReviews=new Map();
    if(pref?.preferences.reviewEvidence)for(const r of [...reviewRequests.values()].filter(r=>r.user_id===uid&&r.status==='completed'&&r.analysis).sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id))){
      const cr=reviews.get(r.review_id);if(cr?.user_id!==uid)continue;const key=cr.problem_id??cr.id;if(!lastReviews.has(key))lastReviews.set(key,{id:r.id,reviewId:r.review_id,problemId:cr.problem_id,knowledge:r.analysis.transferableKnowledge??'',risks:r.analysis.risks??'',createdAt:r.created_at});
    }
    const feedback=new Map();for(const f of [...learningFeedback.values()].filter(f=>f.user_id===uid).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)))if(!feedback.has(f.problemId))feedback.set(f.problemId,{id:f.id,problemId:f.problemId,kind:f.kind,rating:problems.get(f.problemId)?.rating??null,createdAt:f.createdAt});
    return {preferences:pref?.preferences??null,revision:pref?.revision??0,totalSessions:all.length,sessions:all.slice(0,500).map(s=>({id:s.id,problemId:s.problem_id,status:s.status,outcome:s.outcome,rating:problems.get(s.problem_id)?.rating??null,tags:s.status==='completed'&&(s.outcome==='solved_self_reported'||tutorStates.get(s.id)?.maxSeenLevel===5)?(problems.get(s.problem_id)?.tags??[]):[],maxHint:tutorStates.get(s.id)?.maxSeenLevel??0,externalEditorial:null,thoughtCount:[...thoughts.values()].filter(t=>t.session_id===s.id&&t.content.trim()).length,createdAt:s.created_at})),reviews:[...lastReviews.values()].slice(0,200),feedback:[...feedback.values()].slice(0,100)};
  }
  if(name==='learning_candidates'){
    const q=p.p_query;
    const rows=[...problems.values()].filter(r=>r.platform==='codeforces'&&!r.tags.includes('interactive')&&!fitRegistry.contestRestrictions.some(f=>f.contestId===r.contest_id)&&r.rating!==null&&r.rating>=q.min&&r.rating<=q.max&&(!q.themes.length||q.themes.some(t=>r.tags.includes(t)))&&(q.repeat||![...sessions.values()].some(s=>s.user_id===uid&&s.problem_id===r.id&&s.outcome==='solved_self_reported')&&![...reviews.values()].some(cr=>cr.user_id===uid&&cr.problem_id===r.id)));
    return {policyVersion:fitRegistry.suitabilityVersion,total:rows.length,items:rows.sort((a,b)=>Math.abs(a.rating-q.target)-Math.abs(b.rating-q.target)||b.contest_id-a.contest_id||a.problem_index.localeCompare(b.problem_index)).slice(0,600).map(r=>({...cfProblem(r),inPlan:[...planItems.values()].some(i=>i.user_id===uid&&i.problem_id===r.id&&!plans.get(i.plan_id)?.archived),practiced:[...sessions.values()].some(s=>s.user_id===uid&&s.problem_id===r.id)}))};
  }
  if(name==='cf_catalog'){
    const q=p.p_query;let rows=[...problems.values()].filter(r=>r.platform==='codeforces');const tags=(q.tags??'').split(';').filter(Boolean);
    const keys=new Set(rows.flatMap(r=>r.tags));rows=rows.filter(r=>(!q.q || (/^[1-9]\d*[A-Z][A-Z0-9]*$/i.test(q.q)?`${r.contest_id}${r.problem_index}`.toUpperCase()===q.q.toUpperCase():r.title.toLowerCase().includes(q.q.toLowerCase())))&&(q.min===undefined || (r.rating!==null&&r.rating>=q.min))&&(q.max===undefined || (r.rating!==null&&r.rating<=q.max))&&tags.every(t=>r.tags.includes(t)));
    rows.sort((a,b)=>q.sort==='solved_desc'?(b.solved_count??-1)-(a.solved_count??-1):q.sort==='solved_asc'?(a.solved_count??Infinity)-(b.solved_count??Infinity):b.contest_id-a.contest_id||a.problem_index.localeCompare(b.problem_index));
    return {items:rows.slice(q.offset??0,(q.offset??0)+(q.limit??30)).map(cfProblem),total:rows.length,syncedAt:'2026-10-12T05:22:10.562Z',stale:false,tags:[...keys].sort()};
  }
  if(name==='cf_sync')return {acquired:false};
  if(name==='plan_detail'){
    const plan=plans.get(p.p_id);if(!plan||plan.user_id!==uid)failure('P0002');
    return {plan,items:[...planItems.values()].filter(i=>i.plan_id===plan.id).sort((a,b)=>a.position-b.position).map(i=>({...i,problem:cfProblem(problems.get(i.problem_id)),officialStatus:'not_synced',sessions:[...sessions.values()].filter(s=>s.user_id===uid&&s.problem_id===i.problem_id).map(s=>({id:s.id,status:s.status,outcome:s.outcome,created_at:s.created_at,linked:planSessions.has(`${i.id}/${s.id}`)})),reviews:[...reviews.values()].filter(r=>r.user_id===uid&&r.problem_id===i.problem_id).map(r=>({id:r.id,session_id:r.session_id,created_at:r.created_at,analyzed:[...reviewRequests.values()].some(rr=>rr.review_id===r.id&&rr.status==='completed')}))}))};
  }
  if(name==='plan_write'){
    const v=p.p_input,fp=JSON.stringify({id:p.p_id,v}),key=`${uid}/${v.requestId}`,old=planReceipts.get(key);if(old){if(old.fp!==fp)failure('PT409');return old.result;}
    let plan=plans.get(p.p_id);if(v.action==='create'){plan={id:p.p_id,user_id:uid,name:v.name,description:v.description,archived:false,revision:0,created_at:now(),updated_at:now()};plans.set(plan.id,plan);}else{if(!plan||plan.user_id!==uid)failure('P0002');if(plan.revision!==v.revision)failure('PT409');if(plan.archived&&!['edit','delete'].includes(v.action))failure('23514');}
    if(['create','add'].includes(v.action))for(const pid of v.problemIds){if(problems.get(pid)?.platform!=='codeforces')failure('23514');if([...planItems.values()].some(i=>i.plan_id===plan.id&&i.problem_id===pid))continue;const row={id:randomUUID(),plan_id:plan.id,user_id:uid,problem_id:pid,position:Math.max(-1,...[...planItems.values()].filter(i=>i.plan_id===plan.id).map(i=>i.position))+1,manual_status:'planned'};planItems.set(row.id,row);}
    if(['remove','status'].includes(v.action)){const item=planItems.get(v.itemId);if(!item||item.plan_id!==plan.id)failure('P0002');if(v.action==='remove')planItems.delete(item.id);else item.manual_status=v.status;}
    if(v.action==='reorder'){const ids=[...planItems.values()].filter(i=>i.plan_id===plan.id).map(i=>i.id);if(ids.length!==v.itemIds.length||new Set(v.itemIds).size!==ids.length||v.itemIds.some(x=>!ids.includes(x)))failure('23514');v.itemIds.forEach((id,n)=>{planItems.get(id).position=n;});}
    if(v.action==='edit'){plan.name=v.name;plan.description=v.description;plan.archived=v.archived;}
    if(v.action==='delete'){plans.delete(plan.id);for(const i of planItems.values())if(i.plan_id===plan.id)planItems.delete(i.id);}else if(v.action!=='create'){plan.revision++;plan.updated_at=now();}
    const result={id:plan.id,deleted:v.action==='delete'};planReceipts.set(key,{fp,result});return result;
  }
  if(name==='start_cf_session'){
    const v=p.p_input,fp=JSON.stringify(v),key=`start/${uid}/${v.requestId}`,old=planReceipts.get(key);if(old){if(old.fp!==fp)failure('PT409');return [owned(old.result.id,uid)];}
    let pid=v.problemId, item;if(v.itemId){item=planItems.get(v.itemId);if(!item||item.user_id!==uid)failure('P0002');if(plans.get(item.plan_id)?.archived)failure('23514');pid=item.problem_id;}
    if(problems.get(pid)?.platform!=='codeforces')failure('23514');
    let s=item&&!v.newSession?[...sessions.values()].find(s=>s.user_id===uid&&s.status!=='completed'&&s.mode===(v.mode??'practice')&&planSessions.has(`${item.id}/${s.id}`)):null;
    if(!s)[s]=rpc(v.timerEnabled?'create_training_session':'create_untimed_session',{p_problem_id:pid,p_mode:v.mode??'practice',p_statement:v.statementSnapshot??'',p_request_id:v.requestId},uid);
    if(item)planSessions.add(`${item.id}/${s.id}`);planReceipts.set(key,{fp,result:{id:s.id}});return [s];
  }
  if(name==='create_cf_review'){
    const v={...p.p_input},problem=problems.get(p.p_problem_id);if(problem?.platform!=='codeforces')failure('23514');if(!v.sessionId)v.sessionId=rpc('start_cf_session',{p_input:{problemId:problem.id,requestId:v.requestId}},uid)[0].id;
    if(owned(v.sessionId,uid).problem_id!==problem.id)failure('23514');v.problemUrl=problem.canonical_url;return rpc('create_code_review',{p_input:v},uid);
  }
  if(name==='supplement_cf_context'){
    const s=owned(p.p_id,uid);return rpc('append_training_thought',{p_id:s.id,p_content:s.thought_draft+'\n【用户补充的题面上下文】\n'+p.p_content,p_expected_revision:p.p_revision,p_request_id:p.p_request_id},uid);
  }

  if(name === "create_untimed_session") {
    const previous=[...sessions.values()].find(s=>s.user_id===uid && s.create_request_id===p.p_request_id);
    const [row]=rpc("create_training_session",p,uid);
    if(!previous){row.status="paused";row.resumed_at=null;row.active_seconds=0;row.state_revision=1;}
    return [row];
  }
  if(name === "create_code_review") {
    const v=p.p_input;
    const fp=JSON.stringify(v);
    const old=reviews.get(v.requestId);
    if(old){if(old.user_id!==uid)failure("P0002");if(old.fingerprint!==fp)failure("PT409");return old.id;}
    if(v.confirmation!=="我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘")failure("42501");
    const s=v.sessionId?owned(v.sessionId,uid):rpc("create_training_session",{p_problem_id:null,p_statement:v.statement,p_mode:"practice",p_request_id:v.requestId},uid)[0];
    if(s.mode==="contest")failure("AP001");
    const state=tutorStates.get(s.id)??{allowedLevel:0,maxSeenLevel:0};
    const row={id:v.requestId,user_id:uid,session_id:s.id,problem_id:s.problem_id,problem_url:v.problemUrl,statement_snapshot:v.statement||s.statement_snapshot,code_snapshot:v.code,code_hash:createHash("sha256").update(v.code).digest("hex"),source:v.source,file_name:v.fileName,submission_id:v.submissionId,verdict_source:"user_reported",official_verdict:null,source_match:"unverified",authorization_event:{status:s.status,outcome:s.outcome,allowedLevel:state.allowedLevel,maxSeenLevel:state.maxSeenLevel,confirmation:v.confirmation,authorizedAt:now()},notes:"",revision:0,created_at:now(),edited_at:null,fingerprint:fp};
    reviews.set(row.id,row);
    if(s.status!=="completed")rpc("transition_training_session",{p_id:s.id,p_action:"finish",p_expected_revision:s.state_revision,p_outcome:"solved_self_reported"},uid);
    return row.id;
  }
  if(name === "edit_code_review") {
    const r=reviews.get(p.p_id);if(!r || r.user_id!==uid)failure("P0002");
    if(r.revision!==p.p_revision)failure("PT409");r.notes=p.p_notes;r.revision++;r.edited_at=now();return null;
  }
  if(name === "review_reserve" || name === "review_finish") {
    if(createHmac("sha256",fixtureSigningSecret).update(p.p_payload).digest("hex")!==p.p_signature)failure("42501");
    const v=JSON.parse(p.p_payload);if(v.userId!==uid || Date.parse(v.expiresAt)<Date.now())failure("42501");
    const r=reviews.get(v.reviewId);if(!r || r.user_id!==uid)failure("P0002");
    if(name === "review_reserve"){
      const old=reviewRequests.get(v.requestId);
      if(old){if(old.fingerprint!==v.fingerprint)failure("PT409");if(old.status==="completed")return {cached:true};failure(old.status==="pending"?"AP004":"AP006");}
      const all=[...tutorRequests.values(),...reviewRequests.values()].filter(x=>x.userId===uid);
      if(all.some(x=>x.status==="pending"))failure("AP004");if(all.length>=v.dailyLimit)failure("AP003");
      const q={...v,id:v.requestId,review_id:r.id,user_id:uid,status:"pending",leaseNonce:randomUUID(),created_at:now()};reviewRequests.set(q.id,q);return {cached:false,leaseNonce:q.leaseNonce};
    }
    const q=reviewRequests.get(v.requestId);if(!q || q.leaseNonce!==v.leaseNonce)failure("42501");if(q.status==="completed")return {accepted:true};
    q.status=v.success?"completed":"failed";if(v.success){q.analysis=v.analysis;q.model=v.model;q.prompt_version=v.promptVersion;}return {accepted:v.success};
  }
  if (name === "tutor_reserve" || name === "tutor_finish") {
    if (
      createHmac("sha256", fixtureSigningSecret)
        .update(p.p_payload)
        .digest("hex") !== p.p_signature
    )
      failure("42501");
    const v = JSON.parse(p.p_payload);
    if (v.userId !== uid || Date.parse(v.expiresAt) < Date.now())
      failure("42501");
    const row = owned(v.sessionId, uid);
    const state = tutorStates.get(row.id) ?? {
      allowedLevel: 0,
      maxSeenLevel: 0,
      revision: 0,
    };
    tutorStates.set(row.id, state);
    if (name === "tutor_reserve") {
      if (row.mode === "contest") failure("AP001");
      if (row.status === "completed") failure("AP002");
      const old = tutorRequests.get(v.requestId);
      if (old) {
        if (old.fingerprint !== v.fingerprint) failure("PT409");
        if (old.status === "completed")
          return { cached: true, requestId: v.requestId };
        failure(old.status === "pending" ? "AP004" : "AP006");
      }
      const requests = [...tutorRequests.values()].filter(
        (r) => r.userId === uid,
      );
      if ([...reviewRequests.values()].some(r=>r.user_id===uid && r.status==="pending") || requests.some((r) => r.status === "pending")) failure("AP004");
      if (requests.length + [...reviewRequests.values()].filter(r=>r.user_id===uid).length >= v.dailyLimit) failure("AP003");
      if (v.action === "explain" && state.allowedLevel !== 5) failure("AP007");
      const r = {
        ...v,
        leaseNonce: randomUUID(),
        allowedLevel: state.allowedLevel,
        status: "pending",
      };
      tutorRequests.set(v.requestId, r);
      return {
        cached: false,
        requestId: v.requestId,
        leaseNonce: r.leaseNonce,
        allowedLevel: r.allowedLevel,
      };
    }
    const r = tutorRequests.get(v.requestId);
    if (!r || r.leaseNonce !== v.leaseNonce) failure("42501");
    if (r.status === "completed") return { accepted: true };
    const accepted =
      v.success && row.status !== "completed" && row.mode !== "contest";
    if (accepted) {
      for (const role of ["user", "assistant"]) {
        const id = randomUUID();
        tutorMessages.set(id, {
          id,
          session_id: row.id,
          request_id: v.requestId,
          role,
          ordinal:
            [...tutorMessages.values()].filter((m) => m.session_id === row.id)
              .length + 1,
          action: r.action,
          content: role === "user" ? v.userMessage : v.content,
          disclosure_level: role === "user" ? 0 : v.disclosureLevel,
          verification:
            role === "assistant" && r.action === "counterexample"
              ? "unverified_candidate"
              : "not_applicable",
          prompt_version: v.promptVersion,
          thought_revision: v.thoughtRevision,
          code_revision: v.codeRevision,
          created_at: now(),
        });
      }
      state.maxSeenLevel = Math.max(state.maxSeenLevel, v.disclosureLevel);
    }
    r.status = accepted ? "completed" : "failed";
    return { accepted };
  }
  if (name === "tutor_state" || name === "tutor_hint") {
    const row = owned(p.p_id, uid);
    const state = tutorStates.get(row.id) ?? {
      allowedLevel: 0,
      maxSeenLevel: 0,
      revision: 0,
    };
    tutorStates.set(row.id, state);
    if (name === "tutor_state")
      return {
        ...state,
        used: [...tutorRequests.values()].filter((r) => r.userId === uid)
          .length,
      };
    if (row.mode === "contest") failure("AP001");
    if (row.status === "completed") failure("AP002");
    if (state.revision !== p.p_revision) failure("PT409");
    if (p.p_operation === "upgrade" && state.allowedLevel < 4) {
      state.allowedLevel++;
      state.revision++;
      return state;
    }
    if (p.p_operation === "begin_l5" && state.allowedLevel === 4) {
      const id = randomUUID();
      const c = {
        id,
        userId: uid,
        sessionId: row.id,
        requestId: p.p_request_id,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        consumed: false,
      };
      challenges.set(id, c);
      return { ...state, challengeId: id, expiresAt: c.expiresAt };
    }
    if (p.p_operation === "confirm_l5" && state.allowedLevel === 4) {
      const c = challenges.get(p.p_challenge);
      if (
        !c ||
        c.userId !== uid ||
        c.sessionId !== row.id ||
        c.requestId !== p.p_request_id ||
        c.consumed ||
        Date.parse(c.expiresAt) < Date.now()
      )
        failure("AP005");
      c.consumed = true;
      state.allowedLevel = 5;
      state.revision++;
      return state;
    }
    failure("23514");
  }
  if (name === "create_custom_problem") {
    const old = [...problems.values()].find(
      (row) => row.owner_id === uid && row.request_id === p.p_request_id,
    );
    if (old) {
      if (old.title !== p.p_title || old.statement !== p.p_statement)
        failure("PT409");
      return [old];
    }
    const row = {
      id: randomUUID(),
      owner_id: uid,
      platform: "custom",
      title: p.p_title,
      statement: p.p_statement,
      rating: null,
      created_at: now(),
      request_id: p.p_request_id,
    };
    problems.set(row.id, row);
    return [row];
  }
  if (name === "create_training_session") {
    const problem = p.p_problem_id ? problems.get(p.p_problem_id) : null;
    if (p.p_problem_id && (!problem || (problem.platform!=="codeforces" && problem.owner_id !== uid)))
      failure("P0002");
    const old = [...sessions.values()].find(
      (row) => row.user_id === uid && row.create_request_id === p.p_request_id,
    );
    if (old) return [old];
    const timestamp = now();
    const row = {
      id: randomUUID(),
      user_id: uid,
      problem_id: p.p_problem_id,
      statement_snapshot: p.p_statement ?? problem?.statement ?? "",
      mode: p.p_mode,
      phase: "thinking",
      status: "active",
      started_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
      active_seconds: 0,
      resumed_at: timestamp,
      ended_at: null,
      state_revision: 0,
      code_draft: "",
      code_revision: 0,
      thought_draft: "",
      thought_revision: 0,
      outcome: null,
      create_request_id: p.p_request_id,
    };
    sessions.set(row.id, row);
    return [row];
  }
  const row = owned(p.p_id, uid);
  if (name === "transition_training_session") {
    const target = { pause: "paused", resume: "active", finish: "completed" }[
      p.p_action
    ];
    if (row.status === "completed") {
      if (
        p.p_action === "finish" &&
        row.outcome === (p.p_outcome ?? "not_recorded")
      )
        return [row];
      failure("23514");
    }
    if (row.status === target) return [row];
    if (row.state_revision !== p.p_expected_revision) failure("PT409");
    if (row.status === "active")
      row.active_seconds += Math.max(
        0,
        Math.floor((Date.now() - Date.parse(row.resumed_at)) / 1000),
      );
    row.resumed_at = target === "active" ? now() : null;
    row.status = target;
    row.state_revision++;
    row.updated_at = now();
    if (target === "completed") {
      row.ended_at = now();
      row.phase = "finished";
      row.outcome = p.p_outcome ?? "not_recorded";
    }
    return [row];
  }
  if (name === "save_training_draft") {
    if (row.status === "completed") failure("23514");
    const revision = `${p.p_kind}_revision`;
    const draft = `${p.p_kind}_draft`;
    if (
      row[draft] === p.p_content &&
      [p.p_expected_revision, p.p_expected_revision + 1].includes(row[revision])
    )
      return [row];
    if (row[revision] !== p.p_expected_revision) failure("PT409");
    row[draft] = p.p_content;
    row[revision]++;
    row.updated_at = now();
    return [row];
  }
  if (name === "append_training_thought") {
    const old = [...thoughts.values()].find(
      (v) => v.session_id === row.id && v.request_id === p.p_request_id,
    );
    if (old) {
      if (old.content !== p.p_content) failure("PT409");
      return { session: row, thought: old };
    }
    if (row.status === "completed") failure("23514");
    if (row.thought_revision !== p.p_expected_revision) failure("PT409");
    const version = {
      id: randomUUID(),
      session_id: row.id,
      version:
        [...thoughts.values()].filter((v) => v.session_id === row.id).length +
        1,
      content: p.p_content,
      created_at: now(),
      request_id: p.p_request_id,
    };
    thoughts.set(version.id, version);
    row.thought_draft = p.p_content;
    row.thought_revision++;
    return { session: row, thought: version };
  }
  failure("P0002");
}
function select(url, uid) {
  const table = url.pathname.split("/").at(-1);
  let rows =
    table === "tutor_requests" ? [...tutorRequests.values()].filter(r=>r.userId===uid).map(r=>({id:r.requestId,user_id:r.userId,session_id:r.sessionId,created_at:"2026-10-27T00:00:00Z"})) : table === "learning_preferences" ? (learningPrefs.has(uid)?[{user_id:uid,...learningPrefs.get(uid)}]:[]) : table === "training_plans" ? [...plans.values()].filter(r=>r.user_id===uid) : table === "code_reviews" ? [...reviews.values()].filter(r=>r.user_id===uid) : table === "review_requests" ? [...reviewRequests.values()].filter(r=>r.user_id===uid) : table === "training_sessions"
      ? [...sessions.values()].filter((row) => row.user_id === uid)
      : table === "problems"
        ? [...problems.values()].filter((row) => (row.platform==="codeforces" || row.owner_id === uid))
        : table === "tutor_messages"
          ? [...tutorMessages.values()].filter(
              (row) => sessions.get(row.session_id)?.user_id === uid,
            )
          : [...thoughts.values()].filter(
              (row) => sessions.get(row.session_id)?.user_id === uid,
            );
  for (const [key, value] of url.searchParams)
    if (value.startsWith("lt."))
      rows = rows.filter((row) => row[key] < value.slice(3));
    else if (value.startsWith("eq."))
      rows = rows.filter((row) => row[key] === value.slice(3));
  rows.sort((a, b) =>
    table === "tutor_messages"
      ? b.ordinal - a.ordinal
      : table === "thought_snapshots"
        ? b.version - a.version
        : b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
  );
  rows = rows.slice(
    Number(url.searchParams.get("offset") ?? 0),
    Number(url.searchParams.get("offset") ?? 0) +
      Number(url.searchParams.get("limit") ?? 100),
  );
  const fields = url.searchParams.get("select")?.split(",");
  return fields
    ? rows.map((row) =>
        Object.fromEntries(fields.map((field) => [field, row[field]])),
      )
    : rows;
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:54001");
  response.setHeader("Content-Type", "application/json");
  const send = (status, value) => {
    response.statusCode = status;
    response.end(value === undefined ? "" : JSON.stringify(value));
  };
  if (url.pathname === "/health") return send(200, { ready: true });
  if (url.pathname === "/metrics") return send(200, metrics);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString())
    : {};
  const token = request.headers.authorization?.replace(/^Bearer /, "");
  const entry = tokens.get(token);
  try {
    if (url.pathname.startsWith("/auth/")) {
      metrics.auth++;
      if (url.pathname.endsWith("/token")) {
        const target = body.refresh_token
          ? tokens.get(body.refresh_token)
          : users.get(body.email);
        if (
          !target?.email_confirmed_at ||
          (!body.refresh_token && body.password !== "Fixture-password-123")
        )
          return send(400, {
            code: "invalid_credentials",
            msg: "Invalid login credentials",
          });
        return send(200, sessionFor(target));
      }
      if (url.pathname.endsWith("/signup")) {
        const target = user(body.email);
        target.email_confirmed_at = null;
        return send(200, target);
      }
      if (url.pathname.endsWith("/verify")) {
        const target = users.get(body.token_hash.replace("confirm:", ""));
        if (!target) return send(403, { msg: "Invalid confirmation" });
        target.email_confirmed_at = now();
        return send(200, sessionFor(target));
      }
      if (!entry) return send(401, { code: "bad_jwt", msg: "Invalid token" });
      if (url.pathname.endsWith("/user")) return send(200, entry);
      if (url.pathname.endsWith("/logout")) {
        tokens.delete(token);
        return send(204);
      }
    }
    if (url.pathname.startsWith("/rest/")) {
      metrics.data++;
      if (!entry) return send(401, { code: "42501", message: "Unauthorized" });
      if (url.pathname.includes("/rpc/"))
        return send(200, rpc(url.pathname.split("/").at(-1), body, entry.id));
      return send(200, select(url, entry.id));
    }
    send(404, { message: "Not found" });
  } catch (error) {
    send(error.code === "P0002" ? 404 : error.code === "PT409" ? 409 : 400, {
      code: error.code ?? "XX000",
      message: "fixture operation rejected",
    });
  }
});
server.listen(54001, "127.0.0.1");
