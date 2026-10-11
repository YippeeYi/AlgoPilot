// Route Handlers 的 Auth/SDK 替身测试；真实 RLS 另由 database.test.ts 执行。
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  assertSameOrigin,
  handle,
  json,
  readJson,
} from "@/server/http";
import { createSessionSchema } from "@/lib/validation/m1";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  append: vi.fn(),
  thoughts: vi.fn(),
  draft: vi.fn(),
  transition: vi.fn(),
  repo: vi.fn(),
}));
vi.mock("@/server/auth", () => ({ requireContext: mocks.context }));
vi.mock("@/server/db/training", () => ({ trainingRepository: mocks.repo }));
import { POST as create } from "@/app/api/v1/sessions/route";
import {
  GET as get,
  PATCH as transition,
} from "@/app/api/v1/sessions/[id]/route";
import {
  POST as append,
  GET as thoughts,
} from "@/app/api/v1/sessions/[id]/thoughts/route";
import { PATCH as draft } from "@/app/api/v1/sessions/[id]/code/route";

const id = "10000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id }) };
function request(body: unknown) {
  return new Request(`http://localhost/api/v1/sessions/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({
    user: { id: "trusted-user-A" },
    client: {},
  });
  mocks.repo.mockImplementation((_client, userId) => {
    expect(userId).toBe("trusted-user-A");
    return {
      create: mocks.create,
      get: mocks.get,
      append: mocks.append,
      thoughts: mocks.thoughts,
      draft: mocks.draft,
      transition: mocks.transition,
    };
  });
});
describe("M1 API 鉴权与输入（测试替身）", () => {
  it("未登录请求返回 401，不接触数据库", async () => {
    mocks.context.mockRejectedValue(
      new ApiError(401, "UNAUTHENTICATED", "请登录"),
    );
    expect((await create(request({ requestId: id }))).status).toBe(401);
    expect(mocks.repo).not.toHaveBeenCalled();
  });
  it("缺少配置时返回 503，而不是伪造会话", async () => {
    mocks.context.mockRejectedValue(
      new ApiError(503, "SUPABASE_NOT_CONFIGURED", "未配置"),
    );
    expect((await create(request({ requestId: id }))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["user_id", "active_seconds", "max_hint_seen"])(
    "拒绝 mass assignment: %s",
    async (field) => {
      expect(
        (await create(request({ requestId: id, [field]: 99 }))).status,
      ).toBe(422);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("合法创建只传允许字段，不接受客户端身份", async () => {
    mocks.create.mockResolvedValue({ id });
    expect(
      (await create(request({ requestId: id, statementSnapshot: "statement" })))
        .status,
    ).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      requestId: id,
      statementSnapshot: "statement",
      mode: "practice",
    });
  });
  it.each(["session", "thoughts", "append", "code", "transition"])(
    "越权 %s 返回相同 404",
    async (kind) => {
      const failure = new ApiError(404, "NOT_FOUND", "未找到可访问的记录。");
      mocks.get.mockRejectedValue(failure);
      mocks.thoughts.mockRejectedValue(failure);
      mocks.append.mockRejectedValue(failure);
      mocks.draft.mockRejectedValue(failure);
      mocks.transition.mockRejectedValue(failure);
      const response =
        kind === "session"
          ? await get(request({}), context)
          : kind === "thoughts"
            ? await thoughts(
                new Request("http://localhost/api/v1/sessions"),
                context,
              )
            : kind === "append"
              ? await append(
                  request({ content: "x", expectedRevision: 0, requestId: id }),
                  context,
                )
              : kind === "code"
                ? await draft(
                    request({ content: "x", expectedRevision: 0 }),
                    context,
                  )
                : await transition(
                    request({ action: "pause", expectedRevision: 0 }),
                    context,
                  );
      expect(response.status).toBe(404);
    },
  );
  it("非法状态转换返回 409，SDK 原始错误不泄露", async () => {
    mocks.transition.mockRejectedValue(
      new ApiError(409, "INVALID_TRANSITION", "当前状态不支持此操作。"),
    );
    expect(
      (
        await transition(
          request({ action: "resume", expectedRevision: 0 }),
          context,
        )
      ).status,
    ).toBe(409);
    const response = await handle(async () => {
      throw new Error("private-sql-secret");
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-sql-secret");
  });
  it("拒绝跨站 JSON、无效 JSON 和超长 body", async () => {
    const cross = new Request("http://localhost/api/v1/sessions", {
      method: "POST",
      headers: {
        Origin: "https://attacker.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId: id }),
    });
    expect((await create(cross)).status).toBe(403);
    const bad = new Request("http://localhost/api/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect((await create(bad)).status).toBe(400);
    const long = request({
      requestId: id,
      statementSnapshot: "a".repeat(300001),
    });
    expect(
      (
        await handle(async () =>
          json(await readJson(long, createSessionSchema)),
        )
      ).status,
    ).toBe(413);
  });
  it("Next 内部 localhost URL 与合法外部 Host 不一致时仍能安全校验同源", () => {
    const same = new Request("http://localhost/api/v1/auth/login", {
      headers: { Host: "127.0.0.1:3101", Origin: "http://127.0.0.1:3101" },
    });
    expect(() => assertSameOrigin(same)).not.toThrow();
    const attack = new Request("http://localhost/api/v1/auth/login", {
      headers: {
        Host: "127.0.0.1:3101",
        Origin: "https://attacker.test",
        "X-Forwarded-Host": "attacker.test",
      },
    });
    expect(() => assertSameOrigin(attack)).toThrow(ApiError);
  });
});
