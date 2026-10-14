import { beforeEach, describe, it, expect, vi } from "vitest";
import { ApiError } from "@/server/http";
import { defaultPreferences } from "@/lib/validation/learning";
const auth = vi.hoisted(() => vi.fn());
const repo = vi.hoisted(() => ({ evidence: vi.fn(), candidates: vi.fn(), write: vi.fn(), assertRevision: vi.fn() }));
const cf = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ requireContext: auth }));
vi.mock("@/server/learning/repository", () => ({ learningRepository: () => repo }));
vi.mock("@/server/codeforces/repository", () => ({ cfRepository: () => ({}) }));
vi.mock("@/server/codeforces/catalog", () => ({ catalog: cf }));
import { GET as profile } from "@/app/api/v1/learning/route";
import { POST as rec } from "@/app/api/v1/recommendations/route";
import { POST as prefs } from "@/app/api/v1/learning/preferences/route";
import { POST as feedback } from "@/app/api/v1/learning/feedback/route";
const id = "70000000-0000-4000-8000-000000000001";
const req = (body: unknown, origin?: string) => new Request("http://localhost/api/v1/recommendations", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ client: {}, user: { id } }); repo.evidence.mockResolvedValue({ preferences: null, revision: 0, totalSessions: 0, sessions: [], reviews: [], feedback: [] }); repo.candidates.mockResolvedValue({ items: [], total: 0 }); repo.write.mockResolvedValue(undefined); repo.assertRevision.mockResolvedValue(undefined); cf.mockResolvedValue({ syncedAt: "2026-10-12T00:00:00Z", stale: true, notice: "缓存回退" }); });
describe("learning API Auth, origin, field whitelist and safe output", () => {
    it("refuses unauthenticated reads and mutations without accessing private repositories", async () => { auth.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "login")); for (const r of [await profile(), await rec(req({})), await prefs(req({})), await feedback(req({}))])
        expect(r.status).toBe(401); expect(repo.evidence).not.toHaveBeenCalled(); expect(repo.write).not.toHaveBeenCalled(); });
    it("blocks owner/official/mastery mass assignment and cross-origin", async () => { expect((await prefs(req({ requestId: id, revision: 0, preferences: defaultPreferences, userId: id }))).status).toBe(422); expect((await feedback(req({ requestId: id, problemId: id, kind: "too_easy", officialVerdict: "OK" }))).status).toBe(422); expect((await rec(req({}, "https://evil.test"))).status).toBe(403); expect((await rec(req({ target: 3000 }))).status).toBe(422); expect(repo.write).not.toHaveBeenCalled(); });
    it("writes only validated preferences/feedback and uses RPC evidence for ranking", async () => { expect((await prefs(req({ requestId: id, revision: 0, preferences: defaultPreferences }))).status).toBe(200); expect(repo.write).toHaveBeenCalledWith({ action: "preferences", requestId: id, revision: 0, preferences: defaultPreferences }); expect((await feedback(req({ requestId: id, problemId: id, kind: "too_hard" }))).status).toBe(200); const r = await rec(req({})); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ items: [], stale: true, notice: "缓存回退" }); expect(repo.candidates).toHaveBeenCalledWith(defaultPreferences, 1000); });
    it("safe service errors do not contain sensitive SDK originals or turn unavailable cache into recommendations", async () => { cf.mockRejectedValue(new Error("PRIVATE_API_KEY")); const r = await rec(req({})); expect(r.status).toBe(503); expect(JSON.stringify(await r.json())).not.toContain("PRIVATE_API_KEY"); expect(repo.candidates).not.toHaveBeenCalled(); });
});

it("refuses stale recommendations when preferences or review consent changed during cache refresh",async()=>{
  repo.evidence.mockResolvedValue({preferences:{...defaultPreferences,reviewEvidence:true},revision:1,totalSessions:0,sessions:[],reviews:[],feedback:[]});
  repo.assertRevision.mockRejectedValue(new ApiError(409,"LEARNING_EVIDENCE_CHANGED","retry"));
  const r=await rec(req({}));expect(r.status).toBe(409);expect(await r.json()).not.toHaveProperty("items");expect(repo.assertRevision).toHaveBeenCalledWith(1);
});
