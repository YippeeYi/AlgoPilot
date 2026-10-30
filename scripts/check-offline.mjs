// Local checks in a private copy, with no real environment files or inherited secrets.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,symlink,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {collectOfflineAudit} from './offline-audit.ts';
import {collectOfflineDiagnostics} from './offline-diagnostics.ts';
const root=process.cwd(),temporary=await mkdtemp(join(tmpdir(),'algopilot-replay-checks-')),workspace=join(temporary,'workspace'),audits=join(temporary,'audits'),home=join(temporary,'home');
for(const p of [workspace,audits,home])await mkdir(p,{mode:0o700});
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).split('\0').filter(Boolean);
for(const file of files){if(/(^|\/)\.env($|\.)/.test(file))continue;const to=join(workspace,file);await mkdir(dirname(to),{recursive:true});await copyFile(join(root,file),to);}
await symlink(join(root,'node_modules'),join(workspace,'node_modules'),'dir');
const env={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:home,TMPDIR:temporary,CI:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:`--require=${join(workspace,'scripts/offline-diagnostic-preload.cjs')}`};
const targeted=['test','--','tests/unit/review-list-recovery.test.tsx','tests/unit/review-navigation.test.tsx','tests/unit/review-workspace.test.tsx','tests/integration/review-database.test.ts','tests/unit/recommendation-continuity.test.tsx','tests/unit/draft-queue.test.ts','tests/unit/navigation-guard.test.ts','tests/unit/tutor-draft.test.tsx','tests/unit/workspace-continuity.test.tsx','tests/unit/m34-review.test.ts','tests/unit/m34-review-cli.test.ts','tests/unit/m34-replay.test.ts','tests/unit/m34-replay-cli.test.ts','tests/unit/offline-audit.test.ts','tests/unit/m34-results-validation.test.ts','tests/unit/m34-results-pairing.test.ts','tests/unit/m34-results-cli.test.ts','--maxWorkers=1'];
targeted.splice(targeted.length-1,0,'tests/unit/offline-diagnostics.test.ts');
const readiness=['test','--','tests/unit/native-node-audit.test.ts','tests/unit/native-postgres-infrastructure.test.ts','tests/unit/native-readiness-plan.test.ts','tests/integration/native-r1-readiness.test.ts','tests/integration/training-feedback-database.test.ts','tests/unit/offline-audit.test.ts','tests/unit/offline-diagnostics.test.ts','--maxWorkers=1'];
const option=process.argv.slice(2),early=option.length===1&&option[0]==='--targeted',probe=option.length===1&&option[0]==='--audit-only',quality=option.length===1&&option[0]==='--quality-only',native=option.length===1&&option[0]==='--native-readiness';
if(option.length&&!early&&!probe&&!quality&&!native)throw Error('Only --targeted, --audit-only, --quality-only or --native-readiness is supported');
const commands=native?[['probe',readiness]]:quality?[['lint',['lint']],['typecheck',['typecheck']],['build',['build']]]:probe?[['probe',['test','--','tests/unit/offline-audit.test.ts','tests/unit/offline-diagnostics.test.ts','--maxWorkers=1']]]:
  [['lint',['lint']],['typecheck',['typecheck']],['targeted',targeted],...early?[]:[['test',['test','--','--maxWorkers=1']],['recommendations',['test:recommendations','--','--maxWorkers=1']],['build',['build']]]];
console.log('OFFLINE_WORKSPACE='+workspace);const results=[];
for(const [phase,args] of commands){const directory=join(audits,phase);await mkdir(directory,{mode:0o700});console.log('npm run '+args.join(' '));const start=Date.now();const exitCode=await new Promise((resolve,reject)=>{const c=spawn('npm',['run',...args],{cwd:workspace,env:{...env,M353_B3_AUDIT_DIRECTORY:directory},stdio:'inherit'});c.once('error',reject);c.once('close',(code,signal)=>resolve(signal?1:code??1));});results.push({phase,command:'npm run '+args.join(' '),exitCode,elapsedMs:Date.now()-start,audit:await collectOfflineAudit(directory),diagnostics:await collectOfflineDiagnostics(directory)});}
const report={version:'offline-checks/2',workspace,results};
await writeFile(join(temporary,'checks.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.exitCode||r.audit.status!=='PASS'||r.diagnostics.state!=='CORRELATED'))process.exitCode=1;
