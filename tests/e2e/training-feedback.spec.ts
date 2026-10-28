// Local SDK/HTTP fixtures, not hosted RLS/JWT. This flow makes no model request.
import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
async function login(page:Page){const email=`feedback-${randomUUID()}@fixture.test`;await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}});await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fdashboard`);await expect(page).toHaveURL(/\/dashboard$/);await expect(page.getByRole('button',{name:'保存目标并推荐'})).toBeEnabled();}
async function end(page:Page,outcome:string){await page.getByRole('button',{name:'结束训练',exact:true}).click();await page.getByLabel('手动记录训练结果（用户自报）').selectOption(outcome);await page.getByRole('button',{name:'确认完成',exact:true}).click();await expect(page.getByText(/训练已完成，用时不再累计/)).toBeVisible();}
test('recommendation source survives skip, resumed drafts, explicit outcomes and profile refresh without duplicate success',async({page,browser,baseURL},info)=>{
  await login(page);await expect(page.getByText(/本轮推荐来源已记录/)).toBeVisible();
  const originalPrefs=(await(await page.request.get('/api/v1/learning')).json()).preferences;
  const card=page.locator('[data-slot="card"]').first();await card.getByRole('button',{name:'跳过本轮推荐'}).click();await expect(page.getByText(/已跳过本轮推荐/)).toBeVisible();
  const read=async()=> (await(await page.request.get('/api/v1/learning/training-feedback?window=all')).json()).items;
  const skipped=(await read()).find((r:{skippedAt:string|null})=>r.skippedAt);expect(skipped.sessionId).toBeNull();expect((await(await page.request.get('/api/v1/sessions')).json()).items).toEqual([]);
  await card.getByRole('button',{name:'进入思维教练'}).click();await expect(page).toHaveURL(/\/practice\/[\w-]+$/);const firstId=new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('heading',{name:'本次训练的推荐来源'})).toBeVisible();
  expect((await page.request.patch(`/api/v1/sessions/${firstId}/thought-draft`,{data:{content:'[SYNTHETIC] preserved thought',expectedRevision:0}})).status()).toBe(200);
  const key=`${skipped.contestId}${skipped.index}`;
  await page.goto('/dashboard');const again=page.locator('[data-slot="card"]').filter({hasText:key});await again.getByRole('button',{name:'进入思维教练'}).click();await expect(page).toHaveURL(new RegExp('/practice/'+firstId+'$'));
  expect((await(await page.request.get(`/api/v1/sessions/${firstId}`)).json()).session.thought_draft).toBe('[SYNTHETIC] preserved thought');
  const linked=(await read()).filter((r:{sessionId:string})=>r.sessionId===firstId);expect(linked.filter((r:{originated:boolean})=>r.originated)).toHaveLength(1);expect(linked.some((r:{originated:boolean})=>!r.originated)).toBe(true);
  await end(page,'unsolved');await expect(page.getByText(/自报暂未解出/).first()).toBeVisible();
  await page.goto('/dashboard');await page.locator('[data-slot="card"]').filter({hasText:key}).getByRole('button',{name:'进入思维教练'}).click();await expect(page).toHaveURL(/\/practice\/[\w-]+$/);const secondId=new URL(page.url()).pathname.split('/').at(-1)!;expect(secondId).not.toBe(firstId);
  await end(page,'solved_self_reported');await page.getByRole('link',{name:'返回能力画像，查看最新训练证据'}).click();await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole('heading',{name:'推荐后的训练反馈'})).toBeVisible();await expect(page.getByText(/本轮新建训练 2/)).toBeVisible();await expect(page.getByText(/UNKNOWN（至少5道不同题目有明确结果）/)).toBeVisible();
  const learning=await(await page.request.get('/api/v1/learning?window=all')).json();expect(learning.intelligence.recent).toMatchObject({completedProblems:1,selfReportedSolved:1});expect(learning.preferences).toEqual(originalPrefs);
  const old=(await(await page.request.get(`/api/v1/sessions/${firstId}`)).json()).session;expect(old).toMatchObject({outcome:'unsolved',thought_draft:'[SYNTHETIC] preserved thought'});
  const next=await(await page.request.post('/api/v1/recommendations',{data:{}})).json();expect(next.items.some((r:{problem:{id:string}})=>r.problem.id===skipped.problemId)).toBe(false);
  const ctx=await browser.newContext({baseURL});try{const other=await ctx.newPage();await login(other);expect((await(await other.request.get('/api/v1/learning/training-feedback')).json()).items.every((r:{id:string})=>r.id!==skipped.id)).toBe(true);
    expect((await other.request.post('/api/v1/learning/training-feedback',{data:{id:skipped.id,action:'start'}})).status()).toBe(404);
  }finally{await ctx.close();}
  await page.screenshot({path:`/tmp/algopilot-training-feedback-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
