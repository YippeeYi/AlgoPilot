import { describe, expect, it } from "vitest";
import {
  appendThoughtSchema,
  createSessionSchema,
  saveDraftSchema,
  transitionSchema,
  registerSchema,
} from "@/lib/validation/m1";
import { safeNext, isPrivatePath } from "@/lib/auth/redirect";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { displayedSeconds } from "@/features/sessions/time";

const id = "10000000-0000-4000-8000-000000000001";
describe("M1 白名单、身份目标与计时显示", () => {
  it.each([
    "user_id",
    "owner",
    "max_hint_seen",
    "active_seconds",
    "created_at",
  ])("创建拒绝客户端字段 %s", (field) => {
    expect(
      createSessionSchema.safeParse({ requestId: id, [field]: id }).success,
    ).toBe(false);
  });
  it("保存拒绝越限文本与未知字段", () => {
    expect(
      appendThoughtSchema.safeParse({
        content: "",
        expectedRevision: 0,
        requestId: id,
      }).success,
    ).toBe(false);
    expect(
      saveDraftSchema.safeParse({
        content: "",
        expectedRevision: 2_147_483_647,
      }).success,
    ).toBe(false);
    expect(
      saveDraftSchema.safeParse({
        content: "a".repeat(64001),
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      appendThoughtSchema.safeParse({
        content: "x",
        expectedRevision: 0,
        requestId: id,
        version: 999,
      }).success,
    ).toBe(false);
  });
  it("完成只允许自报结果，不接受官方 AC 或独立性推断", () => {
    expect(
      transitionSchema.safeParse({ action: "finish", expectedRevision: 0 })
        .success,
    ).toBe(false);
    expect(
      transitionSchema.safeParse({
        action: "pause",
        expectedRevision: 0,
        outcome: "unsolved",
      }).success,
    ).toBe(false);
    expect(
      transitionSchema.safeParse({
        action: "finish",
        expectedRevision: 0,
        outcome: "OK",
      }).success,
    ).toBe(false);
    expect(
      transitionSchema.safeParse({
        action: "finish",
        expectedRevision: 0,
        outcome: "solved_self_reported",
        independent: true,
      }).success,
    ).toBe(false);
  });
  it("注册拒绝无效邮箱与短密码", () => {
    expect(
      registerSchema.safeParse({ email: "not-an-email", password: "12345678" })
        .success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        email: "user@example.invalid",
        password: "123",
      }).success,
    ).toBe(false);
  });
  it.each([
    "https://attacker.example",
    "//attacker.example",
    "/\\attacker.example",
    "/login",
    "/auth/callback",
    "/dashboard\n",
  ])("拒绝外部/循环登录目标 %s", (next) =>
    expect(safeNext(next)).toBe("/dashboard"),
  );
  it("保留私人原始访问目标及查询参数", () =>
    expect(safeNext("/sessions?offset=30")).toBe("/sessions?offset=30"));
  it("公开预览不属于私人路由", () => {
    expect(isPrivatePath("/practice/preview")).toBe(false);
    expect(isPrivatePath(`/practice/${id}`)).toBe(true);
  });
  it("缺少/非法 Supabase 配置不创建 client，本地 Supabase URL 可用", () => {
    expect(getSupabaseConfig({})).toBeNull();
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "bad",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-only",
      }),
    ).toBeNull();
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://remote.example",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-only",
      }),
    ).toBeNull();
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-only",
      }),
    ).not.toBeNull();
  });
  it("显示计时不产生负数、暂停与完成不再增加", () => {
    expect(
      displayedSeconds(
        {
          active_seconds: 10,
          status: "active",
          resumed_at: "2026-10-11T00:00:00Z",
        },
        Date.parse("2026-10-11T00:00:03Z"),
      ),
    ).toBe(13);
    expect(
      displayedSeconds(
        {
          active_seconds: 10,
          status: "active",
          resumed_at: "2026-10-11T00:00:00Z",
        },
        0,
      ),
    ).toBe(10);
    for (const status of ["paused", "completed"] as const)
      expect(
        displayedSeconds(
          { active_seconds: 10, status, resumed_at: null },
          Date.now(),
        ),
      ).toBe(10);
  });
});
