import { afterEach, beforeEach, expect, it, vi } from "vitest";
const r = vi.hoisted(() => ({
  getSession: vi.fn(), get: vi.fn(), state: vi.fn(), history: vi.fn(), thoughts: vi.fn(), results: vi.fn(),
  hasRequest: vi.fn(), reserve: vi.fn(), finish: vi.fn(),
}));
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ requireContext: auth }));
vi.mock("@/server/tutor/repository", async importOriginal => ({ ...await importOriginal<object>(), tutorRepository: () => r }));
vi.mock("@/server/review/repository", () => ({ reviewRepository: () => r }));
import { POST as tutor } from "@/app/api/v1/sessions/[id]/tutor/route";
import { POST as review } from "@/app/api/v1/reviews/[id]/generate/route";
const id = "10000000-0000-4000-8000-000000000011", context = { params: Promise.resolve({ id }) };
const body = (value: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "https://fixture.invalid/v1", LLM_MODEL: "fixture", LLM_API_KEY: "SYNTHETIC_API_KEY", TUTOR_RPC_SIGNING_SECRET: "ab".repeat(32) })) vi.stubEnv(key, value);
  auth.mockResolvedValue({ user: { id }, client: {} });
  r.getSession.mockResolvedValue({ id, user_id: id, mode: "practice", status: "active", statement_snapshot: "合成题面", thought_draft: "", code_draft: "" });
  r.get.mockResolvedValue({ id, user_id: id, code_snapshot: "int main(){}", statement_snapshot: "合成题面", code_hash: "a".repeat(64) });
  r.state.mockResolvedValue({ allowedLevel: 0 }); r.history.mockResolvedValue([]); r.thoughts.mockResolvedValue([]); r.results.mockResolvedValue([]);
  r.hasRequest.mockResolvedValue(false); r.reserve.mockResolvedValue({ cached: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each(["tutor", "review"])("%s real route/orchestrator/default factory denies before admission or HTTP", async kind => {
  const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  const response = kind === "tutor" ? await tutor(body({ action: "hint", message: "PRIVATE_INPUT", requestId: id }), context) : await review(body({ question: "PRIVATE_INPUT", requestId: id }), context);
  expect(response.status).toBe(403);
  const value = await response.json(); expect(value.error.code).toBe("LLM_FREE_TIER_UNVERIFIED");
  expect(JSON.stringify(value)).not.toMatch(/SYNTHETIC_API_KEY|PRIVATE_INPUT|lease|nonce|usage/);
  expect(r.reserve).not.toHaveBeenCalled(); expect(r.finish).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it.each(["tutor", "review"])("%s route rejects client-supplied eligibility claims", async kind => {
  const input = kind === "tutor" ? { action: "hint", message: "hi", requestId: id } : { question: "", requestId: id };
  const response = await (kind === "tutor" ? tutor : review)(body({ ...input, freeTierConfirmed: true, executionAuthorized: true }), context);
  expect(response.status).toBe(422); expect(r.hasRequest).not.toHaveBeenCalled(); expect(r.reserve).not.toHaveBeenCalled();
});
it.each(["tutor", "review"])("%s cached result remains readable through the real route with no generation permission", async kind => {
  r.hasRequest.mockResolvedValue(true);
  const response = kind === "tutor" ? await tutor(body({ action: "hint", message: "hi", requestId: id }), context) : await review(body({ question: "", requestId: id }), context);
  expect(response.status).toBe(200); expect((await response.json()).cached).toBe(true); expect(r.reserve).toHaveBeenCalledOnce(); expect(r.finish).not.toHaveBeenCalled();
});
