import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import fixture from "../fixtures/cf-problemset.json";
import { parseProblemset } from "@/server/codeforces/parser";
import { fetchProblemset, synchronize, catalog, CF_ENDPOINT } from "@/server/codeforces/catalog";
import { catalogQuerySchema, locateCodeforces, mutatePlanSchema } from "@/lib/validation/m3";
import type { CfRepository } from "@/server/codeforces/repository";
const nonce = "90000000-0000-4000-8000-000000000001";
function repo(stale = true): CfRepository { return { read: vi.fn().mockResolvedValue({ items: [], total: 0, syncedAt: "2026-10-12T05:22:10Z", stale, tags: [] }), sync: vi.fn().mockImplementation(async (v) => v.action === "reserve" ? { acquired: true, nonce } : v.action === "slot" ? { waitMs: 0 } : { accepted: true }) }; }
describe("CF official response parser and local-cache orchestration", () => {
    it("parses recorded official response, uses external keys, never invents rating/tags or statement", () => { const rows = parseProblemset(fixture); expect(rows).toHaveLength(40); expect(rows.find(p => p.contestId === 1538 && p.index === "D")?.name).toBe("Another Problem About Dividing Numbers"); expect(rows.some(p => p.rating === null)).toBe(true); expect(rows.every(p => !("statement" in p))).toBe(true); });
    it("preserves missing rating/tags/statistics, validates malformed/FAILED/duplicate upstream", () => { const raw = { status: "OK", result: { problems: [{ contestId: 1, index: "ABC123", name: "Edge", type: "PROGRAMMING" }], problemStatistics: [] } }; expect(parseProblemset(raw)).toEqual([{ contestId: 1, index: "ABC123", name: "Edge", rating: null, tags: [], solvedCount: null }]); expect(() => parseProblemset({ status: "FAILED", comment: "Call limit exceeded" })).toThrow(); expect(() => parseProblemset({ ...raw, result: { ...raw.result, problems: [raw.result.problems[0], raw.result.problems[0]] } })).toThrow(); expect(() => parseProblemset({ ...raw, result: { ...raw.result, problems: [{ ...raw.result.problems[0], rating: "800" }] } })).toThrow(); });
    it("accepts exact index/official URLs, refuses credentials/other hosts/redirect input", () => { expect(locateCodeforces("https://codeforces.com/problemset/problem/921/01")).toBe("921/01"); expect(locateCodeforces("https://codeforces.com/contest/1732/problem/C1")).toBe("1732C1"); expect(locateCodeforces("https://codeforces.com/problemset/problem/1538/D")).toBe("1538D"); for (const url of ["https://evil.test/contest/1/problem/A", "http://codeforces.com/contest/1/problem/A", "https://u:p@codeforces.com/contest/1/problem/A", "https://codeforces.com/contest/1/problem/A?x=1"])
        expect(() => locateCodeforces(url)).toThrow(); expect(catalogQuerySchema.safeParse({ min: 2000, max: 1000 }).success).toBe(false); expect(mutatePlanSchema.safeParse({ action: "status", status: "OK", revision: 0, requestId: nonce, itemId: nonce }).success).toBe(false); });
    it("uses fresh cache without downloading, stale fallback on configuration errors", async () => { const r = repo(false); await catalog(r, catalogQuerySchema.parse({ q: "1538D" })); expect(r.sync).not.toHaveBeenCalled(); const stale = repo(); vi.mocked(stale.sync).mockRejectedValue(new Error("unavailable")); expect((await catalog(stale, catalogQuerySchema.parse({}))).syncedAt).toBe("2026-10-12T05:22:10Z"); });
    it("deduplicates shared admission and backs off 429/FAILED with slot on each attempt", async () => {
        const r = repo(), fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 429 })).mockResolvedValueOnce(Response.json(fixture)), sleep = vi.fn().mockResolvedValue(undefined);
        expect(await synchronize(r, false, fetcher, sleep)).toBe("synced");
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(3000);
        expect(vi.mocked(r.sync).mock.calls.filter(([v]) => v.action === "slot")).toHaveLength(2);
        expect(fetcher.mock.calls[0]![0]).toBe(CF_ENDPOINT);
        const busy = repo();
        vi.mocked(busy.sync).mockResolvedValue({ acquired: false });
        fetcher.mockClear();
        expect(await synchronize(busy, true, fetcher, sleep)).toBe("busy");
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("handles timeout/network/FAILED, preserves cache and records fail; rejects oversized UTF8 response", async () => { const r = repo(), sleep = vi.fn().mockResolvedValue(undefined); expect(await synchronize(r, false, vi.fn().mockRejectedValue(new Error("network")), sleep)).toBe("failed"); expect(r.sync).toHaveBeenCalledWith({ action: "fail", nonce }); await expect(fetchProblemset(vi.fn().mockResolvedValue(Response.json({ status: "FAILED" })))).rejects.toThrow(); await expect(fetchProblemset(vi.fn().mockResolvedValue(new Response("x", { headers: { "content-length": "12000001" } })))).rejects.toThrow(); await expect(fetchProblemset(vi.fn().mockResolvedValue(new Response(new Uint8Array([255]))))).rejects.toThrow(); });
    it("validates full live-download artifact when explicitly supplied to test runner", async () => { if (!process.env.CF_REAL_RESPONSE_PATH)
        return; const raw = JSON.parse(await readFile(process.env.CF_REAL_RESPONSE_PATH, "utf8")); const rows = parseProblemset(raw); expect(rows.length).toBeGreaterThan(1000); });
});
