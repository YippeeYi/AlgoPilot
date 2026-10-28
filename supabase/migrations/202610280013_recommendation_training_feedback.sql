-- Local-only until separately authorized. Existing sessions/receipts have no trustworthy
-- recommendation provenance or skipped state. Do not repurpose preference feedback or notes.
begin;
-- PK(id) already guarantees this uniqueness; the composite key additionally lets
-- the new receipt FK enforce ownership. No valid legacy row is excluded or rewritten.
alter table public.training_sessions add constraint training_sessions_id_owner_key unique(id,user_id);
create table algopilot_private.recommendation_trials (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  run_id uuid not null, problem_id uuid not null references public.problems(id),
  source jsonb not null, fingerprint text not null, issued_at timestamptz not null default clock_timestamp(),
  skipped_at timestamptz, chosen_at timestamptz, session_id uuid,
  originated boolean not null default false,
  foreign key(session_id,user_id) references public.training_sessions(id,user_id),
  unique(user_id,run_id,problem_id),
  check((session_id is null and chosen_at is null and not originated) or (session_id is not null and chosen_at is not null))
);
create unique index recommendation_origin_once on algopilot_private.recommendation_trials(session_id) where originated;
create index recommendation_trials_owner on algopilot_private.recommendation_trials(user_id,issued_at desc,id);
alter table algopilot_private.recommendation_trials enable row level security;
revoke all on algopilot_private.recommendation_trials from public,anon,authenticated;

create function public.record_recommendation_run(p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; uid uuid:=auth.uid(); fp text; old_fp text; pid uuid; result jsonb; focus jsonb; baseline jsonb;
begin
  if octet_length(p_payload)>4000 then raise exception 'INVALID_RECOMMENDATION' using errcode='23514'; end if;
  v:=algopilot_private.verify_cf(p_payload,p_signature,'recommendation_record');
  if v-array['operation','userId','expiresAt','runId','revision','officialRevision','focus','baseline','problemIds','repeat']<>'{}'::jsonb
    or not(v ?& array['runId','revision','officialRevision','focus','baseline','problemIds','repeat']) or jsonb_typeof(v->'repeat') is distinct from 'boolean'
    or jsonb_typeof(v->'problemIds') is distinct from 'array' or jsonb_array_length(v->'problemIds') not between 1 and 5
    or (v->>'runId')::uuid is null then raise exception 'INVALID_RECOMMENDATION' using errcode='23514'; end if;
  focus:=v->'focus'; baseline:=v->'baseline';
  if focus<>'null'::jsonb and (jsonb_typeof(focus)<>'object' or focus-array['topic','window']<>'{}'::jsonb or not(focus ?& array['topic','window'])
    or focus->>'window' not in('7','30','90','all') or length(coalesce(focus->>'topic','')) not between 1 and 100) then raise exception 'INVALID_FOCUS' using errcode='23514'; end if;
  if baseline<>'null'::jsonb and (jsonb_typeof(baseline)<>'object' or baseline-array['samples','concerns','solved']<>'{}'::jsonb
    or not(baseline ?& array['samples','concerns','solved']) or jsonb_typeof(baseline->'samples') is distinct from 'number' or jsonb_typeof(baseline->'concerns') is distinct from 'number' or jsonb_typeof(baseline->'solved') is distinct from 'number' or (baseline->>'samples')::integer not between 0 and 500
    or (baseline->>'concerns')::integer not between 0 and (baseline->>'samples')::integer
    or (baseline->>'solved')::integer not between 0 and (baseline->>'samples')::integer) then raise exception 'INVALID_BASELINE' using errcode='23514'; end if;
  if (focus='null'::jsonb)<>(baseline='null'::jsonb) then raise exception 'INVALID_BASELINE' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recommendation/'||uid::text,0));
  fp:=encode(extensions.digest((v-array['userId','expiresAt'])::text,'sha256'),'hex');
  select fingerprint into old_fp from algopilot_private.recommendation_trials where user_id=uid and run_id=(v->>'runId')::uuid limit 1;
  if found then
    if old_fp<>fp then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if;
  else
    perform public.learning_evidence_guard((v->>'revision')::integer,(v->>'officialRevision')::bigint);
    if jsonb_array_length(v->'problemIds')<>(select count(distinct x) from jsonb_array_elements_text(v->'problemIds') x) then raise exception 'DUPLICATE_PROBLEM' using errcode='23514'; end if;
    for pid in select value::uuid from jsonb_array_elements_text(v->'problemIds') loop
      if not exists(select 1 from public.problems where id=pid and platform='codeforces' and metadata_synced_at is not null) then raise exception 'CF_PROBLEM_REQUIRED' using errcode='23514'; end if;
      insert into algopilot_private.recommendation_trials(user_id,run_id,problem_id,source,fingerprint)
        values(uid,(v->>'runId')::uuid,pid,jsonb_build_object('version','deterministic/1.3-official','focus',focus,'baseline',baseline,'repeat',v->'repeat','revision',v->'revision','officialRevision',v->'officialRevision'),fp);
    end loop;
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'problemId',problem_id) order by id) into result from algopilot_private.recommendation_trials where user_id=uid and run_id=(v->>'runId')::uuid;
  return jsonb_build_object('available',true,'items',result);
end $$;

create function public.recommendation_choice(p_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r algopilot_private.recommendation_trials; s public.training_sessions; resumed boolean:=false;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if p_action is null or p_action not in('start','skip') then raise exception 'INVALID_ACTION' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recommendation/'||uid::text,0));
  select * into r from algopilot_private.recommendation_trials where id=p_id and user_id=uid for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_action='skip' then
    if r.session_id is not null then raise exception 'ALREADY_CHOSEN' using errcode='PT409'; end if;
    update algopilot_private.recommendation_trials set skipped_at=coalesce(skipped_at,clock_timestamp()) where id=r.id;
    return jsonb_build_object('sessionId',null,'resumed',false);
  end if;
  if r.session_id is not null then return jsonb_build_object('sessionId',r.session_id,'resumed',true); end if;
  perform public.learning_evidence_guard((r.source->>'revision')::integer,(r.source->>'officialRevision')::bigint);
  if not (r.source->>'repeat')::boolean and (
    exists(select 1 from public.training_sessions where user_id=uid and problem_id=r.problem_id and outcome='solved_self_reported')
    or exists(select 1 from public.code_reviews where user_id=uid and problem_id=r.problem_id)
    or exists(select 1 from algopilot_private.cf_accounts a join algopilot_private.cf_submissions f on f.user_id=a.user_id and f.scope_id=a.scope_id
      join public.problems p on p.contest_id=f.contest_id and p.problem_index=f.problem_index where a.user_id=uid and a.enabled and f.active and f.verdict='OK' and p.id=r.problem_id)
  ) then raise exception 'ALREADY_SOLVED_REFRESH_RECOMMENDATION' using errcode='PT409'; end if;
  select * into s from public.training_sessions where user_id=uid and problem_id=r.problem_id and mode='practice' and status<>'completed' order by created_at desc,id limit 1 for update;
  resumed:=found;
  if not resumed then
    select * into s from public.start_cf_session(jsonb_build_object('problemId',r.problem_id,'requestId',r.id,'mode','practice','timerEnabled',false));
  end if;
  update algopilot_private.recommendation_trials set session_id=s.id,chosen_at=clock_timestamp(),originated=not resumed where id=r.id;
  return jsonb_build_object('sessionId',s.id,'resumed',resumed);
end $$;

create function public.recommendation_training_evidence(p_window text,p_session_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); since_at timestamptz; result jsonb; n integer; pref_revision integer; a algopilot_private.cf_accounts;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if p_window is null or p_window not in('7','30','90','all') then raise exception 'INVALID_WINDOW' using errcode='23514'; end if;
  if p_session_id is not null and not exists(select 1 from public.training_sessions where id=p_session_id and user_id=uid) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  since_at:=case when p_window='all' then '-infinity'::timestamptz else clock_timestamp()-p_window::integer*interval '1 day' end;
  select coalesce((select revision from public.learning_preferences where user_id=uid),0) into pref_revision;
  select * into a from algopilot_private.cf_accounts where user_id=uid;
  with filtered as (select * from algopilot_private.recommendation_trials where user_id=uid and issued_at>since_at and (p_session_id is null or session_id=p_session_id)),
  page as (select * from filtered order by issued_at desc,id limit 200)
  select (select count(*) from filtered),coalesce(jsonb_agg(jsonb_build_object('id',r.id,'runId',r.run_id,'problemId',r.problem_id,'contestId',p.contest_id,'index',p.problem_index,'issuedAt',r.issued_at,
    'focus',r.source->'focus','baseline',r.source->'baseline','skippedAt',r.skipped_at,'chosenAt',r.chosen_at,'sessionId',r.session_id,'originated',r.originated,
    'sessionStatus',s.status,'outcome',s.outcome,'endedAt',s.ended_at,
    'official',case when not coalesce(a.enabled,false) then 'disabled' when a.last_synced_at is null then 'not_synced'
      when exists(select 1 from algopilot_private.cf_submissions f where f.user_id=uid and f.scope_id=a.scope_id and f.active and f.verdict='OK' and f.contest_id=p.contest_id and f.problem_index=p.problem_index) then 'observed_ok' else 'not_observed' end,
    'officialSyncedAt',case when a.enabled then a.last_synced_at end) order by r.issued_at desc,r.id),'[]'::jsonb) into n,result
  from page r
  join public.problems p on p.id=r.problem_id left join public.training_sessions s on s.id=r.session_id and s.user_id=uid;
  return jsonb_build_object('available',true,'items',result,'total',n,'asOf',clock_timestamp(),'revision',pref_revision,'officialRevision',coalesce(a.evidence_revision,0));
end $$;
revoke all on function public.record_recommendation_run(text,text),public.recommendation_choice(uuid,text),public.recommendation_training_evidence(text,uuid) from public,anon,authenticated;
grant execute on function public.record_recommendation_run(text,text),public.recommendation_choice(uuid,text),public.recommendation_training_evidence(text,uuid) to authenticated;
commit;
