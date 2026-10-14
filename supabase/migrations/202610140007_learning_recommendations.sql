begin;
do $$ begin
 if to_regprocedure('public.cf_catalog(jsonb)') is null then raise exception 'APPLY_006_FIRST'; end if;
end $$;
create index sessions_learning_problem on public.training_sessions(user_id,problem_id,outcome);
create index reviews_learning_problem on public.code_reviews(user_id,problem_id);
-- Evidence remains in existing immutable session/review records; no fabricated CF facts.
create table public.learning_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 preferences jsonb not null, revision integer not null default 0 check(revision>=0),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.recommendation_feedback (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 problem_id uuid not null references public.problems(id), kind text not null check(kind in('too_easy','too_hard','off_goal')),
 created_at timestamptz not null default clock_timestamp()
);
create index recommendation_feedback_owner on public.recommendation_feedback(user_id,created_at desc,id);
create table algopilot_private.learning_receipts (
 user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 fingerprint jsonb not null, primary key(user_id,request_id)
);
alter table public.learning_preferences enable row level security;
alter table public.recommendation_feedback enable row level security;
alter table algopilot_private.learning_receipts enable row level security;
create policy learning_preferences_owner on public.learning_preferences for select to authenticated using(user_id=auth.uid());
create policy recommendation_feedback_owner on public.recommendation_feedback for select to authenticated using(user_id=auth.uid());
revoke all on public.learning_preferences,public.recommendation_feedback,algopilot_private.learning_receipts from public,anon,authenticated;
grant select on public.learning_preferences,public.recommendation_feedback to authenticated;

create function public.learning_write(p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid; v jsonb; old jsonb; rev integer; pid uuid;
begin
 if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input->>'requestId' is null then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
 rid:=(p_input->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,32));
 select fingerprint into old from algopilot_private.learning_receipts where user_id=uid and request_id=rid;
 if found then
  if old is distinct from p_input then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if;
  return jsonb_build_object('saved',true);
 end if;
 if p_input->>'action'='preferences' then
  if p_input-array['action','requestId','revision','preferences']<>'{}'::jsonb or not(p_input ?& array['revision','preferences']) or jsonb_typeof(p_input->'revision') is distinct from 'number' then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  v:=p_input->'preferences';
  if jsonb_typeof(v) is distinct from 'object' or v-array['min','max','themes','goal','repeat','reviewEvidence']<>'{}'::jsonb or not(v ?& array['min','max','themes','goal','repeat','reviewEvidence'])
   or jsonb_typeof(v->'min') is distinct from 'number' or jsonb_typeof(v->'max') is distinct from 'number'
   or jsonb_typeof(v->'repeat') is distinct from 'boolean' or jsonb_typeof(v->'reviewEvidence') is distinct from 'boolean'
   or jsonb_typeof(v->'themes') is distinct from 'array' or jsonb_array_length(v->'themes')>5
   or v->>'goal' is null or v->>'goal' not in('balanced','independence','explore')
   or (v->>'min')::numeric <> (v->>'min')::integer or (v->>'max')::numeric <> (v->>'max')::integer
   or (v->>'min')::integer not between 800 and 3500 or (v->>'max')::integer not between 800 and 3500 or (v->>'min')::integer>(v->>'max')::integer
   or exists(select 1 from jsonb_array_elements(v->'themes') t where jsonb_typeof(t) is distinct from 'string' or t#>>'{}' not in('implementation','math','greedy','dp','data structures','graphs','trees','binary search','number theory','strings','combinatorics','geometry','bitmasks','two pointers','sortings','dfs and similar','shortest paths','flows','dsu','constructive algorithms'))
   or (select count(*)<>count(distinct t) from jsonb_array_elements(v->'themes') t) then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  select revision into rev from public.learning_preferences where user_id=uid for update;
  rev:=coalesce(rev,0);
  if (p_input->>'revision')::numeric <> rev then raise exception 'REVISION_CONFLICT' using errcode='PT409'; end if;
  insert into public.learning_preferences(user_id,preferences,revision) values(uid,v,rev+1)
   on conflict(user_id) do update set preferences=excluded.preferences,revision=excluded.revision,updated_at=clock_timestamp();
 elsif p_input->>'action'='feedback' then
  if p_input-array['action','requestId','problemId','kind']<>'{}'::jsonb or not(p_input ?& array['problemId','kind']) or p_input->>'kind' is null or p_input->>'kind' not in('too_easy','too_hard','off_goal') then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  pid:=(p_input->>'problemId')::uuid;
  if not exists(select 1 from public.problems where id=pid and platform='codeforces' and catalog_version is not null) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  insert into public.recommendation_feedback(id,user_id,problem_id,kind) values(rid,uid,pid,p_input->>'kind');
 else raise exception 'INVALID_INPUT' using errcode='23514'; end if;
 insert into algopilot_private.learning_receipts values(uid,rid,p_input);
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.learning_write(jsonb) from public,anon,authenticated;
grant execute on function public.learning_write(jsonb) to authenticated;

-- A bounded, auditable evidence window. Never include code, raw output, nonce, usage or tutor internal evidence.
create function public.learning_evidence() returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); pref jsonb; rev integer; sessions jsonb; reviews jsonb; feedback jsonb;
begin
 if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
 select preferences,revision into pref,rev from public.learning_preferences where user_id=uid;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'problemId',s.problem_id,'status',s.status,'outcome',s.outcome,'rating',p.rating,
  'tags',case when s.status='completed' and (s.outcome='solved_self_reported' or s.max_hint_seen=5) then coalesce(p.tags,'{}'::text[]) else '{}'::text[] end,
  'maxHint',s.max_hint_seen,'externalEditorial',s.used_external_editorial,'thoughtCount',(select count(*) from public.thought_snapshots t where t.session_id=s.id and length(btrim(t.content))>0),'createdAt',s.created_at) order by s.created_at desc,s.id),'[]'::jsonb)
 into sessions from (select * from public.training_sessions where user_id=uid order by created_at desc,id limit 500) s left join public.problems p on p.id=s.problem_id and (p.owner_id is null or p.owner_id=uid);
 reviews:='[]'::jsonb;
 if coalesce((pref->>'reviewEvidence')::boolean,false) then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'reviewId',r.review_id,'problemId',r.problem_id,'knowledge',coalesce(r.analysis->>'transferableKnowledge',''),'risks',coalesce(r.analysis->>'risks',''),'createdAt',r.created_at) order by r.created_at desc,r.id),'[]'::jsonb) into reviews
  from (select * from (select distinct on (coalesce(cr.problem_id,cr.id)) rr.id,rr.review_id,cr.problem_id,rr.analysis,rr.created_at
   from public.review_requests rr join public.code_reviews cr on cr.id=rr.review_id
   where rr.user_id=uid and cr.user_id=uid and rr.status='completed' and rr.analysis is not null and cr.authorization_event->>'confirmation'='我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘'
   order by coalesce(cr.problem_id,cr.id),rr.created_at desc,rr.id) latest order by created_at desc,id limit 200) r;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'problemId',f.problem_id,'kind',f.kind,'rating',p.rating,'createdAt',f.created_at) order by f.created_at desc,f.id),'[]'::jsonb) into feedback
 from (select * from (select distinct on(problem_id) * from public.recommendation_feedback where user_id=uid order by problem_id,created_at desc,id) latest order by created_at desc,id limit 100) f join public.problems p on p.id=f.problem_id;
 return jsonb_build_object('preferences',pref,'revision',coalesce(rev,0),'totalSessions',(select count(*) from public.training_sessions where user_id=uid),'sessions',sessions,'reviews',reviews,'feedback',feedback);
end $$;
revoke all on function public.learning_evidence() from public,anon,authenticated;
grant execute on function public.learning_evidence() to authenticated;

-- Filtering and shortlist selection happen in Postgres, including ALL known solved history.
create function public.learning_candidates(p_query jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); v jsonb; result jsonb; n integer;
begin
 if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
 if jsonb_typeof(p_query) is distinct from 'object' or p_query-array['min','max','target','themes','repeat']<>'{}'::jsonb or not(p_query ?& array['min','max','target','themes','repeat'])
  or jsonb_typeof(p_query->'themes') is distinct from 'array' or jsonb_array_length(p_query->'themes')>5
  or jsonb_typeof(p_query->'repeat') is distinct from 'boolean'
  or jsonb_typeof(p_query->'min') is distinct from 'number' or jsonb_typeof(p_query->'max') is distinct from 'number' or jsonb_typeof(p_query->'target') is distinct from 'number'
  or (p_query->>'min')::numeric <> (p_query->>'min')::integer or (p_query->>'max')::numeric <> (p_query->>'max')::integer or (p_query->>'target')::numeric <> (p_query->>'target')::integer
  or exists(select 1 from jsonb_array_elements(p_query->'themes') t where jsonb_typeof(t) is distinct from 'string' or char_length(t#>>'{}') not between 1 and 100)
  or (p_query->>'min')::integer not between 800 and 3500 or (p_query->>'max')::integer not between 800 and 3500 or (p_query->>'min')::integer>(p_query->>'max')::integer
  or (p_query->>'target')::integer not between (p_query->>'min')::integer and (p_query->>'max')::integer then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
 with filtered as (
  select p.*,exists(select 1 from public.training_plan_items i join public.training_plans tp on tp.id=i.plan_id where i.problem_id=p.id and i.user_id=uid and tp.user_id=uid and not tp.archived) in_plan,
   exists(select 1 from public.training_sessions s where s.problem_id=p.id and s.user_id=uid) practiced
  from public.problems p where p.platform='codeforces' and p.catalog_version=(select version from algopilot_private.cf_cache_state where singleton)
   and p.rating between (p_query->>'min')::integer and (p_query->>'max')::integer
   and (jsonb_array_length(p_query->'themes')=0 or p.tags && array(select jsonb_array_elements_text(p_query->'themes')))
   and ((p_query->>'repeat')::boolean or not exists(select 1 from public.training_sessions s where s.user_id=uid and s.problem_id=p.id and s.outcome='solved_self_reported') and not exists(select 1 from public.code_reviews r where r.user_id=uid and r.problem_id=p.id))
 ), spread as (
  select f.*,row_number() over(partition by coalesce(f.tags[1],'') order by abs(f.rating-(p_query->>'target')::integer),f.contest_id desc,f.problem_index,f.id) topic_rank from filtered f
 ), shortlist as (select * from spread order by topic_rank,abs(rating-(p_query->>'target')::integer),contest_id desc,problem_index,id limit 600)
 select (select count(*) from filtered),coalesce(jsonb_agg(jsonb_build_object('id',s.id,'contestId',s.contest_id,'index',s.problem_index,'name',s.title,'rating',s.rating,'tags',s.tags,'solvedCount',s.solved_count)||jsonb_build_object('inPlan',s.in_plan,'practiced',s.practiced) order by s.topic_rank,abs(s.rating-(p_query->>'target')::integer),s.contest_id desc,s.problem_index,s.id),'[]'::jsonb)
 into n,result from shortlist s;
 return jsonb_build_object('items',result,'total',n);
end $$;
revoke all on function public.learning_candidates(jsonb) from public,anon,authenticated;
grant execute on function public.learning_candidates(jsonb) to authenticated;
commit;
