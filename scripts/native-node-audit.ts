// Test infrastructure only. No PostgreSQL or network connection is made by this module.
import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import type {collectOfflineAudit} from './offline-audit';
import type {collectOfflineDiagnostics} from './offline-diagnostics';

export const nativeAuditBoundary = {
  node: 'Preloaded Node test roots, inherited forks and workers only; original B3 guard unchanged',
  nonNode: 'Supervisor, PostgreSQL daemon, psql/initdb/pg_ctl and native bindings are not syscall/network instrumented',
  nativeHTTP: 'UNKNOWN', nativeDNS: 'UNKNOWN', nativeCredentialReads: 'UNKNOWN',
  databaseTransport: 'Native psql uses only the validated generated target and fixed loopback arguments; not a model transport',
};
type Phase = 'native-state' | 'native-feedback';
export const nativeCaseCounts = {'native-state':20,'native-feedback':14} as const;
export async function readNativeTestSummary(file:string,expected:number) {
  try {
    const text=await readFile(file,'utf8');if(text.length>5_000_000)throw Error();
    const r=JSON.parse(text),keys=['numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTodoTests'] as const;
    if(keys.some(k=>!Number.isSafeInteger(r[k])||r[k]<0))throw Error();
    const counts=Object.fromEntries(keys.map(k=>[k,r[k] as number]));
    return {state:'COLLECTED',expected,counts,complete:r.numTotalTests===expected&&r.numPassedTests===expected&&r.numFailedTests===0&&r.numPendingTests===0&&r.numTodoTests===0};
  } catch { return {state:'UNKNOWN',expected,counts:null,complete:false}; }
}
type Audit = Pick<Awaited<ReturnType<typeof collectOfflineAudit>>,'status'>;
type Diagnostics = Pick<Awaited<ReturnType<typeof collectOfflineDiagnostics>>,'state'|'contexts'>;
// Static names only; hashes/counts preserve no SQL text, user rows, signatures or keys.
export const nativeHistorySql = "select jsonb_object_agg(name,jsonb_build_object('rows',n,'md5',digest)) from ("+
  ['training_sessions','thought_snapshots','code_reviews','review_requests','tutor_requests','tutor_messages',
    'training_plans','training_plan_items','training_plan_sessions','hint_events','tutor_authorizations','llm_usage',
    'learning_preferences','recommendation_feedback'].map(name=>
    `select '${name}' name,count(*) n,md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'[]')) digest from public.${name} s`
  ).join(' union all ')+') snapshots';
export function nativePhaseVerdict(exitCode:number|null, signal:string|null, audit:Audit, diagnostics:Diagnostics, rootPid:number|null, phase:Phase) {
  const rootObserved = rootPid !== null && diagnostics.contexts.some(c=>c.pid===rootPid && c.threadId===0);
  const phaseAssociated=diagnostics.contexts.length>0&&diagnostics.contexts.every(c=>c.phase===phase);
  const functionalStatus = exitCode===0 && signal===null ? 'PASS' : 'FAIL';
  const auditStatus = audit.status==='PASS' && diagnostics.state==='CORRELATED' && rootObserved && phaseAssociated ? 'PASS' : 'FAIL';
  return {functionalStatus, auditStatus, rootObserved,phaseAssociated, status:functionalStatus==='PASS' && auditStatus==='PASS'?'PASS':'FAIL'};
}
export async function runNativeNodePhase(options:{
  phase:Phase; workspace:string; directory:string; args:string[];
  environment:Record<string,string>; inheritOutput?:boolean;
  collectors:{audit:typeof collectOfflineAudit;diagnostics:typeof collectOfflineDiagnostics};
}) {
  const {phase,workspace,directory}=options;
  await mkdir(directory,{mode:0o700});
  // Never use process.env here. The caller supplies nativeEnvironment's constants and synthetic target.
  const env={...options.environment,NODE_ENV:'test' as const,PATH:dirname(process.execPath)+':/usr/bin:/bin',CI:'1',
    NODE_OPTIONS:'--require='+join(workspace,'scripts/offline-diagnostic-preload.cjs'),M353_B3_AUDIT_DIRECTORY:directory};
  let rootPid:number|null=null;
  const exit=await new Promise<{code:number|null;signal:string|null}>(resolve=>{
    const child=spawn(process.execPath,options.args,{cwd:workspace,env,stdio:options.inheritOutput?'inherit':'ignore'});
    rootPid=child.pid??null;
    child.once('error',()=>resolve({code:null,signal:null}));
    // close, not exit: inherited descendants must have released the output streams first.
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
  const [a,d]=await Promise.allSettled([options.collectors.audit(directory),options.collectors.diagnostics(directory)]);
  const audit=a.status==='fulfilled'?a.value:{status:'FAIL',state:'UNKNOWN',counters:null,issues:[{code:'COLLECTION_UNAVAILABLE',runtime:'unknown'}]};
  const diagnostics=d.status==='fulfilled'?d.value:{state:'UNKNOWN',contexts:[],events:[],issues:['COLLECTION_UNAVAILABLE']};
  return {phase,rootPid,exitCode:exit.code,signal:exit.signal,...nativePhaseVerdict(exit.code,exit.signal,audit,diagnostics,rootPid,phase),audit,diagnostics};
}
