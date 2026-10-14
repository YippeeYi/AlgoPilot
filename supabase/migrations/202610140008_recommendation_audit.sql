begin;
-- M3.2.1 counterexamples: tag permutation and plan/newest tie bias.
-- Canonical tag sets, equal-fit unplanned/unpracticed first, deterministic external-key hash.
-- No window expansion, random exploration, data rewrites or new permissions.
do $$ begin
 if to_regprocedure('public.learning_candidates(jsonb)') is null then raise exception 'APPLY_007_FIRST'; end if;
end $$;
create or replace function public.learning_candidates(p_query jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb; n integer;
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
  select f.*,row_number() over(partition by array(select distinct t from unnest(f.tags) t order by t) order by abs(f.rating-(p_query->>'target')::integer),f.in_plan,f.practiced,md5(f.contest_id::text||'/'||f.problem_index),f.id) topic_rank from filtered f
 ), shortlist as (select * from spread order by topic_rank,abs(rating-(p_query->>'target')::integer),in_plan,practiced,md5(contest_id::text||'/'||problem_index),id limit 600)
 select (select count(*) from filtered),coalesce(jsonb_agg(jsonb_build_object('id',s.id,'contestId',s.contest_id,'index',s.problem_index,'name',s.title,'rating',s.rating,'tags',s.tags,'solvedCount',s.solved_count)||jsonb_build_object('inPlan',s.in_plan,'practiced',s.practiced) order by s.topic_rank,abs(s.rating-(p_query->>'target')::integer),s.in_plan,s.practiced,md5(s.contest_id::text||'/'||s.problem_index),s.id),'[]'::jsonb)
 into n,result from shortlist s;
 return jsonb_build_object('items',result,'total',n);
end $$;
revoke all on function public.learning_candidates(jsonb) from public,anon,authenticated;
grant execute on function public.learning_candidates(jsonb) to authenticated;
commit;
