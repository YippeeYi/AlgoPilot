// Browser interactions with local Auth/HTTP fixtures, not hosted JWT/CF integration.
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { emptyCfAccount } from "../fixtures/cf-account";

test.beforeEach(async ({ page }) => {
    const email = `m341-${randomUUID()}@fixture.test`;
    await page.request.post("/api/v1/auth/register", { data: { email, password: "Fixture-password-123" } });
    await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fdashboard`);
});

test("loading, expired login, service errors and missing RPC preserve typing; reload restores binding", async ({ page }) => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let first = true, status = 401, code = "UNAUTHENTICATED";
    await page.route("**/api/v1/codeforces-account", async route => {
        if (first) { first = false; await waiting; }
        await route.fulfill(status === 200 ? { json: { state: emptyCfAccount } }
            : { status, json: { error: { code, message: "PRIVATE JWT signature SQL" } } });
    });
    await page.goto("/settings");
    const input = page.getByLabel("公开 CF Handle"), bind = page.getByRole("button", { name: "关联公开账号", exact: true });
    await expect(page.locator("main")).toContainText("正在加载账号状态");
    await input.fill("Draft_Handle"); await expect(bind).toBeDisabled(); release();
    await expect(page.locator("main").getByRole("alert")).toContainText("未登录或登录已过期");
    for (const [nextStatus, nextCode, message] of [
        [500, "UNKNOWN", "账号请求失败或超时"],
        [503, "DATABASE_UNAVAILABLE", "账号请求失败或超时"],
        [503, "CF_ACCOUNT_RPC_UNAVAILABLE", "账号数据库接口暂不可用"],
    ] as const) {
        status = nextStatus; code = nextCode;
        await page.getByRole("button", { name: "重新加载账号状态" }).click();
        await expect(page.locator("main").getByRole("alert")).toContainText(message);
        await expect(input).toHaveValue("Draft_Handle"); await expect(input).toBeEnabled(); await expect(bind).toBeDisabled();
        await expect(page.locator("main")).not.toContainText("PRIVATE");
    }
    status = 200;
    await page.getByRole("button", { name: "重新加载账号状态" }).click();
    await expect(bind).toBeEnabled(); await expect(input).toHaveValue("Draft_Handle");
});

test("binding allows edits, prevents duplicate submission and preserves the valid association after failed replacement", async ({ page }) => {
    let state = { ...emptyCfAccount }, posts = 0;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/v1/codeforces-account", async route => {
        if (route.request().method() === "GET") { await route.fulfill({ json: { state } }); return; }
        posts++;
        if (posts > 1) { await route.fulfill({ status: 422, json: { error: { code: "CF_HANDLE_INVALID" } } }); return; }
        const body = route.request().postDataJSON(); await waiting;
        state = { ...state, handle: body.handle, revision: 1, status: "never" };
        await route.fulfill({ json: { state, notice: null } });
    });
    await page.goto("/settings");
    const input = page.getByLabel("公开 CF Handle"), bind = page.getByRole("button", { name: "关联公开账号", exact: true });
    await input.fill("Public_Handle"); await expect(bind).toBeEnabled(); await bind.click();
    await expect(bind).toBeDisabled(); await expect(page.getByRole("button", { name: "重新加载账号状态" })).toBeDisabled();
    await input.fill("Next_Draft"); await expect(input).toBeEnabled(); expect(posts).toBe(1); release();
    await expect(page.getByRole("link", { name: "Public_Handle", exact: true })).toBeVisible();
    await expect(input).toHaveValue("Next_Draft");
    await page.getByRole("button", { name: "替换公开账号" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("原关联未被替换");
    await expect(page.getByRole("button", { name: "替换公开账号" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Public_Handle", exact: true })).toBeVisible(); await expect(input).toHaveValue("Next_Draft");
});
