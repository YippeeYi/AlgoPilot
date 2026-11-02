import {it,expect,vi} from 'vitest';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {database} from '../evaluation/database';
import {compareR2Catalog,migrationPlan,migrationManifest,metadataHash,type Catalog} from '../../scripts/r2a-hosted-readiness';
vi.mock('server-only',()=>({}));

it('executes the fixed catalog SELECT read-only on 010 through 013, detects drift/extra privileges and keeps ledger separate',async()=>{
  const sql=await readFile('docs/sql/R2_READONLY_STRUCTURE.sql','utf8');
  const code=sql.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
  expect(code.trim().startsWith('select ')).toBe(true);expect(code.match(/;/g)).toHaveLength(1);
  expect(code).not.toMatch(/\b(insert|update|delete|drop|alter|create|execute|perform|set_config|pg_read_file|pg_advisory_lock)\b/i);
  // Fixed-query allowlist, not a general SQL sanitizer. The read-only transaction
  // and explicit review of this file are additional, independent checks.
  const allowed=['jsonb_build_object','current_setting','to_regclass','bool_or','jsonb_agg','format','pg_get_function_identity_arguments','pg_get_function_result','md5','pg_get_functiondef','pg_get_userbyid','unnest','split_part','aclexplode','acldefault','has_function_privilege','has_table_privilege','has_schema_privilege','format_type','pg_get_expr','has_column_privilege','pg_get_constraintdef','pg_get_triggerdef'];
  for(const m of code.matchAll(/pg_catalog\.([a-z_]+)\s*\(/g))expect(allowed).toContain(m[1]);
  for(const m of code.matchAll(/\b(?:from|join)\s+([a-z_][a-z_.]*)/g))expect(m[1]).toMatch(/^pg_catalog\./);
  const db=await database('202610150010'),manifest=await migrationManifest(),references:Record<string,Catalog>={};
  const audit=()=>db.transaction(async tx=>{await tx.exec('set transaction read only');return (await tx.query<{audit:Catalog}>(sql)).rows[0]!.audit;});
  try{
    references[manifest[9]!.version]=await audit();
    for(const m of manifest.slice(10)){await db.exec(await readFile('supabase/migrations/'+m.file,'utf8'));references[m.version]=await audit();}
    const first=references[manifest[9]!.version]!,latest=references[manifest[12]!.version]!;
    const fn=(c:Catalog,name:string)=>(c.functions as Record<string,unknown>[]).find(f=>String(f.signature).startsWith('public.'+name+'('))!;
    expect(fn(first,'review_reserve').bodyMd5).not.toBe(fn(references[manifest[10]!.version]!,'review_reserve').bodyMd5);
    expect(fn(references[manifest[10]!.version]!,'tutor_reserve').bodyMd5).not.toBe(fn(references[manifest[11]!.version]!,'tutor_reserve').bodyMd5);
    expect((latest.functions as unknown[]).length-(first.functions as unknown[]).length).toBe(3);
    for(const name of ['record_recommendation_run','recommendation_choice','recommendation_training_evidence'])expect(fn(latest,name)).toMatchObject({securityDefiner:true,searchPath:'search_path=""',anonExecute:false,publicExecute:false,authenticatedExecute:true});
    expect((latest.relations as Record<string,unknown>[]).find(r=>r.name==='recommendation_trials')).toMatchObject({rls:true,userSelect:false,userInsert:false,userUpdate:false,userDelete:false});
    const constraints=latest.constraints as {definition:string}[];
    expect(constraints.some(c=>c.definition.includes('FOREIGN KEY (session_id, user_id)'))).toBe(true);
    expect((latest.indexes as {name:string;unique:boolean;valid:boolean}[]).find(i=>i.name==='recommendation_origin_once')).toMatchObject({unique:true,valid:true});
    expect(compareR2Catalog(latest,latest).status).toBe('MATCH');
    const withLedger=(c:Catalog)=>({...c,migrationHistoryExists:true,ledgerVersionColumn:true,ledgerReadShape:{ordinaryTable:true,rowSecurity:false,versionBuiltinText:true,owner:'synthetic_ledger_owner'}});
    expect(migrationPlan(references,latest,{state:'ABSENT'},manifest)).toMatchObject({effectiveState:'EXISTS',status:'BLOCKED',proposedMissing:[],executionEnabled:false,historyDataEffects:'NOT_PROVEN'});
    expect(migrationPlan(references,withLedger(first),{state:'OBSERVED',versions:manifest.slice(0,10).map(m=>m.version)},manifest)).toMatchObject({effectiveState:'MISSING_INCREMENT',status:'REVIEW_REQUIRED',proposedMissing:manifest.slice(10),executionEnabled:false});
    expect(migrationPlan(references,withLedger(latest),{state:'OBSERVED',versions:manifest.map(m=>m.version)},manifest)).toMatchObject({effectiveState:'EXISTS',status:'REVIEW_REQUIRED',ledgerStatus:'VERSIONS_MATCH_ONLY',proposedMissing:[]});
    for(const ledger of [{state:'UNREADABLE'},{state:'OBSERVED',versions:[]},{state:'OBSERVED',versions:[...manifest.map(m=>m.version),manifest[12]!.version]},{state:'OBSERVED',versions:['999999999999']}])expect(migrationPlan(references,withLedger(latest),ledger,manifest).status).toBe('BLOCKED');
    for(const change of [{ordinaryTable:false},{rowSecurity:true},{versionBuiltinText:false}]){
      const unsafe=withLedger(latest);Object.assign(unsafe.ledgerReadShape,change);
      expect(migrationPlan(references,unsafe,{state:'OBSERVED',versions:manifest.map(m=>m.version)},manifest).status).toBe('BLOCKED');
    }
    expect(()=>migrationPlan({},latest,{state:'ABSENT'},manifest)).toThrow('Incomplete prefix references');
    const drift=structuredClone(latest);(drift.relations as Row[])[0]!.rls=false;
    expect(compareR2Catalog(latest,drift).status).toBe('MISMATCH');
    expect(migrationPlan(references,drift,{state:'ABSENT'},manifest)).toMatchObject({effectiveState:'PARTIAL_OR_UNKNOWN',status:'BLOCKED',proposedMissing:[]});
    const extra=structuredClone(latest);(extra.functions as Row[]).push({...fn(latest,'tutor_reserve'),signature:'public.tutor_reserve(p_payload text)'});
    expect(compareR2Catalog(latest,extra)).toMatchObject({status:'MISMATCH',extraObjectCount:1});
    const privilege=structuredClone(latest);fn(privilege,'review_reserve').publicExecute=true;expect(compareR2Catalog(latest,privilege).status).toBe('MISMATCH');
    const column=structuredClone(latest);(column.columns as Row[])[0]!.acl=[{grantee:'PUBLIC',privilege:'UPDATE',grantable:true}];expect(compareR2Catalog(latest,column).status).toBe('MISMATCH');
    const broken=structuredClone(latest);Reflect.deleteProperty(broken,'schemas');expect(()=>compareR2Catalog(latest,broken)).toThrow('Incomplete R2 metadata');
    // Unrelated private function config is never exported as a value.
    await db.exec("alter function public.tutor_reserve(text,text) set app.synthetic_private='PRIVATE_R2_CONFIG_SENTINEL'");
    expect(JSON.stringify(await audit())).not.toContain('PRIVATE_R2_CONFIG_SENTINEL');
    const ledgerSql=await readFile('docs/sql/R2_READONLY_LEDGER_VERSIONS.sql','utf8');
    expect(ledgerSql.replace(/--[^\n]*/g,'')).toMatch(/^\s*select version::text as version\s+from supabase_migrations.schema_migrations\s+order by version;\s*$/);
    await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text,statements text); insert into supabase_migrations.schema_migrations values('202610150010','PRIVATE_LEDGER_STATEMENTS_SENTINEL')");
    expect((await audit()).ledgerReadShape).toMatchObject({ordinaryTable:true,rowSecurity:false,versionBuiltinText:true});
    const versions=await db.transaction(async tx=>{await tx.exec('set transaction read only');return (await tx.query(ledgerSql)).rows;});
    expect(versions).toEqual([{version:'202610150010'}]);expect(JSON.stringify(versions)).not.toContain('PRIVATE_LEDGER_STATEMENTS_SENTINEL');
    await db.exec('alter table supabase_migrations.schema_migrations enable row level security');
    expect((await audit()).ledgerReadShape?.rowSecurity).toBe(true);
    const output=process.env.R2A_EVALUATION_OUTPUT;
    if(output){await mkdir(output,{recursive:true});await writeFile(output+'/catalog-references.json',JSON.stringify(references,null,2)+'\n',{mode:0o600});await writeFile(output+'/reference-summary.json',JSON.stringify({boundary:'LOCAL PGlite catalog only; no remote identity or execution proof',migrations:manifest,prefixes:Object.fromEntries(Object.entries(references).map(([version,c])=>[version,{sha256:metadataHash(c),counts:Object.fromEntries(['functions','relations','columns','indexes','constraints','policies','triggers'].map(s=>[s,(c[s] as unknown[]).length]))}]))},null,2)+'\n',{mode:0o600});}
  }finally{await db.close();}
},30000);
type Row=Record<string,unknown>;
