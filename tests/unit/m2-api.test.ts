import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/server/http";
const auth = vi.hoisted(() => vi.fn());
const repository = vi.hoisted(() => ({
  getSession: vi.fn(),
  state: vi.fn(),
  history: vi.fn(),
  hint: vi.fn(),
}));
const run = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ requireContext: auth }));
vi.mock("@/server/tutor/repository", () => ({
  tutorRepository: () => repository,
}));
vi.mock("@/server/tutor/orchestrator", () => ({ runTutor: run }));
import { POST, GET } from "@/app/api/v1/sessions/[id]/tutor/route";
import { POST as hintPost } from "@/app/api/v1/sessions/[id]/hints/route";
const id = "30000000-0000-4000-8000-000000000011";
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown) =>
  new Request(`http://localhost/api/v1/sessions/${id}/tutor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id }, client: {} });
  repository.getSession.mockResolvedValue({ id });
});
describe("M2 HTTP 鉴权与白名单", () => {
  it("无模型配置时比赛/完成政策仍先于配置错误，不能绕过 L5", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    for (const [row, status, code] of [
      [{ id, mode: "contest", status: "active" }, 403, "CONTEST_AI_DISABLED"],
      [{ id, mode: "practice", status: "completed" }, 409, "SESSION_COMPLETED"],
    ] as const) {
      repository.getSession.mockResolvedValue(row);
      const response = await POST(
        request({ action: "chat", message: "hi", requestId: id }),
        context,
      );
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    repository.getSession.mockResolvedValue({
      id,
      mode: "practice",
      status: "active",
    });
    repository.state.mockResolvedValue({ allowedLevel: 0 });
    const explain = await POST(
      request({ action: "explain", message: "完整题解", requestId: id }),
      context,
    );
    expect(explain.status).toBe(403);
    expect((await explain.json()).error.code).toBe("L5_REQUIRED");
    expect(run).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("未登录所有 AI/升级/历史接口返回 401，完全不触发模型", async () => {
    auth.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "请登录"));
    for (const call of [
      () => POST(request({}), context),
      () => GET(new Request("http://localhost/api"), context),
      () => hintPost(request({}), context),
    ])
      expect((await call()).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it("其他用户会话返回不泄露存在性的 404", async () => {
    repository.getSession.mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "未找到"),
    );
    expect(
      (
        await POST(
          request({ action: "chat", message: "hi", requestId: id }),
          context,
        )
      ).status,
    ).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
  it("无 Key 配置返回 503 且没有配置值或密钥", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const r = await POST(
      request({ action: "chat", message: "hi", requestId: id }),
      context,
    );
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({
      error: {
        code: "LLM_NOT_CONFIGURED",
        message: expect.stringContaining("AI 未配置"),
      },
    });
    expect(run).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("拒绝伪造等级/用量/owner 和无确认的 L5 请求", async () => {
    for (const extra of [
      { allowedLevel: 5 },
      { userId: id },
      { usage: { totalTokens: 0 } },
    ])
      expect(
        (
          await POST(
            request({ action: "chat", message: "hi", requestId: id, ...extra }),
            context,
          )
        ).status,
      ).toBe(422);
    expect(
      (
        await hintPost(
          request({
            operation: "confirm_l5",
            revision: 4,
            requestId: id,
            challengeId: id,
          }),
          context,
        )
      ).status,
    ).toBe(422);
    expect(repository.hint).not.toHaveBeenCalled();
  });
});
