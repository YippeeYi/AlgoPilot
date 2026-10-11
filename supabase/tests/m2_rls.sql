-- Run only against an isolated migrated test database. Entire test rolls back.
begin;
insert into auth.users(id,email) values('20000000-0000-4000-8000-000000000011','m2-sql@fixture.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000011',true);
select set_config('test.m2_session',(select id::text from public.create_training_session(null,'private','practice',gen_random_uuid())),true);
do $$ begin
  begin insert into public.hint_events default values; raise exception 'hint forgery allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.tutor_messages default values; raise exception 'assistant forgery allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.llm_usage default values; raise exception 'usage forgery allowed'; exception when insufficient_privilege then null; end;
  begin perform * from algopilot_private.tutor_settings; raise exception 'secret readable'; exception when insufficient_privilege then null; end;
  if (public.tutor_state(current_setting('test.m2_session')::uuid)->>'allowedLevel')::integer <> 0 then raise exception 'default not L0'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000012',true);
do $$ begin
  begin perform public.tutor_state(current_setting('test.m2_session')::uuid); raise exception 'cross user access allowed'; exception when no_data_found then null; end;
end $$;
set local role anon;
do $$ begin
  begin perform public.tutor_state(current_setting('test.m2_session')::uuid); raise exception 'anon access allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
