import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
// Supplement only: never repairs records, suppresses counters, or changes the audit verdict.
export async function collectOfflineDiagnostics(auditDirectory:string) {
  const issues:string[]=[];
  const contexts:Record<string,unknown>[]=[];
  const events:Record<string,unknown>[]=[];
  const directory=auditDirectory+'-diagnostics';
  const auditNames=await readdir(auditDirectory);
  let names:string[];
  try { names=await readdir(directory); } catch { return {state:'UNKNOWN',issues:['MISSING_DIAGNOSTICS'],contexts,events}; }
  const parse=async(file:string) => {
    try { const value=await readFile(join(directory,file),'utf8'); if(value.length>32_768)throw Error(); return JSON.parse(value); }
    catch { issues.push('INVALID_DIAGNOSTIC'); return null; }
  };
  const ids=auditNames.filter(n=>/^\d+-\d+\.started$/.test(n)).map(n=>n.slice(0,-8));
  for(const id of ids) {
    const c=await parse(id+'.context.json');
    const [pid,threadId]=id.split('-').map(Number);
    if(!c || c.version!=='offline-diagnostic/1' || c.auditRecord!==id+'.json' || c.pid!==pid || c.threadId!==threadId ||
      !Number.isSafeInteger(c.ppid) || c.ppid<=0 || c.isMainThread!==(threadId===0) ||
      !/^(probe|lint|typecheck|targeted|test|recommendations|build|native-state|native-feedback)$/.test(c.phase) || !/^[0-9]{1,30}$/.test(c.startedNs) ||
      Object.keys(c).some(k=>!['version','auditRecord','pid','ppid','threadId','isMainThread','phase','startedNs'].includes(k))) {
      issues.push('INVALID_CONTEXT'); continue;
    }
    contexts.push(c);
    const eventNames=names.filter(n=>n.startsWith(id+'.')&&n.endsWith('.event.json')).sort((a,b)=>Number(a.split('.')[1])-Number(b.split('.')[1]));
    const counts={networkBlocked:0,dnsBlocked:0,credentialReadBlocked:0};
    let previous=BigInt(c.startedNs), sequence=0;
    for(const name of eventNames) {
      const e=await parse(name);
      if(!e || e.version!=='offline-denial/1' || e.auditRecord!==id+'.json' || e.sequence!==++sequence || sequence>32 ||
        name!==`${id}.${sequence}.event.json` || !Object.hasOwn(counts,e.kind) ||
        !/^(fetch|https?\.(request|get)|net\.(connect|createConnection|Socket.connect)|tls.connect|dns(\.promises)?\.(lookup|lookupService|resolve[A-Za-z0-9]*|reverse)|fs(\.promises)?\.(readFile|readFileSync|open|openSync|createReadStream))$/.test(e.operation) ||
        !/^[0-9]{1,30}$/.test(e.monotonicNs) || BigInt(e.monotonicNs)<previous || !Array.isArray(e.stack) || e.stack.length>14 ||
        e.stack.some((s:Record<string,unknown>)=>!s || typeof s.source!=='string' ||
          !/^(unmapped|node:[a-zA-Z0-9_/-]+|(src|scripts|tests|node_modules)\/[a-zA-Z0-9_@./+-]+\.[cm]?[jt]sx?)$/.test(s.source) ||
          s.source.split('/').some(p=>p==='..'||p.startsWith('.')) || !Number.isSafeInteger(s.line) || Number(s.line)<0 ||
          !Number.isSafeInteger(s.column) || Number(s.column)<0 || Object.keys(s).some(k=>!['source','line','column'].includes(k))) ||
        Object.keys(e).some(k=>!['version','auditRecord','sequence','kind','operation','monotonicNs','stack'].includes(k))) {
        issues.push('INVALID_EVENT'); continue;
      }
      previous=BigInt(e.monotonicNs);counts[e.kind as keyof typeof counts]++;events.push(e);
    }
    try {
      const final=JSON.parse(await readFile(join(auditDirectory,id+'.json'),'utf8'));
      if(Object.entries(counts).some(([k,v])=>final[k]!==v))issues.push('DENIAL_COUNT_MISMATCH');
    } catch { issues.push('MISSING_FINAL_FOR_DIAGNOSTICS'); }
  }
  for(const name of names) {
    const id=name.match(/^(\d+-\d+)\.(context|\d+\.event)\.json$/)?.[1];
    if(!id || !ids.includes(id))issues.push('ORPHAN_DIAGNOSTIC');
  }
  if(!ids.length)issues.push('NO_DIAGNOSTIC_COVERAGE');
  return {state:issues.length?'UNKNOWN':'CORRELATED',issues,contexts,events};
}
