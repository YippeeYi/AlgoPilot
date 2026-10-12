-- M2.5: independent AC review authorization_event, immutable snapshots and shared AI admission.
begin;
-- Existing sessions retain their timing behavior. New UI sessions may start without timing.
alter table public.training_sessions add column timer_enabled boolean not null default true;
create function public.create_untimed_session(p_problem_id uuid,p_statement text,p_mode text,p_request_id uuid) returns setof public.training_sessions
language plpgsql security definer set search_path='' as $$
declare s public.training_sessions; existed boolean;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,17));
  existed := exists(select 1 from public.training_sessions where user_id=auth.uid() and create_request_id=p_request_id);
  select * into s from public.create_training_session(p_problem_id,p_statement,p_mode,p_request_id);
  if existed and s.timer_enabled then raise exception 'request conflict' using errcode='PT409'; end if;
  if not existed then
    update public.training_sessions set timer_enabled=false,status='paused',resumed_at=null,active_seconds=0,state_revision=1 where id=s.id returning * into s;
  end if;
  return next s;
end $$;
revoke all on function public.create_untimed_session(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_untimed_session(uuid,text,text,uuid) to authenticated;
create table public.code_reviews (
  id uuid primary key, user_id uuid not null references auth.users(id),
  session_id uuid not null references public.training_sessions(id), problem_id uuid references public.problems(id),
  problem_url text not null default '' check(length(problem_url)<=200),
  statement_snapshot text not null check(length(statement_snapshot)<=64000),
  code_snapshot text not null check(octet_length(code_snapshot) between 1 and 64000 and length(btrim(code_snapshot))>0),
  code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
  source text not null check(source in ('paste','file')), file_name text,
  submission_id text check(submission_id ~ '^[1-9][0-9]{0,17}$'),
  verdict_source text not null default 'user_reported' check(verdict_source='user_reported'),
  official_verdict text check(official_verdict is null), source_match text not null default 'unverified' check(source_match='unverified'),
  authorization_event jsonb not null check(jsonb_typeof(authorization_event)='object'),
  notes text not null default '' check(length(notes)<=16000), revision integer not null default 0 check(revision>=0),
  create_fingerprint text not null, created_at timestamptz not null default clock_timestamp(), edited_at timestamptz,
  check((source='paste' and file_name is null) or (source='file' and file_name is not null and file_name ~* '^[^/\\]+\.(cpp|cc|cxx|txt)$' and length(file_name)<=160 and file_name !~ '[\x01-\x1F\x7F]'))
);
create index code_reviews_owner_history on public.code_reviews(user_id,created_at desc);
create table public.review_requests (
  id uuid primary key, review_id uuid not null references public.code_reviews(id), user_id uuid not null references auth.users(id),
  fingerprint text not null, question text not null check(length(question)<=3000),
  status text not null default 'pending' check(status in ('pending','completed','failed')),
  lease_nonce uuid not null default gen_random_uuid(), lease_until timestamptz not null default clock_timestamp()+interval '180 seconds',
  analysis jsonb, model text, prompt_version text, usage jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default clock_timestamp(), finished_at timestamptz
);
create unique index review_one_pending on public.review_requests(user_id) where status='pending';
create index review_requests_daily on public.review_requests(user_id,created_at);
alter table public.code_reviews enable row level security;
alter table public.review_requests enable row level security;
create policy code_reviews_owner on public.code_reviews for select to authenticated using(user_id=auth.uid());
create policy review_requests_owner on public.review_requests for select to authenticated using(user_id=auth.uid());
revoke all on public.code_reviews,public.review_requests from public,anon,authenticated;
grant select(id,user_id,session_id,problem_id,problem_url,statement_snapshot,code_snapshot,code_hash,source,file_name,submission_id,verdict_source,official_verdict,source_match,authorization_event,notes,revision,created_at,edited_at) on public.code_reviews to authenticated;
grant select(id,review_id,question,analysis,model,prompt_version,created_at,status) on public.review_requests to authenticated;

create function public.create_code_review(p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.training_sessions; r public.code_reviews; fp text; a integer; rid uuid; url text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  if p_input - array['sessionId','requestId','code','source','fileName','problemUrl','statement','submissionId','confirmation'] <> '{}'::jsonb
    or p_input->>'confirmation' is distinct from '我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘'
    or p_input->>'source' not in ('paste','file') or p_input->>'source' is null
    or p_input->>'code' is null or octet_length(p_input->>'code') not between 1 and 64000
    or length(btrim(p_input->>'code'))=0 or p_input->>'code' ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' or position(chr(65533) in p_input->>'code')>0
    or length(coalesce(p_input->>'statement',''))>16000 then raise exception 'invalid input' using errcode='23514'; end if;
  url := coalesce(p_input->>'problemUrl','');
  if url <> '' and url !~ '^https://codeforces\.com/(problemset/problem/[1-9][0-9]*/[A-Z][0-9]?|(contest|gym)/[1-9][0-9]*/problem/[A-Z][0-9]?)$' then raise exception 'invalid URL' using errcode='23514'; end if;
  rid := (p_input->>'requestId')::uuid;
  if rid is null then raise exception 'request required' using errcode='23514'; end if;
  fp := encode(extensions.digest(p_input::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,17));
  select * into r from public.code_reviews where id=rid;
  if found then
    if r.user_id <> auth.uid() then raise exception 'not found' using errcode='P0002'; end if;
    if r.create_fingerprint <> fp then raise exception 'request conflict' using errcode='PT409'; end if;
    return r.id;
  end if;
  if p_input->>'sessionId' is null then
    select * into s from public.create_training_session(null,coalesce(p_input->>'statement',''),'practice',rid);
    select * into s from public.transition_training_session(s.id,'pause',s.state_revision,null);
  else s := public.lock_owned_session((p_input->>'sessionId')::uuid); end if;
  if s.mode='contest' then raise exception 'contest assistance disabled' using errcode='AP001'; end if;
  if exists(select 1 from public.tutor_requests where user_id=auth.uid() and status='pending' and lease_until>clock_timestamp())
    or exists(select 1 from public.review_requests where user_id=auth.uid() and status='pending' and lease_until>clock_timestamp()) then raise exception 'in flight' using errcode='AP004'; end if;
  select allowed_level into a from public.tutor_authorizations where session_id=s.id;
  insert into public.code_reviews(id,user_id,session_id,problem_id,problem_url,statement_snapshot,code_snapshot,code_hash,source,file_name,submission_id,authorization_event,create_fingerprint)
    values(rid,auth.uid(),s.id,s.problem_id,url,coalesce(nullif(p_input->>'statement',''),s.statement_snapshot),p_input->>'code',encode(extensions.digest(p_input->>'code','sha256'),'hex'),p_input->>'source',p_input->>'fileName',p_input->>'submissionId',
      jsonb_build_object('status',s.status,'outcome',s.outcome,'allowedLevel',coalesce(a,0),'maxSeenLevel',s.max_hint_seen,'confirmation',p_input->>'confirmation','authorizedAt',clock_timestamp()),fp);
  -- Entering full review closes the pre-AC tutoring workflow, with explicit self-report.
  if s.status <> 'completed' then perform public.transition_training_session(s.id,'finish',s.state_revision,'solved_self_reported'); end if;
  return rid;
end $$;
create function public.edit_code_review(p_id uuid,p_revision integer,p_notes text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.code_reviews;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  select * into r from public.code_reviews where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'not found' using errcode='P0002'; end if;
  if r.revision<>p_revision then raise exception 'revision conflict' using errcode='PT409'; end if;
  if p_notes is null or length(p_notes)>16000 then raise exception 'invalid notes' using errcode='23514'; end if;
  update public.code_reviews set notes=p_notes,revision=revision+1,edited_at=clock_timestamp() where id=p_id;
end $$;

create function public.review_reserve(p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; r public.code_reviews; q public.review_requests; lim integer; hard integer; used integer; s public.training_sessions;
begin
  v := algopilot_private.verify_tutor(p_payload,p_signature,'review_reserve');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,17));
  select * into r from public.code_reviews where id=(v->>'reviewId')::uuid and user_id=auth.uid();
  if not found then raise exception 'not found' using errcode='P0002'; end if;
  s := public.lock_owned_session(r.session_id);
  if s.mode='contest' then raise exception 'contest assistance disabled' using errcode='AP001'; end if;
  if s.status<>'completed' or r.authorization_event->>'confirmation' is distinct from '我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘' then raise exception 'review not authorized' using errcode='42501'; end if;
  select * into q from public.review_requests where id=(v->>'requestId')::uuid;
  if found then
    if q.user_id<>auth.uid() or q.review_id<>r.id then raise exception 'not found' using errcode='P0002'; end if;
    if q.fingerprint<>v->>'fingerprint' then raise exception 'request conflict' using errcode='PT409'; end if;
    if q.status='completed' then return jsonb_build_object('cached',true); end if;
    if q.status='failed' then raise exception 'use new request' using errcode='AP006'; end if;
    raise exception 'in flight' using errcode='AP004';
  end if;
  update public.tutor_requests set status='failed',error_code='LEASE_EXPIRED',finished_at=clock_timestamp() where user_id=auth.uid() and status='pending' and lease_until<=clock_timestamp();
  update public.review_requests set status='failed',finished_at=clock_timestamp() where user_id=auth.uid() and status='pending' and lease_until<=clock_timestamp();
  if exists(select 1 from public.tutor_requests where user_id=auth.uid() and status='pending') or exists(select 1 from public.review_requests where user_id=auth.uid() and status='pending') then raise exception 'in flight' using errcode='AP004'; end if;
  select daily_hard_limit into hard from algopilot_private.tutor_settings where singleton;
  lim := (v->>'dailyLimit')::integer;
  if lim is null or lim<1 or lim>hard then raise exception 'invalid quota' using errcode='42501'; end if;
  select count(*) into used from (
    select created_at from public.tutor_requests where user_id=auth.uid() union all select created_at from public.review_requests where user_id=auth.uid()
  ) requests where created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  if used>=lim then raise exception 'quota exhausted' using errcode='AP003'; end if;
  insert into public.review_requests(id,review_id,user_id,fingerprint,question) values((v->>'requestId')::uuid,r.id,auth.uid(),v->>'fingerprint',coalesce(v->>'question','')) returning * into q;
  return jsonb_build_object('cached',false,'leaseNonce',q.lease_nonce);
end $$;
create function public.review_finish(p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; q public.review_requests; r public.code_reviews; s public.training_sessions; ok boolean;
begin
  v := algopilot_private.verify_tutor(p_payload,p_signature,'review_finish');
  select * into r from public.code_reviews where id=(v->>'reviewId')::uuid and user_id=auth.uid();
  if not found then raise exception 'not found' using errcode='P0002'; end if;
  s := public.lock_owned_session(r.session_id);
  select * into q from public.review_requests where id=(v->>'requestId')::uuid and review_id=r.id and user_id=auth.uid() for update;
  if not found then raise exception 'not found' using errcode='P0002'; end if;
  if q.lease_nonce is distinct from (v->>'leaseNonce')::uuid then raise exception 'invalid lease' using errcode='42501'; end if;
  if q.status='completed' then return jsonb_build_object('accepted',true); end if;
  -- Late usage can be recorded, but never a late disclosure.
  if jsonb_typeof(v->'usage') is distinct from 'array' or length((v->'usage')::text)>8000 then raise exception 'invalid usage' using errcode='23514'; end if;
  update public.review_requests set usage=v->'usage' where id=q.id;
  ok := coalesce((v->>'success')::boolean,false) and q.status='pending' and q.lease_until>clock_timestamp() and s.mode='practice' and s.status='completed';
  if q.status<>'pending' then return jsonb_build_object('accepted',false); end if;
  if ok and (v->>'codeHash' is distinct from r.code_hash or jsonb_typeof(v->'analysis') is distinct from 'object' or length((v->'analysis')::text)>24000 or length(v->>'model') not between 1 and 200 or length(v->>'promptVersion') not between 1 and 200) then raise exception 'invalid result' using errcode='23514'; end if;
  update public.review_requests set status=case when ok then 'completed' else 'failed' end,
    analysis=case when ok then v->'analysis' end, model=case when ok then v->>'model' end,
    prompt_version=case when ok then v->>'promptVersion' end,finished_at=clock_timestamp() where id=q.id;
  return jsonb_build_object('accepted',ok);
end $$;
revoke all on function public.create_code_review(jsonb),public.edit_code_review(uuid,integer,text),public.review_reserve(text,text),public.review_finish(text,text) from public,anon,authenticated;
grant execute on function public.create_code_review(jsonb),public.edit_code_review(uuid,integer,text),public.review_reserve(text,text),public.review_finish(text,text) to authenticated;

-- Retain the existing Tutor RPC guards and signature; extend its shared admission only.
do $$
declare def text; needle text;
begin
  def := pg_get_functiondef('public.tutor_reserve(text,text)'::regprocedure);
  needle := 'if exists(select 1 from public.tutor_requests where user_id=auth.uid() and status=''pending'') then';
  if position(needle in def)=0 then raise exception 'unexpected tutor admission definition'; end if;
  def := replace(def,needle,'if exists(select 1 from public.tutor_requests where user_id=auth.uid() and status=''pending'') or exists(select 1 from public.review_requests where user_id=auth.uid() and status=''pending'' and lease_until>clock_timestamp()) then');
  needle := 'select count(*) into used from public.tutor_requests where user_id=auth.uid() and created_at >=';
  if position(needle in def)=0 then raise exception 'unexpected quota definition'; end if;
  def := replace(def,needle,'select count(*) into used from (select created_at from public.tutor_requests where user_id=auth.uid() union all select created_at from public.review_requests where user_id=auth.uid()) requests where created_at >=');
  execute def;
  def := pg_get_functiondef('public.tutor_state(uuid)'::regprocedure);
  if position(needle in def)=0 then raise exception 'unexpected state quota definition'; end if;
  execute replace(def,needle,'select count(*) into used from (select created_at from public.tutor_requests where user_id=auth.uid() union all select created_at from public.review_requests where user_id=auth.uid()) requests where created_at >=');
end $$;
commit;
