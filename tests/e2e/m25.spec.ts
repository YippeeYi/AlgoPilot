// Browser + local HTTP fixtures; separate SQL tests verify actual PostgreSQL/RLS.
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: import("@playwright/test").Page, email = `m25-${randomUUID()}@fixture.test`) {
    // Each parallel case gets its own fixture account; shared-user AI leases are intentional.
    if(email.startsWith("m25-")) {
        await page.request.post("/api/v1/auth/register", {data:{email,password:"Fixture-password-123"}});
        await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Freviews`);
        await expect(page).toHaveURL(/\/reviews$/);
        return;
    }
    await page.goto("/login?next=%2Freviews");
    await page.getByLabel("邮箱", { exact: true }).fill(email);
    await page.getByLabel("密码", { exact: true }).fill("Fixture-password-123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/reviews$/);
}
test("AC import, explicit authorization, immutable snapshot, generate/edit/regenerate/questions and refresh", async ({ page, browser, baseURL }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await login(page);
    const session = await (await page.request.post("/api/v1/sessions", { data: { problemId:"50000000-0000-4000-8000-000000000001", requestId: randomUUID(), statementSnapshot: "n<=100，输出结果", timerEnabled: false } })).json();
    expect(session.session.status).toBe("paused");
    await page.goto(`/reviews?sessionId=${session.session.id}`);
    await page.getByLabel("选择本地代码文件", { exact: false }).setInputFiles({ name: "accepted.cpp", mimeType: "text/plain", buffer: Buffer.from("int main() { return 0; }") });
    await expect(page.getByLabel("C++ 代码快照", { exact: true })).toHaveValue("int main() { return 0; }");
    await expect(page.getByRole("button", { name: "确认进入复盘并保存快照" })).toBeDisabled();
    await page.getByRole("checkbox").check();
    const response = page.waitForResponse(r => r.url().endsWith("/api/v1/reviews") && r.request().method() === "POST");
    await page.getByRole("button", { name: "确认进入复盘并保存快照" }).click();
    const r = await response;
    expect(r.status()).toBe(201);
    const { review } = await r.json();
    expect(review.source).toBe("file");
    expect(review.official_verdict).toBeNull();
    expect(review.authorization_event.status).toBe("paused");
    await page.getByRole("button", { name: "生成 AI 复盘", exact: true }).click();
    await expect(page.getByRole("heading", { name: "算法思路", exact: true })).toBeVisible();
    await expect(page.getByText("[MOCK] 算法总结", { exact: true })).toBeVisible();
    // Contract failure: no real model request, prior analysis and unsent comparison survive.
    const failedQuestion = "追问 WA 对照代码：请检查依赖完成顺序。";
    await page.getByLabel("后续复盘问题", { exact: true }).fill(failedQuestion);
    await page.route(`**/api/v1/reviews/${review.id}/generate`, route => route.fulfill({status:502,contentType:"application/json",body:JSON.stringify({error:{code:"REVIEW_OUTPUT_REJECTED",reason:"invalid_line_range",message:"复盘行号不属于已保存 AC 快照，未展示。"}})}));
    await page.getByRole("button", { name: "发送复盘追问", exact: true }).click();
    await expect(page.getByRole("alert", {name:"复盘错误"})).toContainText("可能已产生模型用量");
    await expect(page.getByLabel("后续复盘问题", {exact:true})).toHaveValue(failedQuestion);
    await expect(page.getByText("[MOCK] 算法总结", {exact:true})).toBeVisible();
    expect((await (await page.request.get(`/api/v1/reviews/${review.id}`)).json()).results).toHaveLength(1);
    await page.unroute(`**/api/v1/reviews/${review.id}/generate`);
    await page.getByLabel("后续复盘问题", {exact:true}).fill("");
    await page.getByLabel("用户编辑复盘", { exact: true }).fill("我的复盘：边界条件值得复习。");
    await page.getByRole("button", { name: "保存用户编辑", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/v1/reviews/${review.id}`)).json()).review.notes).toBe("我的复盘：边界条件值得复习。");
    await page.reload();
    await expect(page.getByLabel("用户编辑复盘", { exact: true })).toHaveValue("我的复盘：边界条件值得复习。");
    await page.getByText("查看本次代码快照与授权记录", { exact: true }).click();
    await expect(page.locator("pre")).toContainText("1: int main()");
    await page.getByRole("button", { name: "重新生成 AI 复盘", exact: true }).click();
    await expect(page.locator("summary").filter({ hasText: "历史分析" })).toHaveCount(1);
    await page.getByLabel("后续复盘问题", { exact: true }).fill("复杂度是否依赖输入？");
    await page.getByRole("button", { name: "发送复盘追问", exact: true }).click();
    await expect(page.getByText("追问：复杂度是否依赖输入？", { exact: true })).toBeVisible();
    const refreshed = await (await page.request.get(`/api/v1/reviews/${review.id}`)).json();
    expect(refreshed.results).toHaveLength(3);
    expect(refreshed.review.code_snapshot).toBe("int main() { return 0; }");
    const tutor = await (await page.request.get(`/api/v1/sessions/${session.session.id}/tutor`)).json();
    expect(tutor.messages).toHaveLength(0);
    expect(tutor.state.maxSeenLevel).toBe(0);
    expect((await page.request.post(`/api/v1/sessions/${session.session.id}/tutor`, { data: { action: "chat", message: "full review", requestId: randomUUID() } })).status()).toBe(409);
    expect((await page.request.patch(`/api/v1/reviews/${review.id}`, { data: { revision: 0, notes: "old" } })).status()).toBe(409);
    const other = await browser.newContext({ baseURL });
    try {
        const p = await other.newPage();
        await login(p, "bob@fixture.test");
        expect((await p.request.get(`/api/v1/reviews/${review.id}`)).status()).toBe(404);
        expect((await p.request.post(`/api/v1/reviews/${review.id}/generate`, { data: { requestId: randomUUID(), question: "" } })).status()).toBe(404);
    }
    finally {
        await other.close();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({path:`/tmp/algopilot-m25-${testInfo.project.name}.png`,fullPage:true});
});
test("file rejection, review field whitelist, contest and no-idea L0 continuity", async ({ page }) => {
    await login(page);
    await page.getByLabel("选择本地代码文件", { exact: false }).setInputFiles({ name: "bad.cpp", mimeType: "text/plain", buffer: Buffer.from([255, 0]) });
    await expect(page.getByRole("alert", {name:"复盘错误"})).toContainText("UTF-8");
    await expect(page.getByLabel("C++ 代码快照", { exact: true })).toHaveValue("");
    const create = (mode: string) => page.request.post("/api/v1/sessions", { data: { problemId:"50000000-0000-4000-8000-000000000001", requestId: randomUUID(), mode, statementSnapshot: "输入 n 个整数，n<=100。输出最大值。" } });
    const c = await (await create("contest")).json();
    const data = { sessionId: c.session.id, requestId: randomUUID(), code: "int main(){}", source: "paste", fileName: null, problemUrl: "", statement: "", submissionId: null, confirmation: "我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘" };
    expect((await page.request.post("/api/v1/reviews", { data })).status()).toBe(403);
    expect((await page.request.post("/api/v1/reviews", { data: { ...data, official_verdict: "OK" } })).status()).toBe(422);
    const s = await (await create("practice")).json();
    const path = `/api/v1/sessions/${s.session.id}/tutor`;
    const first = await (await page.request.post(path, { data: { action: "hint", message: "完全没有思路", requestId: randomUUID() } })).json();
    const second = await (await page.request.post(path, { data: { action: "hint", message: "完全没有思路，请继续", requestId: randomUUID() } })).json();
    expect(first.messages[1].content).toContain("n\\<=100");
    expect(second.messages[3].content).not.toBe(first.messages[1].content);
    expect(second.state.maxSeenLevel).toBe(0);
});
