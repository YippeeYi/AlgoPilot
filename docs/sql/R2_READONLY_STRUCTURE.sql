-- R2 metadata only. One SELECT; no business calls, settings values, user rows,
-- function source, ledger statements, HMAC values/digests or writes.
-- All callable routines and catalog relations are explicitly pg_catalog-qualified.
select pg_catalog.jsonb_build_object(
 'format','r2-catalog/1',
 'boundary','001-013 effective metadata; not execution history, identity, JWT, runtime RLS or private configuration proof',
 'serverVersion',pg_catalog.current_setting('server_version'),
 'migrationHistoryExists',pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null,
 'ledgerVersionColumn',coalesce((select pg_catalog.bool_or(a.attname='version')
  from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('supabase_migrations.schema_migrations') and a.attnum>0 and not a.attisdropped),false),
 'ledgerReadShape',(select pg_catalog.jsonb_build_object('ordinaryTable',c.relkind='r','rowSecurity',c.relrowsecurity,'owner',pg_catalog.pg_get_userbyid(c.relowner),
  'versionBuiltinText',exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attname='version' and a.attnum>0 and not a.attisdropped and a.atttypid in('pg_catalog.text'::pg_catalog.regtype,'pg_catalog.varchar'::pg_catalog.regtype)))
  from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass('supabase_migrations.schema_migrations')),
 'functions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'signature',pg_catalog.format('%I.%I(%s)',n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)),
  'returns',pg_catalog.pg_get_function_result(p.oid),'language',l.lanname,
  'definitionMd5',pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),'bodyMd5',pg_catalog.md5(p.prosrc),
  'securityDefiner',p.prosecdef,'owner',pg_catalog.pg_get_userbyid(p.proowner),
  'searchPath',(select x from pg_catalog.unnest(p.proconfig) x where x like 'search_path=%'),
  'otherConfigNames',coalesce((select pg_catalog.jsonb_agg(pg_catalog.split_part(x,'=',1) order by x) from pg_catalog.unnest(p.proconfig) x where x not like 'search_path=%'),'[]'::jsonb),
  'acl',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee=0,pg_catalog.pg_get_userbyid(a.grantee),a.privilege_type)
    from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb),
  'publicExecute',exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),
  'anonExecute',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')) order by n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace join pg_catalog.pg_language l on l.oid=p.prolang
  where n.nspname in('public','algopilot_private') and p.prokind='f'
  and not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass and d.objid=p.oid and d.deptype='e')),'[]'::jsonb),
 'relations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',n.nspname,'name',c.relname,
  'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'owner',pg_catalog.pg_get_userbyid(c.relowner),
  'acl',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee=0,pg_catalog.pg_get_userbyid(a.grantee),a.privilege_type)
    from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a),'[]'::jsonb),
  'anonSelect',pg_catalog.has_table_privilege('anon',c.oid,'SELECT'),'userSelect',pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'),
  'userInsert',pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT'),'userUpdate',pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE'),'userDelete',pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE'),
  'schemaUserUsage',pg_catalog.has_schema_privilege('authenticated',n.oid,'USAGE')) order by n.nspname,c.relname)
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and n.nspname in('public','algopilot_private')),'[]'::jsonb),
 'columns',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,
  'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
  'defaultMd5',pg_catalog.md5(pg_catalog.pg_get_expr(d.adbin,d.adrelid)),
  'acl',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',case when g.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(g.grantee) end,'privilege',g.privilege_type,'grantable',g.is_grantable) order by g.grantee=0,pg_catalog.pg_get_userbyid(g.grantee),g.privilege_type)
    from pg_catalog.aclexplode(a.attacl) g),'[]'::jsonb),
  'userSelect',pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),
  'userInsert',pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'INSERT'),
  'userUpdate',pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')) order by n.nspname,c.relname,a.attnum)
  from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where a.attnum>0 and not a.attisdropped and c.relkind in('r','p') and n.nspname in('public','algopilot_private')),'[]'::jsonb),
 'indexes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',v.schemaname,'table',v.tablename,'name',v.indexname,'definition',v.indexdef,'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique) order by v.schemaname,v.tablename,v.indexname)
  from pg_catalog.pg_indexes v join pg_catalog.pg_namespace n on n.nspname=v.schemaname join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=v.indexname join pg_catalog.pg_index i on i.indexrelid=c.oid
  where v.schemaname in('public','algopilot_private')),'[]'::jsonb),
 'constraints',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'validated',k.convalidated,'definition',pg_catalog.pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname)
  from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid=k.conrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','algopilot_private')),'[]'::jsonb),
 'policies',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'command',cmd,'permissive',permissive,'using',qual,'check',with_check) order by schemaname,tablename,policyname)
  from pg_catalog.pg_policies where schemaname in('public','algopilot_private')),'[]'::jsonb),
 'triggers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_catalog.pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname)
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal
  and (n.nspname in('public','algopilot_private') or (n.nspname='auth' and c.relname='users' and t.tgname='initialize_profile'))),'[]'::jsonb),
 'schemas',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',n.nspname,'owner',pg_catalog.pg_get_userbyid(n.nspowner),
  'anonUsage',pg_catalog.has_schema_privilege('anon',n.oid,'USAGE'),'anonCreate',pg_catalog.has_schema_privilege('anon',n.oid,'CREATE'),
  'userUsage',pg_catalog.has_schema_privilege('authenticated',n.oid,'USAGE'),'userCreate',pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE'),
  'acl',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee=0,pg_catalog.pg_get_userbyid(a.grantee),a.privilege_type)
   from pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a),'[]'::jsonb)) order by n.nspname)
  from pg_catalog.pg_namespace n where n.nspname in('public','algopilot_private')),'[]'::jsonb),
 'roleCapabilities',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,'bypassRls',r.rolbypassrls,'inherit',r.rolinherit,
  'memberships',coalesce((select pg_catalog.jsonb_agg(pg_catalog.pg_get_userbyid(m.roleid) order by pg_catalog.pg_get_userbyid(m.roleid)) from pg_catalog.pg_auth_members m where m.member=r.oid),'[]'::jsonb)) order by r.rolname)
  from pg_catalog.pg_roles r where r.rolname in('anon','authenticated')),'[]'::jsonb)
) as audit;
