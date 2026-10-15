-- Operator-run METADATA ONLY. No user rows, key contents, function source text,
-- DDL, RPC invocation, Auth impersonation or migration is performed.
select jsonb_build_object(
 'boundary','catalog metadata only; not JWT, HMAC or data compatibility acceptance',
 'serverVersion',current_setting('server_version'),
 'migrationHistoryExists',exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='supabase_migrations' and c.relname='schema_migrations'),
 'migrationHistoryVisible',exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
  where n.nspname='supabase_migrations' and c.relname='schema_migrations' and a.attname='version' and a.attnum>0 and not a.attisdropped
  and has_schema_privilege(current_user,n.oid,'USAGE') and has_column_privilege(current_user,c.oid,a.attnum,'SELECT')),
 'functions',coalesce((select jsonb_agg(jsonb_build_object(
  'signature',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
  'definitionMd5',md5(pg_get_functiondef(p.oid)),'bodyMd5',md5(p.prosrc),
  'securityDefiner',p.prosecdef,'config',p.proconfig,'owner',pg_get_userbyid(p.proowner),
  'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and (p.proname like 'learning_%' or p.proname like 'cf_%'
   or p.proname in('tutor_hint','tutor_reserve','tutor_finish','review_reserve','review_finish')))
   or (n.nspname='algopilot_private' and p.proname in('verify_cf','cf_secret','cf_problem','cf_new_cursor','cf_advance_cursor','cf_official_evidence'))),'[]'::jsonb),
 'relations',coalesce((select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
  'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),
  'anonSelect',has_table_privilege('anon',c.oid,'SELECT'),'userSelect',has_table_privilege('authenticated',c.oid,'SELECT'),
  'userInsert',has_table_privilege('authenticated',c.oid,'INSERT'),'userUpdate',has_table_privilege('authenticated',c.oid,'UPDATE'),'userDelete',has_table_privilege('authenticated',c.oid,'DELETE'),
  'schemaUserUsage',has_schema_privilege('authenticated',n.oid,'USAGE')) order by n.nspname,c.relname)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and
  ((n.nspname='public' and c.relname in('problems','training_sessions','thought_snapshots','training_plans','training_plan_items','code_reviews','review_requests','learning_preferences','recommendation_feedback')) or
   (n.nspname='algopilot_private' and c.relname in('learning_receipts','recommendation_restrictions','cf_accounts','cf_submissions','cf_account_receipts','cf_settings','cf_cache_state','tutor_settings')))),'[]'::jsonb),
 'columns',coalesce((select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,
  'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
  'userSelect',has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),
  'userInsert',has_column_privilege('authenticated',c.oid,a.attnum,'INSERT'),
  'userUpdate',has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')) order by n.nspname,c.relname,a.attnum)
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where a.attnum>0 and not a.attisdropped and c.relkind='r' and
   ((n.nspname='public' and c.relname in('problems','training_sessions','thought_snapshots','training_plans','training_plan_items','code_reviews','review_requests','learning_preferences','recommendation_feedback')) or
    (n.nspname='algopilot_private' and c.relname in('cf_accounts','cf_submissions','cf_account_receipts','cf_settings')))),'[]'::jsonb),
 'indexes',coalesce((select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef) order by schemaname,tablename,indexname)
  from pg_indexes where (schemaname='public' and tablename in('training_sessions','thought_snapshots','training_plans','training_plan_items','code_reviews','review_requests','learning_preferences','recommendation_feedback')) or
   (schemaname='algopilot_private' and tablename in('learning_receipts','recommendation_restrictions','cf_accounts','cf_submissions','cf_account_receipts'))),'[]'::jsonb),
 'constraints',coalesce((select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname)
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
  where (n.nspname='public' and c.relname in('training_sessions','thought_snapshots','training_plans','training_plan_items','code_reviews','review_requests','learning_preferences','recommendation_feedback')) or
   (n.nspname='algopilot_private' and c.relname in('learning_receipts','recommendation_restrictions','cf_accounts','cf_submissions','cf_account_receipts'))),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname)
  from pg_policies where (schemaname='public' and tablename in('problems','training_sessions','thought_snapshots','training_plans','training_plan_items','code_reviews','review_requests','learning_preferences','recommendation_feedback')) or
   (schemaname='algopilot_private' and tablename in('learning_receipts','recommendation_restrictions','cf_accounts','cf_submissions','cf_account_receipts'))),'[]'::jsonb)
) as audit;
-- If migrationHistoryVisible=true, an operator with SELECT on version ONLY may run:
-- select version from supabase_migrations.schema_migrations
-- where version in ('202610140007','202610140008','202610140009','202610150010') order by version;
