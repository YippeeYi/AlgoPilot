-- SELECT/system catalogs only. No user rows, settings values, function source,
-- secret digests, RPC calls, migration ledger writes or schema changes.
select jsonb_build_object(
 'boundary','001-010 effective structure only; no JWT/RLS runtime/HMAC or ledger attestation',
 'serverVersion',current_setting('server_version'),
 'migrationHistoryExists',to_regclass('supabase_migrations.schema_migrations') is not null,
 'functions',coalesce((select jsonb_agg(jsonb_build_object(
  'signature',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
  'returns',pg_get_function_result(p.oid),'language',l.lanname,
  'definitionMd5',md5(pg_get_functiondef(p.oid)),'bodyMd5',md5(p.prosrc),
  'securityDefiner',p.prosecdef,'config',p.proconfig,'owner',pg_get_userbyid(p.proowner),
  'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname in('public','algopilot_private') and p.prokind='f'
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),'[]'::jsonb),
 'relations',coalesce((select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
  'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),
  'anonSelect',has_table_privilege('anon',c.oid,'SELECT'),'userSelect',has_table_privilege('authenticated',c.oid,'SELECT'),
  'userInsert',has_table_privilege('authenticated',c.oid,'INSERT'),'userUpdate',has_table_privilege('authenticated',c.oid,'UPDATE'),'userDelete',has_table_privilege('authenticated',c.oid,'DELETE'),
  'schemaUserUsage',has_schema_privilege('authenticated',n.oid,'USAGE')) order by n.nspname,c.relname)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and n.nspname in('public','algopilot_private')),'[]'::jsonb),
 'columns',coalesce((select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,
  'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
  'defaultMd5',md5(pg_get_expr(d.adbin,d.adrelid)),
  'userSelect',has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),
  'userInsert',has_column_privilege('authenticated',c.oid,a.attnum,'INSERT'),
  'userUpdate',has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')) order by n.nspname,c.relname,a.attnum)
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where a.attnum>0 and not a.attisdropped and c.relkind in('r','p') and n.nspname in('public','algopilot_private')),'[]'::jsonb),
 'indexes',coalesce((select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef) order by schemaname,tablename,indexname)
  from pg_indexes where schemaname in('public','algopilot_private')),'[]'::jsonb),
 'constraints',coalesce((select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname)
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','algopilot_private')),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname)
  from pg_policies where schemaname in('public','algopilot_private')),'[]'::jsonb),
 'triggers',coalesce((select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal
  and (n.nspname in('public','algopilot_private') or (n.nspname='auth' and c.relname='users' and t.tgname='initialize_profile'))),'[]'::jsonb)
) as audit;
