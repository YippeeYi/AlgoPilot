import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { integrateReviews, parseCsv, csv } from "../../scripts/m322-review";
const recorded = JSON.parse(await readFile("docs/m321/recorded-catalog-scenarios.json", "utf8"));
const manual = parseCsv(await readFile("docs/m321/manual-review.csv", "utf8"));
const ai = parseCsv(await readFile("docs/m321/ai-assisted-review.csv", "utf8"));
describe("offline review import and human override audit", () => {
    it("joins the distinct source schemas on scenario/key, preserving 0/40 humans", () => {
        const r = integrateReviews(recorded, manual, ai);
        expect(r.aiCompleted).toBe(40); expect(r.humanCompleted).toBe(0); expect(r.pendingAI).toBe(40);
        expect(r.rows.filter(r => r.ai_assessment === "适合")).toHaveLength(33);
        expect(r.rows.filter(r => r.ai_assessment === "偏简单")).toHaveLength(2);
        expect(r.rows.filter(r => r.ai_assessment === "方向不符")).toHaveLength(5);
        expect(r.summary.every(s => s.humanFitRate === null)).toBe(true);
        expect(r.rows.find(r => r.scenario === "cold" && r.problem_key === "29/A")!.ai_assessment).toBe("适合");
        expect(r.rows.find(r => r.scenario === "beginner" && r.problem_key === "29/A")!.ai_assessment).toBe("偏简单");
        expect(manual.every(r => r.assessment === "")).toBe(true);
    });
    it("allows a human to disagree with AI, recording the entire before/after change and subsequent edit", () => {
        const h = { ...manual[0]!, assessment: "偏困难", rationale: "[TEST ONLY] prerequisites missing", suggestion: "[TEST ONLY] diagnostic first", reviewer: "[SYNTHETIC HUMAN TEST] Reviewer", reviewed_at: "2026-10-14", statement_consulted: "[TEST ONLY] yes", review_type: "human" };
        const first = integrateReviews(recorded, manual, ai, [h]);
        expect(first.humanCompleted).toBe(1); expect(first.rows[0]!.effective_source).toBe("human"); expect(first.rows[0]!.ai_assessment).toBe("适合");
        expect(first.audit[0]).toMatchObject({ before: null, after: { human_assessment: "偏困难" } });
        const second = integrateReviews(recorded, manual, ai, [{ ...h, assessment: "适合" }], first.rows);
        expect(second.audit[0]).toMatchObject({ before: { human_assessment: "偏困难" }, after: { human_assessment: "适合" } });
        expect(integrateReviews(recorded, manual, ai, [], second.rows).audit[0]!.after).toBeNull();
    });
    it("rejects duplicates, missing records, invented keys, wrong rating/url/enums and counterfeit human provenance", () => {
        const invalid = [ai.slice(1), [ai[0]!, ...ai.slice(0, 39)], ai.map((r, i) => i ? r : { ...r, problem_key: "999999/Z" }), ai.map((r, i) => i ? r : { ...r, rating: "999" }), ai.map((r, i) => i ? r : { ...r, official_url: "https://evil.invalid" }), ai.map((r, i) => i ? r : { ...r, assessment: "掌握" }), ai.map((r, i) => i ? r : { ...r, review_type: "human" })];
        for (const a of invalid) expect(() => integrateReviews(recorded, manual, a)).toThrow();
        expect(() => integrateReviews(recorded, manual, ai, [{ ...ai[0]!, review_type: "human" }])).toThrow("AI reviewer");
        expect(() => integrateReviews(recorded, manual, ai, [{ ...manual[0]!, review_type: "human", reviewer: "Incomplete" }])).toThrow();
    });
    it("handles BOM/CRLF, quoted commas, quotes and embedded newlines without splitting by line", () => {
        const rows = [{ a: 'a,b', b: 'quoted "statement"\nnext line' }];
        expect(parseCsv('\uFEFF' + csv(rows, ["a", "b"]).replaceAll('\n', '\r\n'))).toEqual(rows);
        for (const bad of ['a,a\n1,2', 'a,b\n1', 'a,b\n"open,2', 'a,b\n"closed"x,2']) expect(() => parseCsv(bad)).toThrow();
    });
    it("keeps source verification separate from human teaching decisions and rejects foreign audit keys", async () => {
        const audit = JSON.parse(await readFile('docs/m322/source-audit.json', 'utf8'));
        const r = integrateReviews(recorded, manual, ai, [], [], audit.items);
        expect(r.humanCompleted).toBe(0); expect(r.pendingAI).toBe(40);
        expect(r.rows.filter(r => r.source_check_status !== 'unconfirmed')).toHaveLength(7);
        expect(r.rows.every(r => r.verification === 'pending')).toBe(true);
        expect(() => integrateReviews(recorded, manual, ai, [], [], [{ ...audit.items[0], key: '999/Z' }])).toThrow();
        expect(() => integrateReviews(recorded, manual, ai, [], [], [{ ...audit.items[0], sources: ['https://evil.invalid'] }])).toThrow();
    });
    it("distinguishes unreviewed replacements instead of inheriting a different problem's AI label", () => {
        const blank = { ...manual[0]!, rationale: '', review_type: 'unreviewed' };
        const result = integrateReviews(recorded, manual, [blank, ...ai.slice(1)]);
        expect(result.aiCompleted).toBe(39); expect(result.unreviewed).toBe(1); expect(result.pendingAI).toBe(39); expect(result.humanCompleted).toBe(0);
        expect(result.rows[0]).toMatchObject({ effective_assessment: '', effective_source: 'unreviewed', verification: 'unreviewed' });
    });
});
