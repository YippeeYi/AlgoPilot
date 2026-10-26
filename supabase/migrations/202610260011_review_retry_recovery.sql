-- Local M3.5.3 review retry recovery. Apply only with explicit target authorization.
-- 001–010 are unchanged. Completed replays, HMAC, owner checks, quotas and leases remain.
begin;

create or replace function public.review_reserve(p_payload text,p_signature text) returns jsonb
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
    -- A same-ID retry must not stay busy forever after a crashed worker.
    -- No row update before raising: the next explicit new ID expires old leases below.
    if q.status='failed' or (q.status='pending' and q.lease_until<=clock_timestamp()) then
      raise exception 'use new request' using errcode='AP006';
    end if;
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

revoke all on function public.review_reserve(text,text) from public,anon,authenticated;
grant execute on function public.review_reserve(text,text) to authenticated;

commit;
