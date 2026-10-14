begin;
do $$ begin
 if to_regprocedure('public.learning_candidates(jsonb)') is null or to_regclass('algopilot_private.recommendation_restrictions') is null then raise exception 'APPLY_007_008_009_FIRST'; end if;
end $$;
create function algopilot_private.cf_new_cursor(p_stop bigint default null) returns jsonb language sql volatile set search_path='' as $$
 select jsonb_build_object('from',1,'anchor',null,'top',null,'stop',p_stop,'cycle',gen_random_uuid(),'probe',false,'done',false,'gaps',0)
$$;
revoke all on function algopilot_private.cf_new_cursor(bigint) from public,anon,authenticated;
create table algopilot_private.cf_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 scope_id uuid not null default gen_random_uuid(), handle text, registration_seconds bigint,
 enabled boolean not null default false, revision integer not null default 0 check(revision>=0), evidence_revision bigint not null default 0,
 last_synced_at timestamptz, last_full_scan_at timestamptz, full_scan_upper_id bigint, oldest_observed_at timestamptz, high_water bigint,
 head jsonb not null default algopilot_private.cf_new_cursor(), history jsonb not null default algopilot_private.cf_new_cursor(),
 status text not null default 'unlinked' check(status in('unlinked','never','partial','idle','syncing','failed')), error_code text,
 lease_nonce uuid, lease_until timestamptz, run_id uuid, lease_kind text, requested_handle text, intent jsonb,
 next_attempt_at timestamptz not null default '-infinity',
 check((handle is null)=(registration_seconds is null)), check(handle is null or handle ~ '^[A-Za-z0-9_.-]{3,24}$')
);
create table algopilot_private.cf_submissions (
 id uuid not null default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, scope_id uuid not null,
 submission_id bigint not null check(submission_id between 1 and 9007199254740991), contest_id integer, problem_index text,
 created_at timestamptz not null, verdict text, observed_from integer not null check(observed_from>0),
 collected_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 scan_cycle uuid, active boolean not null default true,
 primary key(user_id,scope_id,submission_id), unique(id),
 check((contest_id is null)=(problem_index is null)), check(contest_id is null or contest_id>0),
 check(problem_index is null or problem_index ~ '^[A-Z0-9]{1,12}$'), check(verdict is null or verdict ~ '^[A-Z_]{1,60}$')
);
create index cf_submissions_accepted on algopilot_private.cf_submissions(user_id,scope_id,contest_id,problem_index,submission_id desc) where verdict='OK' and active;
create index cf_submissions_pending on algopilot_private.cf_submissions(user_id,scope_id,updated_at) where verdict is null or verdict in('TESTING','SUBMITTED');
create table algopilot_private.cf_account_receipts (
 user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null, fingerprint text not null, result jsonb not null,
 primary key(user_id,request_id)
);
alter table algopilot_private.cf_accounts enable row level security;
alter table algopilot_private.cf_submissions enable row level security;
alter table algopilot_private.cf_account_receipts enable row level security;
revoke all on algopilot_private.cf_accounts,algopilot_private.cf_submissions,algopilot_private.cf_account_receipts from public,anon,authenticated;

create function algopilot_private.cf_advance_cursor(c jsonb,ids bigint[],new_cycle uuid,is_head boolean) returns jsonb language plpgsql set search_path='' as $$
declare n integer:=coalesce(cardinality(ids),0); top_id bigint:=coalesce((c->>'top')::bigint,ids[1]); result jsonb;
begin
 ids:=coalesce(ids,'{}'::bigint[]);
 if (c->>'done')::boolean then raise exception 'CURSOR_FINISHED' using errcode='PT409'; end if;
 if n=0 and ((c->>'from')::integer=1 or (c->>'probe')::boolean) then return c||'{"done":true}'::jsonb; end if;
 if (c->>'probe')::boolean or (c->>'anchor' is not null and not((c->>'anchor')::bigint=any(ids))) then
  result:=algopilot_private.cf_new_cursor((c->>'stop')::bigint);
  return result||jsonb_build_object('cycle',new_cycle,'gaps',(c->>'gaps')::integer+1);
 end if;
 if is_head and (c->>'stop' is null or exists(select 1 from unnest(ids) id where id<=(c->>'stop')::bigint)) then return c||jsonb_build_object('top',top_id,'done',true); end if;
 return c||jsonb_build_object('top',top_id,'anchor',ids[n],'from',(c->>'from')::integer+case when n<200 then n else 160 end,'probe',n<200,'done',false);
end $$;
revoke all on function algopilot_private.cf_advance_cursor(jsonb,bigint[],uuid,boolean) from public,anon,authenticated;

create function public.cf_account_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a algopilot_private.cf_accounts; observed integer; accepted integer; pending integer;
begin
 if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
 select * into a from algopilot_private.cf_accounts where user_id=uid;
 select count(*),count(*) filter(where verdict is null or verdict in('TESTING','SUBMITTED')) into observed,pending from algopilot_private.cf_submissions where user_id=uid and scope_id=a.scope_id and active;
 select count(*) into accepted from (select distinct contest_id,problem_index from algopilot_private.cf_submissions where user_id=uid and scope_id=a.scope_id and active and verdict='OK' and contest_id is not null) s;
 return jsonb_build_object('version','cf-evidence/1','revision',coalesce(a.revision,0),'evidenceRevision',coalesce(a.evidence_revision,0),'handle',a.handle,'ownershipVerified',false,'enabled',coalesce(a.enabled,false),
 'lastSyncedAt',a.last_synced_at,'lastFullScanAt',a.last_full_scan_at,'fullScanUpperId',a.full_scan_upper_id,'oldestObservedAt',a.oldest_observed_at,'highWater',a.high_water,
 'historyFrom',coalesce((a.history->>'from')::integer,1),'historyInProgress',a.handle is not null and coalesce(not(a.history->>'done')::boolean,false),'observedSubmissions',observed,'acceptedProblems',accepted,'pendingSubmissions',pending,
 'status',coalesce(a.status,'unlinked'),'errorCode',a.error_code);
end $$;
revoke all on function public.cf_account_state() from public,anon,authenticated;
grant execute on function public.cf_account_state() to authenticated;

create function public.cf_account_command(p_payload text,p_signature text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb; uid uuid:=auth.uid(); a algopilot_private.cf_accounts; op text; rid uuid; fp text; receipt algopilot_private.cf_account_receipts; result jsonb;
 now_at timestamptz:=clock_timestamp(); ids bigint[]; cur jsonb; next_cur jsonb; requested_from integer; kind text; rows_json jsonb; canonical text; registry bigint;
begin
 v:=algopilot_private.verify_cf(p_payload,p_signature,'cf_account'); op:=v->>'action';
 if v-array['operation','userId','expiresAt','action','requestId','revision','kind','handle','registrationSeconds','enabled','nonce','scope','purpose','from','submissions','resetCycle','errorCode']<>'{}'::jsonb then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,32));
 insert into algopilot_private.cf_accounts(user_id) values(uid) on conflict do nothing;
 select * into a from algopilot_private.cf_accounts where user_id=uid for update;
 now_at:=clock_timestamp(); -- after per-user contention
 if op='reserve' then
  if v->>'kind' not in('bind','enable','sync') or v->>'requestId' is null or jsonb_typeof(v->'revision') is distinct from 'number' then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  rid:=(v->>'requestId')::uuid; fp:=encode(extensions.digest((v-array['operation','userId','expiresAt'])::text,'sha256'),'hex');
  select * into receipt from algopilot_private.cf_account_receipts where user_id=uid and request_id=rid;
  if found then if receipt.fingerprint<>fp then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if; return jsonb_build_object('acquired',false,'replayed',true); end if;
  if (v->>'revision')::numeric<>a.revision then raise exception 'REVISION_CONFLICT' using errcode='PT409'; end if;
  if a.lease_until>now_at then
   if a.run_id=rid and a.lease_kind=v->>'kind' and a.intent=v-array['operation','userId','expiresAt'] then
    return jsonb_build_object('acquired',true,'nonce',a.lease_nonce,'scope',a.scope_id,'handle',coalesce(a.requested_handle,a.handle),'registrationSeconds',a.registration_seconds);
   end if;
   return jsonb_build_object('acquired',false);
  end if;
  if a.next_attempt_at>now_at then return jsonb_build_object('acquired',false); end if;
  kind:=v->>'kind'; canonical:=case when kind='bind' then v->>'handle' else a.handle end;
  if canonical is null or canonical!~'^[A-Za-z0-9_.-]{3,24}$' then raise exception 'INVALID_HANDLE' using errcode='23514'; end if;
  update algopilot_private.cf_accounts set lease_nonce=gen_random_uuid(),lease_until=now_at+interval '3 minutes',run_id=rid,lease_kind=kind,requested_handle=case when kind='bind' then canonical else null end,
   intent=v-array['operation','userId','expiresAt'],next_attempt_at=now_at+interval '5 seconds',status=case when kind='sync' then 'syncing' else status end,
   head=case when kind='sync' and (head->>'done')::boolean then algopilot_private.cf_new_cursor(high_water) else head end,
   history=case when kind='sync' and (history->>'done')::boolean then algopilot_private.cf_new_cursor() else history end
   where user_id=uid returning * into a;
  return jsonb_build_object('acquired',true,'nonce',a.lease_nonce,'scope',a.scope_id,'handle',canonical,'registrationSeconds',a.registration_seconds);
 end if;
 if op in('unlink','delete','consent') then
  if v->>'requestId' is null or jsonb_typeof(v->'revision') is distinct from 'number' then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  rid:=(v->>'requestId')::uuid; fp:=encode(extensions.digest((v-array['operation','userId','expiresAt'])::text,'sha256'),'hex');
  select * into receipt from algopilot_private.cf_account_receipts where user_id=uid and request_id=rid;
  if found then if receipt.fingerprint<>fp then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if; return jsonb_build_object('accepted',true); end if;
  if (v->>'revision')::numeric<>a.revision then raise exception 'REVISION_CONFLICT' using errcode='PT409'; end if;
  if op='consent' then
   if jsonb_typeof(v->'enabled') is distinct from 'boolean' or (v->>'enabled')::boolean then raise exception 'SIGNED_IDENTITY_CHECK_REQUIRED' using errcode='23514'; end if;
   update algopilot_private.cf_accounts set enabled=false,revision=revision+1,evidence_revision=evidence_revision+1,lease_nonce=null,lease_until=null,next_attempt_at='-infinity',status=case when handle is null then 'unlinked' else 'partial' end where user_id=uid;
  else
   delete from algopilot_private.cf_submissions where user_id=uid;
   delete from algopilot_private.cf_account_receipts where user_id=uid;
   update algopilot_private.cf_accounts set scope_id=gen_random_uuid(),handle=null,registration_seconds=null,enabled=false,revision=revision+1,evidence_revision=evidence_revision+1,
    last_synced_at=null,last_full_scan_at=null,full_scan_upper_id=null,oldest_observed_at=null,high_water=null,head=algopilot_private.cf_new_cursor(),history=algopilot_private.cf_new_cursor(),status='unlinked',error_code=null,
    lease_nonce=null,lease_until=null,run_id=null,lease_kind=null,requested_handle=null,intent=null,next_attempt_at='-infinity' where user_id=uid;
  end if;
  insert into algopilot_private.cf_account_receipts values(uid,rid,fp,'{"accepted":true}'::jsonb);
  return jsonb_build_object('accepted',true);
 end if;
 if a.lease_nonce is null or (v->>'nonce')::uuid is distinct from a.lease_nonce or a.lease_until<=now_at or (v->>'scope')::uuid is distinct from a.scope_id then raise exception 'INVALID_LEASE' using errcode='PT409'; end if;
 if op='slot' then
  perform 1 from algopilot_private.cf_cache_state where singleton for update;
  now_at:=clock_timestamp(); -- reserve from acquisition time, not before the lock wait
  if (select next_slot_at from algopilot_private.cf_cache_state where singleton)>now_at then
   return jsonb_build_object('waitMs',ceil(extract(epoch from (select next_slot_at from algopilot_private.cf_cache_state where singleton)-now_at)*1000));
  end if;
  update algopilot_private.cf_cache_state set next_slot_at=now_at+interval '3 seconds' where singleton;
  return jsonb_build_object('waitMs',0);
 elsif op in('bind','enable','identity') then
  canonical:=v->>'handle'; registry:=(v->>'registrationSeconds')::bigint;
  if canonical is null or canonical!~'^[A-Za-z0-9_.-]{3,24}$' or registry is null or registry<0 then raise exception 'INVALID_IDENTITY' using errcode='23514'; end if;
  if lower(canonical) is distinct from lower(coalesce(a.requested_handle,a.handle)) then raise exception 'IDENTITY_CHANGED' using errcode='PT409'; end if;
  if op<>'bind' and registry is distinct from a.registration_seconds then raise exception 'IDENTITY_CHANGED' using errcode='PT409'; end if;
  if op='identity' then if a.lease_kind<>'sync' then raise exception 'INVALID_OPERATION' using errcode='23514'; end if; return jsonb_build_object('accepted',true); end if;
  if a.lease_kind is distinct from (case when op='bind' then 'bind' else 'enable' end) then raise exception 'INVALID_OPERATION' using errcode='23514'; end if;
  fp:=encode(extensions.digest(a.intent::text,'sha256'),'hex'); rid:=a.run_id;
  if op='bind' then
   delete from algopilot_private.cf_submissions where user_id=uid;
   delete from algopilot_private.cf_account_receipts where user_id=uid;
   update algopilot_private.cf_accounts set scope_id=gen_random_uuid(),handle=canonical,registration_seconds=registry,enabled=false,revision=revision+1,evidence_revision=evidence_revision+1,
    head=algopilot_private.cf_new_cursor(),history=algopilot_private.cf_new_cursor(),high_water=null,last_synced_at=null,last_full_scan_at=null,full_scan_upper_id=null,oldest_observed_at=null,status='never',error_code=null,
    lease_nonce=null,lease_until=null,run_id=null,lease_kind=null,requested_handle=null,intent=null,next_attempt_at='-infinity' where user_id=uid;
  else
   update algopilot_private.cf_accounts set enabled=true,revision=revision+1,evidence_revision=evidence_revision+1,lease_nonce=null,lease_until=null,error_code=null,next_attempt_at='-infinity' where user_id=uid;
  end if;
  insert into algopilot_private.cf_account_receipts values(uid,rid,fp,'{"accepted":true}'::jsonb);
  return jsonb_build_object('accepted',true);
 elsif op='plan' then
  if a.lease_kind<>'sync' then raise exception 'INVALID_OPERATION' using errcode='23514'; end if;
  select greatest(1,observed_from-40) into requested_from from algopilot_private.cf_submissions where user_id=uid and scope_id=a.scope_id and active and (verdict is null or verdict in('TESTING','SUBMITTED')) order by updated_at,submission_id limit 1;
  return jsonb_build_object('head',a.head,'history',a.history,'pendingFrom',requested_from);
 elsif op='page' then
  if a.lease_kind<>'sync' or v->>'purpose' not in('head','history','pending') or v->>'requestId' is null or jsonb_typeof(v->'submissions') is distinct from 'array' or jsonb_array_length(v->'submissions')>200 then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  rows_json:=v->'submissions'; requested_from:=(v->>'from')::integer; rid:=(v->>'requestId')::uuid;
  if requested_from<1 then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  fp:=encode(extensions.digest((v-array['operation','userId','expiresAt'])::text,'sha256'),'hex');
  select * into receipt from algopilot_private.cf_account_receipts where user_id=uid and request_id=rid;
  if found then if receipt.fingerprint<>fp then raise exception 'REQUEST_CONFLICT' using errcode='PT409'; end if; return receipt.result; end if;
  if exists(select 1 from jsonb_array_elements(rows_json) x where jsonb_typeof(x) is distinct from 'object' or x-array['submissionId','contestId','index','createdSeconds','verdict']<>'{}'::jsonb or not(x ?& array['submissionId','contestId','index','createdSeconds','verdict'])
   or (x->>'submissionId')::numeric not between 1 and 9007199254740991 or (x->>'submissionId')::numeric<>(x->>'submissionId')::bigint or (x->>'createdSeconds')::numeric not between 0 and 253402300799
   or (x->>'createdSeconds')::numeric<>(x->>'createdSeconds')::bigint or ((x->>'contestId' is null)<>(x->>'index' is null)) or (x->>'contestId' is not null and ((x->>'contestId')::integer<=0 or x->>'index'!~'^[A-Z0-9]{1,12}$')) or (x->>'verdict' is not null and x->>'verdict'!~'^[A-Z_]{1,60}$')) then raise exception 'INVALID_SUBMISSIONS' using errcode='23514'; end if;
  select array_agg((x->>'submissionId')::bigint order by pos) into ids from jsonb_array_elements(rows_json) with ordinality e(x,pos);
  if exists(select 1 from unnest(ids) with ordinality e(id,pos) where pos>1 and id>=ids[pos-1]) then raise exception 'INVALID_SUBMISSIONS' using errcode='23514'; end if;
  if v->>'purpose'<>'pending' then
   cur:=case when v->>'purpose'='head' then a.head else a.history end;
   if requested_from<>(cur->>'from')::integer then raise exception 'CHECKPOINT_CONFLICT' using errcode='PT409'; end if;
   next_cur:=algopilot_private.cf_advance_cursor(cur,ids,(v->>'resetCycle')::uuid,v->>'purpose'='head');
  end if;
  if exists(select 1 from jsonb_array_elements(rows_json) x join algopilot_private.cf_submissions s on s.user_id=uid and s.scope_id=a.scope_id and s.submission_id=(x->>'submissionId')::bigint
   where s.contest_id is distinct from (x->>'contestId')::integer or s.problem_index is distinct from x->>'index' or s.created_at is distinct from to_timestamp((x->>'createdSeconds')::bigint)) then raise exception 'SUBMISSION_IDENTITY_CONFLICT' using errcode='PT409'; end if;
  insert into algopilot_private.cf_submissions(user_id,scope_id,submission_id,contest_id,problem_index,created_at,verdict,observed_from,scan_cycle)
   select uid,a.scope_id,(x->>'submissionId')::bigint,(x->>'contestId')::integer,x->>'index',to_timestamp((x->>'createdSeconds')::bigint),x->>'verdict',requested_from+pos::integer-1,
    case when v->>'purpose'='history' then (cur->>'cycle')::uuid else null end from jsonb_array_elements(rows_json) with ordinality e(x,pos)
   on conflict(user_id,scope_id,submission_id) do update set verdict=excluded.verdict,observed_from=excluded.observed_from,updated_at=now_at,active=true,
    scan_cycle=case when v->>'purpose'='history' then excluded.scan_cycle else algopilot_private.cf_submissions.scan_cycle end;
  if v->>'purpose'='history' and (next_cur->>'done')::boolean then
   -- A confirmed empty scan from position 1 has no top ID: withdraw all old
   -- observed rows, rather than leaving them active behind a fabricated 0 bound.
   update algopilot_private.cf_submissions set active=false,updated_at=now_at where user_id=uid and scope_id=a.scope_id and ((cur->>'top') is null or submission_id<=(cur->>'top')::bigint) and scan_cycle is distinct from (cur->>'cycle')::uuid;
  end if;
  update algopilot_private.cf_accounts set evidence_revision=evidence_revision+1,last_synced_at=now_at,error_code=null,
   oldest_observed_at=(select min(created_at) from algopilot_private.cf_submissions where user_id=uid and scope_id=a.scope_id and active),
   head=case when v->>'purpose'='head' then next_cur else head end,history=case when v->>'purpose'='history' then next_cur else history end,
   high_water=case when v->>'purpose'='head' and (next_cur->>'done')::boolean then (next_cur->>'top')::bigint else high_water end,
   last_full_scan_at=case when v->>'purpose'='history' and (next_cur->>'done')::boolean then now_at else last_full_scan_at end,
   full_scan_upper_id=case when v->>'purpose'='history' and (next_cur->>'done')::boolean then (next_cur->>'top')::bigint else full_scan_upper_id end
   where user_id=uid;
  insert into algopilot_private.cf_account_receipts values(uid,rid,fp,'{"accepted":true}'::jsonb);
  return jsonb_build_object('accepted',true);
 elsif op in('finish','fail') then
  fp:=encode(extensions.digest(a.intent::text,'sha256'),'hex');rid:=a.run_id;
  if op='fail' and (v->>'errorCode' is null or v->>'errorCode' not in('invalid_handle','identity_changed','rate_limit','http','invalid_response','network','database','budget')) then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  update algopilot_private.cf_accounts set status=case when op='fail' then 'failed' when last_full_scan_at is not null and (head->>'done')::boolean and (history->>'done')::boolean then 'idle' else 'partial' end,
   error_code=case when op='fail' then v->>'errorCode' else null end, lease_nonce=null,lease_until=null,requested_handle=null,
   enabled=case when op='fail' and v->>'errorCode' in('invalid_handle','identity_changed') and lease_kind<>'bind' then false else enabled end,
   revision=revision+case when op='fail' and v->>'errorCode' in('invalid_handle','identity_changed') and lease_kind<>'bind' then 1 else 0 end,
   evidence_revision=evidence_revision+case when op='fail' and v->>'errorCode' in('invalid_handle','identity_changed') and lease_kind<>'bind' then 1 else 0 end,
   next_attempt_at=case when op='fail' then now_at+interval '30 seconds' else now_at end where user_id=uid;
  if op='finish' then insert into algopilot_private.cf_account_receipts values(uid,rid,fp,'{"accepted":true}'::jsonb) on conflict do nothing; end if;
  return jsonb_build_object('accepted',true);
 end if;
 raise exception 'INVALID_OPERATION' using errcode='23514';
end $$;
revoke all on function public.cf_account_command(text,text) from public,anon,authenticated;
grant execute on function public.cf_account_command(text,text) to authenticated;

create function algopilot_private.cf_official_evidence() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a algopilot_private.cf_accounts; items jsonb:='[]'::jsonb; n integer:=0;
begin
 if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
 select * into a from algopilot_private.cf_accounts where user_id=uid;
 if a.enabled and a.handle is not null then
  select count(*) into n from (select distinct contest_id,problem_index from algopilot_private.cf_submissions where user_id=uid and scope_id=a.scope_id and verdict='OK' and active and contest_id is not null) distinct_problems;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'submissionId',r.submission_id,'contestId',r.contest_id,'index',r.problem_index,'problemId',p.id,
    'rating',p.rating,'tags',coalesce(p.tags,'{}'::text[]),'createdAt',r.created_at,'observedAt',r.updated_at) order by r.created_at desc,r.submission_id desc),'[]'::jsonb) into items
  from (select * from (select distinct on(contest_id,problem_index) * from algopilot_private.cf_submissions where user_id=uid and scope_id=a.scope_id and verdict='OK' and active and contest_id is not null
   order by contest_id,problem_index,submission_id desc) latest order by created_at desc,submission_id desc limit 500) r
  left join public.problems p on p.platform='codeforces' and p.contest_id=r.contest_id and p.problem_index=r.problem_index and p.catalog_version=(select version from algopilot_private.cf_cache_state where singleton);
 end if;
 return jsonb_build_object('revision',coalesce(a.evidence_revision,0),'enabled',coalesce(a.enabled,false),'handle',a.handle,'ownershipVerified',false,'totalAcceptedProblems',n,
  'lastSyncedAt',a.last_synced_at,'lastFullScanAt',a.last_full_scan_at,'fullScanUpperId',a.full_scan_upper_id,'oldestObservedAt',a.oldest_observed_at,'items',items);
end $$;
revoke all on function algopilot_private.cf_official_evidence() from public,anon,authenticated;
create or replace function public.learning_evidence() returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); pref jsonb; rev integer; sessions jsonb; reviews jsonb; feedback jsonb;
begin
 if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,32));
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
 return jsonb_build_object('preferences',pref,'revision',coalesce(rev,0),'totalSessions',(select count(*) from public.training_sessions where user_id=uid),'sessions',sessions,'reviews',reviews,'feedback',feedback,'official',algopilot_private.cf_official_evidence());
end $$;
revoke all on function public.learning_evidence() from public,anon,authenticated;
grant execute on function public.learning_evidence() to authenticated;

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
   and not ('interactive'=any(p.tags))
   and not exists(select 1 from algopilot_private.recommendation_restrictions r where r.contest_id=p.contest_id and (r.problem_index is null or r.problem_index=p.problem_index) and r.status='source_checked_by_ai')
   and p.rating between (p_query->>'min')::integer and (p_query->>'max')::integer
   and (jsonb_array_length(p_query->'themes')=0 or p.tags && array(select jsonb_array_elements_text(p_query->'themes')))
   and ((p_query->>'repeat')::boolean or not exists(select 1 from algopilot_private.cf_accounts ca join algopilot_private.cf_submissions cs on cs.user_id=ca.user_id and cs.scope_id=ca.scope_id
    where ca.user_id=uid and ca.enabled and ca.handle is not null and cs.verdict='OK' and cs.active and cs.contest_id=p.contest_id and cs.problem_index=p.problem_index))
   and ((p_query->>'repeat')::boolean or not exists(select 1 from public.training_sessions s where s.user_id=uid and s.problem_id=p.id and s.outcome='solved_self_reported') and not exists(select 1 from public.code_reviews r where r.user_id=uid and r.problem_id=p.id))
 ), spread as (
  select f.*,row_number() over(partition by array(select distinct t from unnest(f.tags) t order by t) order by abs(f.rating-(p_query->>'target')::integer),f.in_plan,f.practiced,md5(f.contest_id::text||'/'||f.problem_index),f.id) topic_rank from filtered f
 ), shortlist as (select * from spread order by topic_rank,abs(rating-(p_query->>'target')::integer),in_plan,practiced,md5(contest_id::text||'/'||problem_index),id limit 600)
 select (select count(*) from filtered),coalesce(jsonb_agg(jsonb_build_object('id',s.id,'contestId',s.contest_id,'index',s.problem_index,'name',s.title,'rating',s.rating,'tags',s.tags,'solvedCount',s.solved_count)||jsonb_build_object('inPlan',s.in_plan,'practiced',s.practiced) order by s.topic_rank,abs(s.rating-(p_query->>'target')::integer),s.in_plan,s.practiced,md5(s.contest_id::text||'/'||s.problem_index),s.id),'[]'::jsonb)
 into n,result from shortlist s;
 return jsonb_build_object('items',result,'total',n,'policyVersion','training-fit/1');
end $$;
revoke all on function public.learning_candidates(jsonb) from public,anon,authenticated;
grant execute on function public.learning_candidates(jsonb) to authenticated;
create function public.learning_evidence_guard(p_revision integer,p_official_revision bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rev integer; official_rev bigint;
begin
 if uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,32));
 select revision into rev from public.learning_preferences where user_id=uid;
 select evidence_revision into official_rev from algopilot_private.cf_accounts where user_id=uid;
 if coalesce(rev,0) is distinct from p_revision or coalesce(official_rev,0) is distinct from p_official_revision then raise exception 'LEARNING_EVIDENCE_CHANGED' using errcode='PT409'; end if;
 return true;
end $$;
revoke all on function public.learning_evidence_guard(integer,bigint) from public,anon,authenticated;
grant execute on function public.learning_evidence_guard(integer,bigint) to authenticated;
-- Native multi-connection audit reproduced the 006 pre-lock clock bug.
-- Preserve its signature/ACL/publication contract; only the timestamp position changes.
create or replace function public.cf_sync(p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; s algopilot_private.cf_cache_state; nonce uuid; version_id uuid; now_at timestamptz:=clock_timestamp(); op text; rows_count integer;
begin
  v:=algopilot_private.verify_cf(p_payload,p_signature,'cf_sync'); op:=v->>'action';
  select * into s from algopilot_private.cf_cache_state where singleton for update;
  now_at:=clock_timestamp(); -- refresh after acquiring the shared slot/lease row
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


commit;
