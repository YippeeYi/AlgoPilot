// Synthetic local API contracts only; no Tutor/Review dispatch or real account evidence.
import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
async function login(page:Page){const email=`growth-${randomUUID()}@fixture.test`;await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}});await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fanalytics`);await expect(page).toHaveURL(/\/analytics$/);}
test('training evidence updates growth and outcome observations, then supports a focused next recommendation',async({page,browser,baseURL},info)=>{
  await login(page);await expect(page.getByRole('heading',{name:'成长观测：记录变化与下一步'})).toBeVisible();
  const prefs={min:800,max:3500,themes:[],goal:'balanced',repeat:false,reviewEvidence:false};
  expect((await page.request.post('/api/v1/learning/preferences',{data:{requestId:randomUUID(),revision:0,preferences:prefs}})).status()).toBe(200);
  const problems=(await(await page.request.get('/api/v1/problems?tags=math&limit=50')).json()).items;
  const used:string[]=[];
  for(const p of problems.slice(0,5)){
    const response=await page.request.post('/api/v1/sessions',{data:{problemId:p.id,mode:'practice',timerEnabled:false,requestId:randomUUID()}});expect(response.status()).toBe(201);
    const s=(await response.json()).session;used.push(p.id);
    expect((await page.request.patch(`/api/v1/sessions/${s.id}`,{data:{action:'finish',expectedRevision:s.state_revision,outcome:'solved_self_reported'}})).status()).toBe(200);
  }
  await page.getByRole('button',{name:'刷新训练证据'}).click();await page.getByLabel('诊断时间窗口').selectOption('7');
  const link=page.getByRole('link',{name:'按 math 成长证据选择下一题'});await expect(link).toBeVisible();
  expect((await(await page.request.get('/api/v1/learning?window=7')).json()).intelligence.growth).toMatchObject({current:{problems:5,known:5},previous:{problems:0},comparison:'insufficient',medianChange:null});
  await link.click();await expect(page).toHaveURL(/\/dashboard\?focus=math&window=7$/);await expect(page.getByText(/来自成长观测的显式专项：math/).first()).toBeVisible();
  const cards=page.locator('[data-slot="card"]');await cards.first().getByRole('button',{name:'进入思维教练'}).click();await expect(page).toHaveURL(/\/practice\/[\w-]+$/);
  await page.getByRole('button',{name:'结束训练',exact:true}).click();await page.getByLabel('手动记录训练结果（用户自报）').selectOption('solved_self_reported');await page.getByRole('button',{name:'确认完成',exact:true}).click();
  await page.getByRole('link',{name:'返回能力画像，查看最新训练证据'}).click();await expect(page).toHaveURL(/\/analytics$/);
  const observations=page.getByRole('region',{name:'推荐效果观测'});await expect(observations.getByText(/新建训练按 session 去重 1 次/)).toBeVisible();await expect(observations.getByText(/真实展示数量：UNKNOWN/)).toBeVisible();await expect(observations.getByText(/推荐后官方确认完成数：UNKNOWN/)).toBeVisible();
  const latest=(await(await page.request.get('/api/v1/learning?window=7')).json());expect(latest.intelligence.growth.current).toMatchObject({problems:6,known:6,solved:6});expect(latest.preferences).toEqual(prefs);
  for(const window of ['90','all','30']){await page.getByLabel('诊断时间窗口').selectOption(window);await expect(page.getByRole('heading',{name:'成长观测：记录变化与下一步'})).toBeVisible();}
  const next=await(await page.request.post('/api/v1/recommendations',{data:{}})).json();expect(next.items.every((r:{problem:{id:string}})=>!used.includes(r.problem.id))).toBe(true);
  const peer=await browser.newContext({baseURL});try{const other=await peer.newPage();await login(other);expect((await(await other.request.get('/api/v1/learning?window=7')).json()).intelligence.growth.current.problems).toBe(0);expect((await other.request.post('/api/v1/recommendations',{data:{focus:{topic:'math',window:'7'}}})).status()).toBe(409);}finally{await peer.close();}
  await page.getByRole('heading',{name:'成长观测：记录变化与下一步'}).scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/algopilot-growth-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
