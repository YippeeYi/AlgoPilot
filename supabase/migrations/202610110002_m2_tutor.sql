-- M2: authenticated user JWT + server HMAC attestation, never service-role CRUD.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists algopilot_private;
revoke all on schema algopilot_private from public, anon, authenticated;
create table algopilot_private.tutor_settings (
  singleton boolean primary key default true check(singleton),
  signing_secret text not null check(signing_secret ~ '^[a-fA-F0-9]{64,128}$'),
  daily_hard_limit integer not null default 100 check(daily_hard_limit between 1 and 1000)
);
alter table algopilot_private.tutor_settings enable row level security;
revoke all on algopilot_private.tutor_settings from public, anon, authenticated;
-- Provision the secret separately using the administrator SQL editor; no embedded key.
create table public.tutor_authorizations (
  session_id uuid primary key references public.training_sessions(id) on delete cascade,
  allowed_level smallint not null default 0 check(allowed_level between 0 and 5),
  revision integer not null default 0 check(revision >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.tutor_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  fingerprint text not null check(length(fingerprint) = 64),
  context_evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(context_evidence)='object' and length(context_evidence::text)<=100000),
  action text not null check(action in ('chat','hint','validate','counterexample','complexity','debug','explain')),
  allowed_level smallint not null check(allowed_level between 0 and 5),
  status text not null default 'pending' check(status in ('pending','completed','failed')),
  lease_nonce uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default clock_timestamp() + interval '180 seconds',
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  check((status = 'pending' and finished_at is null) or (status <> 'pending' and finished_at is not null))
);
create index tutor_requests_daily on public.tutor_requests(user_id, created_at);
create unique index tutor_requests_one_pending on public.tutor_requests(user_id) where status = 'pending';
create table public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  request_id uuid not null references public.tutor_requests(id) on delete cascade,
  ordinal integer not null check(ordinal > 0),
  role text not null check(role in ('user','assistant')),
  action text not null check(action in ('chat','hint','validate','counterexample','complexity','debug','explain')),
  content text not null check(length(content) between 1 and 24000),
  disclosure_level smallint not null check(disclosure_level between 0 and 5),
  verification text not null check(verification in ('not_applicable','unverified_candidate')),
  prompt_version text not null,
  thought_revision integer not null check(thought_revision >= 0),
  code_revision integer not null check(code_revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique(session_id, ordinal),
  unique(request_id, role)
);
create index tutor_messages_history on public.tutor_messages(session_id, ordinal desc);
create table public.hint_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  request_id uuid not null,
  kind text not null check(kind in ('authorization','l5_challenge','disclosure','full_reveal')),
  level smallint not null check(level between 0 and 5),
  created_at timestamptz not null default clock_timestamp(),
  unique(session_id, request_id, kind)
);
create index hint_events_history on public.hint_events(session_id, created_at);
create table public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.tutor_requests(id) on delete cascade,
  attempt smallint not null check(attempt between 1 and 2),
  provider text not null check(provider = 'openai-compatible'),
  model text not null check(length(model) between 1 and 200),
  input_tokens integer check(input_tokens >= 0),
  output_tokens integer check(output_tokens >= 0),
  total_tokens integer check(total_tokens >= 0),
  duration_ms integer not null check(duration_ms >= 0),
  status text not null check(status in ('success','rejected','timeout','error')),
  cost_usd numeric(14,8) check(cost_usd >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique(request_id, attempt),
  check((input_tokens is null and output_tokens is null and total_tokens is null) or
    (input_tokens is not null and output_tokens is not null and total_tokens = input_tokens + output_tokens))
);
create table algopilot_private.l5_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  request_id uuid not null unique,
  expires_at timestamptz not null default clock_timestamp() + interval '5 minutes',
  consumed_at timestamptz
);
alter table algopilot_private.l5_challenges enable row level security;
revoke all on algopilot_private.l5_challenges from public, anon, authenticated;

alter table public.tutor_authorizations enable row level security;
alter table public.tutor_requests enable row level security;
alter table public.tutor_messages enable row level security;
alter table public.hint_events enable row level security;
alter table public.llm_usage enable row level security;
create policy tutor_authorizations_owner on public.tutor_authorizations for select to authenticated using(exists(select 1 from public.training_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy tutor_requests_owner on public.tutor_requests for select to authenticated using(user_id = auth.uid());
create policy tutor_messages_owner on public.tutor_messages for select to authenticated using(exists(select 1 from public.training_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy hint_events_owner on public.hint_events for select to authenticated using(exists(select 1 from public.training_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy llm_usage_owner on public.llm_usage for select to authenticated using(exists(select 1 from public.tutor_requests r join public.training_sessions s on s.id = r.session_id where r.id = request_id and s.user_id = auth.uid()));
revoke all on public.tutor_authorizations, public.tutor_requests, public.tutor_messages, public.hint_events, public.llm_usage from public, anon, authenticated;
grant select (id,user_id,session_id) on public.tutor_requests to authenticated;
grant select on public.tutor_authorizations, public.tutor_messages, public.hint_events, public.llm_usage to authenticated;
-- Request leases/nonces are intentionally not selectable by a browser.
create function algopilot_private.verify_tutor(p_payload text, p_signature text, p_operation text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; k text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  if p_payload is null or length(p_payload)>200000 or p_signature is null or p_signature !~ '^[a-f0-9]{64}$' then raise exception 'invalid attestation' using errcode='42501'; end if;
  select signing_secret into k from algopilot_private.tutor_settings where singleton;
  if k is null or p_signature is null or p_signature <> encode(extensions.hmac(p_payload, k, 'sha256'), 'hex') then
    raise exception 'invalid attestation' using errcode='42501';
  end if;
  v := p_payload::jsonb;
  if v->>'operation' is distinct from p_operation or v->>'userId' is null or v->>'expiresAt' is null or (v->>'userId')::uuid <> auth.uid() or
    (v->>'expiresAt')::timestamptz < clock_timestamp() or (v->>'expiresAt')::timestamptz > clock_timestamp() + interval '10 minutes' then
    raise exception 'invalid attestation scope' using errcode='42501';
  end if;
  return v;
end $$;
revoke all on function algopilot_private.verify_tutor(text,text,text) from public, anon, authenticated;
create function algopilot_private.tutor_session(p_id uuid) returns public.training_sessions
language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions;
begin
  s := public.lock_owned_session(p_id);
  if s.mode = 'contest' then raise exception 'contest assistance disabled' using errcode='AP001'; end if;
  if s.status = 'completed' then raise exception 'session completed' using errcode='AP002'; end if;
  return s;
end $$;
revoke all on function algopilot_private.tutor_session(uuid) from public, anon, authenticated;

create function public.tutor_hint(p_id uuid,p_operation text,p_revision integer,p_request_id uuid,p_challenge uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions; a public.tutor_authorizations; c algopilot_private.l5_challenges;
begin
  s := algopilot_private.tutor_session(p_id);
  insert into public.tutor_authorizations(session_id) values(p_id) on conflict do nothing;
  select * into a from public.tutor_authorizations where session_id=p_id for update;
  if a.revision <> p_revision then raise exception 'revision conflict' using errcode='40001'; end if;
  if p_operation = 'upgrade' and a.allowed_level < 4 then
    update public.tutor_authorizations set allowed_level=allowed_level+1, revision=revision+1,updated_at=clock_timestamp() where session_id=p_id returning * into a;
    insert into public.hint_events(session_id,request_id,kind,level) values(p_id,p_request_id,'authorization',a.allowed_level);
  elsif p_operation = 'begin_l5' and a.allowed_level = 4 then
    insert into algopilot_private.l5_challenges(user_id,session_id,request_id) values(auth.uid(),p_id,p_request_id) returning * into c;
    insert into public.hint_events(session_id,request_id,kind,level) values(p_id,p_request_id,'l5_challenge',5);
    return jsonb_build_object('challengeId',c.id,'expiresAt',c.expires_at,'allowedLevel',a.allowed_level,'revision',a.revision);
  elsif p_operation = 'confirm_l5' and a.allowed_level = 4 then
    select * into c from algopilot_private.l5_challenges where id=p_challenge and user_id=auth.uid() and session_id=p_id and request_id=p_request_id for update;
    if not found or c.consumed_at is not null or c.expires_at <= clock_timestamp() then raise exception 'expired or replayed confirmation' using errcode='AP005'; end if;
    update algopilot_private.l5_challenges set consumed_at=clock_timestamp() where id=c.id;
    update public.tutor_authorizations set allowed_level=5,revision=revision+1,updated_at=clock_timestamp() where session_id=p_id returning * into a;
    insert into public.hint_events(session_id,request_id,kind,level) values(p_id,p_request_id,'authorization',5);
  else raise exception 'invalid hint transition' using errcode='23514'; end if;
  return jsonb_build_object('allowedLevel',a.allowed_level,'revision',a.revision);
end $$;

create function public.tutor_reserve(p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; s public.training_sessions; r public.tutor_requests; a smallint; used integer; lim integer; hard integer;
begin
  v := algopilot_private.verify_tutor(p_payload,p_signature,'reserve');
  -- One admission lock per user across sessions and application instances.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,17));
  s := algopilot_private.tutor_session((v->>'sessionId')::uuid);
  select * into r from public.tutor_requests where id=(v->>'requestId')::uuid;
  if found then
    if r.user_id <> auth.uid() or r.session_id <> s.id then raise exception 'not found' using errcode='P0002'; end if;
    if r.fingerprint <> v->>'fingerprint' then raise exception 'idempotency conflict' using errcode='40001'; end if;
    if r.status = 'completed' then return jsonb_build_object('cached',true,'requestId',r.id); end if;
    if r.status = 'failed' then raise exception 'request failed; use new request id' using errcode='AP006'; end if;
    raise exception 'request already in flight' using errcode='AP004';
  end if;
  update public.tutor_requests set status='failed',error_code='LEASE_EXPIRED',finished_at=clock_timestamp() where user_id=auth.uid() and status='pending' and lease_until <= clock_timestamp();
  if exists(select 1 from public.tutor_requests where user_id=auth.uid() and status='pending') then raise exception 'in flight' using errcode='AP004'; end if;
  select daily_hard_limit into hard from algopilot_private.tutor_settings where singleton;
  lim := (v->>'dailyLimit')::integer;
  if lim is null or lim < 1 or lim > hard then raise exception 'invalid quota config' using errcode='42501'; end if;
  select count(*) into used from public.tutor_requests where user_id=auth.uid() and created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  if used >= lim then raise exception 'daily quota exhausted' using errcode='AP003'; end if;
  insert into public.tutor_authorizations(session_id) values(s.id) on conflict do nothing;
  select allowed_level into a from public.tutor_authorizations where session_id=s.id;
  if v->>'action' = 'explain' and a < 5 then raise exception 'L5 required' using errcode='AP007'; end if;
  insert into public.tutor_requests(id,user_id,session_id,fingerprint,action,allowed_level,context_evidence)
    values((v->>'requestId')::uuid,auth.uid(),s.id,v->>'fingerprint',v->>'action',a,coalesce(v->'contextEvidence','{}'::jsonb)) returning * into r;
  return jsonb_build_object('cached',false,'requestId',r.id,'leaseNonce',r.lease_nonce,'allowedLevel',a,'used',used+1,'limit',lim);
end $$;

create function public.tutor_finish(p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; r public.tutor_requests; s public.training_sessions; u jsonb; level integer; ordinal_start integer; ok boolean;
begin
  v := algopilot_private.verify_tutor(p_payload,p_signature,'finish');
  s := public.lock_owned_session((v->>'sessionId')::uuid);
  select * into r from public.tutor_requests where id=(v->>'requestId')::uuid and user_id=auth.uid() and session_id=s.id for update;
  if not found then raise exception 'not found' using errcode='P0002'; end if;
  if r.lease_nonce <> (v->>'leaseNonce')::uuid then raise exception 'invalid lease' using errcode='42501'; end if;
  if r.status = 'completed' then return jsonb_build_object('accepted',true); end if;
  -- Late settlement may record actual usage but can never reveal a late response.
  ok := coalesce((v->>'success')::boolean,false) and r.status='pending' and r.lease_until > clock_timestamp() and s.mode='practice' and s.status <> 'completed';
  for u in select value from jsonb_array_elements(v->'usage') loop
    insert into public.llm_usage(request_id,attempt,provider,model,input_tokens,output_tokens,total_tokens,duration_ms,status,cost_usd)
      values(r.id,(u->>'attempt')::smallint,'openai-compatible',u->>'model',(u->>'inputTokens')::integer,(u->>'outputTokens')::integer,(u->>'totalTokens')::integer,(u->>'durationMs')::integer,
        case when u->>'status'='success' and not ok then 'rejected' else u->>'status' end,(u->>'costUsd')::numeric)
      on conflict(request_id,attempt) do nothing;
  end loop;
  if r.status <> 'pending' then return jsonb_build_object('accepted',false); end if;
  if ok then
    level := (v->>'disclosureLevel')::integer;
    if level is null or level < 0 or level > r.allowed_level or (r.action='explain' and level <> 5) then raise exception 'unauthorized disclosure' using errcode='42501'; end if;
    select coalesce(max(ordinal),0) into ordinal_start from public.tutor_messages where session_id=s.id;
    insert into public.tutor_messages(session_id,request_id,ordinal,role,action,content,disclosure_level,verification,prompt_version,thought_revision,code_revision)
      values(s.id,r.id,ordinal_start+1,'user',r.action,v->>'userMessage',0,'not_applicable',v->>'promptVersion',(v->>'thoughtRevision')::integer,(v->>'codeRevision')::integer),
      (s.id,r.id,ordinal_start+2,'assistant',r.action,v->>'content',level,case when r.action='counterexample' then 'unverified_candidate' else 'not_applicable' end,v->>'promptVersion',(v->>'thoughtRevision')::integer,(v->>'codeRevision')::integer);
    update public.training_sessions set max_hint_seen=greatest(max_hint_seen,level) where id=s.id;
    insert into public.hint_events(session_id,request_id,kind,level) values(s.id,r.id,'disclosure',level);
    if level=5 then insert into public.hint_events(session_id,request_id,kind,level) values(s.id,r.id,'full_reveal',5); end if;
  end if;
  update public.tutor_requests set status=case when ok then 'completed' else 'failed' end,error_code=case when ok then null else coalesce(v->>'errorCode','RESPONSE_DISCARDED') end,finished_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('accepted',ok);
end $$;

create function public.tutor_state(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions; a public.tutor_authorizations; used integer;
begin
  s := public.lock_owned_session(p_id);
  select * into a from public.tutor_authorizations where session_id=p_id;
  select count(*) into used from public.tutor_requests where user_id=auth.uid() and created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  return jsonb_build_object('allowedLevel',coalesce(a.allowed_level,0),'maxSeenLevel',s.max_hint_seen,'revision',coalesce(a.revision,0),'used',used);
end $$;
revoke all on function public.tutor_hint(uuid,text,integer,uuid,uuid),public.tutor_reserve(text,text),public.tutor_finish(text,text),public.tutor_state(uuid) from public,anon,authenticated;
grant execute on function public.tutor_hint(uuid,text,integer,uuid,uuid),public.tutor_reserve(text,text),public.tutor_finish(text,text),public.tutor_state(uuid) to authenticated;
commit;
