import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
// This server retains the production denying factory, with only synthetic credentials.
test.use({ baseURL: "http://127.0.0.1:3103" });
async function start(page: Page) {
  const email = `gate-${randomUUID()}@fixture.test`;
  expect((await page.request.post("/api/v1/auth/register", { data: { email, password: "Fixture-password-123" } })).status()).toBe(200);
  await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Freviews`);
  await expect(page).toHaveURL(/\/reviews$/);
  const response = await page.request.post("/api/v1/sessions", { data: { problemId: "50000000-0000-4000-8000-000000000001", statementSnapshot: "合成题面 n<=10，输出常量。", requestId: randomUUID(), timerEnabled: false } });
  expect(response.status()).toBe(201);
  return (await response.json()).session.id as string;
}
test("Tutor production gate refuses before generation, preserves draft and requires explicit new intent", async ({ page }, info) => {
  const id = await start(page);
  await page.goto(`/practice/${id}`);
  if (info.project.name === "m2-mobile") await page.getByRole("tab", { name: "AI 教练", exact: true }).click();
  const draft = page.getByLabel("发送给思维教练");
  await draft.fill("保留的提示请求");
  const response = page.waitForResponse(r => r.url().endsWith(`/sessions/${id}/tutor`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const denied = await response;
  expect(denied.status()).toBe(403); expect((await denied.json()).error.code).toBe("LLM_FREE_TIER_UNVERIFIED");
  await expect(draft).toHaveValue("保留的提示请求");
  await expect(page.getByText(/AI 生成已阻止/)).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  expect((await (await page.request.get(`/api/v1/sessions/${id}/tutor`)).json()).messages).toHaveLength(0);
  await expect(page.getByRole("button", { name: "查询 / 重试原请求" })).toHaveCount(0);
  // Seed only through the isolated Mock server, then recover through the production-denied server.
  const cachedBody = { action: "hint", message: "离线缓存夹具", requestId: randomUUID() };
  expect((await page.request.post(`http://127.0.0.1:3102/api/v1/sessions/${id}/tutor`, { data: cachedBody })).status()).toBe(200);
  const cached = await page.request.post(`/api/v1/sessions/${id}/tutor`, { data: cachedBody });
  expect(cached.status()).toBe(200); expect((await cached.json()).cached).toBe(true);
});
test("Review production gate preserves snapshot/notes/question, without an unresolved retry or extra result", async ({ page }) => {
  const sessionId = await start(page);
  const response = await page.request.post("/api/v1/reviews", { data: { sessionId, requestId: randomUUID(), code: "int main(){}", source: "paste", fileName: null, problemUrl: "", statement: "", submissionId: null, confirmation: "我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘" } });
  expect(response.status()).toBe(201); const { review } = await response.json();
  await page.goto(`/reviews?reviewId=${review.id}`);
  await expect(page.getByRole("button", { name: "生成 AI 复盘", exact: true })).toBeEnabled();
  await page.getByLabel("用户编辑复盘", { exact: true }).fill("尚未保存的笔记");
  await page.getByLabel("后续复盘问题", { exact: true }).fill("保留的复盘问题");
  const result = page.waitForResponse(r => r.url().endsWith(`/reviews/${review.id}/generate`));
  await page.getByRole("button", { name: "生成 AI 复盘", exact: true }).click();
  const denied = await result; expect(denied.status()).toBe(403); expect((await denied.json()).error.code).toBe("LLM_FREE_TIER_UNVERIFIED");
  await expect(page.getByRole("alert", { name: "复盘错误" })).toContainText("AI 生成已阻止");
  await expect(page.getByRole("alert", { name: "复盘错误" })).not.toContainText("超时");
  await expect(page.getByLabel("用户编辑复盘", { exact: true })).toHaveValue("尚未保存的笔记");
  await expect(page.getByLabel("后续复盘问题", { exact: true })).toHaveValue("保留的复盘问题");
  await expect(page.getByRole("button", { name: "重试上次生成请求" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成 AI 复盘", exact: true })).toBeEnabled();
  const saved = await (await page.request.get(`/api/v1/reviews/${review.id}`)).json();
  expect(saved.results).toHaveLength(0); expect(saved.review.code_hash).toBe(review.code_hash);
  const cachedBody = { requestId: randomUUID(), question: "离线复盘缓存夹具" };
  expect((await page.request.post(`http://127.0.0.1:3102/api/v1/reviews/${review.id}/generate`, { data: cachedBody })).status()).toBe(200);
  const cached = await page.request.post(`/api/v1/reviews/${review.id}/generate`, { data: cachedBody });
  expect(cached.status()).toBe(200); expect((await cached.json()).cached).toBe(true);
});
