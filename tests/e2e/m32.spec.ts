// Real Next application + local HTTP contract fixtures, never hosted acceptance.
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: Page) {
    const email = `m32-${randomUUID()}@fixture.test`;
    await page.request.post('/api/v1/auth/register', { data: { email, password: 'Fixture-password-123' } });
    await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fdashboard`);
    await expect(page).toHaveURL(/\/dashboard$/);
}
test('cold start, feedback, plan association, Tutor context, AC review evidence and profile across refresh', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page);
    await expect(page.getByText('简短能力自评与本轮目标', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存目标并推荐' })).toBeEnabled();
    await page.getByLabel('愿意挑战的最低难度').fill('1200');
    await page.getByLabel('愿意挑战的最高难度').fill('1800');
    await page.getByLabel(/授权从已生成/).check();
    await page.getByRole('button', { name: '保存目标并推荐' }).click();
    await expect(page.getByText(/目标已保存/)).toBeVisible();
    const rec = await (await page.request.post('/api/v1/recommendations', { data: {} })).json();
    expect(rec.items.length).toBeGreaterThan(0);
    expect(rec.items.length).toBeLessThanOrEqual(5);
    expect(rec.profile.directions).toEqual([]);
    expect(rec.items.every((i: {
        problem: object;
    }) => !('tags' in i.problem))).toBe(true);
    const problemId = rec.items[0].problem.id;
    const plan = await (await page.request.post('/api/v1/plans', { data: { requestId: randomUUID(), name: '推荐闭环计划', problemIds: [] } })).json();
    await page.reload();
    await expect(page.getByRole('button', { name: '保存目标并推荐' })).toBeEnabled();
    await page.getByRole('combobox', { name: '加入计划', exact: true }).selectOption(plan.plan.id);
    const card = page.locator('[data-slot="card"]').first();
    await card.getByRole('button', { name: '加入所选计划' }).click();
    await expect(page.getByText(/已加入现有计划/)).toBeVisible();
    const detail = await (await page.request.get(`/api/v1/plans/${plan.plan.id}`)).json();
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].problem.id).toBe(problemId);
    await card.getByRole('button', { name: '太难', exact: true }).click();
    await expect(page.getByText(/反馈已保存/)).toBeVisible();
    const next = await (await page.request.post('/api/v1/recommendations', { data: {} })).json();
    expect(next.shift).toBe(-100);
    await page.getByRole('button', { name: '重新推荐', exact: true }).click();
    await expect(page.getByRole('button', { name: '重新推荐', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/algopilot-m32-recommendations-${info.project.name}.png`, fullPage: true });
    await card.getByRole('button', { name: '进入思维教练' }).click();
    await expect(page).toHaveURL(/\/practice\/[\w-]+$/);
    const sid = new URL(page.url()).pathname.split('/').at(-1)!;
    const missing = await page.request.post(`/api/v1/sessions/${sid}/tutor`, { data: { requestId: randomUUID(), action: 'chat', message: '没有思路' } });
    expect(missing.status()).toBe(422);
    expect((await missing.json()).error.code).toBe('STATEMENT_REQUIRED');
    await page.getByLabel('补充当前题目的题面、约束与样例').fill('给定 n 个正整数，n<=100，输出最大值。样例：1 5，输出5。');
    await page.getByRole('button', { name: '保存题面上下文' }).click();
    await expect(page.getByText('题面上下文已保存为笔记版本。')).toBeVisible();
    expect((await page.request.post(`/api/v1/sessions/${sid}/tutor`, { data: { requestId: randomUUID(), action: 'chat', message: '没有思路' } })).status()).toBe(200);
    const created = await page.request.post('/api/v1/reviews', { data: { sessionId: sid, requestId: randomUUID(), code: 'int main(){return 0;}', source: 'paste', fileName: null, problemUrl: '', statement: '输入约束 n<=100', submissionId: null, confirmation: '我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘' } });
    expect(created.status()).toBe(201);
    const review = (await created.json()).review;
    let profile = await (await page.request.get('/api/v1/learning')).json();
    expect(profile.profile.reviewDirections).toEqual([]);
    const generated = await page.request.post(`/api/v1/reviews/${review.id}/generate`, { data: { requestId: randomUUID(), question: '' } });
    expect(generated.status()).toBe(200);
    profile = await (await page.request.get('/api/v1/learning')).json();
    expect(profile.profile.reviewDirections.some((d: {
        topic: string;
    }) => d.topic === 'math')).toBe(true);
    const withReview = await (await page.request.post('/api/v1/recommendations', { data: {} })).json();
    expect(withReview.items.some((i: {
        factors: {
            review: number;
        };
    }) => i.factors.review > 0)).toBe(true);
    await page.goto('/analytics');
    await expect(page.getByText(/AI 推测（未验证）/).first()).toBeVisible();
    await expect(page.getByText(/单次提及，样本不足/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/algopilot-m32-profile-${info.project.name}.png`, fullPage: true });
    await page.reload();
    await expect(page.getByText(/AI 推测（未验证）/).first()).toBeVisible();
    await page.goto('/dashboard');
    await expect(page.getByRole('button',{name:'保存目标并推荐'})).toBeEnabled();
    await page.getByLabel(/授权从已生成/).uncheck();
    await page.getByRole('button',{name:'保存目标并推荐'}).click();
    await expect(page.getByText(/目标已保存/)).toBeVisible();
    const revoked=await(await page.request.post('/api/v1/recommendations',{data:{}})).json();
    expect(revoked.profile.reviewDirections).toEqual([]);expect(revoked.items.every((i:{factors:{review:number}})=>i.factors.review===0)).toBe(true);
    await page.goto('/analytics');await expect(page.getByText(/尚无已授权且可识别的复盘证据/)).toBeVisible();
    expect(errors).toEqual([]);
});
test('two users isolate profile, feedback, preferences and review sources; safe cache failure with retry', async ({ page, browser, baseURL }) => {
    await login(page);
    await expect(page.getByRole('button', { name: '保存目标并推荐' })).toBeEnabled();
    const r = await (await page.request.post('/api/v1/recommendations', { data: {} })).json();
    const pid = r.items[0].problem.id;
    const prefs = { min: 800, max: 1800, themes: ['math'], goal: 'independence', repeat: false, reviewEvidence: true };
    expect((await page.request.post('/api/v1/learning/preferences', { data: { requestId: randomUUID(), revision: 0, preferences: prefs } })).status()).toBe(200);
    await page.request.post('/api/v1/learning/feedback', { data: { requestId: randomUUID(), problemId: pid, kind: 'too_easy' } });
    const context = await browser.newContext({ baseURL });
    try {
        const other = await context.newPage();
        expect((await other.request.get('/api/v1/learning')).status()).toBe(401);
        await login(other);
        const profile = await (await other.request.get('/api/v1/learning')).json();
        expect(profile.preferences).toBeNull();
        expect(profile.profile.totalSessions).toBe(0);
        const rec = await (await other.request.post('/api/v1/recommendations', { data: {} })).json();
        expect(rec.shift).toBe(0);
        expect(rec.profile.reviewDirections).toEqual([]);
    }
    finally {
        await context.close();
    }
    await page.route('**/api/v1/recommendations', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '题库缓存暂时不可用。' } }) }), { times: 1 });
    await page.goto('/dashboard');
    await expect(page.locator('main').getByRole('alert')).toContainText('题库缓存暂时不可用');
    await expect(page.getByRole('link', { name: '辅助选题：浏览题库' })).toBeVisible();
    await page.getByRole('button', { name: '重新推荐' }).click();
    await expect(page.locator('[data-slot="card"]').first()).toBeVisible();
});

test('feedback A/B/A creates new intent while a lost acknowledgement retries the same request',async({page})=>{
 await login(page);await expect(page.getByRole('button',{name:'保存目标并推荐'})).toBeEnabled();
 await page.getByLabel('愿意挑战的最低难度').fill('1800');await page.getByLabel('愿意挑战的最高难度').fill('1800');await page.getByRole('button',{name:'保存目标并推荐'}).click();await expect(page.getByText(/目标已保存/)).toBeVisible();
 const ids:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/learning/feedback'))ids.push(r.postDataJSON().requestId);});
 const card=page.locator('[data-slot="card"]').filter({hasText:'1732C1'});
 for(const label of ['太简单','太难','太简单']){await card.getByRole('button',{name:label,exact:true}).click();await expect(page.getByText(/反馈已保存/)).toBeVisible();}
 expect(ids).toHaveLength(3);expect(new Set(ids).size).toBe(3);
 let rec=await(await page.request.post('/api/v1/recommendations',{data:{}})).json();expect(rec.items[0].refs.some((r:{id:string})=>r.id===ids[2])).toBe(true);
 await page.route('**/api/v1/learning/feedback',async route=>{await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'[FIXTURE] acknowledgement lost after persistence'}})});},{times:1});
 await card.getByRole('button',{name:'太难',exact:true}).click();await expect(page.locator('main').getByRole('alert')).toContainText('acknowledgement lost');
 await card.getByRole('button',{name:'太难',exact:true}).click();await expect(page.getByText(/反馈已保存/)).toBeVisible();expect(ids[4]).toBe(ids[3]);
 rec=await(await page.request.post('/api/v1/recommendations',{data:{}})).json();expect(rec.items[0].refs.some((r:{id:string})=>r.id===ids[3])).toBe(true);expect(rec.shift).toBe(0); // Fixed range: actual movement is zero.
});
