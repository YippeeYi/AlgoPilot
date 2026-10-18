import { describe, expect, it } from "vitest";
import { auditReview, buildReviewPrompt, runReview } from "@/server/review/orchestrator";
import { handle, ApiError } from "@/server/http";
import { MockProvider } from "@/server/tutor/provider";
import type { CodeReview, ReviewAnalysis } from "@/lib/validation/review";
import type { ReviewRepository } from "@/server/review/repository";
import type { TutorConfig } from "@/server/tutor/config";
import { vi } from "vitest";
const review = { id: "10000000-0000-4000-8000-000000000011", code_snapshot: "int main() {\nreturn 0;\n}", code_hash: "a".repeat(64), statement_snapshot: "测试题面" } as CodeReview;
const base: ReviewAnalysis = { summary: "静态分析", correctness: "通过静态推导可知，满足给定前提；未实际运行，不能保证正确。", assumptions: "输入符合约束。", timeComplexity: "O(1)", spaceComplexity: "O(1)", lineAnalysis: [{start:1,end:3,analysis:"原 AC 快照入口。"}], risks:"无实际输出可比较。", improvements:"结合约束检查。", alternatives:"", transferableKnowledge:"状态不变量。", revisionQuestions:["输入前提是什么？"],answer:"" };
const check = (value: unknown) => auditReview(JSON.stringify(value), review, ["fixture-secret"]);
function rejected(value: unknown, reason: string) {
    try { check(value); throw new Error("Expected rejection"); }
    catch (error) { expect(error).toMatchObject({status:502,code:"REVIEW_OUTPUT_REJECTED",reason}); expect((error as Error).message).toContain("可能已产生模型用量"); }
}
describe("review source and assertion boundaries (deterministic contracts, not model quality)", () => {
    it("accepts qualified static and hypothetical analysis without erasing later positive claims", () => {
        for (const answer of ["通过静态推导可知，输出应为6；未实际运行。", "假设执行结果为6，则需比较独立期望值；没有运行代码。", "我没有实际运行过代码，不能保证正确。", "我不会保证正确，也没有运行代码。", "I have not run the code; this is a static deduction."]) {
            expect(check({...base,answer}).answer).toBe(answer);
        }
        for (const answer of ["未实际运行，但我已经测试过代码。", "没有运行；测试通过。", "静态分析：I have executed the code.", "本系统已验证正确。", "实际输出为4。", "不是没有运行代码。", "我已运\u200b行代码。", "保证正确", "不是不保证正确"]) rejected({...base,answer},"unsupported_execution_claim");
    });
    it("bounds every numeric line to the AC snapshot even when comparison text is longer", () => {
        const question = "以下是追问 WA 对照代码：" + "\nx++;".repeat(20);
        const prompt = buildReviewPrompt(review,question,[]);
        const input = JSON.parse(prompt[1]!.content);
        expect(input).toMatchObject({snapshotSource:"saved_ac_snapshot",lineAnalysisSource:"saved_ac_snapshot",lineCount:3,comparisonSource:"followup_question_only"});
        expect(prompt[0]!.content).toContain("不把其行号写入 lineAnalysis");
        expect(prompt[0]!.content).not.toContain("1 4\n1 3"); // no acceptance answer/counterexample in prompt
        rejected({...base,lineAnalysis:[{start:4,end:12,analysis:"对照代码错误行"}]},"invalid_line_range");
        rejected({...base,lineAnalysis:[{start:3,end:1,analysis:"倒置"}]},"invalid_line_range");
        expect(check({...base,answer:"追问对照代码中 dfs 的后继循环需要核对依赖完成顺序；这是静态分析。"})).toBeTruthy();
    });
    it("retains schema, length, secret, HTML and internal-reasoning rejection", () => {
        rejected({...base,reasoning:"not allowed"},"invalid_schema");
        rejected({...base,summary:"x".repeat(2201)},"invalid_schema");
        for (const answer of ["fixture-secret","<script>bad</script>","<think>hidden</think>","内部推理", "javascript:bad"]) rejected({...base,answer},"unsafe_content");
        const escaped=JSON.stringify({...base,summary:"fixture-secret"}).replace("fixture-secret","\\u0066ixture-secret");
        expect(()=>auditReview(escaped,review,["fixture-secret"])).toThrow();
        expect(()=>auditReview("not json",review,[])).toThrow(expect.objectContaining({reason:"invalid_schema"}));
    });
    it("HTTP exposes only a fixed reason, without raw model output or secret material",async()=>{
        const response=await handle(async()=>{check({...base,answer:"fixture-secret"});return Response.json({});});
        expect(response.status).toBe(502);
        const body=await response.json();expect(body.error.reason).toBe("unsafe_content");
        expect(JSON.stringify(body)).not.toContain("fixture-secret");expect(Object.keys(body.error).sort()).toEqual(["code","message","reason"]);
        const malicious=new ApiError(502,"REVIEW_OUTPUT_REJECTED","safe");Object.assign(malicious,{reason:"private payload"});
        expect((await (await handle(async()=>{throw malicious;})).json()).error).not.toHaveProperty("reason");
    });
    it("settles actual fixture usage as rejected once, without saving output or automatically retrying",async()=>{
        const prior=[{id:"existing"}];
        const repo={get:vi.fn().mockResolvedValue(review),results:vi.fn().mockResolvedValue(prior),reserve:vi.fn().mockResolvedValue({cached:false,leaseNonce:review.id}),finish:vi.fn().mockResolvedValue({accepted:true})} as unknown as ReviewRepository;
        const config={apiKey:"fixture-key",signingSecret:"ab".repeat(32),maxInputChars:24000,dailyLimit:30,model:"fixture"} as TutorConfig;
        const usage=[{attempt:1,model:"fixture",inputTokens:10,outputTokens:20,totalTokens:30,durationMs:1,status:"success" as const,costUsd:null}];
        const provider=new MockProvider({text:JSON.stringify({...base,lineAnalysis:[{start:4,end:8,analysis:"WA"}]}),usage});
        await expect(runReview(repo,config,review.id,{requestId:review.id,question:"WA comparison"},undefined,provider)).rejects.toMatchObject({reason:"invalid_line_range"});
        expect(provider.calls).toHaveLength(1);expect(repo.finish).toHaveBeenCalledTimes(1);
        expect(repo.finish).toHaveBeenCalledWith(expect.objectContaining({success:false,usage:[{...usage[0],status:"rejected"}]}),config.signingSecret);
        expect(repo.finish).not.toHaveBeenCalledWith(expect.objectContaining({analysis:expect.anything()}),expect.anything());
        expect(prior).toEqual([{id:"existing"}]);
    });
});
