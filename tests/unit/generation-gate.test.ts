import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateFreeTierPolicy, GenerationGateError, assertGenerationAllowed, type FreeTierPolicyInput, type GenerationPolicy } from "@/server/llm/execution-gate";
import { OpenAICompatibleProvider, MockProvider } from "@/server/tutor/provider";
import { runTutor } from "@/server/tutor/orchestrator";
import { runReview } from "@/server/review/orchestrator";
import { handle } from "@/server/http";
import type { TutorRepository } from "@/server/tutor/repository";
import type { ReviewRepository } from "@/server/review/repository";
import { readTutorConfig } from "@/server/tutor/config";

const id = "10000000-0000-4000-8000-000000000011";
const binding = { provider: "openai-compatible", baseUrl: "https://fixture.invalid/v1", model: "fixture-free", projectRef: "synthetic-project", credentialRef: "synthetic-credential" };
const scope = { operation: "review" as const, userId: id, resourceId: id, requestId: id };
const now = 2_000_000;
const evidence = { binding, observedAt: now - 1000, expiresAt: now + 1000, tier: "free", billingMode: "hard-free-only", evidenceRef: "offline-simulated-attestation" };
const grant = { binding, scope, observedAt: now - 1000, expiresAt: now + 1000, grantRef: "offline-simulated-authorization", revoked: false };
const input = (): FreeTierPolicyInput => ({ subject: binding, approved: [binding], qualification: { state: "verified", value: structuredClone(evidence) }, authorization: { state: "verified", value: structuredClone(grant) }, scope, now });
function denial(p: FreeTierPolicyInput, code: string) { expect(evaluateFreeTierPolicy(p)).toEqual({ allowed: false, code }); }
const config = readTutorConfig({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: binding.baseUrl, LLM_MODEL: binding.model, LLM_API_KEY: "SYNTHETIC_SECRET_KEY", TUTOR_RPC_SIGNING_SECRET: "ab".repeat(32) })!;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("free qualification and separate execution decision (synthetic evidence, not real account verification)", () => {
  it.each(["unavailable", "error"] as const)("denies qualification %s", state => {
    denial({ ...input(), qualification: { state } }, state === "error" ? "LLM_QUALIFICATION_CHECK_FAILED" : "LLM_FREE_TIER_UNVERIFIED");
  });
  it.each([null, {}, { free: true }, { ...evidence, evidenceRef: "" }, { ...evidence, expiresAt: "later" }, { ...evidence, key: "PRIVATE" }])("rejects damaged/untrusted evidence %j", value => {
    denial({ ...input(), qualification: { state: "verified", value } }, "LLM_EVIDENCE_INVALID");
  });
  it.each(["paid", "unknown"])("denies tier %s", tier => {
    denial({ ...input(), qualification: { state: "verified", value: { ...evidence, tier } } }, tier === "paid" ? "LLM_PAID_TIER_DENIED" : "LLM_FREE_TIER_UNVERIFIED");
  });
  it.each(["paid-fallback", "unknown"])("denies billing mode %s", billingMode => {
    denial({ ...input(), qualification: { state: "verified", value: { ...evidence, billingMode } } }, billingMode === "paid-fallback" ? "LLM_PAID_TIER_DENIED" : "LLM_FREE_TIER_UNVERIFIED");
  });
  it.each([
    { expiresAt: now }, { observedAt: now + 1 }, { expiresAt: now - 1 },
    { observedAt: 0, expiresAt: now + 1 }, { expiresAt: now + 15 * 60_000 + 1 },
  ])("rejects expired/future/overlong evidence %j", patch => {
    denial({ ...input(), qualification: { state: "verified", value: { ...evidence, ...patch } } }, "LLM_EVIDENCE_EXPIRED");
  });
  it.each(["projectRef", "credentialRef"] as const)("binds evidence to %s", key => {
    denial({ ...input(), subject: { ...binding, [key]: "different" } }, "LLM_EVIDENCE_SCOPE_MISMATCH");
    denial({ ...input(), subject: { ...binding, [key]: null } }, "LLM_EVIDENCE_SCOPE_MISMATCH");
  });
  it.each(["provider", "baseUrl", "model"] as const)("requires the exact approved %s", key => {
    denial({ ...input(), approved: [{ ...binding, [key]: key === "baseUrl" ? "https://other.invalid/v1" : "other" }] }, "LLM_MODEL_NOT_APPROVED");
  });
  it.each([undefined, {}, { ...binding, baseUrl: "https://secret@fixture.invalid/v1" }])("denies missing/damaged target %j", subject => {
    denial({ ...input(), subject }, "LLM_GATE_CONFIG_INVALID");
  });
  it("rejects a damaged approval list", () => denial({ ...input(), approved: "free" }, "LLM_GATE_CONFIG_INVALID"));
  it("free eligibility alone does not authorize any generation", () => {
    denial({ ...input(), authorization: { state: "unavailable" } }, "LLM_EXECUTION_UNAUTHORIZED");
    denial({ ...input(), authorization: { state: "error" } }, "LLM_QUALIFICATION_CHECK_FAILED");
  });
  it.each([null, {}, { ...grant, revoked: true }, { ...grant, expiresAt: now }, { ...grant, expiresAt: now + 300_001 }, { ...grant, binding: { ...binding, credentialRef: "other" } }])("rejects missing/expired/revoked/unbound grants %j", value => {
    denial({ ...input(), authorization: { state: "verified", value } }, "LLM_EXECUTION_UNAUTHORIZED");
  });
  it.each(["operation", "userId", "resourceId", "requestId"] as const)("authorization is scoped to %s", key => {
    denial({ ...input(), scope: { ...scope, [key]: key === "operation" ? "tutor" : "10000000-0000-4000-8000-000000000012" } }, "LLM_EXECUTION_UNAUTHORIZED");
  });
  it("models a fully verified decision without installing a real verifier or dispatch permit", () => {
    expect(evaluateFreeTierPolicy(input())).toEqual({ allowed: true, mode: "verified-free" });
  });
  it.each([undefined, { allowed: true }, { allowed: false, code: "PRIVATE" }])("fails closed on a broken policy result %j", value => {
    expect(() => assertGenerationAllowed({ check: () => value } as GenerationPolicy)).toThrow(expect.objectContaining({ code: "LLM_QUALIFICATION_CHECK_FAILED" }));
  });
});

describe("shared Provider dispatch boundary", () => {
  it("direct construction and even an injected fetcher are denied by default; env booleans cannot grant free status", async () => {
    vi.stubEnv("LLM_FREE_TIER_CONFIRMED", "true"); vi.stubEnv("LLM_EXECUTION_AUTHORIZED", "true");
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
    for (const provider of [new OpenAICompatibleProvider(config), new OpenAICompatibleProvider(config, fetcher)]) {
      await expect(provider.complete([{ role: "user", content: "SYNTHETIC_PRIVATE_INPUT" }])).rejects.toMatchObject({ code: "LLM_FREE_TIER_UNVERIFIED", status: 403, usage: [] });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([429, 503, 504])("a potential HTTP %s cannot trigger retry/fallback through the gate", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status })); const pause = vi.fn();
    await expect(new OpenAICompatibleProvider(config, fetcher, 1, pause).complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "LLM_FREE_TIER_UNVERIFIED" });
    expect(fetcher).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
  });
  it.each([429, 503])("re-checks after synthetic HTTP %s and keeps only actual prior usage", async status => {
    let allowed = true;
    const policy: GenerationPolicy = { check: () => allowed ? { allowed: true, mode: "offline-mock" } : { allowed: false, code: "LLM_EXECUTION_UNAUTHORIZED" } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
    const pause = vi.fn(async () => { allowed = false; });
    await expect(new OpenAICompatibleProvider(config, fetcher, 1000, pause, policy).complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "LLM_EXECUTION_UNAUTHORIZED", usage: [{ attempt: 1, inputTokens: null, status: "error" }] });
    expect(fetcher).toHaveBeenCalledOnce(); expect(pause).toHaveBeenCalledOnce();
  });
  it("parallel denied calls never dispatch and do not share a permissive race window", async () => {
    const fetcher = vi.fn<typeof fetch>(); const provider = new OpenAICompatibleProvider(config, fetcher);
    const outcomes = await Promise.allSettled(Array.from({ length: 30 }, () => provider.complete([{ role: "user", content: "hi" }])));
    expect(outcomes.every(row => row.status === "rejected" && row.reason instanceof GenerationGateError)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("normalizes verifier errors and HTTP output without logging secrets or input", async () => {
    const log = vi.spyOn(console, "warn"); const errorLog = vi.spyOn(console, "error");
    const policy: GenerationPolicy = { check: () => { throw new Error("SYNTHETIC_SECRET_KEY PRIVATE INPUT"); } };
    const fetcher = vi.fn<typeof fetch>();
    const response = await handle(async () => { await new OpenAICompatibleProvider(config, fetcher, undefined, undefined, policy).complete([{ role: "user", content: "PRIVATE INPUT" }]); return Response.json({}); });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "LLM_QUALIFICATION_CHECK_FAILED", message: expect.stringContaining("AI 生成已阻止") } });
    expect(log).not.toHaveBeenCalled(); expect(errorLog).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
});

function repositories(completed = false) {
  const common = { hasRequest: vi.fn().mockResolvedValue(completed), reserve: vi.fn().mockResolvedValue({ cached: completed, leaseNonce: id, allowedLevel: 0 }), finish: vi.fn().mockResolvedValue({ accepted: true }) };
  const tutor = { ...common, getSession: vi.fn().mockResolvedValue({ id, user_id: id, mode: "practice", status: "active", statement_snapshot: "合成题面 n<=10", thought_draft: "", code_draft: "", thought_revision: 0, code_revision: 0 }), state: vi.fn().mockResolvedValue({ allowedLevel: 0 }), history: vi.fn().mockResolvedValue([]), thoughts: vi.fn().mockResolvedValue([]) } as unknown as TutorRepository;
  const review = { ...common, get: vi.fn().mockResolvedValue({ id, user_id: id, code_snapshot: "int main(){}", statement_snapshot: "合成题面", code_hash: "a".repeat(64) }), results: vi.fn().mockResolvedValue([{ id: "prior", question: "", analysis: {} }]) } as unknown as ReviewRepository;
  return { tutor, review };
}
describe("Tutor / Review admission and recovery", () => {
  it.each(["tutor", "review"] as const)("%s default denial does not reserve, finish, or call HTTP", async kind => {
    const r = repositories(); const fetcher = vi.fn<typeof fetch>(); const provider = new OpenAICompatibleProvider(config, fetcher);
    const task = kind === "tutor" ? runTutor(r.tutor, config, id, { action: "hint", message: "求提示", requestId: id }, undefined, provider) : runReview(r.review, config, id, { question: "", requestId: id }, undefined, provider);
    await expect(task).rejects.toMatchObject({ code: "LLM_FREE_TIER_UNVERIFIED" });
    expect(r[kind].reserve).not.toHaveBeenCalled(); expect(r[kind].finish).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["tutor", "review"] as const)("%s restores completed caches while live generation is denied", async kind => {
    const r = repositories(true); const fetcher = vi.fn<typeof fetch>(); const provider = new OpenAICompatibleProvider(config, fetcher);
    const result = kind === "tutor" ? await runTutor(r.tutor, config, id, { action: "hint", message: "求提示", requestId: id }, undefined, provider) : await runReview(r.review, config, id, { question: "", requestId: id }, undefined, provider);
    expect(result.cached).toBe(true); expect(r[kind].reserve).toHaveBeenCalledOnce(); expect(r[kind].finish).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["tutor", "review"] as const)("%s preserves existing pending/expired receipt handling without generating", async kind => {
    const r = repositories(true); const fetcher = vi.fn<typeof fetch>(); const provider = new OpenAICompatibleProvider(config, fetcher);
    for (const code of ["TUTOR_BUSY", "REVIEW_REQUEST_FAILED", "TUTOR_REQUEST_FAILED"]) {
      vi.mocked(r[kind].reserve).mockRejectedValueOnce(Object.assign(new Error("fixed receipt state"), { code }));
      const task = kind === "tutor" ? runTutor(r.tutor, config, id, { action: "hint", message: "求提示", requestId: id }, undefined, provider) : runReview(r.review, config, id, { question: "", requestId: id }, undefined, provider);
      await expect(task).rejects.toMatchObject({ code });
    }
    expect(r[kind].finish).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["tutor", "review"] as const)("%s safely settles rejection after admission without leaving pending", async kind => {
    const r = repositories(); const provider = new MockProvider({ text: "unreachable", usage: [] });
    vi.spyOn(provider, "assertCanGenerate").mockImplementationOnce(() => {}).mockImplementation(() => { throw new GenerationGateError("LLM_EXECUTION_UNAUTHORIZED"); });
    const task = kind === "tutor" ? runTutor(r.tutor, config, id, { action: "hint", message: "求提示", requestId: id }, undefined, provider) : runReview(r.review, config, id, { question: "", requestId: id }, undefined, provider);
    await expect(task).rejects.toMatchObject({ code: "LLM_EXECUTION_UNAUTHORIZED" });
    expect(provider.calls).toHaveLength(0); expect(r[kind].finish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ success: false, usage: [] }), config.signingSecret);
  });
});
