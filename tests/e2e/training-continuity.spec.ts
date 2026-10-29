// Synthetic local contracts only. No real Provider, credentials or hosted database.
import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
async function account(page:Page,next='/dashboard'){
  const email=`continuity-${randomUUID()}@fixture.test`;
  expect((await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}})).status()).toBe(200);
  await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(new RegExp(next+'$'));
}
test('recommendation training preserves context through a lost save, completion, refresh, review and profile return',async({page},info)=>{
  await account(page);await expect(page.getByRole('button',{name:'保存目标并推荐'})).toBeEnabled();
  const preferences=(await(await page.request.get('/api/v1/learning')).json()).preferences;
  await page.locator('[data-slot="card"]').first().getByRole('button',{name:'进入思维教练'}).click();await expect(page).toHaveURL(/\/practice\/[\w-]+$/);
  const path=new URL(page.url()).pathname,id=path.split('/').at(-1)!, supplement='[SYNTHETIC] n<=10，输出给定整数。';
  const context=page.getByLabel('补充当前题目的题面、约束与样例');await context.fill(supplement);
  for(const name of ['返回我的计划','AC 后导入代码复盘']){
    await page.getByRole('link',{name,exact:true}).click();await expect(page).toHaveURL(new RegExp(path+'$'));await expect(page.getByRole('alert').filter({hasText:'未保存的修改'})).toBeVisible();
  }
  if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'思路笔记',exact:true}).click();
  await page.getByLabel('当前思路',{exact:true}).fill('[SYNTHETIC] 保留我的推导');
  const attempts:unknown[]=[];
  await page.route(`**/api/v1/sessions/${id}/context`,async route=>{
    attempts.push(route.request().postDataJSON());
    if(attempts.length===1){const committed=await route.fetch();expect(committed.status()).toBe(200);await route.abort('failed');}
    else await route.fallback();
  });
  await page.getByRole('button',{name:'结束训练',exact:true}).click();await page.getByLabel('手动记录训练结果（用户自报）').selectOption('solved_self_reported');await page.getByRole('button',{name:'确认完成',exact:true}).click();
  // The first append committed, but neither the browser nor completion may assume an acknowledgement.
  if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'题面',exact:true}).click();
  await expect(page.getByText(/题面保存结果尚未确认/)).toBeVisible();await expect(context).toHaveAttribute('readonly','');
  const before=(await(await page.request.get(`/api/v1/sessions/${id}`)).json()).session;expect(before.status).not.toBe('completed');expect(before.thought_draft).toContain(supplement);
  await page.getByRole('button',{name:'确认完成',exact:true}).click();await expect(page.getByText(/训练已完成，用时不再累计/)).toBeVisible();
  expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
  const thoughts=(await(await page.request.get(`/api/v1/sessions/${id}/thoughts`)).json()).items;expect(thoughts).toHaveLength(1);
  await page.reload();if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'思路笔记',exact:true}).click();
  const saved=(await(await page.request.get(`/api/v1/sessions/${id}`)).json()).session;expect(saved.thought_draft.match(/n<=10/g)).toHaveLength(1);expect(saved.outcome).toBe('solved_self_reported');
  await expect(page.getByLabel('当前思路',{exact:true})).toHaveValue('[SYNTHETIC] 保留我的推导\n【用户补充的题面上下文】\n'+supplement);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/algopilot-continuity-${info.project.name}.png`,fullPage:true});
  await page.getByRole('link',{name:'AC 后导入代码复盘',exact:true}).click();await expect(page).toHaveURL(new RegExp('/reviews\\?sessionId='+id+'$'));await expect(page.getByLabel('关联训练（可选）')).toHaveValue(id);
  await page.getByRole('link',{name:'能力画像',exact:true}).click();await expect(page).toHaveURL(/\/analytics$/);await expect(page.getByRole('heading',{name:'成长观测：记录变化与下一步'})).toBeVisible();
  const updated=await(await page.request.get('/api/v1/learning')).json();expect(updated.intelligence.recent).toMatchObject({completedProblems:1,selfReportedSolved:1});expect(updated.preferences).toEqual(preferences);
  const evidence=await(await page.request.get('/api/v1/learning/training-feedback')).json();expect(evidence.items.filter((r:{sessionId:string;originated:boolean})=>r.sessionId===id&&r.originated)).toHaveLength(1);
});

test.describe('production-denied Tutor remains separate from saving training evidence',()=>{
  test.use({baseURL:'http://127.0.0.1:3103'});
  test('supplemental context is saved before the gate refuses and normal training remains usable',async({page},info)=>{
    await account(page,'/sessions');const response=await page.request.post('/api/v1/sessions',{data:{problemId:'50000000-0000-4000-8000-000000000001',timerEnabled:false,requestId:randomUUID()}});expect(response.status()).toBe(201);const id=(await response.json()).session.id;
    await page.goto(`/practice/${id}`);await page.getByLabel('补充当前题目的题面、约束与样例').fill('[SYNTHETIC] 新约束先保存，模型继续拒绝。');
    if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();
    const question=page.getByLabel('发送给思维教练');await question.fill('[SYNTHETIC] 保留的问题');const gate=page.waitForResponse(r=>r.url().endsWith(`/sessions/${id}/tutor`)&&r.request().method()==='POST');
    await page.getByRole('button',{name:'发送',exact:true}).click();const denied=await gate;expect(denied.status()).toBe(403);expect((await denied.json()).error.code).toBe('LLM_FREE_TIER_UNVERIFIED');
    await expect(page.getByRole('alert',{name:'AI 请求错误'})).toContainText('AI 生成已阻止');await expect(page.getByRole('alert',{name:'AI 请求错误'})).not.toContainText('超时');await expect(question).toHaveValue('[SYNTHETIC] 保留的问题');
    const session=(await(await page.request.get(`/api/v1/sessions/${id}`)).json()).session;expect(session.thought_draft).toContain('新约束先保存');expect((await(await page.request.get(`/api/v1/sessions/${id}/tutor`)).json()).messages).toHaveLength(0);
    await question.fill('');await page.getByRole('button',{name:'结束训练',exact:true}).click();await page.getByLabel('手动记录训练结果（用户自报）').selectOption('unsolved');await page.getByRole('button',{name:'确认完成',exact:true}).click();await expect(page.getByText(/训练已完成，用时不再累计/)).toBeVisible();
  });
});
