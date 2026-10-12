-- 业务 CAS / requestId 冲突不是可重试的数据库 serialization_failure。
-- PostgREST 14 会内部重试 40001；PT409 直接返回 HTTP 409。
-- 精确修改七个受控 RPC 的错误码，保留函数体其余内容、owner、ACL、search_path 和所有 CAS。
begin;
do $$
declare
  signature text;
  definition text;
  revised text;
  expected_count integer;
  actual_count integer;
begin
  for signature, expected_count in
    select * from (values
      ('public.create_custom_problem(text,text,uuid)', 1),
      ('public.create_training_session(uuid,text,text,uuid)', 1),
      ('public.transition_training_session(uuid,text,integer,text)', 1),
      ('public.save_training_draft(uuid,text,text,integer)', 1),
      ('public.append_training_thought(uuid,text,integer,uuid)', 2),
      ('public.tutor_hint(uuid,text,integer,uuid,uuid)', 1),
      ('public.tutor_reserve(text,text)', 1)
    ) as functions(signature, expected_count)
  loop
    definition := pg_get_functiondef(signature::regprocedure);
    select count(*) into actual_count
      from regexp_matches(definition, 'errcode\s*=\s*''40001''', 'g');
    if actual_count <> expected_count then
      raise exception 'Unexpected business conflict definition: %', signature;
    end if;
    revised := regexp_replace(definition, 'errcode\s*=\s*''40001''', 'errcode = ''PT409''', 'g');
    execute revised;
  end loop;
end;
$$;
notify pgrst, 'reload schema';
commit;
