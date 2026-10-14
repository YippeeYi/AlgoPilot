// 浏览器 + 真实 Next Route Handlers + Supabase SDK HTTP 替身，非托管服务测试。
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function login(
  page: Page,
  email = "alice@fixture.test",
  next = "/sessions",
) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("Fixture-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
  );
}

test("私人页面保护、登录恢复目标、退出和非法登录", async ({ page }) => {
  for (const path of [
    "/dashboard",
    "/problems",
    "/sessions",
    "/reviews",
    "/analytics",
    "/settings",
    `/practice/${randomUUID()}`,
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(path);
  }
  expect((await page.request.get("/api/v1/sessions")).status()).toBe(401);
  await page.goto("/login?next=%2Fsettings");
  await page.getByLabel("邮箱", { exact: true }).fill("alice@fixture.test");
  await page.getByLabel("密码", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "登录失败",
  );
  await page.getByLabel("密码", { exact: true }).fill("Fixture-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/v1/sessions")).status()).toBe(401);
});

test("注册提示邮箱验证，回调验证后恢复原目标", async ({ page }) => {
  const email = `register-${randomUUID()}@fixture.test`;
  await page.goto("/register?next=%2Fsessions");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("Fixture-password-123");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("查看邮箱");
  expect((await page.request.get("/api/v1/sessions")).status()).toBe(401);
  // 替身不发送邮件；显式模拟配置后的 Supabase token_hash 回调。
  await page.goto(
    `/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fsessions`,
  );
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByText("账户已验证 · 私人训练空间")).toBeVisible();
});

test("CF 选题、草稿刷新恢复、思路历史、计时与完成（桌面及移动）", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const externalEditorRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (/cdn\.jsdelivr|unpkg|cdnjs/.test(req.url()))
      externalEditorRequests.push(req.url());
  });
  await login(page, "alice@fixture.test", "/sessions");
  await page.getByLabel("CF 题号或 URL").fill("1538D");
  await page.getByRole("button",{name:"查找 CF 题目"}).click();
  await page.getByRole("button",{name:/选择 1538D/}).click();
  await page.getByLabel("题面与约束（仅自己可见）").fill("给定 n 个整数。约束：1 ≤ n ≤ 100。");
  await page.getByRole("button",{name:"开始训练",exact:true}).click();
  await expect(page).toHaveURL(/\/practice\/[0-9a-f-]{36}$/);
  const sessionUrl = page.url();
  await expect(
    page.getByText("给定 n 个整数。约束：1 ≤ n ≤ 100。", { exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === "m1-mobile")
    await page.getByRole("tab", { name: "思路笔记" }).click();
  await expect(page.locator(".monaco-editor")).toHaveCount(0);
  await page.getByLabel("当前思路", { exact: true }).fill("先分析边界条件");
  await page.getByRole("button", { name: "保存历史版本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "版本 1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("当前思路", { exact: true }).fill("再建立循环不变量");
  await page.getByRole("button", { name: "保存历史版本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "版本 2", exact: true }),
  ).toBeVisible();
  await page.getByText("历史代码记录（可选）", {exact:true}).click();
  await page
    .getByLabel("C++ 草稿", { exact: true })
    .fill("#include <iostream>\nint main() { return 0; }");
  await page.getByRole("button", { name: "保存代码草稿", exact: true }).click();
  await expect(
    page.getByText("代码：已保存到服务器", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续计时", exact: true }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续计时", exact: true }),
  ).toBeVisible();
  const pausedTime = await page.getByLabel("有效训练时间").textContent();
  await page.waitForTimeout(1100);
  await expect(page.getByLabel("有效训练时间")).toHaveText(pausedTime!);
  await page.reload();
  if (testInfo.project.name === "m1-mobile")
    await page.getByRole("tab", { name: "思路笔记" }).click();
  await expect(page.getByLabel("当前思路", { exact: true })).toHaveValue(
    "再建立循环不变量",
  );
  await page.getByText("历史代码记录（可选）", {exact:true}).click();
  await expect(page.getByLabel("C++ 草稿", { exact: true })).toHaveValue(
    "#include <iostream>\nint main() { return 0; }",
  );
  await page.getByRole("button", { name: "版本 1", exact: true }).click();
  await page.getByRole("button", { name: "恢复到编辑器" }).click();
  await expect(page.getByLabel("当前思路", { exact: true })).toHaveValue(
    "先分析边界条件",
  );
  await page.getByRole("button", { name: "保存思路草稿", exact: true }).click();
  await expect(
    page.getByText("思路：已保存到服务器", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续计时", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === "m1-mobile")
    await page.getByRole("tab", { name: "AI 教练", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "结束训练", exact: true }).click();
  await page
    .getByLabel("手动记录训练结果（用户自报）")
    .selectOption("solved_self_reported");
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  await expect(page.getByText(/训练已完成，用时不再累计/)).toContainText(
    "非官方 AC",
  );
  await expect(
    page.getByRole("button", { name: "结束训练", exact: true }),
  ).toBeDisabled();
  await page.goto("/sessions");
  await page.goto(sessionUrl);
  await expect(page.getByText(/训练已完成，用时不再累计/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(externalEditorRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("两用户 Session/Thought 隔离、非法请求、重复暂停与并发继续", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page);
  const created = await page.request.post("/api/v1/sessions", {
    data: {
      requestId: randomUUID(),
      mode: "contest",
      timerEnabled:true,
      problemId:"50000000-0000-4000-8000-000000000001",
      statementSnapshot: "private",
    },
  });
  expect(created.status()).toBe(201);
  const { session } = await created.json();
  const path = `/api/v1/sessions/${session.id}`;
  expect(
    (
      await page.request.post("/api/v1/sessions", {
        data: { requestId: randomUUID(), user_id: randomUUID() },
      })
    ).status(),
  ).toBe(422);
  const pause = () =>
    page.request.patch(path, {
      data: { action: "pause", expectedRevision: 0 },
    });
  const first = await (await pause()).json();
  const again = await (await pause()).json();
  expect(again.session.active_seconds).toBe(first.session.active_seconds);
  expect(again.session.state_revision).toBe(1);
  const resumed = await Promise.all(
    [1, 2].map(() =>
      page.request
        .patch(path, { data: { action: "resume", expectedRevision: 1 } })
        .then((response) => response.json()),
    ),
  );
  expect(resumed[0].session.resumed_at).toBe(resumed[1].session.resumed_at);
  expect(resumed[1].session.state_revision).toBe(2);
  expect(
    (
      await page.request.post(`${path}/thoughts`, {
        data: {
          content: "private reasoning",
          expectedRevision: 0,
          requestId: randomUUID(),
        },
      })
    ).status(),
  ).toBe(201);
  const otherContext = await browser.newContext({ baseURL });
  const other = await otherContext.newPage();
  try {
    await login(other, "bob@fixture.test");
    for (const suffix of ["", "/thoughts"])
      expect((await other.request.get(path + suffix)).status()).toBe(404);
    expect(
      (
        await other.request.patch(`${path}/code`, {
          data: { content: "overwrite", expectedRevision: 0 },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await other.request.post(`${path}/thoughts`, {
          data: { content: "x", expectedRevision: 1, requestId: randomUUID() },
        })
      ).status(),
    ).toBe(404);
    const listed = await (await other.request.get("/api/v1/sessions")).json();
    expect(
      listed.items.some((row: { id: string }) => row.id === session.id),
    ).toBe(false);
  } finally {
    await otherContext.close();
  }
  expect(
    (
      await page.request.patch(path, {
        data: { action: "finish", expectedRevision: 2, outcome: "unsolved" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.patch(path, {
        data: { action: "resume", expectedRevision: 3 },
      })
    ).status(),
  ).toBe(409);
});

test("会话失效后保存明确失败，保留本地草稿并阻止应用内导航丢失", async ({
  page,
}, testInfo) => {
  await login(page);
  const { session } = await (
    await page.request.post("/api/v1/sessions", {
      data: { problemId:"50000000-0000-4000-8000-000000000001",requestId: randomUUID() },
    })
  ).json();
  await page.goto(`/practice/${session.id}`);
  if (testInfo.project.name === "m1-mobile")
    await page.getByRole("tab", { name: "思路笔记" }).click();
  await page.request.post("/api/v1/auth/logout");
  await page.getByLabel("当前思路", { exact: true }).fill("还未保存的本地推论");
  await page.getByRole("button", { name: "保存思路草稿", exact: true }).click();
  await expect(
    page.getByText("思路：保存失败 · 本地内容仍保留", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("当前思路", { exact: true })).toHaveValue(
    "还未保存的本地推论",
  );
  await page.getByText("辅助入口", {exact:true}).click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "训练记录" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/practice/${session.id}$`));
  await expect(
    page.getByText(/还有未保存的修改，请先保存再离开/),
  ).toBeVisible();
});

test("公开 preview 不调用私人 API（Auth 零调用由 proxy 单测验证）", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/")) requests.push(r.url());
  });
  await page.goto("/practice/preview");
  await expect(
    page.getByRole("heading", { name: "训练工作台预览" }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
});

test("在途自动保存保留最新编辑并阻止导航；旧窗口 409 不覆盖新草稿", async ({page, context}, testInfo) => {
  await login(page);
  const {session} = await (await page.request.post("/api/v1/sessions", {data:{problemId:"50000000-0000-4000-8000-000000000001",requestId:randomUUID()}})).json();
  const path = `/practice/${session.id}`;
  await page.goto(path);
  if (testInfo.project.name === "m1-mobile") await page.getByRole("tab",{name:"思路笔记"}).click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release=resolve;});
  let started!: () => void;
  const arrived = new Promise<void>(resolve => {started=resolve;});
  await page.route(`**/api/v1/sessions/${session.id}/thought-draft`, async route => {
    started(); await gate; await route.continue();
  }, {times:1});
  await page.getByLabel("当前思路",{exact:true}).fill("在途 A");
  await arrived;
  await page.getByLabel("当前思路",{exact:true}).fill("最新 B");
  await page.getByText("辅助入口", {exact:true}).click();
  await page.getByRole("navigation",{name:"主导航"}).getByRole("link",{name:"训练记录"}).click();
  await expect(page).toHaveURL(new RegExp(path+"$"));
  await expect(page.getByText(/还有未保存的修改，请先保存再离开/)).toBeVisible();
  release();
  await expect(page.getByText("思路：已保存到服务器",{exact:true})).toBeVisible();
  await page.reload();
  if (testInfo.project.name === "m1-mobile") await page.getByRole("tab",{name:"思路笔记"}).click();
  await expect(page.getByLabel("当前思路",{exact:true})).toHaveValue("最新 B");
  const other = await context.newPage();
  try {
    await other.goto(path);
    if (testInfo.project.name === "m1-mobile") await other.getByRole("tab",{name:"思路笔记"}).click();
    await page.getByLabel("当前思路",{exact:true}).fill("新窗口 C");
    await page.getByRole("button",{name:"保存思路草稿",exact:true}).click();
    await expect(page.getByText("思路：已保存到服务器",{exact:true})).toBeVisible();
    const response = other.waitForResponse(r => r.url().endsWith(`/api/v1/sessions/${session.id}/thought-draft`) && r.request().method()==="PATCH");
    await other.getByLabel("当前思路",{exact:true}).fill("旧窗口 D");
    await other.getByRole("button",{name:"保存思路草稿",exact:true}).click();
    const rejected = await response;
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error.code).toBe("REVISION_CONFLICT");
    await expect(other.getByLabel("当前思路",{exact:true})).toHaveValue("旧窗口 D");
    await expect(other.getByText("思路：保存失败 · 本地内容仍保留",{exact:true})).toBeVisible();
    const current = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json();
    expect(current.session.thought_draft).toBe("新窗口 C");
    expect(current.session.thought_revision).toBe(3);
  } finally { await other.close(); }
});
