// Local HTTP contract fixture only; cf-problemset.json records public official metadata.
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: Page, email = `m3-${randomUUID()}@fixture.test`) { await page.request.post('/api/v1/auth/register', { data: { email, password: 'Fixture-password-123' } }); await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fproblems`); await expect(page).toHaveURL(/\/problems$/); }
test('CF search/URL, cross-page multi-select, plan order/progress/refresh, independent training/review and history after deletion', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page);
    await expect(page.getByText(/最后成功同步/)).toContainText('2026');
    const boxes = page.getByRole('checkbox');
    await expect(boxes).toHaveCount(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path: `/tmp/algopilot-m3-library-${info.project.name}.png`, fullPage:true});
    const firstLabel = await boxes.first().getAttribute('aria-label');
    await boxes.first().check();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(boxes).toHaveCount(10);
    await boxes.first().check();
    await expect(page.getByText('已选 2 题（跨页保留，最多 200 题）')).toBeVisible();
    await page.getByLabel('题号、题目名称或 Codeforces URL').fill('https://codeforces.com/contest/1732/problem/C1');
    await page.getByRole('button', { name: '搜索题库' }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(1);
    await page.getByRole('checkbox', { name: '选择 1732C1' }).check();
    const name = `多题计划-${randomUUID()}`;
    await page.getByLabel('新计划名称').fill(name);
    await page.getByRole('button', { name: '创建计划并加入选题' }).click();
    await expect(page).toHaveURL(/\/plans\/[\w-]+$/);
    const planUrl = page.url();
    await expect(page.getByText('手动计划进度：0/3（用户记录，不代表官方 AC）')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path: `/tmp/algopilot-m3-plan-${info.project.name}.png`, fullPage:true});
    await expect(page.getByText(/官方状态未同步/)).toHaveCount(3);
    const cards = page.locator('[data-slot="card"]');
    const first = cards.first();
    const heading = await first.getByRole('heading').textContent();
    await first.getByRole('button', { name: /下移/ }).click();
    await expect(cards.nth(1).getByRole('heading')).toContainText(heading!.replace(/^1\./, '').trim());
    await cards.first().getByRole('combobox').selectOption('completed');
    await expect(page.getByText('手动计划进度：1/3（用户记录，不代表官方 AC）')).toBeVisible();
    await page.reload();
    await expect(page.getByText('手动计划进度：1/3（用户记录，不代表官方 AC）')).toBeVisible();
    await cards.first().getByRole('button', { name: '打开或开始训练' }).click();
    await expect(page).toHaveURL(/\/practice\/[\w-]+\?planId=/);
    const sessionId = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect(page.getByRole('link', { name: '在 Codeforces 打开' })).toHaveAttribute('href', /^https:\/\/codeforces.com\/problemset\/problem\//);
    await page.getByLabel('补充当前题目的题面、约束与样例').fill('输入 n<=100，输出一个整数。');
    await page.getByRole('button', { name: '保存题面上下文' }).click();
    await expect(page.getByText('题面上下文已保存为笔记版本。')).toBeVisible();
    await page.reload();
    if (info.project.name === 'm2-mobile')
        await page.getByRole('tab', { name: '思路笔记' }).click();
    await expect(page.getByLabel('当前思路', { exact: true })).toHaveValue(/用户补充的题面上下文/);
    await page.goto(planUrl);
    await cards.first().getByRole('button', { name: '打开或开始训练' }).click();
    await expect(page).toHaveURL(new RegExp(`/practice/${sessionId}\\?planId=`));
    await page.goto(planUrl);
    await cards.first().getByRole('button', { name: '开始新一轮训练' }).click();
    await expect(page).toHaveURL(/\/practice\//);
    expect(new URL(page.url()).pathname).not.toBe(`/practice/${sessionId}`);
    // Snapshot-only review must not count as generated AI review or official AC.
    const response = await page.request.post('/api/v1/reviews', { data: { sessionId, requestId: randomUUID(), code: 'int main() { return 0; }', source: 'paste', fileName: null, problemUrl: '', statement: '', submissionId: null, confirmation: '我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘' } });
    expect(response.status()).toBe(201);
    const review = (await response.json()).review;
    await page.goto(planUrl);
    await cards.first().locator('summary').click();
    await expect(page.getByRole('link', { name: /仅保存代码快照/ })).toBeVisible();
    await page.getByRole('button', { name: '删除计划', exact: true }).click();
    await page.getByRole('button', { name: '确认删除计划' }).click();
    await expect(page).toHaveURL(/\/plans$/);
    expect((await page.request.get(`/api/v1/sessions/${sessionId}`)).status()).toBe(200);
    expect((await page.request.get(`/api/v1/reviews/${review.id}`)).status()).toBe(200);
    expect(firstLabel).toMatch(/选择/);
    expect(errors).toEqual([]);
});
test('plan append/idempotency/multiple plans/CAS and owner isolation; rejects new custom, blank training, forged official state', async ({ page, browser, baseURL }) => {
    await login(page);
    const p = await (await page.request.get('/api/v1/problems?q=1538D')).json();
    const problemId = p.items[0].id;
    const make = async () => { const r = await page.request.post('/api/v1/plans', { data: { requestId: randomUUID(), name: '隔离计划', problemIds: [problemId] } }); expect(r.status()).toBe(201); return r.json(); };
    const a = await make(), b = await make();
    expect(a.plan.id).not.toBe(b.plan.id);
    const input = { action: 'add', revision: 0, requestId: randomUUID(), problemIds: [problemId, problemId] };
    const patch = () => page.request.patch(`/api/v1/plans/${a.plan.id}`, { data: input });
    expect((await patch()).status()).toBe(200);
    expect((await patch()).status()).toBe(200);
    const d = await (await page.request.get(`/api/v1/plans/${a.plan.id}`)).json();
    expect(d.items).toHaveLength(1);
    expect((await page.request.patch(`/api/v1/plans/${a.plan.id}`, { data: { ...input, requestId: randomUUID() } })).status()).toBe(409);
    expect((await page.request.patch(`/api/v1/plans/${a.plan.id}`, { data: { action: 'status', itemId: d.items[0].id, status: 'completed', revision: 1, requestId: randomUUID(), official_verdict: 'OK' } })).status()).toBe(422);
    expect((await page.request.post('/api/v1/problems', { data: { title: 'custom', statement: '', requestId: randomUUID() } })).status()).toBe(410);
    expect((await page.request.post('/api/v1/sessions', { data: { requestId: randomUUID() } })).status()).toBe(422);
    const otherContext = await browser.newContext({ baseURL });
    const other = await otherContext.newPage();
    try {
        expect((await other.request.post('/api/v1/plans', { data: { name: 'x', requestId: randomUUID() } })).status()).toBe(401);
        await login(other);
        expect((await other.request.get(`/api/v1/plans/${a.plan.id}`)).status()).toBe(404);
        expect((await other.request.patch(`/api/v1/plans/${a.plan.id}`, { data: { action: 'delete', revision: 1, requestId: randomUUID() } })).status()).toBe(404);
    }
    finally {
        await otherContext.close();
    }
});
