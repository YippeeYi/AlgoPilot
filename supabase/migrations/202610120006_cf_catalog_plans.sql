begin;

-- Require M2.5; never rewrite 001–005 or discard legacy records.
do $$ begin
  if to_regprocedure('public.review_finish(text,text)') is null then raise exception 'APPLY_005_FIRST'; end if;
end $$;
alter table public.problems drop constraint problems_problem_index_check;
alter table public.problems add constraint problems_problem_index_check check(problem_index ~ '^[A-Z0-9]{1,16}$');
alter table public.problems add column solved_count integer check(solved_count>=0), add column metadata_synced_at timestamptz, add column catalog_version uuid;
create index problems_catalog on public.problems(catalog_version,contest_id desc,problem_index);
create index problems_catalog_rating on public.problems(catalog_version,rating);
create index problems_catalog_tags on public.problems using gin(tags);

-- Persistent, shared across instances. Only server-signed calls can acquire slots or publish.
create table algopilot_private.cf_settings (
  singleton boolean primary key default true check(singleton), signing_secret text not null check(signing_secret ~ '^[a-f0-9]{64,128}$')
);
create table algopilot_private.cf_cache_state (
  singleton boolean primary key default true check(singleton), synced_at timestamptz, version uuid,
  next_attempt_at timestamptz not null default '-infinity', next_slot_at timestamptz not null default '-infinity',
  lease_nonce uuid, lease_until timestamptz, failed boolean not null default false
);
insert into algopilot_private.cf_cache_state(singleton) values(true);
-- Existing deployments may use the purpose-separated key derived from the Tutor master.
insert into algopilot_private.cf_settings(signing_secret) select encode(extensions.hmac('algopilot/cf/v1',signing_secret,'sha256'),'hex') from algopilot_private.tutor_settings where singleton;
revoke all on algopilot_private.cf_settings,algopilot_private.cf_cache_state from public,anon,authenticated;

create function algopilot_private.verify_cf(p_payload text,p_signature text,p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; secret text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if octet_length(p_payload)>12000000 or p_signature is null then raise exception 'INVALID_SIGNATURE' using errcode='42501'; end if;
  select signing_secret into secret from algopilot_private.cf_settings where singleton;
  if secret is null or p_signature<>encode(extensions.hmac(p_payload,secret,'sha256'),'hex') then raise exception 'INVALID_SIGNATURE' using errcode='42501'; end if;
  v:=p_payload::jsonb;
  if v->>'userId' is distinct from auth.uid()::text or v->>'operation' is distinct from p_operation or v->>'expiresAt' is null or (v->>'expiresAt')::timestamptz<clock_timestamp()
    or (v->>'expiresAt')::timestamptz>clock_timestamp()+interval '6 minutes' then raise exception 'INVALID_SIGNATURE' using errcode='42501'; end if;
  return v;
end $$;
revoke all on function algopilot_private.verify_cf(text,text,text) from public,anon,authenticated;

create function public.cf_sync(p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; s algopilot_private.cf_cache_state; nonce uuid; version_id uuid; now_at timestamptz:=clock_timestamp(); op text; rows_count integer;
begin
  v:=algopilot_private.verify_cf(p_payload,p_signature,'cf_sync'); op:=v->>'action';
  select * into s from algopilot_private.cf_cache_state where singleton for update;
  if op='reserve' then
    if (s.lease_until>now_at or s.next_attempt_at>now_at or (not coalesce((v->>'force')::boolean,false) and s.synced_at>now_at-interval '6 hours')) then return jsonb_build_object('acquired',false); end if;
    nonce:=gen_random_uuid();
    update algopilot_private.cf_cache_state set lease_nonce=nonce,lease_until=now_at+interval '3 minutes',next_attempt_at=now_at+interval '1 minute' where singleton;
    return jsonb_build_object('acquired',true,'nonce',nonce);
  end if;
  if s.lease_nonce is null or (v->>'nonce')::uuid is distinct from s.lease_nonce or s.lease_until<=now_at then raise exception 'INVALID_LEASE' using errcode='PT409'; end if;
  if op='slot' then
    if s.next_slot_at>now_at then return jsonb_build_object('waitMs',ceil(extract(epoch from s.next_slot_at-now_at)*1000)); end if;
    update algopilot_private.cf_cache_state set next_slot_at=now_at+interval '3 seconds' where singleton;
    return jsonb_build_object('waitMs',0);
  elsif op='fail' then
    update algopilot_private.cf_cache_state set lease_nonce=null,lease_until=null,failed=true,next_attempt_at=now_at+interval '1 minute' where singleton;
    return jsonb_build_object('accepted',true);
  elsif op<>'publish' then raise exception 'INVALID_OPERATION' using errcode='23514'; end if;
  if jsonb_typeof(v->'problems')<>'array' or jsonb_array_length(v->'problems') not between 1 and 50000 then raise exception 'INVALID_CATALOG' using errcode='23514'; end if;
  -- Signature attests official upstream validation. DB independently checks normalized shape.
  if exists(select 1 from jsonb_array_elements(v->'problems') x where jsonb_typeof(x)<>'object' or
    x - array['contestId','index','name','rating','tags','solvedCount'] <> '{}'::jsonb or
    not(x ?& array['contestId','index','name','rating','tags','solvedCount']) or
    jsonb_typeof(x->'tags')<>'array' or jsonb_array_length(x->'tags')>50 or
    exists(select 1 from jsonb_array_elements(x->'tags') tag where jsonb_typeof(tag)<>'string' or char_length(tag#>>'{}') not between 1 and 100)) then raise exception 'INVALID_CATALOG' using errcode='23514'; end if;
  version_id:=gen_random_uuid();
  insert into public.problems(platform,contest_id,problem_index,title,rating,tags,canonical_url,solved_count,metadata_synced_at,catalog_version)
    select 'codeforces',(x->>'contestId')::integer,x->>'index',x->>'name',(x->>'rating')::integer,
      array(select jsonb_array_elements_text(x->'tags')),
      'https://codeforces.com/problemset/problem/'||(x->>'contestId')||'/'||(x->>'index'),(x->>'solvedCount')::integer,now_at,version_id
    from jsonb_array_elements(v->'problems') x
    on conflict(platform,contest_id,problem_index) where platform='codeforces' do update set title=excluded.title,rating=excluded.rating,tags=excluded.tags,solved_count=excluded.solved_count,metadata_synced_at=excluded.metadata_synced_at,catalog_version=excluded.catalog_version;
  get diagnostics rows_count=row_count;
  update algopilot_private.cf_cache_state set version=version_id,synced_at=now_at,failed=false,lease_nonce=null,lease_until=null,next_attempt_at=now_at+interval '1 minute' where singleton;
  return jsonb_build_object('accepted',true,'count',rows_count);
end $$;
revoke all on function public.cf_sync(text,text) from public,anon,authenticated;
grant execute on function public.cf_sync(text,text) to authenticated;

create function algopilot_private.cf_problem(p public.problems) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'contestId',p.contest_id,'index',p.problem_index,'name',p.title,'rating',p.rating,'tags',p.tags,'solvedCount',p.solved_count);
$$;
revoke all on function algopilot_private.cf_problem(public.problems) from public,anon,authenticated;

create function public.cf_catalog(p_query jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s algopilot_private.cf_cache_state; q text:=coalesce(p_query->>'q',''); tag_filter text[]; result jsonb; n integer; lim integer:=coalesce((p_query->>'limit')::integer,30); offs integer:=coalesce((p_query->>'offset')::integer,0); sort_key text:=coalesce(p_query->>'sort','newest');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if p_query-array['q','min','max','tags','sort','limit','offset']<>'{}'::jsonb or char_length(q)>200 or lim not between 1 and 50 or offs not between 0 and 100000 or sort_key not in('newest','solved_desc','solved_asc')
    or coalesce((p_query->>'min')::integer,0) not between 0 and 10000 or coalesce((p_query->>'max')::integer,10000) not between 0 and 10000 or char_length(coalesce(p_query->>'tags',''))>500 then raise exception 'INVALID_QUERY' using errcode='23514'; end if;
  select * into s from algopilot_private.cf_cache_state where singleton;
  tag_filter:=case when coalesce(p_query->>'tags','')='' then '{}'::text[] else string_to_array(p_query->>'tags',';') end;
  with filtered as (
    select p.* from public.problems p where p.catalog_version=s.version and p.platform='codeforces'
      and (q='' or case when q ~* '^[1-9][0-9]*[A-Z][A-Z0-9]*$' then upper(p.contest_id::text||p.problem_index)=upper(q) when q ~* '^[1-9][0-9]*/[A-Z0-9]+$' then upper(p.contest_id::text||'/'||p.problem_index)=upper(q) else strpos(lower(p.title),lower(q))>0 end)
      and (p_query->>'min' is null or p.rating>=(p_query->>'min')::integer)
      and (p_query->>'max' is null or p.rating<=(p_query->>'max')::integer) and p.tags @> tag_filter
  ), page as (
    select f.* from filtered f order by case when sort_key='solved_desc' then f.solved_count end desc nulls last,case when sort_key='solved_asc' then f.solved_count end asc nulls last,f.contest_id desc,f.problem_index,f.id limit lim offset offs
  ) select (select count(*) from filtered),coalesce(jsonb_agg(algopilot_private.cf_problem(page)), '[]'::jsonb) into n,result from page;
  return jsonb_build_object('items',result,'total',n,'syncedAt',s.synced_at,'stale',s.synced_at is null or s.synced_at<clock_timestamp()-interval '6 hours' or s.failed,
    'tags',coalesce((select jsonb_agg(t order by t) from (select distinct unnest(tags) t from public.problems where catalog_version=s.version) a),'[]'::jsonb));
end $$;
revoke all on function public.cf_catalog(jsonb) from public,anon,authenticated;
grant execute on function public.cf_catalog(jsonb) to authenticated;

create table public.training_plans (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 1 and 100),description text not null default '' check(char_length(description)<=2000),
  archived boolean not null default false,revision integer not null default 0 check(revision>=0),
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(id,user_id)
);
create table public.training_plan_items (
  id uuid primary key default gen_random_uuid(),plan_id uuid not null,user_id uuid not null,
  problem_id uuid not null references public.problems(id),position integer not null check(position>=0),
  manual_status text not null default 'planned' check(manual_status in('planned','in_progress','completed')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(plan_id,user_id) references public.training_plans(id,user_id) on delete cascade,
  unique(plan_id,problem_id),unique(plan_id,position) deferrable initially deferred,unique(id,user_id)
);
create table public.training_plan_sessions (
  item_id uuid not null,user_id uuid not null,session_id uuid not null references public.training_sessions(id),
  foreign key(item_id,user_id) references public.training_plan_items(id,user_id) on delete cascade,
  primary key(item_id,session_id)
);
create table algopilot_private.plan_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,fingerprint text not null,result jsonb not null,primary key(user_id,request_id)
);
revoke all on algopilot_private.plan_receipts from public,anon,authenticated;
alter table public.training_plans enable row level security;
alter table public.training_plan_items enable row level security;
alter table public.training_plan_sessions enable row level security;
create policy plans_owner on public.training_plans for select to authenticated using(user_id=auth.uid());
create policy plan_items_owner on public.training_plan_items for select to authenticated using(user_id=auth.uid());
create policy plan_sessions_owner on public.training_plan_sessions for select to authenticated using(user_id=auth.uid());
revoke all on public.training_plans,public.training_plan_items,public.training_plan_sessions from public,anon,authenticated;
grant select on public.training_plans,public.training_plan_items,public.training_plan_sessions to authenticated;
create index plans_owner_updated on public.training_plans(user_id,updated_at desc);

create function algopilot_private.add_plan_problems(p_id uuid,p_ids jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare next_pos integer; problem uuid;
begin
  if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids)>200 then raise exception 'INVALID_PROBLEMS' using errcode='23514'; end if;
  select coalesce(max(position)+1,0) into next_pos from public.training_plan_items where plan_id=p_id;
  for problem in select value::uuid from jsonb_array_elements_text(p_ids) with ordinality a group by value order by min(ordinality) loop
    if not exists(select 1 from public.problems where id=problem and platform='codeforces' and metadata_synced_at is not null) then raise exception 'CF_PROBLEM_REQUIRED' using errcode='23514'; end if;
    insert into public.training_plan_items(plan_id,user_id,problem_id,position) values(p_id,auth.uid(),problem,next_pos) on conflict(plan_id,problem_id) do nothing;
    if found then next_pos:=next_pos+1; end if;
  end loop;
  if (select count(*) from public.training_plan_items where plan_id=p_id)>500 then raise exception 'PLAN_TOO_LARGE' using errcode='23514'; end if;
end $$;
revoke all on function algopilot_private.add_plan_problems(uuid,jsonb) from public,anon,authenticated;

create function public.plan_write(p_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid:=(p_input->>'requestId')::uuid; action text:=p_input->>'action'; p public.training_plans; receipt algopilot_private.plan_receipts; fp text; result jsonb; item uuid; fields text[];
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if rid is null then raise exception 'REQUEST_REQUIRED' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('plan/'||uid::text,0));
  fp:=encode(extensions.digest(jsonb_build_object('id',p_id,'input',p_input)::text,'sha256'),'hex');
  select * into receipt from algopilot_private.plan_receipts where user_id=uid and request_id=rid;
  if found then
    if receipt.fingerprint<>fp then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if;
    return receipt.result;
  end if;
  fields:=case action when 'create' then array['action','requestId','name','description','problemIds'] when 'add' then array['action','requestId','revision','problemIds'] when 'remove' then array['action','requestId','revision','itemId'] when 'reorder' then array['action','requestId','revision','itemIds'] when 'status' then array['action','requestId','revision','itemId','status'] when 'edit' then array['action','requestId','revision','name','description','archived'] when 'delete' then array['action','requestId','revision'] else null end;
  if fields is null or p_input-fields<>'{}'::jsonb or not(p_input ?& fields) then raise exception 'INVALID_FIELDS' using errcode='23514'; end if;
  if action='create' then
    if p_id<>rid then raise exception 'INVALID_ID' using errcode='23514'; end if;
    insert into public.training_plans(id,user_id,name,description) values(p_id,uid,p_input->>'name',p_input->>'description') returning * into p;
    perform algopilot_private.add_plan_problems(p_id,p_input->'problemIds');
  else
    select * into p from public.training_plans where id=p_id and user_id=uid for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if p.revision is distinct from (p_input->>'revision')::integer then raise exception 'REVISION_CONFLICT' using errcode='PT409'; end if;
    if p.archived and action not in('edit','delete') then raise exception 'PLAN_ARCHIVED' using errcode='23514'; end if;
    if action='add' then perform algopilot_private.add_plan_problems(p_id,p_input->'problemIds');
    elsif action in('remove','status') then
      item:=(p_input->>'itemId')::uuid;
      if not exists(select 1 from public.training_plan_items where id=item and plan_id=p_id and user_id=uid) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
      if action='remove' then delete from public.training_plan_items where id=item;
      else update public.training_plan_items set manual_status=p_input->>'status' where id=item; end if;
    elsif action='reorder' then
      if jsonb_typeof(p_input->'itemIds')<>'array' or jsonb_array_length(p_input->'itemIds')<>(select count(*) from public.training_plan_items where plan_id=p_id)
        or (select count(distinct value) from jsonb_array_elements_text(p_input->'itemIds'))<>jsonb_array_length(p_input->'itemIds')
        or exists(select 1 from jsonb_array_elements_text(p_input->'itemIds') a where not exists(select 1 from public.training_plan_items where id=a.value::uuid and plan_id=p_id)) then raise exception 'INVALID_ORDER' using errcode='23514'; end if;
      update public.training_plan_items i set position=a.ordinality-1 from jsonb_array_elements_text(p_input->'itemIds') with ordinality a where i.id=a.value::uuid and i.plan_id=p_id;
    elsif action='edit' then update public.training_plans set name=p_input->>'name',description=p_input->>'description',archived=(p_input->>'archived')::boolean where id=p_id;
    elsif action='delete' then delete from public.training_plans where id=p_id;
    end if;
    if action<>'delete' then update public.training_plans set revision=revision+1,updated_at=clock_timestamp() where id=p_id; end if;
  end if;
  result:=jsonb_build_object('id',p_id,'deleted',action='delete');
  insert into algopilot_private.plan_receipts values(uid,rid,fp,result);
  return result;
end $$;
revoke all on function public.plan_write(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.plan_write(uuid,jsonb) to authenticated;

create function public.plan_detail(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.training_plans; items jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select * into p from public.training_plans where id=p_id and user_id=auth.uid();
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'position',i.position,'manual_status',i.manual_status,'problem',algopilot_private.cf_problem(pr),'officialStatus','not_synced',
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'outcome',s.outcome,'created_at',s.created_at,'linked',exists(select 1 from public.training_plan_sessions l where l.item_id=i.id and l.session_id=s.id)) order by s.created_at desc,s.id) from public.training_sessions s where s.problem_id=i.problem_id and s.user_id=auth.uid()),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'session_id',r.session_id,'created_at',r.created_at,'analyzed',exists(select 1 from public.review_requests rr where rr.review_id=r.id and rr.status='completed' and rr.analysis is not null)) order by r.created_at desc,r.id) from public.code_reviews r where r.problem_id=i.problem_id and r.user_id=auth.uid()),'[]'::jsonb)) order by i.position,i.id),'[]'::jsonb) into items from public.training_plan_items i join public.problems pr on pr.id=i.problem_id where i.plan_id=p_id;
  return jsonb_build_object('plan',to_jsonb(p)-'user_id','items',items);
end $$;
revoke all on function public.plan_detail(uuid) from public,anon,authenticated;
grant execute on function public.plan_detail(uuid) to authenticated;

create function public.start_cf_session(p_input jsonb) returns setof public.training_sessions
language plpgsql security definer set search_path='' as $$
declare fp text; receipt algopilot_private.plan_receipts; uid uuid:=auth.uid(); pid uuid:=(p_input->>'problemId')::uuid; iid uuid:=(p_input->>'itemId')::uuid; rid uuid:=(p_input->>'requestId')::uuid; s public.training_sessions; p public.training_plans; i public.training_plan_items;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if p_input-array['problemId','itemId','requestId','statementSnapshot','mode','timerEnabled','newSession']<>'{}'::jsonb or rid is null then raise exception 'INVALID_FIELDS' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('plan/'||uid::text,0));
  fp:=encode(extensions.digest(jsonb_build_object('operation','start_cf_session','input',p_input)::text,'sha256'),'hex');
  select * into receipt from algopilot_private.plan_receipts where user_id=uid and request_id=rid;
  if found then
    if receipt.fingerprint<>fp then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if;
    select * into s from public.training_sessions where id=(receipt.result->>'id')::uuid and user_id=uid;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    return next s;return;
  end if;
  if iid is not null then
    select * into i from public.training_plan_items where id=iid and user_id=uid;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    select * into p from public.training_plans where id=i.plan_id and user_id=uid for update;
    if p.archived then raise exception 'PLAN_ARCHIVED' using errcode='23514'; end if;
    if pid is not null and pid<>i.problem_id then raise exception 'INVALID_PROBLEM' using errcode='23514'; end if;
    pid:=i.problem_id;
  end if;
  if not exists(select 1 from public.problems where id=pid and platform='codeforces' and metadata_synced_at is not null) then raise exception 'CF_PROBLEM_REQUIRED' using errcode='23514'; end if;
  -- Explicit retries create the same learning record; resume only unfinished, matching mode.
  select * into s from public.training_sessions where user_id=uid and create_request_id=rid;
  if found and (s.problem_id<>pid or s.mode<>coalesce(p_input->>'mode','practice') or s.statement_snapshot<>coalesce(p_input->>'statementSnapshot','')) then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if;
  if s.id is null and iid is not null and not coalesce((p_input->>'newSession')::boolean,false) then
    select t.* into s from public.training_sessions t join public.training_plan_sessions l on l.session_id=t.id where l.item_id=iid and t.user_id=uid and t.status<>'completed' and t.mode=coalesce(p_input->>'mode','practice') order by t.created_at desc,t.id limit 1;
  end if;
  if s.id is null then
    if coalesce((p_input->>'timerEnabled')::boolean,false) then select * into s from public.create_training_session(pid,coalesce(p_input->>'statementSnapshot',''),coalesce(p_input->>'mode','practice'),rid);
    else select * into s from public.create_untimed_session(pid,coalesce(p_input->>'statementSnapshot',''),coalesce(p_input->>'mode','practice'),rid); end if;
  end if;
  if iid is not null then insert into public.training_plan_sessions values(iid,uid,s.id) on conflict do nothing; end if;
  insert into algopilot_private.plan_receipts values(uid,rid,fp,jsonb_build_object('id',s.id,'deleted',false));
  return next s;
end $$;
revoke all on function public.start_cf_session(jsonb) from public,anon,authenticated;
grant execute on function public.start_cf_session(jsonb) to authenticated;
-- Remove direct new-custom/blank training entry points. Legacy review definer continues internally.
revoke execute on function public.create_custom_problem(text,text,uuid),public.create_training_session(uuid,text,text,uuid),public.create_untimed_session(uuid,text,text,uuid) from public,anon,authenticated;

-- Per-session context is appended as thought evidence, leaving immutable original snapshot intact.
create function public.supplement_cf_context(p_id uuid,p_content text,p_revision integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.training_sessions;
begin
  s:=public.lock_owned_session(p_id);
  if not exists(select 1 from public.problems where id=s.problem_id and platform='codeforces') then raise exception 'CF_PROBLEM_REQUIRED' using errcode='23514'; end if;
  if exists(select 1 from public.thought_snapshots where session_id=p_id and request_id=p_request_id) then
    if not exists(select 1 from public.thought_snapshots where session_id=p_id and request_id=p_request_id and right(content,char_length(E'\n【用户补充的题面上下文】\n'||p_content))=E'\n【用户补充的题面上下文】\n'||p_content) then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if;
    return (select jsonb_build_object('session',to_jsonb(s),'thought',to_jsonb(t)) from public.thought_snapshots t where session_id=p_id and request_id=p_request_id);
  end if;
  if char_length(p_content)+char_length(s.thought_draft)>63000 then raise exception 'CONTEXT_TOO_LARGE' using errcode='23514'; end if;
  return public.append_training_thought(p_id,s.thought_draft||E'\n【用户补充的题面上下文】\n'||p_content,p_revision,p_request_id);
end $$;
revoke all on function public.supplement_cf_context(uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.supplement_cf_context(uuid,text,integer,uuid) to authenticated;

-- New standalone review UI selects a trusted CF problem. Existing legacy review RPC stays compatible.
create function public.create_cf_review(p_problem_id uuid,p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.training_sessions; pid uuid; rid uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if not exists(select 1 from public.problems where id=p_problem_id and platform='codeforces' and metadata_synced_at is not null) then raise exception 'CF_PROBLEM_REQUIRED' using errcode='23514'; end if;
  if nullif(p_input->>'sessionId','') is null then
    select * into s from public.start_cf_session(jsonb_build_object('problemId',p_problem_id,'requestId',p_input->>'requestId'));
    p_input:=jsonb_set(p_input,'{sessionId}',to_jsonb(s.id::text));
  else
    select problem_id into pid from public.training_sessions where id=(p_input->>'sessionId')::uuid and user_id=auth.uid();
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if pid is distinct from p_problem_id then raise exception 'PROBLEM_MISMATCH' using errcode='23514'; end if;
  end if;
  p_input:=jsonb_set(p_input,'{problemUrl}',to_jsonb(''::text));
  rid:=public.create_code_review(p_input);
  update public.code_reviews set problem_url=(select canonical_url from public.problems where id=p_problem_id) where id=rid and user_id=auth.uid();
  return rid;
end $$;
revoke all on function public.create_cf_review(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_cf_review(uuid,jsonb) to authenticated;

alter table algopilot_private.cf_settings enable row level security;
alter table algopilot_private.cf_cache_state enable row level security;
alter table algopilot_private.plan_receipts enable row level security;

commit;
