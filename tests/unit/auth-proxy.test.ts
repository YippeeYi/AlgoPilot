import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({
  factory: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mock.factory }));
import { updateSession } from "@/lib/supabase/proxy";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public");
  vi.resetAllMocks();
  mock.factory.mockReturnValue({
    auth: { getUser: mock.getUser, getSession: mock.getSession },
  });
  mock.getUser.mockResolvedValue({ data: { user: null }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("proxy 验证身份及 Cookie 刷新（SDK 替身）", () => {
  it("公开 preview 完全不初始化 Auth 客户端", async () => {
    expect(
      (
        await updateSession(
          new NextRequest("https://app.test/practice/preview"),
        )
      ).status,
    ).toBe(200);
    expect(mock.factory).not.toHaveBeenCalled();
  });
  it("缺配置只提供无数据页面壳，不伪造用户", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(
      (await updateSession(new NextRequest("https://app.test/sessions")))
        .status,
    ).toBe(200);
    expect(mock.factory).not.toHaveBeenCalled();
  });
  it("不信任伪造 Cookie/user 或 getSession，恢复原请求目标", async () => {
    mock.getSession.mockResolvedValue({
      data: { session: { user: { id: "forged" } } },
    });
    const response = await updateSession(
      new NextRequest("https://app.test/sessions?offset=30", {
        headers: {
          cookie: "sb-fixture-auth-token=forged",
          "x-algopilot-path": "https://attacker.test",
        },
      }),
    );
    expect(response.status).toBe(307);
    expect(
      new URL(response.headers.get("location")!).searchParams.get("next"),
    ).toBe("/sessions?offset=30");
    expect(mock.getUser).toHaveBeenCalledOnce();
    expect(mock.getSession).not.toHaveBeenCalled();
  });
  it("刷新 Cookie 同时转发到 Server Component 和响应，重定向仍保留 Cookie", async () => {
    const request = new NextRequest("https://app.test/dashboard");
    mock.factory.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([
            {
              name: "sb-fixture-auth-token",
              value: "refreshed",
              options: { httpOnly: true, path: "/", secure: true },
            },
          ]);
          return { data: { user: null }, error: null };
        },
      },
    }));
    const response = await updateSession(request);
    expect(request.cookies.get("sb-fixture-auth-token")?.value).toBe(
      "refreshed",
    );
    expect(response.cookies.get("sb-fixture-auth-token")?.value).toBe(
      "refreshed",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("仅服务端 getUser 已验证的用户可进入私人页面", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: { id: "verified" } },
      error: null,
    });
    const response = await updateSession(
      new NextRequest("https://app.test/settings"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
  it("失效会话重定向，而 API 保留 401 处理入口", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("expired"),
    });
    expect(
      (await updateSession(new NextRequest("https://app.test/settings")))
        .status,
    ).toBe(307);
    expect(
      (await updateSession(new NextRequest("https://app.test/api/v1/sessions")))
        .status,
    ).toBe(200);
  });
});
