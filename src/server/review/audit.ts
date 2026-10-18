import "server-only";
import { ApiError } from "@/server/http";
import { reviewAnalysisSchema, type CodeReview, type ReviewRejectionReason } from "@/lib/validation/review";

const messages: Record<ReviewRejectionReason, string> = {
    invalid_schema: "复盘格式或长度不符合要求，未展示。",
    unsafe_content: "复盘未通过内容安全审核，未展示。",
    invalid_line_range: "复盘行号超出已保存 AC 快照或顺序无效；对照代码应在追问回答中注明来源。",
    unsupported_execution_claim: "复盘包含未经支持的运行或验证声明，未展示。",
};
function reject(reason: ReviewRejectionReason): never {
    throw new ApiError(502, "REVIEW_OUTPUT_REJECTED", `${messages[reason]}可能已产生模型用量；追问草稿与原有结果保留，请检查后再决定是否重试。`, reason);
}

// A bounded language heuristic, not a proof of factual correctness. Mask only
// explicit negated actions, never an entire sentence (which could hide a later claim).
export function unsupportedExecutionClaim(value: string) {
    const text = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
    if (/(?:并非|不是|并不|不能)(?:没有|未|不曾|不)(?:实际)?(?:运行|执行|编译|测试|验证|保证正确)/.test(text)) return true;
    const unnegated = text
        .replace(/(?:并未|尚未|从未|没有|不曾|不会|不能|无法|未)(?:实际|真正|亲自)?(?:运行|执行|编译|测试|验证|复现)(?:过|了|通过|成功)?/g, "[未执行]")
        .replace(/(?:不能|不会|无法|不敢|没有|并不|不)(?:据此)?保证正确/g, "[无保证]")
        .replace(/(?:未|没有|无)(?:获得|取得|观察到)?实际(?:输出|执行结果)/g, "[无执行结果]")
        .replace(/\b(?:not|never)(?: actually| personally)? (?:run|ran|executed|compiled|tested|verified)(?: the code| code)?\b/gi, "[not executed]");
    return /(?:我|我们|本系统|本工具)(?:已经|已|实际|亲自|确实|刚刚)*(?:运行|执行|编译|测试|验证|复现|跑过)|(?:已经|已)(?:实际|成功)?(?:运行|执行|编译|测试|验证|复现)(?:过|了|通过|代码|程序|正确)?|测试(?:全部)?通过|编译(?:成功|通过)|实测(?:输出|结果)|实际(?:输出|执行结果)|保证正确|\b(?:I|we|this system)(?:\s+(?:have|has|had|already|actually|just))*\s+(?:ran|run|executed|tested|compiled|verified|reproduced)\b|\b(?:all tests? pass(?:ed)?|tests? passed|compiled successfully|verified by (?:us|this system))\b/i.test(unnegated);
}

export function auditReview(text: string, review: CodeReview, secrets: string[]) {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { reject("invalid_schema"); }
    const parsed = reviewAnalysisSchema.safeParse(raw);
    if (!parsed.success || text.length > 24000) reject("invalid_schema");
    const decoded = JSON.stringify(parsed.data);
    if (secrets.some(s => s && (text.includes(s) || decoded.includes(s))) || /<\s*\/?(?:script|iframe|object|embed|style|svg|img|think|analysis)\b|javascript:|data:text\/html|内部(?:推理|思维链)|chain.of.thought/i.test(decoded)) reject("unsafe_content");
    const lines = review.code_snapshot.split("\n").length;
    if (parsed.data.lineAnalysis.some(l => l.start > l.end || l.end > lines)) reject("invalid_line_range");
    const claims = Object.values(parsed.data).filter((v): v is string => typeof v === "string").concat(parsed.data.lineAnalysis.map(v => v.analysis), parsed.data.revisionQuestions);
    if (claims.some(unsupportedExecutionClaim)) reject("unsupported_execution_claim");
    return parsed.data;
}
