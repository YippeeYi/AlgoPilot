import { expect, test } from "@playwright/test";

test("未配置 Supabase 时 CF Handle 可输入，关联保持禁用", async ({ page }) => {
  await page.goto("/settings");
  const input = page.getByLabel("公开 CF Handle");
  await expect(input).toBeEnabled();
  await input.fill("Editable_Handle");
  await expect(input).toHaveValue("Editable_Handle");
  await expect(page.getByRole("button", { name: "关联公开账号", exact: true })).toBeDisabled();
  await expect(page.locator("main")).toContainText("当前无法完成关联");
});

test("无凭据可浏览所有页面壳", async ({ page }) => {
  const pages = [
    ["/dashboard", "现在应该练什么，为什么？"],
    ["/problems", "选一道值得思考的题"],
    ["/sessions", "看见你的思考轨迹"],
    ["/reviews", "AC 后深度代码复盘"],
    ["/analytics", "用真实证据理解能力"],
    ["/settings", "个人设置"],
    ["/login", "回到你的训练空间"],
    ["/register", "开始你的训练旅程"],
  ];
  for (const [route, heading] of pages) {
    await page.goto(route!);
    await expect(
      page.getByRole("heading", { name: heading!, exact: true }),
    ).toBeVisible();
  }
});

test("首页重定向、主题切换和刷新后恢复", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "切换深浅主题" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("训练预览响应式布局、无调用操作与无横向溢出", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/practice/preview");
  await expect(
    page.getByRole("heading", { name: "训练工作台预览" }),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-chromium") {
    await expect(
      page.getByRole("tab", { name: "题面", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "思路笔记" }).click();
    await expect(page.getByRole("tabpanel")).toContainText("当前思路");
    await page.getByRole("tab", { name: "AI 教练" }).click();
    await expect(page.getByRole("tabpanel")).toContainText("模型未接入");
    await expect(
      page.getByRole("button", { name: "申请下一提示等级" }),
    ).toBeDisabled();
  } else {
    await expect(page.getByTestId("desktop-workspace")).toBeVisible();
    await expect(page.getByRole("tablist")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "结束训练" })).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("统计空状态不产生伪 Rating 或百分比", async ({ page }) => {
  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "样本不足" }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\d+%/);
});

test("不存在的会话与路由返回 404", async ({ page }) => {
  for (const route of ["/practice/not-a-session", "/not-a-page"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "没有找到这个页面或训练" }),
    ).toBeVisible();
  }
});
