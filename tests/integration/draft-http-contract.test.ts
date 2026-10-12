// 真实 Route Handler + Supabase SDK；HTTP 响应/Auth 为替身，不是托管 PostgREST 验收。
import { createClient } from "@supabase/supabase-js";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { ApiError } from "@/server/http";
import type { TrainingSession } from "@/lib/validation/m1";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireContext: mocks.context }));
import { PATCH } from "@/app/api/v1/sessions/[id]/thought-draft/route";

const id = "10000000-0000-4000-8000-000000000001";
const alice = "10000000-0000-4000-8000-000000000002";
const bob = "10000000-0000-4000-8000-000000000003";
let row: TrainingSession;
let failure: "database" | "transport" | null;
let rpcCalls: number;
let warn: ReturnType<typeof vi.spyOn>;
const context = { params: Promise.resolve({ id }) };
const request = (content: string, expectedRevision: number) => new Request(`http://localhost/api/v1/sessions/${id}/thought-draft`, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, expectedRevision }),
});
const client = createClient<Database>("http://sdk.fixture.invalid", "fixture-public-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/training_sessions"))
      return Response.json(url.searchParams.get("user_id") === `eq.${alice}` ? [row] : []);
    rpcCalls++;
    if (failure === "transport") throw new TypeError("fixture transport unavailable");
    if (failure === "database") return Response.json({ code: "PGRST000", message: "private database detail" }, { status: 503 });
    const body = JSON.parse(String(init?.body));
    if (body.p_expected_revision !== row.thought_revision)
      return Response.json({ code: "PT409", message: "DRAFT_CONFLICT", details: null, hint: null }, { status: 409 });
    row = { ...row, thought_draft: body.p_content, thought_revision: row.thought_revision + 1 };
    return Response.json([row]);
  } },
});
beforeEach(() => {
  failure = null; rpcCalls = 0;
  row = { id, user_id: alice, problem_id: null, statement_snapshot: "", mode: "practice", phase: "thinking", status: "paused", started_at: "2026-10-12", created_at: "2026-10-12", updated_at: "2026-10-12", active_seconds: 0, resumed_at: null, ended_at: null, state_revision: 1, code_draft: "", code_revision: 0, thought_draft: "", thought_revision: 0, outcome: null };
  mocks.context.mockResolvedValue({ client, user: { id: alice } });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
describe("草稿 HTTP 契约回归（SDK HTTP 替身）", () => {
  it("正常 revision 200；PostgREST PT409 返回 409；旧请求不覆盖", async () => {
    expect((await PATCH(request("newer", 0), context)).status).toBe(200);
    const response = await PATCH(request("stale", 0), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("REVISION_CONFLICT");
    expect(row.thought_draft).toBe("newer");
    expect(row.thought_revision).toBe(1);
    expect(rpcCalls).toBe(2); // POST 无 SDK 自动重试。
    expect(warn).toHaveBeenCalledWith("database_operation_failed", expect.objectContaining({code: "PT409", status: 409}));
  });
  it.each(["database", "transport"] as const)("%s 故障仍为 503，不伪装成冲突", async (kind) => {
    failure = kind;
    const response = await PATCH(request("newer", 0), context);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("DATABASE_UNAVAILABLE");
    expect(row.thought_revision).toBe(0);
    expect(rpcCalls).toBe(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private database detail");
  });
  it("未登录 401，跨用户 404，均不执行写 RPC", async () => {
    mocks.context.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "请登录"));
    expect((await PATCH(request("x", 0), context)).status).toBe(401);
    mocks.context.mockResolvedValueOnce({client, user: {id: bob}});
    expect((await PATCH(request("x", 0), context)).status).toBe(404);
    expect(rpcCalls).toBe(0);
  });
});
