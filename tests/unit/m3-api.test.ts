import { beforeEach, describe, it, expect, vi } from "vitest";
import { ApiError } from "@/server/http";
const auth = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), write: vi.fn() }));
const cf = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ requireContext: auth }));
vi.mock("@/server/plans/repository", () => ({ planRepository: () => plans }));
vi.mock("@/server/codeforces/repository", () => ({ cfRepository: () => ({}) }));
vi.mock("@/server/codeforces/catalog", () => ({ catalog: cf }));
import { GET as list, POST as create } from "@/app/api/v1/plans/route";
import { GET as detail, PATCH as edit } from "@/app/api/v1/plans/[id]/route";
import { POST as start } from "@/app/api/v1/plans/[id]/start/route";
import { GET as browse, POST as custom } from "@/app/api/v1/problems/route";
import { POST as refresh } from "@/app/api/v1/problems/refresh/route";
const id = "80000000-0000-4000-8000-000000000001", context = { params: Promise.resolve({ id }) };
function req(body: unknown, origin?: string) { return new Request("http://localhost/api/v1/plans", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ client: {}, user: { id } }); plans.write.mockResolvedValue({ id, deleted: false }); plans.detail.mockResolvedValue({ plan: { id, revision: 0 }, items: [] }); cf.mockResolvedValue({ items: [], total: 0 }); });
describe("M3 server routes enforce Auth/origin/whitelist and ownership before writes", () => {
    it("rejects all unauthenticated reads/writes without contacting repositories", async () => { auth.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "login")); for (const r of [await list(), await create(req({})), await detail(req({}), context), await edit(req({}), context), await start(req({}), context), await browse(new Request("http://localhost/api/v1/problems")), await refresh(req({}))])
        expect(r.status).toBe(401); expect(plans.write).not.toHaveBeenCalled(); expect(cf).not.toHaveBeenCalled(); });
    it("blocks mass assignment, official evidence, cross-origin, invalid order input", async () => { expect((await create(req({ requestId: id, name: "p", user_id: id }))).status).toBe(422); expect((await edit(req({ action: "status", revision: 0, requestId: id, itemId: id, status: "completed", officialStatus: "OK" }), context)).status).toBe(422); expect((await create(req({ requestId: id, name: "p" }, "https://evil.test"))).status).toBe(403); expect((await edit(req({ action: "reorder", revision: -1, requestId: id, itemIds: [] }), context)).status).toBe(422); expect(plans.write).not.toHaveBeenCalled(); });
    it("uses trusted defaults, strict catalog query and controlled manual refresh", async () => { expect((await create(req({ requestId: id, name: "计划" }))).status).toBe(201); expect(plans.write).toHaveBeenCalledWith(id, { action: "create", requestId: id, name: "计划", description: "", problemIds: [] }); expect((await browse(new Request("http://localhost/api/v1/problems?q=https%3A%2F%2Fcodeforces.com%2Fcontest%2F1732%2Fproblem%2FC1"))).status).toBe(200); expect(cf.mock.calls.at(-1)?.[1].q).toBe("1732C1"); expect((await browse(new Request("http://localhost/api/v1/problems?upstream=https://evil.test"))).status).toBe(422); expect((await refresh(req({ force: true }))).status).toBe(422); expect((await custom(req({ name: "custom" }))).status).toBe(410); });
    it("returns safe foreign-object/conflict errors and refuses a start item outside requested plan", async () => { plans.detail.mockRejectedValue(new ApiError(404, "NOT_FOUND", "missing")); expect((await detail(req({}), context)).status).toBe(404); expect((await start(req({ itemId: id, requestId: id }), context)).status).toBe(404); plans.write.mockRejectedValue(new ApiError(409, "REVISION_CONFLICT", "changed")); expect((await edit(req({ action: "delete", revision: 0, requestId: id }), context)).status).toBe(409); });
});
