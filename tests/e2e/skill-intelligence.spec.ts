// Local contract fixtures only: no hosted Auth/RLS or real model generation.
import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
async function login(page:Page){const email=`skill-${randomUUID()}@fixture.test`;await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}});await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fanalytics`);await expect(page).toHaveURL(/\/analytics$/);}
test('owned training evidence becomes an explicit focused recommendation and starts a new training without changing preferences',async({page,browser,baseURL},info)=>{
  await login(page);await expect(page.getByRole('heading',{name:'本窗口的训练诊断与行动'})).toBeVisible();
  await expect(page.getByText(/暂无可见知识方向证据/)).toBeVisible();
  const prefs={min:800,max:3500,themes:[],goal:'balanced',repeat:false,reviewEvidence:false};
  expect((await page.request.post('/api/v1/learning/preferences',{data:{requestId:randomUUID(),revision:0,preferences:prefs}})).status()).toBe(200);
  const problems=(await(await page.request.get('/api/v1/problems?tags=math&limit=50')).json()).items;
  const used:string[]=[];
  // Build genuine application fixture records using existing APIs; only the isolated HTTP Mock handles Tutor.
  for(const p of problems.slice(0,5)){
    const response=await page.request.post('/api/v1/sessions',{data:{problemId:p.id,statementSnapshot:'[SYNTHETIC] 输入一个整数，输出其值。',mode:'practice',timerEnabled:false,requestId:randomUUID()}});expect(response.status()).toBe(201);
    const s=(await response.json()).session;used.push(p.id);
    for(let revision=0;revision<3;revision++)expect((await page.request.post(`/api/v1/sessions/${s.id}/hints`,{data:{operation:'upgrade',revision,requestId:randomUUID()}})).status()).toBe(200);
    expect((await page.request.post(`/api/v1/sessions/${s.id}/tutor`,{data:{action:'chat',message:'检查这个前提',requestId:randomUUID()}})).status()).toBe(200);
    expect((await page.request.patch(`/api/v1/sessions/${s.id}`,{data:{action:'finish',expectedRevision:s.state_revision,outcome:'solved_self_reported'}})).status()).toBe(200);
  }
  await page.getByRole('button',{name:'刷新训练证据'}).click();await expect(page.getByRole('link',{name:'按 math 诊断补充训练'})).toBeVisible();
  await page.getByLabel('诊断时间窗口').selectOption('7');await expect(page.getByRole('link',{name:'按 math 诊断补充训练'})).toHaveAttribute('href','/dashboard?focus=math&window=7');
  await page.screenshot({path:`/tmp/algopilot-skill-profile-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const otherContext=await browser.newContext({baseURL});try{const other=await otherContext.newPage();await login(other);await expect(other.getByRole('link',{name:'按 math 诊断补充训练'})).toHaveCount(0);
    expect((await other.request.post('/api/v1/recommendations',{data:{focus:{topic:'math',window:'7'}}})).status()).toBe(409);
  }finally{await otherContext.close();}
  await page.getByRole('link',{name:'按 math 诊断补充训练'}).click();await expect(page).toHaveURL(/\/dashboard\?focus=math&window=7$/);
  await expect(page.getByText(/来自能力画像的专项：math/)).toBeVisible();
  const response=await page.request.post('/api/v1/recommendations',{data:{focus:{topic:'math',window:'7'}}});expect(response.status()).toBe(200);const rec=await response.json();
  expect(rec.items.length).toBeGreaterThan(0);expect(rec.items.every((i:{problem:{id:string};reasons:string[]})=>!used.includes(i.problem.id)&&i.reasons.some(r=>r.includes('来自能力画像的显式专项：math')))).toBe(true);
  expect((await(await page.request.get('/api/v1/learning')).json()).preferences).toEqual(prefs);
  await expect(page.getByText(/来自能力画像的显式专项：math/).first()).toBeVisible();
  await page.screenshot({path:`/tmp/algopilot-skill-action-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'进入思维教练'}).first().click();await expect(page).toHaveURL(/\/practice\/[\w-]+$/);
});
