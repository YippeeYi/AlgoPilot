import { describe, it, expect, vi } from "vitest";
import { readCodeFile } from "@/features/reviews/import-code";
import { codeTextSchema, createReviewSchema, cfProblemUrlSchema, type CodeReview, type ReviewAnalysis } from "@/lib/validation/review";
import { auditReview, buildReviewPrompt, runReview } from "@/server/review/orchestrator";
import { MockProvider, OpenAICompatibleProvider } from "@/server/tutor/provider";
import { auditOutput } from "@/server/tutor/audit";
import type { ReviewRepository } from "@/server/review/repository";
import type { TutorConfig } from "@/server/tutor/config";
const review = { id: "10000000-0000-4000-8000-000000000011", code_snapshot: "int main() {\nreturn 0;\n}", code_hash: "a".repeat(64), statement_snapshot: "给定 n 个整数，n <= 100；输出最大值。" } as CodeReview;
const analysis: ReviewAnalysis = { summary: "算法总结", correctness: "静态证明摘要；没有运行代码。", assumptions: "输入前提尚未证明。", timeComplexity: "O(1)", spaceComplexity: "O(1)", lineAnalysis: [{ start: 1, end: 3, analysis: "入口与返回值。" }], risks: "未验证边界", improvements: "命名改进", alternatives: "", transferableKnowledge: "复杂度", revisionQuestions: ["输入前提是什么？"], answer: "" };
const config = { apiKey: "fixture-key", signingSecret: "ab".repeat(32), maxInputChars: 24000, dailyLimit: 30, model: "fixture" } as TutorConfig;
function file(name: string, bytes: Uint8Array, type = "text/plain") { return { name, size: bytes.length, type, arrayBuffer: async () => bytes.buffer } as File; }
function repo() { return { get: vi.fn().mockResolvedValue(review), results: vi.fn().mockResolvedValue([]), reserve: vi.fn().mockResolvedValue({ cached: false, leaseNonce: review.id }), finish: vi.fn().mockResolvedValue({ accepted: true }) } as unknown as ReviewRepository; }
describe("code import and review", () => {
    it("reads only the selected file and validates extension, MIME, size and UTF-8", async () => {
        expect(await readCodeFile(file("solution.CPP", new TextEncoder().encode(review.code_snapshot)))).toBe(review.code_snapshot);
        for (const f of [file("x.exe", new Uint8Array([65])), file("x.txt", new Uint8Array([65]), "image/png"), file("x.cc", new Uint8Array([0])), file("x.cxx", new Uint8Array([255])), file("x.txt", new Uint8Array()), file("x.txt", new Uint8Array(64001))])
            await expect(readCodeFile(f)).rejects.toThrow();
        expect(codeTextSchema.safeParse("中".repeat(22000)).success).toBe(false);
        expect(codeTextSchema.safeParse("x\u0000").success).toBe(false);
    });
    it("rejects arbitrary URL, spoofed official AC and ordinary chat authorization", () => {
        for (const url of ["https://evil.test/problem", "https://codeforces.com.evil.test/contest/1/problem/A", "https://codeforces.com/contest/1/problem/A?x=1", "http://codeforces.com/contest/1/problem/A", "https://a@codeforces.com/contest/1/problem/A"])
            expect(cfProblemUrlSchema.safeParse(url).success).toBe(false);
        expect(cfProblemUrlSchema.safeParse("https://codeforces.com/gym/123/problem/A").success).toBe(true);
        expect(createReviewSchema.safeParse({ confirmation: "AC", officialVerdict: "OK", code: "int main(){}" }).success).toBe(false);
    });
    it("audits every section, rejects forged execution, invalid line ranges, secrets and hidden fields", () => {
        expect(auditReview(JSON.stringify(analysis), review, [])).toEqual(analysis);
        for (const bad of [{ ...analysis, summary: "我已经运行了代码，测试通过" }, { ...analysis, lineAnalysis: [{ start: 3, end: 9, analysis: "bad" }] }, { ...analysis, summary: "fixture-key" }, { ...analysis, reasoning: "hidden" }, { ...analysis, risks: "<script>alert(1)</script>" }])
            expect(() => auditReview(JSON.stringify(bad), review, ["fixture-key"])).toThrow();
        expect(buildReviewPrompt(review, "question", [])[1]!.content).toContain("1: int main()");
        const escapedSecret = JSON.stringify({...analysis, summary:"fixture-key"}).replace("fixture-key", "\\u0066ixture-key");
        expect(()=>auditReview(escapedSecret,review,["fixture-key"])).toThrow();
    });
    it("sends immutable snapshot, saves only audited analysis, and uses separate admission", async () => {
        const r = repo(), provider = new MockProvider({ text: JSON.stringify(analysis), usage: [] });
        await runReview(r, config, review.id, { requestId: review.id, question: "复杂度？" }, undefined, provider);
        expect(provider.calls[0]![1]!.content).toContain(review.code_hash);
        expect(r.reserve).toHaveBeenCalledWith(expect.objectContaining({ operation: "review_reserve" }), config.signingSecret);
        expect(r.finish).toHaveBeenCalledWith(expect.objectContaining({ analysis, codeHash: review.code_hash, operation: "review_finish" }), config.signingSecret);
        expect(r.finish).not.toHaveBeenCalledWith(expect.objectContaining({ rawOutput: expect.anything() }), expect.anything());
    });
    it("cached admission never calls provider; rejected output settles actual usage without analysis", async () => {
        const r = repo(), provider = new MockProvider({ text: "invalid", usage: [] });
        vi.mocked(r.reserve).mockResolvedValue({ cached: true });
        await runReview(r, config, review.id, { requestId: review.id, question: "" }, undefined, provider);
        expect(provider.calls).toHaveLength(0);
        vi.mocked(r.reserve).mockResolvedValue({ cached: false, leaseNonce: review.id });
        await expect(runReview(r, config, review.id, { requestId: review.id, question: "" }, undefined, provider)).rejects.toMatchObject({ code: "REVIEW_OUTPUT_REJECTED" });
        expect(r.finish).toHaveBeenCalledWith(expect.objectContaining({ success: false, usage: [] }), config.signingSecret);
    });
    it("Provider uses the review JSON contract only for the independent server operation", async()=>{
      const fetcher=vi.fn<typeof fetch>(async()=>Response.json({model:"fixture",choices:[{finish_reason:"stop",message:{role:"assistant",content:JSON.stringify(analysis)}}],usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50}}));
      const provider=new OpenAICompatibleProvider({...config,provider:"openai-compatible",baseUrl:"https://provider.invalid/v1",maxOutputTokens:1200,tokenParameter:"max_tokens",responseFormat:"json_schema"},fetcher);
      await provider.complete(buildReviewPrompt(review,"",[]),undefined,{action:"explain",allowedLevel:5,outputKind:"review"});
      const body=JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      expect(body.response_format.json_schema.name).toBe("ac_review");
      expect(body.response_format.json_schema.schema.properties).toHaveProperty("lineAnalysis");
      expect(body.response_format.json_schema.schema.properties).not.toHaveProperty("disclosureLevel");
      expect(body.stream).toBe(false);
    });
    it("L0 without an idea anchors supplied facts and continues with different low-information questions", () => {
        const model = JSON.stringify({ disclosureLevel: 0, focus: "proof", quote: "", content: "" });
        const input = { allowedLevel: 0, action: "hint" as const, thought: "", statement: review.statement_snapshot, previousAssistant: [] as string[], secrets: [] };
        const a = auditOutput(model, input);
        expect(a.content).toContain("n \\<= 100");
        expect(a.disclosureLevel).toBe(0);
        const b = auditOutput(model, { ...input, previousAssistant: [a.content] });
        expect(b.content).not.toBe(a.content);
        expect(b.disclosureLevel).toBe(0);
        expect(b.content).not.toMatch(/动态规划|二分|贪心/);
        expect(() => auditOutput(model.replace('"content":""', '"content":"用贪心"'), input)).toThrow();
    });
});
