// Offline planning only. No network, credentials, SQL execution or migration runner.
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {z} from 'zod';
// Native Node requires a file extension; retain the existing comparator's types.
const {compareStructure}=await import(pathToFileURL(resolve('scripts/m35-compare-structure.ts')).href) as typeof import('./m35-compare-structure');

type Row=Record<string,unknown>;
type LegacyCatalog=Parameters<typeof compareStructure>[0];
export type Catalog=LegacyCatalog&{format:'r2-catalog/1';ledgerVersionColumn:boolean;ledgerReadShape:{ordinaryTable:boolean;rowSecurity:boolean;versionBuiltinText:boolean;owner:string}|null;schemas:Row[];roleCapabilities:Row[]};
const sections=['functions','relations','columns','indexes','constraints','policies','triggers','schemas','roleCapabilities'] as const;
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const metadataHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
function validateCatalog(value:Catalog){
  if(value.format!=='r2-catalog/1'||typeof value.serverVersion!=='string'||typeof value.migrationHistoryExists!=='boolean'||typeof value.ledgerVersionColumn!=='boolean'||!Object.hasOwn(value,'ledgerReadShape'))throw Error('Invalid R2 metadata');
  for(const section of sections)if(!Array.isArray(value[section])||(value[section] as unknown[]).some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Incomplete R2 metadata');
  if(!(value.functions as Row[]).length||!(value.relations as Row[]).length||value.schemas.length!==2||value.roleCapabilities.length!==2)throw Error('Incomplete R2 reference scope');
}
export function compareR2Catalog(reference:Catalog,observed:Catalog){
  validateCatalog(reference);validateCatalog(observed);
  const base=compareStructure(reference,observed);
  const extras=Object.values(base.sections).reduce<number>((n,v)=>n+(v as {extraObjectsNotAttested:unknown[]}).extraObjectsNotAttested.length,0);
  const additional=Object.fromEntries(['schemas','roleCapabilities'].map(section=>[section,{match:canonical(reference[section])===canonical(observed[section])}]));
  const mismatchCount=base.mismatchCount+extras+Object.values(additional).filter(x=>!x.match).length;
  return {...base,boundary:'001-013 catalog comparison only; every extra app object blocks. No ledger, data-effect, identity or runtime proof.',
    extraObjectCount:extras,additional,mismatchCount,status:mismatchCount?'MISMATCH':'MATCH'};
}

export async function migrationManifest(){
  const names=(await readdir('supabase/migrations')).filter(f=>/^\d{12}_.+\.sql$/.test(f)).sort();
  if(names.length!==13||names.some((name,i)=>Number(name.slice(8,12))!==i+1))throw Error('Unexpected migration chain');
  return Promise.all(names.map(async file=>({version:file.slice(0,12),file,sha256:createHash('sha256').update(await readFile('supabase/migrations/'+file)).digest('hex')})));
}
const ledgerSchema=z.discriminatedUnion('state',[
  z.object({state:z.literal('ABSENT')}).strict(),z.object({state:z.literal('UNREADABLE')}).strict(),
  z.object({state:z.literal('OBSERVED'),versions:z.array(z.string().regex(/^\d{12}$/))}).strict(),
]);
export type Ledger=z.infer<typeof ledgerSchema>;
export function migrationPlan(references:Record<string,Catalog>,observed:Catalog,rawLedger:unknown,manifest:{version:string;file:string;sha256:string}[]){
  const ledger=ledgerSchema.parse(rawLedger);
  if(manifest.length!==13||new Set(manifest.map(m=>m.version)).size!==13||manifest.some((m,i)=>!/^\d{12}$/.test(m.version)||Number(m.version.slice(8))!==i+1||!/^\d{12}_.+\.sql$/.test(m.file)||!m.file.startsWith(m.version)||!(/^[a-f0-9]{64}$/).test(m.sha256)))throw Error('Invalid migration manifest');
  const expectedPrefixes=manifest.slice(9).map(m=>m.version);
  if(Object.keys(references).sort().join()!==expectedPrefixes.join())throw Error('Incomplete prefix references');
  const comparisons=Object.fromEntries(Object.entries(references).map(([version,reference])=>[version,compareR2Catalog(reference,observed)]));
  const matching=Object.entries(comparisons).filter(([,v])=>v.status==='MATCH').map(([version])=>version);
  const effectiveThrough=matching.length===1?matching[0]!:null;
  const index=manifest.findIndex(m=>m.version===effectiveThrough);
  const expectedVersions=manifest.slice(0,index+1).map(m=>m.version);
  const ledgerConsistent=ledger.state==='OBSERVED'&&observed.migrationHistoryExists&&observed.ledgerVersionColumn&&
    observed.ledgerReadShape?.ordinaryTable===true&&observed.ledgerReadShape.rowSecurity===false&&observed.ledgerReadShape.versionBuiltinText===true&&
    new Set(ledger.versions).size===ledger.versions.length&&canonical([...ledger.versions].sort())===canonical(expectedVersions)&&index>=9;
  const effectiveState=index===12?'EXISTS':index>=9?'MISSING_INCREMENT':'PARTIAL_OR_UNKNOWN';
  return {format:'r2-migration-plan/1',effectiveThrough,effectiveState,
    ledgerStatus:ledgerConsistent?'VERSIONS_MATCH_ONLY':ledger.state==='OBSERVED'?'INCONSISTENT':ledger.state,
    status:effectiveThrough&&ledgerConsistent?'REVIEW_REQUIRED':'BLOCKED',
    comparisons,proposedMissing:effectiveThrough&&ledgerConsistent?manifest.slice(index+1):[],
    action:'NONE',executionEnabled:false,historyDataEffects:'NOT_PROVEN',
    warning:'A structure match never proves migration execution/data effects. Absent ledger does not authorize replay/repair. Even a clean proposal needs independently verified target, backup and current owner approval.'};
}

const target=z.object({projectRef:z.string().regex(/^[a-z0-9]{20}$/),url:z.string(),environment:z.enum(['TEST','STAGING','PRODUCTION'])}).strict();
const preflightSchema=z.object({proposed:target,approvedTarget:target.optional(),observedTarget:target.optional(),
  scopes:z.array(z.enum(['metadata','auth','fixtures','migration','configuration','cleanup'])),
  accounts:z.array(z.enum(['A','B'])),backupReference:z.string().min(1).optional(),
  restoreReference:z.string().min(1).optional(),migrationState:z.enum(['REVIEWED','UNKNOWN']),useExistingUserData:z.boolean()}).strict();
export function r2bPreflight(raw:unknown){
  const parsed=preflightSchema.safeParse(raw);
  // A file or boolean is never a trusted remote observation or authorization source.
  const blockers=['REMOTE_IDENTITY_VERIFIER_NOT_CONNECTED','CURRENT_OWNER_AUTHORIZATION_NOT_VERIFIED'];
  if(!parsed.success)return {status:'BLOCKED',executionEnabled:false,action:'NONE',blockers:[...blockers,'INVALID_OR_UNTRUSTED_INPUT']};
  const p=parsed.data;
  if(p.proposed.url!==`https://${p.proposed.projectRef}.supabase.co`)blockers.push('PROJECT_URL_MISMATCH');
  if(!p.approvedTarget||canonical(p.proposed)!==canonical(p.approvedTarget))blockers.push('APPROVED_TARGET_MISMATCH');
  if(!p.observedTarget||canonical(p.proposed)!==canonical(p.observedTarget))blockers.push('REMOTE_OBSERVATION_MISSING_OR_MISMATCH');
  if(p.proposed.environment!=='TEST'&&p.scopes.some(s=>s!=='metadata'))blockers.push('WRITES_REQUIRE_DEDICATED_TEST');
  if(p.scopes.some(s=>s!=='metadata')&&(!p.scopes.includes('cleanup')||new Set(p.accounts).size!==2))blockers.push('TEST_ACCOUNTS_AND_CLEANUP_SCOPE_REQUIRED');
  if(p.scopes.includes('migration')&&(!p.backupReference||!p.restoreReference))blockers.push('BACKUP_AND_RESTORE_REQUIRED');
  if(p.migrationState!=='REVIEWED')blockers.push('MIGRATION_STATE_UNKNOWN');
  if(p.useExistingUserData)blockers.push('EXISTING_USER_DATA_PROHIBITED');
  return {status:'BLOCKED',executionEnabled:false,action:'NONE',blockers,
    boundary:'Offline checklist only. Submitted identity/approval fields are untrusted claims; no R2B authorization token is issued.'};
}

async function readMetadata(path:string){
  if(extname(path)!=='.json')throw Error('Only metadata JSON files accepted');
  const text=await readFile(path,'utf8');if(text.length>4_000_000)throw Error('Metadata size limit');return JSON.parse(text);
}
async function main(){
  const [command,...args]=process.argv.slice(2);let result:unknown,output:string;
  if(command==='manifest'&&args.length===1){output=args[0]!;result={format:'r2-local-manifest/1',migrations:await migrationManifest(),remote:'NOT_RUN'};}
  else if(command==='plan'&&args.length===4){const [references,observed,ledger,out]=args as [string,string,string,string];output=out;result=migrationPlan(await readMetadata(references),await readMetadata(observed),await readMetadata(ledger),await migrationManifest());}
  else if(command==='preflight'&&args.length===2){output=args[1]!;result=r2bPreflight(await readMetadata(args[0]!));}
  else throw Error('Invalid arguments');
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({operation:'r2_offline_plan',written:true,executionEnabled:false}));
  if(command==='preflight'||(result as {status?:string}).status==='BLOCKED')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch{console.error(JSON.stringify({operation:'r2_offline_plan',written:false,error:'INVALID_METADATA_OR_IO'}));process.exitCode=1;}
}
