import { z } from "zod";
import { idSchema } from "./m1";
export const MAX_CODE_BYTES = 64000;
export function hasControlCharacters(text: string, allowWhitespace = false) {
    return Array.from(text).some(c => { const n = c.charCodeAt(0); return (n < 32 && !(allowWhitespace && [9, 10, 13].includes(n))) || n === 127; });
}
export const codeTextSchema = z.string().min(1).max(MAX_CODE_BYTES).refine((s) => s.trim().length > 0 && new TextEncoder().encode(s).length <= MAX_CODE_BYTES && !hasControlCharacters(s, true) && !s.includes("\ufffd"), "代码必须为有效 UTF-8 文本，最多 64 KB，不能包含二进制控制字符。");
export const cfProblemUrlSchema = z.string().max(200).refine((s) => {
    if (!s)
        return true;
    try {
        const u = new URL(s);
        return u.href === s && u.protocol === "https:" && u.hostname === "codeforces.com" && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/(?:problemset\/problem\/[1-9]\d*\/[A-Z0-9]{1,16}|(?:contest|gym)\/[1-9]\d*\/problem\/[A-Z0-9]{1,16})$/.test(u.pathname);
    }
    catch {
        return false;
    }
});
export const createReviewSchema = z.object({
    sessionId: idSchema.nullable(), requestId: idSchema, code: codeTextSchema,
    source: z.enum(["paste", "file"]), fileName: z.string().max(160).regex(/^[^/\\]+\.(cpp|cc|cxx|txt)$/i).refine(s => !hasControlCharacters(s)).nullable(),
    problemUrl: cfProblemUrlSchema, statement: z.string().max(16000),
    submissionId: z.string().regex(/^[1-9]\d{0,17}$/).nullable(),
    confirmation: z.literal("我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘"),
}).strict().refine((v) => v.source === "file" ? Boolean(v.fileName) : v.fileName === null);
export const reviewRequestSchema = z.object({ requestId: idSchema, question: z.string().trim().max(3000) }).strict();
export const reviewEditSchema = z.object({ revision: z.number().int().nonnegative().max(2147483646), notes: z.string().max(16000) }).strict();
const text = z.string().min(1).max(2200);
export const reviewRejectionReasonSchema = z.enum(["invalid_line_range", "unsupported_execution_claim", "invalid_schema", "unsafe_content"]);
export type ReviewRejectionReason = z.infer<typeof reviewRejectionReasonSchema>;
export const reviewAnalysisSchema = z.object({
    summary: text, correctness: text, assumptions: text, timeComplexity: text, spaceComplexity: text,
    lineAnalysis: z.array(z.object({ start: z.number().int().positive().describe("原始已保存 AC 快照的起始行，1-based；不得引用追问对照代码的行号"), end: z.number().int().positive().describe("同一 AC 快照的结束行，不超过快照总行数"), analysis: z.string().min(1).max(1200) }).strict()).min(1).max(20).describe("仅分析 saved_ac_snapshot；追问代码的定位放入 answer，明确来源并用函数名或片段引用"),
    risks: text, improvements: text, alternatives: z.string().max(2200), transferableKnowledge: text,
    revisionQuestions: z.array(z.string().min(1).max(400)).min(1).max(8), answer: z.string().max(2200),
}).strict();
export type ReviewAnalysis = z.infer<typeof reviewAnalysisSchema>;
export const reviewSchema = z.object({
    id: idSchema, user_id: idSchema, session_id: idSchema, problem_id: idSchema.nullable(),
    problem_url: z.string(), statement_snapshot: z.string(), code_snapshot: z.string(), code_hash: z.string(),
    source: z.enum(["paste", "file"]), file_name: z.string().nullable(), submission_id: z.string().nullable(),
    verdict_source: z.literal("user_reported"), official_verdict: z.string().nullable(), source_match: z.literal("unverified"),
    authorization_event: z.object({ status: z.string(), outcome: z.string().nullable(), allowedLevel: z.number(), maxSeenLevel: z.number(), confirmation: z.string(), authorizedAt: z.string() }),
    notes: z.string(), revision: z.number().int(), created_at: z.string(), edited_at: z.string().nullable(),
});
export type CodeReview = z.infer<typeof reviewSchema>;
export const reviewResultSchema = z.object({ id: idSchema, review_id: idSchema, question: z.string(), analysis: reviewAnalysisSchema, model: z.string(), prompt_version: z.string(), created_at: z.string() });
export type ReviewResult = z.infer<typeof reviewResultSchema>;
