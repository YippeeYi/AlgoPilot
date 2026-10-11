begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  cf_handle text check (cf_handle is null or char_length(cf_handle) between 1 and 24),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  platform text not null check (platform in ('custom', 'codeforces')),
  contest_id integer check (contest_id > 0),
  problem_index text check (problem_index ~ '^[A-Z][0-9]?$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  statement text check (char_length(statement) <= 64000),
  rating integer check (rating between 0 and 10000),
  tags text[] not null default '{}',
  canonical_url text,
  create_request_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (platform = 'custom' and owner_id is not null and contest_id is null and problem_index is null and canonical_url is null)
    or (platform = 'codeforces' and owner_id is null and statement is null and create_request_id is null and contest_id is not null and problem_index is not null
      and canonical_url is not null and canonical_url = 'https://codeforces.com/problemset/problem/' || contest_id::text || '/' || problem_index)
  ),
  unique (owner_id, create_request_id)
);
create unique index problems_external_key on public.problems(platform, contest_id, problem_index) where platform = 'codeforces';
create index problems_owner_created on public.problems(owner_id, created_at desc);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  problem_id uuid references public.problems(id) on delete set null,
  statement_snapshot text not null default '' check (char_length(statement_snapshot) <= 64000),
  mode text not null default 'practice' check (mode in ('practice', 'contest')),
  phase text not null default 'thinking' check (phase in ('thinking', 'implementing', 'checking', 'finished')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  started_at timestamptz not null default clock_timestamp(),
  resumed_at timestamptz default clock_timestamp(),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  ended_at timestamptz,
  max_hint_seen smallint not null default 0 check (max_hint_seen between 0 and 5),
  outcome text check (outcome in ('not_recorded', 'solved_self_reported', 'unsolved', 'abandoned')),
  used_external_editorial boolean,
  code_draft text not null default '' check (char_length(code_draft) <= 64000),
  code_revision integer not null default 0 check (code_revision >= 0),
  thought_draft text not null default '' check (char_length(thought_draft) <= 64000),
  thought_revision integer not null default 0 check (thought_revision >= 0),
  state_revision integer not null default 0 check (state_revision >= 0),
  create_request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, create_request_id),
  check ((status = 'active' and resumed_at is not null and ended_at is null and outcome is null)
    or (status = 'paused' and resumed_at is null and ended_at is null and outcome is null)
    or (status = 'completed' and resumed_at is null and ended_at is not null and outcome is not null and phase = 'finished')),
  check (ended_at is null or ended_at >= started_at)
);
create index sessions_owner_created on public.training_sessions(user_id, created_at desc, id);
create index sessions_owner_status on public.training_sessions(user_id, status);
create index sessions_problem on public.training_sessions(problem_id);

create table public.thought_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  version integer not null check (version > 0),
  content text not null check (char_length(content) between 1 and 64000),
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (session_id, version),
  unique (session_id, request_id)
);
create index thoughts_session_created on public.thought_snapshots(session_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.problems enable row level security;
alter table public.training_sessions enable row level security;
alter table public.thought_snapshots enable row level security;

create policy profiles_owner_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy problems_visible_read on public.problems for select to anon, authenticated using (platform = 'codeforces' or owner_id = (select auth.uid()));
create policy sessions_owner_read on public.training_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy thoughts_owner_read on public.thought_snapshots for select to authenticated using (
  exists (select 1 from public.training_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
);

-- 不授予客户端 DML。普通 JWT 调用下列窄范围 RPC，身份取自 auth.uid()。
-- SECURITY DEFINER 仅用于服务器时间、行锁、CAS、追加版本等受控写入；不使用 service-role SDK。
revoke all on public.profiles, public.problems, public.training_sessions, public.thought_snapshots from public, anon, authenticated;
-- 算法 tags 不授予浏览器直接读取；训练 API 也不返回这些字段。
grant select (id, owner_id, platform, contest_id, problem_index, title, statement, rating, canonical_url, create_request_id, created_at) on public.problems to anon, authenticated;
grant select on public.profiles, public.training_sessions, public.thought_snapshots to authenticated;

create function public.initialize_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.initialize_profile() from public, anon, authenticated;
create trigger initialize_profile after insert on auth.users for each row execute function public.initialize_profile();
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;

-- 服务端函数也不可以修改原始归属或创建时间。
create function public.guard_session_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at or new.started_at is distinct from old.started_at
     or new.create_request_id is distinct from old.create_request_id or new.mode is distinct from old.mode
     or new.statement_snapshot is distinct from old.statement_snapshot or new.max_hint_seen < old.max_hint_seen then
    raise exception 'IMMUTABLE_SESSION_FIELD' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_session_identity() from public, anon, authenticated;
create trigger guard_session_identity before update on public.training_sessions for each row execute function public.guard_session_identity();

create function public.guard_thought_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'THOUGHTS_ARE_APPEND_ONLY' using errcode = '23514';
end;
$$;
revoke all on function public.guard_thought_append_only() from public, anon, authenticated;
create trigger guard_thought_append_only before update on public.thought_snapshots for each row execute function public.guard_thought_append_only();

-- 仅内部使用的已验证 owner 行锁，不授予 RPC 调用权限。
create function public.lock_owned_session(p_id uuid) returns public.training_sessions
language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into s from public.training_sessions where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002'; end if;
  return s;
end;
$$;
revoke all on function public.lock_owned_session(uuid) from public, anon, authenticated;

create function public.create_custom_problem(p_title text, p_statement text, p_request_id uuid)
returns setof public.problems language plpgsql security definer set search_path = '' as $$
declare p public.problems;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  select * into p from public.problems where owner_id = auth.uid() and create_request_id = p_request_id;
  if found then
    if p.title is distinct from btrim(p_title) or p.statement is distinct from p_statement then raise exception 'REQUEST_REUSED' using errcode = '40001'; end if;
    return next p; return;
  end if;
  insert into public.problems(owner_id, platform, title, statement, create_request_id)
    values (auth.uid(), 'custom', btrim(p_title), p_statement, p_request_id) returning * into p;
  return next p;
end;
$$;

create function public.create_training_session(p_problem_id uuid, p_statement text, p_mode text, p_request_id uuid)
returns setof public.training_sessions language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions; problem public.problems; statement text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = '23514'; end if;
  if p_problem_id is not null then
    select * into problem from public.problems where id = p_problem_id and (platform = 'codeforces' or owner_id = auth.uid());
    if not found then raise exception 'PROBLEM_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  statement := coalesce(p_statement, problem.statement, '');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  select * into s from public.training_sessions where user_id = auth.uid() and create_request_id = p_request_id;
  if found then
    if s.problem_id is distinct from p_problem_id or s.statement_snapshot is distinct from statement or s.mode is distinct from p_mode then raise exception 'REQUEST_REUSED' using errcode = '40001'; end if;
    return next s; return;
  end if;
  insert into public.training_sessions(user_id, problem_id, statement_snapshot, mode, create_request_id)
    values (auth.uid(), p_problem_id, statement, p_mode, p_request_id) returning * into s;
  return next s;
end;
$$;

create function public.transition_training_session(p_id uuid, p_action text, p_expected_revision integer, p_outcome text default null)
returns setof public.training_sessions language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions; instant timestamptz; elapsed integer;
begin
  s := public.lock_owned_session(p_id);
  instant := clock_timestamp();
  if p_action is null or p_action not in ('pause', 'resume', 'finish') or p_expected_revision is null or p_expected_revision < 0
    or (p_action <> 'finish' and p_outcome is not null)
    or (p_action = 'finish' and (p_outcome is null or p_outcome not in ('not_recorded', 'solved_self_reported', 'unsolved', 'abandoned'))) then
    raise exception 'INVALID_TRANSITION_INPUT' using errcode = '23514';
  end if;
  if s.status = 'completed' then
    if p_action = 'finish' and s.outcome = p_outcome then return next s; return; end if;
    raise exception 'SESSION_COMPLETED' using errcode = '23514';
  end if;
  -- 重复暂停/恢复为无副作用操作；不同状态下旧 revision 不可应用。
  if (p_action = 'pause' and s.status = 'paused') or (p_action = 'resume' and s.status = 'active') then return next s; return; end if;
  if s.state_revision <> p_expected_revision then raise exception 'STATE_CONFLICT' using errcode = '40001'; end if;
  elapsed := case when s.status = 'active' then greatest(0, floor(extract(epoch from instant - s.resumed_at)))::integer else 0 end;
  update public.training_sessions set
    active_seconds = s.active_seconds + case when p_action in ('pause', 'finish') then elapsed else 0 end,
    status = case p_action when 'pause' then 'paused' when 'resume' then 'active' else 'completed' end,
    resumed_at = case when p_action = 'resume' then instant else null end,
    ended_at = case when p_action = 'finish' then instant else null end,
    phase = case when p_action = 'finish' then 'finished' else s.phase end,
    outcome = case when p_action = 'finish' then p_outcome else null end,
    state_revision = state_revision + 1, updated_at = instant
  where id = p_id returning * into s;
  return next s;
end;
$$;

create function public.save_training_draft(p_id uuid, p_kind text, p_content text, p_expected_revision integer)
returns setof public.training_sessions language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions; revision integer; current_content text;
begin
  s := public.lock_owned_session(p_id);
  if s.status = 'completed' then raise exception 'SESSION_COMPLETED' using errcode = '23514'; end if;
  if p_kind is null or p_kind not in ('code', 'thought') or p_content is null or char_length(p_content) > 64000
     or p_expected_revision is null or p_expected_revision < 0 then raise exception 'INVALID_DRAFT' using errcode = '23514'; end if;
  revision := case when p_kind = 'code' then s.code_revision else s.thought_revision end;
  current_content := case when p_kind = 'code' then s.code_draft else s.thought_draft end;
  -- 处理响应丢失后的安全重试：相同内容已保存时不再递增 revision。
  if current_content = p_content and revision in (p_expected_revision, p_expected_revision + 1) then return next s; return; end if;
  if revision <> p_expected_revision then raise exception 'DRAFT_CONFLICT' using errcode = '40001'; end if;
  if p_kind = 'code' then
    update public.training_sessions set code_draft = p_content, code_revision = code_revision + 1, updated_at = clock_timestamp() where id = p_id returning * into s;
  else
    update public.training_sessions set thought_draft = p_content, thought_revision = thought_revision + 1, updated_at = clock_timestamp() where id = p_id returning * into s;
  end if;
  return next s;
end;
$$;

create function public.append_training_thought(p_id uuid, p_content text, p_expected_revision integer, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions; t public.thought_snapshots; next_version integer;
begin
  s := public.lock_owned_session(p_id);
  if p_request_id is null or p_content is null or char_length(p_content) not between 1 and 64000 then raise exception 'INVALID_THOUGHT' using errcode = '23514'; end if;
  select * into t from public.thought_snapshots where session_id = p_id and request_id = p_request_id;
  if found then
    if t.content <> p_content then raise exception 'REQUEST_REUSED' using errcode = '40001'; end if;
    return jsonb_build_object('session', to_jsonb(s), 'thought', to_jsonb(t));
  end if;
  if s.status = 'completed' then raise exception 'SESSION_COMPLETED' using errcode = '23514'; end if;
  if p_expected_revision is null or p_expected_revision <> s.thought_revision then raise exception 'THOUGHT_CONFLICT' using errcode = '40001'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.thought_snapshots where session_id = p_id;
  insert into public.thought_snapshots(session_id, version, content, request_id) values (p_id, next_version, p_content, p_request_id) returning * into t;
  update public.training_sessions set thought_draft = p_content, thought_revision = thought_revision + 1, updated_at = clock_timestamp() where id = p_id returning * into s;
  return jsonb_build_object('session', to_jsonb(s), 'thought', to_jsonb(t));
end;
$$;

revoke all on function public.create_custom_problem(text, text, uuid),
  public.create_training_session(uuid, text, text, uuid),
  public.transition_training_session(uuid, text, integer, text),
  public.save_training_draft(uuid, text, text, integer),
  public.append_training_thought(uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.create_custom_problem(text, text, uuid),
  public.create_training_session(uuid, text, text, uuid),
  public.transition_training_session(uuid, text, integer, text),
  public.save_training_draft(uuid, text, text, integer),
  public.append_training_thought(uuid, text, integer, uuid) to authenticated;

commit;
