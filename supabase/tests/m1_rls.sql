-- 只在已应用全部当前迁移（含业务 PT409 修复）的隔离数据库运行；全部夹具和修改随最终 ROLLBACK 撤销。
begin;
insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000001', 'm1-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002', 'm1-b@example.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
declare p public.problems; s public.training_sessions; duplicate public.training_sessions; saved jsonb;
begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'PROFILE_RLS_FAILED'; end if;
  begin
    perform tags from public.problems;
    raise exception 'HIDDEN_TAGS_EXPOSED';
  exception when insufficient_privilege then null; end;
  select * into p from public.create_custom_problem('私人题 A', '私人题面 A', '20000000-0000-4000-8000-000000000001');
  perform set_config('m1_test.problem_id', p.id::text, true);
  select * into s from public.create_training_session(p.id, null, 'practice', '30000000-0000-4000-8000-000000000001');
  perform set_config('m1_test.session_id', s.id::text, true);
  if s.user_id <> auth.uid() or s.statement_snapshot <> '私人题面 A' or s.max_hint_seen <> 0 then raise exception 'CREATE_SESSION_FAILED'; end if;
  select * into duplicate from public.create_training_session(p.id, null, 'practice', '30000000-0000-4000-8000-000000000001');
  if duplicate.id <> s.id then raise exception 'CREATE_RETRY_NOT_IDEMPOTENT'; end if;
  select * into s from public.save_training_draft(s.id, 'code', 'int main() {}', 0);
  if s.code_revision <> 1 or s.code_draft <> 'int main() {}' then raise exception 'CODE_SAVE_FAILED'; end if;
  begin
    perform public.save_training_draft(s.id, 'code', 'stale code', 0);
    raise exception 'STALE_CODE_NOT_REJECTED';
  exception when sqlstate 'PT409' then null; end;
  saved := public.append_training_thought(s.id, '观察一', 0, '40000000-0000-4000-8000-000000000001');
  if (saved->'thought'->>'version')::integer <> 1 then raise exception 'FIRST_VERSION_FAILED'; end if;
  saved := public.append_training_thought(s.id, '观察一', 0, '40000000-0000-4000-8000-000000000001');
  if (select count(*) from public.thought_snapshots) <> 1 then raise exception 'THOUGHT_RETRY_DUPLICATED'; end if;
  begin
    perform public.append_training_thought(s.id, '旧窗口的观察', 0, '40000000-0000-4000-8000-000000000002');
    raise exception 'STALE_THOUGHT_NOT_REJECTED';
  exception when sqlstate 'PT409' then null; end;
  saved := public.append_training_thought(s.id, '观察二', 1, '40000000-0000-4000-8000-000000000003');
  if (saved->'thought'->>'version')::integer <> 2 or (select content from public.thought_snapshots where version = 1) <> '观察一' then raise exception 'APPEND_ONLY_FAILED'; end if;
  begin
    update public.thought_snapshots set content = '篡改';
    raise exception 'DIRECT_THOUGHT_WRITE_NOT_BLOCKED';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.thought_snapshots;
    raise exception 'DIRECT_THOUGHT_DELETE_NOT_BLOCKED';
  exception when insufficient_privilege then null; end;
  begin
    update public.training_sessions set user_id = '10000000-0000-4000-8000-000000000002', active_seconds = 99999;
    raise exception 'DIRECT_SESSION_WRITE_NOT_BLOCKED';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.training_sessions(user_id, create_request_id) values (auth.uid(), gen_random_uuid());
    raise exception 'DIRECT_SESSION_INSERT_NOT_BLOCKED';
  exception when insufficient_privilege then null; end;
  begin
    perform public.lock_owned_session(s.id);
    raise exception 'INTERNAL_FUNCTION_EXPOSED';
  exception when insufficient_privilege then null; end;
end;
$$;

-- 以数据库管理员仅调整测试夹具，避免依赖等待/真实时间流逝。
reset role;
update public.training_sessions set resumed_at = clock_timestamp() - interval '10 seconds'
  where id = current_setting('m1_test.session_id')::uuid;
set local role authenticated;
do $$
declare s public.training_sessions; duplicate public.training_sessions;
begin
  select * into s from public.transition_training_session(current_setting('m1_test.session_id')::uuid, 'pause', 0, null);
  if s.status <> 'paused' or s.active_seconds < 10 or s.active_seconds > 20 or s.resumed_at is not null then raise exception 'PAUSE_TIMER_FAILED'; end if;
  select * into duplicate from public.transition_training_session(s.id, 'pause', 0, null);
  if duplicate.active_seconds <> s.active_seconds or duplicate.state_revision <> s.state_revision then raise exception 'DOUBLE_PAUSE_ACCUMULATED'; end if;
  select * into s from public.transition_training_session(s.id, 'resume', 1, null);
  select * into duplicate from public.transition_training_session(s.id, 'resume', 1, null);
  if duplicate.resumed_at <> s.resumed_at or duplicate.state_revision <> 2 then raise exception 'DOUBLE_RESUME_RESET_TIMER'; end if;
  begin
    perform public.transition_training_session(s.id, 'pause', 0, null);
    raise exception 'STALE_TRANSITION_ALLOWED';
  exception when sqlstate 'PT409' then null; end;
  select * into s from public.transition_training_session(s.id, 'finish', 2, 'solved_self_reported');
  if s.status <> 'completed' or s.resumed_at is not null or s.outcome <> 'solved_self_reported' then raise exception 'FINISH_FAILED'; end if;
  select * into duplicate from public.transition_training_session(s.id, 'finish', 2, 'solved_self_reported');
  if duplicate.active_seconds <> s.active_seconds then raise exception 'DOUBLE_FINISH_ACCUMULATED'; end if;
  begin
    perform public.transition_training_session(s.id, 'resume', 3, null);
    raise exception 'COMPLETED_SESSION_RESUMED';
  exception when check_violation then null; end;
  begin
    perform public.save_training_draft(s.id, 'code', 'completed change', 1);
    raise exception 'COMPLETED_DRAFT_CHANGED';
  exception when check_violation then null; end;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select count(*) from public.profiles) <> 1 or (select count(*) from public.training_sessions) <> 0
     or (select count(*) from public.thought_snapshots) <> 0 or (select count(*) from public.problems) <> 0 then raise exception 'CROSS_USER_READ_LEAK'; end if;
  begin
    perform public.save_training_draft(current_setting('m1_test.session_id')::uuid, 'code', 'attack', 1);
    raise exception 'CROSS_USER_CODE_WRITE';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.append_training_thought(current_setting('m1_test.session_id')::uuid, 'attack', 2, gen_random_uuid());
    raise exception 'CROSS_USER_THOUGHT_WRITE';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.transition_training_session(current_setting('m1_test.session_id')::uuid, 'pause', 3, null);
    raise exception 'CROSS_USER_TRANSITION';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.create_training_session(current_setting('m1_test.problem_id')::uuid, null, 'practice', gen_random_uuid());
    raise exception 'CROSS_USER_PRIVATE_PROBLEM';
  exception when sqlstate 'P0002' then null; end;
end;
$$;

reset role;
insert into public.problems(platform, contest_id, problem_index, title, canonical_url)
  values ('codeforces', 999999, 'A', 'SQL 公共元数据测试夹具（非真实 CF 调用）', 'https://codeforces.com/problemset/problem/999999/A');
do $$
begin
  begin
    insert into public.problems(platform, contest_id, problem_index, title, statement, canonical_url)
      values ('codeforces', 999998, 'A', '公开记录不得含私人题面', 'secret', 'https://codeforces.com/problemset/problem/999998/A');
    raise exception 'PUBLIC_STATEMENT_ALLOWED';
  exception when check_violation then null; end;
  begin
    update public.training_sessions set created_at = clock_timestamp() + interval '1 day' where id = current_setting('m1_test.session_id')::uuid;
    raise exception 'CREATION_TIME_MUTABLE';
  exception when check_violation then null; end;
  begin
    update public.thought_snapshots set content = 'privileged rewrite' where session_id = current_setting('m1_test.session_id')::uuid;
    raise exception 'HISTORY_TRIGGER_MISSING';
  exception when check_violation then null; end;
end;
$$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if (select count(*) from public.problems) <> 1 then raise exception 'ANON_PROBLEM_VISIBILITY_FAILED'; end if;
  begin
    perform count(*) from public.training_sessions;
    raise exception 'ANON_PRIVATE_READ_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_training_session(null, null, 'practice', gen_random_uuid());
    raise exception 'ANON_RPC_ALLOWED';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
