import { describe, it, expect, vi } from "vitest";
import { defaultPreferences } from "@/lib/validation/learning";
vi.mock("server-only", () => ({}));
import { learningRepository } from "@/server/learning/repository";
describe("candidate database policy version gate", () => {
    it("refuses an undeployed or incompatible candidate policy rather than consuming a polluted shortlist", async () => {
        for (const policyVersion of [undefined, "training-fit/0"]) {
            const rpc = vi.fn().mockResolvedValue({ data: { items: [], total: 0, policyVersion }, error: null });
            const client = { rpc } as unknown as Parameters<typeof learningRepository>[0];
            await expect(learningRepository(client).candidates(defaultPreferences, 1000)).rejects.toMatchObject({ status: 503, code: "CANDIDATE_POLICY_UNAVAILABLE" });
            expect(rpc).toHaveBeenCalledWith("learning_candidates", { p_query: { min: 800, max: 1200, themes: [], repeat: false, target: 1000 } });
        }
    });
    it("accepts the installed policy without changing caller-selected range or themes", async () => {
        const client = { rpc: vi.fn().mockResolvedValue({ data: { items: [], total: 0, policyVersion: "training-fit/1" }, error: null }) } as unknown as Parameters<typeof learningRepository>[0];
        expect(await learningRepository(client).candidates(defaultPreferences, 1000)).toEqual({ items: [], total: 0, policyVersion: "training-fit/1" });
    });
});
