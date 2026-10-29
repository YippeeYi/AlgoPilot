// Synthetic local data. This port retains the production denying Provider factory.
import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
test.use({baseURL:'http://127.0.0.1:3103'});
async function login(page:Page,next='/dashboard'){
 const email=`recommendation-continuity-${randomUUID()}@fixture.test`;
 expect((await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}})).status()).toBe(200);
 await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=${encodeURIComponent(next)}`);await expect(page).toHaveURL(new RegExp(next+'$'));
}
test('initial target loading cannot silently overwrite edits, and pending writes lock their submitted controls',async({page})=>{
 await login(page);await expect(page.getByRole('button',{name:'保存目标并推荐'})).toBeEnabled();
 const preferences={min:1300,max:1800,themes:[],goal:'explore',repeat:false,reviewEvidence:false};
 expect((await page.request.post('/api/v1/learning/preferences',{data:{requestId:randomUUID(),revision:0,preferences}})).status()).toBe(200);
 let release!:()=>void,arrive!:()=>void;const wait=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{arrive=r;});
 await page.route('**/api/v1/recommendations',async r=>{const response=await r.fetch();arrive();await wait;await r.fulfill({response});},{times:1});
 await page.reload();await started;const min=page.getByLabel('愿意挑战的最低难度');const editable=await min.isEnabled();
 if(editable)await min.fill('1700');release();await expect(page.getByRole('button',{name:'保存目标并推荐'})).toBeEnabled();await expect(min).toHaveValue('1300');
 expect(editable,'HEAD allowed 1700 to be typed, then replaced it with saved 1300').toBe(false);
 await min.fill('1400');let finish!:()=>void,received!:()=>void;const pending=new Promise<void>(r=>{finish=r;}),sent=new Promise<void>(r=>{received=r;});
 await page.route('**/api/v1/learning/preferences',async r=>{received();await pending;await r.fallback();},{times:1});
 await page.getByRole('button',{name:'保存目标并推荐'}).click();await sent;await expect(min).toBeDisabled();await expect(page.getByLabel('训练目标')).toBeDisabled();finish();
 await expect(page.getByText(/目标已保存/).first()).toBeVisible();await expect(min).toBeEnabled();await expect(min).toHaveValue('1400');
});
test('an acknowledged target with a failed recommendation recovers into training, denied Tutor, review and growth',async({page},info)=>{
 await login(page,'/settings');await expect(page.getByLabel('公开 CF Handle')).toBeEnabled();await page.getByRole('link',{name:'能力画像',exact:true}).click();await expect(page.getByText('官方证据未启用，不参与本轮能力判断。')).toBeVisible();
 await page.getByRole('link',{name:'选择下一道题',exact:true}).click();await expect(page.getByRole('button',{name:'保存目标并推荐'})).toBeEnabled();
 await page.getByLabel(/授权从已生成/).check();await page.getByRole('button',{name:'保存目标并推荐'}).click();await expect(page.getByText(/目标已保存/).first()).toBeVisible();
 const cards=page.locator('[data-slot="card"]');expect(await cards.count()).toBeGreaterThan(0);let writes=0;
 page.on('request',r=>{if(r.url().endsWith('/learning/preferences')&&r.method()==='POST')writes++;});
 await page.getByLabel('愿意挑战的最低难度').fill('1800');await page.getByLabel('愿意挑战的最高难度').fill('1800');await page.getByLabel(/授权从已生成/).uncheck();
 await page.route('**/api/v1/recommendations',r=>r.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'[SYNTHETIC] candidate refresh failed'}}}),{times:1});
 await page.getByRole('button',{name:'保存目标并推荐'}).click();await expect(page.locator('main').getByRole('alert')).toContainText('candidate refresh failed');
 const saved=(await(await page.request.get('/api/v1/learning')).json()).preferences;expect(saved).toMatchObject({min:1800,max:1800,reviewEvidence:false});
 await expect(cards).toHaveCount(0);await expect(page.getByText(/目标已保存.*重新推荐/).first()).toBeVisible();expect(writes).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/private/tmp/algopilot-recommendation-recovery-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'重新推荐',exact:true}).click();await expect(cards.first()).toBeVisible();await expect(page.getByRole('button',{name:'重新推荐',exact:true})).toBeEnabled();expect(writes).toBe(1);
 await cards.first().getByRole('button',{name:'跳过本轮推荐'}).click();await expect(page.getByText(/已跳过本轮推荐/)).toBeVisible();await cards.first().getByRole('button',{name:'进入思维教练'}).click();await expect(page).toHaveURL(/\/practice\/[\w-]+$/);
 const id=new URL(page.url()).pathname.split('/').at(-1)!;
 await page.getByLabel('补充当前题目的题面、约束与样例').fill('[SYNTHETIC] n<=10，输出整数。');
 if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();await page.getByLabel('发送给思维教练').fill('[SYNTHETIC] keep this question');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.getByRole('alert',{name:'AI 请求错误'})).toContainText('AI 生成已阻止');await expect(page.getByLabel('发送给思维教练')).toHaveValue('[SYNTHETIC] keep this question');await page.getByRole('button',{name:'清空未发送草稿'}).click();
 await page.getByRole('button',{name:'结束训练',exact:true}).click();await page.getByLabel('手动记录训练结果（用户自报）').selectOption('solved_self_reported');await page.getByRole('button',{name:'确认完成',exact:true}).click();await expect(page.getByText(/训练已完成，用时不再累计/)).toBeVisible();
 await page.getByRole('link',{name:'AC 后导入代码复盘',exact:true}).click();await expect(page.getByLabel('关联训练（可选）')).toHaveValue(id);await page.getByLabel('C++ 代码快照',{exact:true}).fill('// SYNTHETIC\nint main(){}');await page.getByLabel(/我确认本次为自报 AC/).check();await page.getByRole('button',{name:'确认进入复盘并保存快照'}).click();await expect(page.getByRole('button',{name:'生成 AI 复盘',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'生成 AI 复盘',exact:true}).click();await expect(page.getByRole('alert',{name:'复盘错误'})).toContainText('AI 生成已阻止');await page.getByLabel('用户编辑复盘',{exact:true}).fill('[SYNTHETIC] saved reflection');await page.getByRole('button',{name:'保存用户编辑',exact:true}).click();await expect(page.getByRole('button',{name:'保存用户编辑',exact:true})).toBeEnabled();
 await page.getByRole('link',{name:'能力画像',exact:true}).click();await expect(page.getByRole('heading',{name:'成长观测：记录变化与下一步'})).toBeVisible();
 const current=await(await page.request.get('/api/v1/learning')).json();expect(current.preferences).toEqual(saved);expect(current.intelligence.recent).toMatchObject({completedProblems:1,selfReportedSolved:1});
 const feedback=await(await page.request.get('/api/v1/learning/training-feedback')).json();expect(feedback.items.filter((r:{sessionId:string;originated:boolean})=>r.sessionId===id&&r.originated)).toHaveLength(1);
 const next=await(await page.request.post('/api/v1/recommendations',{data:{}})).json();const old=await(await page.request.get(`/api/v1/sessions/${id}`)).json();expect(next.items.every((r:{problem:{id:string}})=>r.problem.id!==old.session.problem_id)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/private/tmp/algopilot-product-continuity-${info.project.name}.png`,fullPage:true});
});
test('a revision refusal invalidates displayed candidates before an explicit recovery',async({page})=>{
 await login(page);const cards=page.locator('[data-slot="card"]');await expect(cards.first()).toBeVisible();await expect(page.getByRole('button',{name:'保存目标并推荐'})).toBeEnabled();
 await page.route('**/api/v1/recommendations',r=>r.fulfill({status:409,json:{error:{code:'LEARNING_EVIDENCE_CHANGED',message:'[SYNTHETIC] permission revision changed'}}}),{times:1});
 await page.getByRole('button',{name:'重新推荐',exact:true}).click();await expect(page.locator('main').getByRole('alert')).toContainText('permission revision changed');await expect(cards).toHaveCount(0);
 await page.getByRole('button',{name:'重新推荐',exact:true}).click();await expect(cards.first()).toBeVisible();
});
