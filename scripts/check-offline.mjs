// Local checks in a private copy, with no real environment files or inherited secrets.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,symlink,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {collectOfflineAudit} from './offline-audit.ts';
const root=process.cwd(),temporary=await mkdtemp(join(tmpdir(),'algopilot-replay-checks-')),workspace=join(temporary,'workspace'),audits=join(temporary,'audits'),home=join(temporary,'home');
for(const p of [workspace,audits,home])await mkdir(p,{mode:0o700});
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).split('\0').filter(Boolean);
for(const file of files){if(/(^|\/)\.env($|\.)/.test(file))continue;const to=join(workspace,file);await mkdir(dirname(to),{recursive:true});await copyFile(join(root,file),to);}
await symlink(join(root,'node_modules'),join(workspace,'node_modules'),'dir');
const env={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:home,TMPDIR:temporary,CI:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:`--require=${join(workspace,'scripts/offline-audit-lifecycle.cjs')}`,M353_B3_AUDIT_DIRECTORY:audits};
const targeted=['test','--','tests/unit/draft-queue.test.ts','tests/unit/navigation-guard.test.ts','tests/unit/tutor-draft.test.tsx','tests/unit/workspace-continuity.test.tsx','tests/unit/m34-review.test.ts','tests/unit/m34-review-cli.test.ts','tests/unit/m34-replay.test.ts','tests/unit/m34-replay-cli.test.ts','tests/unit/offline-audit.test.ts','tests/unit/m34-results-validation.test.ts','tests/unit/m34-results-pairing.test.ts','tests/unit/m34-results-cli.test.ts','--maxWorkers=1'];
const early=process.argv.slice(2).length===1&&process.argv[2]==='--targeted';
if(process.argv.length>2&&!early)throw Error('Only --targeted is supported');
const commands=[['lint'],['typecheck'],targeted,...early?[]:[['test','--','--maxWorkers=1'],['test:recommendations','--','--maxWorkers=1'],['build']]];
console.log('OFFLINE_WORKSPACE='+workspace);const results=[];
for(const args of commands){console.log('npm run '+args.join(' '));const start=Date.now();const exitCode=await new Promise((resolve,reject)=>{const c=spawn('npm',['run',...args],{cwd:workspace,env,stdio:'inherit'});c.once('error',reject);c.once('close',(code,signal)=>resolve(signal?1:code??1));});results.push({command:'npm run '+args.join(' '),exitCode,elapsedMs:Date.now()-start});}
const audit=await collectOfflineAudit(audits),report={version:'offline-checks/1',workspace,results,audit};
await writeFile(join(temporary,'checks.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.exitCode)||audit.status!=='PASS')process.exitCode=1;
