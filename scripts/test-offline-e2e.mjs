import { readFile, writeFile, readdir, mkdir, mkdtemp, copyFile, symlink } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { collectOfflineAudit } from './offline-audit.ts';
// Stages an isolated synthetic test application; never rewires the user's checkout.
const root=process.cwd();
const temporary=await mkdtemp(join(tmpdir(),'algopilot-gate-e2e-'));
const workspace=join(temporary,'workspace'),temp=temporary;
await mkdir(workspace,{mode:0o700});await mkdir(join(temp,'home'),{mode:0o700});
const audits=await mkdtemp(join(temp,'e2e-audits-'));
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).split('\0').filter(Boolean);
const additions=['scripts/m34-review-core.ts','scripts/m34-review.mjs','tests/fixtures/m34-review.ts','tests/fixtures/m34-review-driver.mjs','tests/unit/m34-review.test.ts','tests/unit/m34-review-cli.test.ts','scripts/m34-replay-core.ts','scripts/m34-replay.mjs','scripts/offline-audit.ts','scripts/offline-audit-lifecycle.cjs','scripts/check-offline.mjs','tests/fixtures/m34-replay.ts','tests/unit/m34-replay.test.ts','tests/unit/m34-replay-cli.test.ts','tests/unit/offline-audit.test.ts','scripts/m34-results.ts','tests/fixtures/m34-results.ts','tests/unit/m34-results-validation.test.ts','tests/unit/m34-results-pairing.test.ts','tests/unit/m34-results-cli.test.ts','src/features/learning/growth.ts','src/components/learning/growth-insights.tsx','tests/unit/growth-observations.test.ts','tests/unit/growth-insights.test.tsx','tests/e2e/growth-observations.spec.ts','supabase/migrations/202610270012_tutor_retry_recovery.sql','src/lib/validation/generation.ts','src/server/llm/execution-gate.ts','src/server/tutor/runtime-provider.ts','tests/fixtures/offline-provider.ts','tests/unit/generation-gate.test.ts','tests/unit/generation-gate-api.test.ts','tests/unit/generation-paths.test.ts','tests/e2e/generation-gate.spec.ts','scripts/test-offline-e2e.mjs','docs/M353_FREE_TIER_GATE_VERIFICATION.md','src/features/learning/intelligence.ts','src/components/learning/skill-insights.tsx','tests/fixtures/skill-intelligence.ts','tests/unit/skill-intelligence.test.ts','tests/unit/skill-insights.test.tsx','tests/integration/skill-intelligence-database.test.ts','tests/e2e/skill-intelligence.spec.ts','supabase/migrations/202610280013_recommendation_training_feedback.sql','src/lib/validation/training-feedback.ts','src/server/learning/training-feedback.ts','src/app/api/v1/learning/training-feedback/route.ts','src/features/learning/training-feedback.ts','src/components/learning/training-feedback.tsx','tests/fixtures/training-feedback.ts','tests/unit/training-feedback.test.ts','tests/unit/training-feedback-api.test.ts','tests/unit/training-feedback-repository.test.ts','tests/unit/training-feedback-panel.test.tsx','tests/integration/training-feedback-database.test.ts','tests/e2e/training-feedback.spec.ts'];
for(const file of new Set([...tracked,...additions])){if(/(^|\/)\.env($|\.)/.test(file))continue;const destination=join(workspace,file);await mkdir(dirname(destination),{recursive:true});try{await copyFile(join(root,file),destination);}catch(e){if(e.code!=='ENOENT'||!additions.includes(file))throw e;}}
await symlink(join(root,'node_modules'),join(workspace,'node_modules'),'dir');
console.log('OFFLINE_E2E_WORKSPACE='+workspace);
// Only the staged app receives fixture wiring. Every other configuration keeps the real, denying factory.
await writeFile(join(workspace,'src/server/tutor/runtime-provider.ts'),`import "server-only";import type {TutorConfig} from "./config";import {OpenAICompatibleProvider} from "./provider";import {createLoopbackFixtureProvider} from "../../../tests/fixtures/offline-provider";export function createRuntimeProvider(config:TutorConfig){return config.baseUrl==="http://127.0.0.1:54002/v1"?createLoopbackFixtureProvider(config):new OpenAICompatibleProvider(config);}`);
const source=await readFile(join(workspace,'scripts/m353-b3-offline-guard.cjs'),'utf8');
const start=source.indexOf('for (const name of ["node:http", "node:https"])');const end=source.indexOf('const dns =');
if(start<0||end<start)throw Error('guard_source_changed');
const local=`
function localHost(host) { return ['127.0.0.1','::1','[::1]','localhost'].includes(host); }
function httpHost(input) { if(typeof input==='string'||input instanceof URL)return new URL(input).hostname;return input?.hostname??input?.host??'localhost'; }
for(const name of ['node:http','node:https']) { const module=process.getBuiltinModule(name);for(const key of ['request','get']) {const original=module[key];module[key]=function(input,...args) {if(!localHost(httpHost(input)))return deny('networkBlocked')();return original.call(this,input,...args);};} }
const net=process.getBuiltinModule('net');
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args) {const a=Array.isArray(args[0])?args[0]:args;const first=a[0];const host=typeof first==='object'?first.host??'localhost':typeof a[1]==='string'?a[1]:'localhost';if((typeof first==='object'&&first.path)||!localHost(host))return deny('networkBlocked')();return connect.apply(this,args);};
const tls=process.getBuiltinModule('tls'),tlsConnect=tls.connect;
tls.connect=function(...args){const first=args[0];const host=typeof first==='object'?first.host??'localhost':typeof args[1]==='string'?args[1]:'localhost';if(!localHost(host))return deny('networkBlocked')();return tlsConnect.apply(this,args);};
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...args){const target=typeof input==='object'&&'url' in input?input.url:input;if(!localHost(new URL(target).hostname))return deny('networkBlocked')();return originalFetch.call(this,input,...args);};
`;
const guard=join(temp,'e2e-loopback-guard.cjs');const localLookup=`
// Resolve only literal loopback/localhost locally. Never call OS DNS for these fixtures.
function loopbackAddress(host,options) { if(!localHost(host))return deny('dnsBlocked')();const family=host==='::1'||host==='[::1]'||host==='localhost'&&(options===6||options?.family===6)?6:4;return {address:family===6?'::1':'127.0.0.1',family}; }
dns.lookup=function(host,options,callback){if(typeof options==='function'){callback=options;options={};}const a=loopbackAddress(host,options);queueMicrotask(()=>options?.all?callback(null,[a]):callback(null,a.address,a.family));};
dns.promises.lookup=async function(host,options){const a=loopbackAddress(host,options);return options?.all?[a]:a;};
`;
const tail=source.slice(end).replace('function credentialPath(value) {',localLookup+'\nfunction credentialPath(value) {');
await writeFile(guard,source.slice(0,start)+local+tail);
const lifecycle=join(temp,'e2e-audit-lifecycle.cjs');
await writeFile(lifecycle,(await readFile(join(workspace,'scripts/offline-audit-lifecycle.cjs'),'utf8')).replace("load('./m353-b3-offline-guard.cjs')",'load('+JSON.stringify(guard)+')'));
const wrapper=`import { test as base, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
export { expect }; export type { Page } from '@playwright/test';
export const test=base.extend({browser:[async({browser},use)=>{
 await writeFile(process.env.OFFLINE_BROWSER_AUDIT_DIRECTORY+'/'+process.pid+'.browser.started',JSON.stringify({version:'offline-browser-lifecycle/1',pid:process.pid}),{flag:'wx',mode:0o600});
 const original=browser.newContext.bind(browser);let denied=0,allowed=0;
 browser.newContext=async(options)=>{const context=await original({...options,serviceWorkers:'block'});await context.route('**/*',async route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)){allowed++;await route.fallback();}else{denied++;await route.abort('blockedbyclient');}});return context;};
 try{await use(browser);}finally{await writeFile(process.env.OFFLINE_BROWSER_AUDIT_DIRECTORY+'/'+process.pid+'.browser.json',JSON.stringify({version:'review-browser-routing/1',allowed,denied,nativeBackgroundHTTP:null,nativeBackgroundDNS:null}));browser.newContext=original;expect(denied).toBe(0);}
},{scope:'worker'}]});
`;
await writeFile(join(workspace,'tests/offline-playwright.ts'),wrapper);
for(const file of (await readdir(join(workspace,'tests/e2e'))).filter(f=>f.endsWith('.spec.ts'))){const p=join(workspace,'tests/e2e',file);const s=await readFile(p,'utf8');await writeFile(p,s.replace(/from (["'])@playwright\/test\1/g,'from "../offline-playwright"'));}
await writeFile(join(workspace,'playwright.offline.config.ts'),`import { defineConfig } from '@playwright/test';import base from './playwright.config';export default defineConfig({...base,retries:0,webServer:(Array.isArray(base.webServer)?base.webServer:base.webServer?[base.webServer]:[]).map(server=>({...server,gracefulShutdown:{signal:'SIGTERM' as const,timeout:500}})),use:{...base.use,launchOptions:{args:['--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--no-pings','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE [::1]']}}});\n`);
const env={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:join(temp,'home'),TMPDIR:temp,CI:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:`--require=${lifecycle}`,M353_B3_AUDIT_DIRECTORY:audits,OFFLINE_BROWSER_AUDIT_DIRECTORY:audits,PLAYWRIGHT_BROWSERS_PATH:join(userInfo().homedir,process.platform==='darwin'?'Library/Caches/ms-playwright':'.cache/ms-playwright')};
async function run(command,args,extra={}){console.log(command+' '+args.join(' '));return new Promise((resolve,reject)=>{const c=spawn(command,args,{cwd:workspace,env:{...env,...extra},stdio:'inherit'});c.on('error',reject);c.on('exit',(code,signal)=>resolve(signal?1:code??1));});}
const buildExitCode=await run(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54001',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',APP_URL:'http://127.0.0.1:3102'});
const exitCode=buildExitCode===0?await run(process.execPath,[join(root,'node_modules/@playwright/test/cli.js'),'test','--config=playwright.offline.config.ts',...process.argv.slice(2)]):1;
const files=await readdir(audits);let invalid=0;const rows=[];
for(const f of files.filter(f=>f.endsWith('.json'))){try{rows.push(JSON.parse(await readFile(join(audits,f),'utf8')));}catch{invalid++;}}
const incomplete=files.filter(f=>f.endsWith('.pending')&&!files.includes(f.replace(/\.pending$/,'.json'))).length;
const node=rows.filter(r=>r.version==='m353-b3-guard/1'),browser=rows.filter(r=>r.version==='review-browser-routing/1');
const counters={networkBlocked:0,dnsBlocked:0,credentialReadBlocked:0,externalHTTP:0,realDNS:0,realCredentialReads:0};
for(const r of node)for(const k of Object.keys(counters)){if(!Number.isSafeInteger(r[k])||r[k]<0)invalid++;else counters[k]+=r[k];}
const lifecycleAudit=await collectOfflineAudit(audits);
const report={lifecycleAudit,artifact:join(audits,'checks.json'),workspace,buildExitCode,exitCode,nodeRuntimes:node.length,incomplete,invalid,nodeCounters:lifecycleAudit.counters,browserRoutes:browser,nativeBrowserHTTP:'UNKNOWN',nativeBrowserDNS:'UNKNOWN'};
await writeFile(join(audits,'checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(lifecycleAudit.status!=='PASS'||!lifecycleAudit.browserCompleted||exitCode||incomplete||invalid||!node.length||!browser.length||Object.values(counters).some(n=>n!==0)||browser.some(r=>r.denied))process.exitCode=1;
