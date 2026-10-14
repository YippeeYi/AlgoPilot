// Actual UI on desktop/mobile with explicit account HTTP fixtures. Not Supabase/JWT or CF sync acceptance.
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('public account controls, partial coverage, consent and unknown-ack retry preserve identity scope',async({page},info)=>{
 const email=`m33-${randomUUID()}@fixture.test`;await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}});await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fdashboard`);
 let state={version:'cf-evidence/1',revision:0,evidenceRevision:0,handle:null as string|null,ownershipVerified:false,enabled:false,lastSyncedAt:null as string|null,lastFullScanAt:null,fullScanUpperId:null,oldestObservedAt:null,highWater:null as number|null,historyFrom:1,historyInProgress:false,observedSubmissions:0,acceptedProblems:0,pendingSubmissions:0,status:'unlinked',errorCode:null};
 const intents:{requestId:string;action?:string;revision:number}[]=[],seen=new Set<string>();let lost=false;
 await page.route('**/api/v1/codeforces-account{,/sync}',async route=>{
  if(route.request().method()==='GET'){await route.fulfill({json:{state}});return;}
  const body=route.request().postDataJSON();intents.push(body);
  if(!seen.has(body.requestId)){
   seen.add(body.requestId);
   if(body.action==='bind')state={...state,revision:state.revision+1,evidenceRevision:state.evidenceRevision+1,handle:body.handle,enabled:false,observedSubmissions:0,acceptedProblems:0,status:'never',historyInProgress:true};
   else if(body.action==='consent'){state={...state,revision:state.revision+1,evidenceRevision:state.evidenceRevision+1,enabled:body.enabled};if(!lost){lost=true;await route.fulfill({status:503,json:{error:{message:'[FIXTURE] acknowledgement lost'}}});return;}}
   else if(body.action==='unlink'||body.action==='delete')state={...state,revision:state.revision+1,evidenceRevision:state.evidenceRevision+1,handle:null,enabled:false,observedSubmissions:0,acceptedProblems:0,lastSyncedAt:null,historyInProgress:false,status:'unlinked'};
   else state={...state,evidenceRevision:state.evidenceRevision+1,lastSyncedAt:'2026-10-15T00:00:00Z',highWater:1000,historyFrom:161,observedSubmissions:200,acceptedProblems:50,pendingSubmissions:1,historyInProgress:true,status:'partial'};
  }
  await route.fulfill({json:{state,notice:'[FIXTURE] 请求已处理'}});
 });
 await page.goto('/settings');await expect(page.getByLabel('公开 CF Handle')).toBeEnabled();await page.getByLabel('公开 CF Handle').fill('Public_Handle');await page.getByRole('button',{name:'关联公开账号',exact:true}).click();await expect(page.getByText('归属未验证',{exact:false}).last()).toBeVisible();
 await page.getByRole('button',{name:'首次同步'}).click();await expect(page.getByText(/本轮历史尚未到尾部/)).toBeVisible();expect(intents.at(-1)).not.toHaveProperty('action');
 await page.getByRole('button',{name:'启用官方证据分析'}).click();await expect(page.locator('main').getByRole('alert')).toContainText('acknowledgement lost');await expect(page.getByRole('button',{name:'关闭官方证据分析'})).toBeEnabled();
 await page.getByRole('button',{name:'重试上次请求'}).click();await expect(page.locator('main').getByRole('alert')).toHaveCount(0);expect(intents.at(-1)!.requestId).toBe(intents.at(-2)!.requestId);
 await page.getByRole('button',{name:'关闭官方证据分析'}).click();await expect(page.getByRole('button',{name:'启用官方证据分析'})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/tmp/algopilot-m33-account-${info.project.name}.png`,fullPage:true});
 await page.getByLabel('公开 CF Handle').fill('Other_Handle');await page.getByRole('button',{name:'替换公开账号'}).click();await expect(page.getByText(/涉及 0 道 OK/)).toBeVisible();
 await page.getByRole('button',{name:'解除关联',exact:true}).click();await expect(page.getByRole('button',{name:'关联公开账号',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'首次同步'})).toHaveCount(0);
});
