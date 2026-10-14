import { defaultPreferences, type LearningCandidate, type LearningEvidence } from "@/lib/validation/learning";
// Ranking units, not a player ability score. Centralized for audit and tuning.
export const recommendationWeights = Object.freeze({ difficulty: 40, weakness: 22, goal: 16, novelty: 10, diversity: 12, plannedPenalty: 24, feedbackPenalty: 60, reviewSuggestion: 6 });
export const learningLimits = Object.freeze({ recommendations: 5, adequateSamples: 5, recentSessions: 20, feedbackWindow: 20, feedbackStep: 100, feedbackMaxShift: 200 });
const aliases: Record<string, RegExp> = {
    implementation: /实现问题|边界问题|溢出风险|可能溢出|off.by.one|integer overflow/i,
    dp: /动态规划|\bdp\b|dynamic programming/i, graphs: /图论|\bgraphs?\b/i, trees: /树形|树结构|\btrees?\b/i,
    math: /数学|\bmath\b/i, "number theory": /数论|number theory/i, "binary search": /二分|binary search/i,
    "data structures": /数据结构|data structures/i, strings: /字符串|\bstrings?\b/i,
    greedy: /贪心|\bgreedy\b/i, geometry: /几何|geometry/i, bitmasks: /位掩码|状态压缩|bitmasks/i,
    "two pointers": /双指针|two pointers/i, combinatorics: /组合计数|combinatorics/i,
};
const issuePatterns = {
    boundary: /边界问题|未处理.{0,8}边界|boundary (?:issue|risk)|off.by.one/i,
    overflow: /溢出风险|可能溢出|overflow (?:risk|possible)|integer overflow/i,
    complexity: /复杂度过高|可能超时|超时风险|complexity (?:issue|risk)|time.limit risk/i,
};
// Only affirmative risk clauses contribute recurring-issue suggestions.
function riskClauses(text: string) {
    return text.split(/[。；;.!?！？\n]|但是|但|\bbut\b/i).filter(clause => !/没有|不存在|并无|无需|未发现|无明显|\bno\b|\bnot\b/i.test(clause)).join("；");
}
export type EvidenceRef = {
    kind: "training" | "ai_review" | "user_feedback";
    id: string;
    reviewId?: string;
};
function latestProblems(e: LearningEvidence) {
    const seen = new Set<string>();
    return [...e.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).filter(s => {
        if (s.status !== "completed" || !s.problemId || seen.has(s.problemId))
            return false;
        seen.add(s.problemId);
        return true;
    });
}
export function abilityProfile(e: LearningEvidence) {
    const samples = latestProblems(e);
    const tags = [...new Set(samples.flatMap(s => s.tags))].sort();
    const directions = tags.map(topic => {
        const rows = samples.filter(s => s.tags.includes(topic));
        const highHints = rows.filter(s => s.maxHint >= 3);
        const unresolved = rows.filter(s => s.outcome === "unsolved" || s.outcome === "abandoned");
        const solved = rows.filter(s => s.outcome === "solved_self_reported");
        // No hint doesn't prove independence: external help is unknown in legacy records.
        const lowHintSolved = solved.filter(s => s.maxHint <= 1);
        return { topic, samples: rows.length, selfReportedSolved: solved.length, highHints: highHints.length, unresolved: unresolved.length, lowHintSolved: lowHintSolved.length,
            confidence: rows.length < learningLimits.adequateSamples ? "样本不足" : "有限可信（含自报）",
            suggestion: highHints.length + unresolved.length > 0 ? "暂定加强方向：存在高等级提示或未解记录，建议继续验证。" : "继续收集证据；不能据此断言已掌握。",
            refs: rows.map(s => ({ kind: "training" as const, id: s.id })),
            // Repeated attempts at the same problem count once; tags aren't causal proof.
            weakness: Math.min(1, (highHints.length + unresolved.length) / Math.max(rows.length, 3)) };
    });
    const bands = [...new Set(samples.filter(s => s.rating !== null).map(s => Math.floor(s.rating! / 400) * 400))].sort((a, b) => a - b).map(min => {
        const rows = samples.filter(s => s.rating !== null && s.rating >= min && s.rating < min + 400);
        return { min, max: min + 399, samples: rows.length, selfReportedSolved: rows.filter(s => s.outcome === "solved_self_reported").length, highHints: rows.filter(s => s.maxHint >= 3).length, confidence: rows.length < 5 ? "样本不足" : "有限可信（含自报）" };
    });
    const reviews = e.preferences?.reviewEvidence ? e.reviews : [];
    const reviewDirections = Object.entries(aliases).flatMap(([topic, pattern]) => {
        const rows = reviews.filter(r => pattern.test(r.knowledge) || pattern.test(r.risks));
        return rows.length ? [{ topic, samples: rows.length, source: "AI 推测（未验证）", refs: rows.map(r => ({ kind: "ai_review" as const, id: r.id, reviewId: r.reviewId })) }] : [];
    });
    const recurringIssues = Object.entries(issuePatterns).flatMap(([key, pattern]) => {
        const rows = reviews.filter(r => pattern.test(riskClauses(r.risks)));
        return rows.length ? [{ key, samples: rows.length, confidence: "AI 推测（未验证）", recurring: rows.length >= 2, refs: rows.map(r => ({ kind: "ai_review" as const, id: r.id, reviewId: r.reviewId })) }] : [];
    });
    return { totalSessions: e.totalSessions, analyzedSessions: e.sessions.length, distinctCompletedProblems: samples.length, directions, bands, reviewDirections, recurringIssues,
        hintDistribution: Array.from({ length: 6 }, (_, level) => ({ level, samples: e.sessions.filter(s => s.maxHint === level).length })),
        thoughtRecordedSessions: e.sessions.filter(s => s.thoughtCount > 0).length,
        sources: { metadata: "CF 官方题目元数据（Rating 不是选手能力）", outcome: "用户自报；官方提交状态未同步", hints: "AlgoPilot 实际已看最高等级，不等于授权等级", review: "已授权的结构化 AI 复盘，未经执行或正确性验证" },
        limitations: ["缺少提示不能证明独立完成；外部题解使用可能未知。", "同题只取最近一次完成训练；重复训练不增加知识方向样本量。", "题目 Tags 只能表明关联方向，不能证明卡点由该知识点造成。", "未自报解出且未查看 L5 的题目不展开知识方向；保留难度与提示统计。", "复盘仅取每题最新分析、最多 200 题；词汇匹配不能证明 AI 判断正确。", ...(e.totalSessions > e.sessions.length ? ["仅分析最近 500 次训练，较早记录未纳入画像。"] : [])] };
}
export function recommendationTarget(e: LearningEvidence) {
    const p = e.preferences ?? defaultPreferences;
    const completed = latestProblems(e).filter(s => s.outcome === "solved_self_reported" && s.rating !== null);
    const ratings = completed.map(s => s.rating!).sort((a, b) => a - b);
    const median = ratings.length ? ratings[Math.floor(ratings.length / 2)]! : null;
    const relevant = [...e.feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).filter(f => f.rating !== null && f.rating >= p.min && f.rating <= p.max).slice(0, learningLimits.feedbackWindow);
    const shift = Math.max(-learningLimits.feedbackMaxShift, Math.min(learningLimits.feedbackMaxShift, relevant.reduce((n, f) => n + (f.kind === "too_easy" ? learningLimits.feedbackStep : f.kind === "too_hard" ? -learningLimits.feedbackStep : 0), 0)));
    const highHintSamples = completed.filter(s => s.maxHint >= 3).length;
    const base = ratings.length >= 3 && median !== null ? median - (highHintSamples * 2 >= ratings.length ? 100 : 0) : (p.min + p.max) / 2;
    // Explicit range is a hard constraint. History only narrows cold-start target if inside it.
    return { preferences: p, target: Math.round(Math.max(p.min, Math.min(p.max, base + shift))), shift, historySamples: ratings.length, historyRefs: completed.slice(0, 20).map(s => ({ kind: "training" as const, id: s.id })), feedbackRefs: relevant.filter(f => f.kind !== "off_goal").map(f => ({ kind: "user_feedback" as const, id: f.id })) };
}
export function recommend(e: LearningEvidence, candidates: LearningCandidate[], exclude: string[] = []) {
    const profile = abilityProfile(e);
    const { preferences: p, target, shift, feedbackRefs, historySamples, historyRefs } = recommendationTarget(e);
    const recent = [...e.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, learningLimits.recentSessions);
    const recentTags = new Set(recent.flatMap(s => s.tags));
    const solved = new Set(e.sessions.filter(s => s.outcome === "solved_self_reported").map(s => s.problemId));
    const unique = new Map(candidates.map(c => [c.id, c]));
    let pool = [...unique.values()].filter(c => c.rating !== null && c.rating >= p.min && c.rating <= p.max && (p.repeat || !solved.has(c.id)) && (!p.themes.length || c.tags.some(t => p.themes.includes(t as typeof p.themes[number]))));
    const alternatives = pool.filter(c => !exclude.includes(c.id));
    const reused = alternatives.length < Math.min(learningLimits.recommendations, pool.length);
    pool = [...alternatives, ...(reused ? pool.filter(c => exclude.includes(c.id)) : [])];
    const usedTags = new Set<string>();
    const selected = [];
    while (pool.length && selected.length < learningLimits.recommendations) {
        const scored = pool.map(c => {
            const directions = profile.directions.filter(d => c.tags.includes(d.topic) && d.weakness > 0);
            const ai = profile.reviewDirections.filter(d => c.tags.includes(d.topic));
            const difficulty = recommendationWeights.difficulty * Math.max(0, 1 - Math.abs(c.rating! - target) / Math.max(200, p.max - p.min));
            const weakness = recommendationWeights.weakness * Math.max(0, ...directions.map(d => d.weakness));
            const theme = p.themes.some(t => c.tags.includes(t));
            const novel = c.tags.length > 0 && c.tags.some(t => !recentTags.has(t));
            const diversity = c.tags.length > 0 && c.tags.some(t => !usedTags.has(t));
            const feedback = e.feedback.find(f => f.problemId === c.id);
            const factors = { difficulty, weakness, goal: p.goal === "independence" ? weakness / recommendationWeights.weakness * recommendationWeights.goal : p.goal === "explore" ? Number(novel) * recommendationWeights.goal : Number(theme) * recommendationWeights.goal,
                novelty: Number(novel) * recommendationWeights.novelty - Number(recent.some(s => s.problemId === c.id)) * recommendationWeights.novelty,
                diversity: Number(diversity) * recommendationWeights.diversity, plan: c.inPlan ? -recommendationWeights.plannedPenalty : 0,
                feedback: feedback ? -recommendationWeights.feedbackPenalty : 0, review: ai.length ? recommendationWeights.reviewSuggestion : 0 };
            const score = Object.values(factors).reduce((a, b) => a + b, 0) - (exclude.includes(c.id) ? recommendationWeights.feedbackPenalty : 0);
            const refs: EvidenceRef[] = [...new Map([...directions.flatMap(d => d.refs), ...ai.flatMap(d => d.refs), ...feedbackRefs, ...(historySamples >= 3 ? historyRefs : []), ...(feedback ? [{ kind: "user_feedback" as const, id: feedback.id }] : [])].map(r => [r.id, r])).values()];
            // Do not send candidate tags, nor name a hidden algorithm in default recommendations.
            const reasons = [`CF 题目 Rating ${c.rating}，位于${e.preferences ? "你选择的" : "暂定冷启动"} ${p.min}–${p.max} 区间；本轮参考难度 ${target}。`];
            if (historySamples >= 3)
                reasons.push(`参考难度结合 ${historySamples} 道不同题目的自报解出 Rating 中位数与实际提示依赖；不是能力评级，仍以所选范围为界。`);
            if (!e.preferences)
                reasons.push("尚未保存自评；使用保守区间，可先选择你愿意挑战的难度。此范围不是能力结论。");
            if (directions.length)
                reasons.push(`与你的已完成训练中待加强方向相关：依据 ${new Set(directions.flatMap(d => d.refs.map(r => r.id))).size} 道题的实际提示与自报结果；关联不等于因果，仍需验证。（未解题标签隐藏）`);
            if (theme)
                reasons.push(`符合你主动选择的主题：${p.themes.filter(t => c.tags.includes(t)).join("、")}。`);
            if (ai.length)
                reasons.push("已授权 AI 复盘提及相关知识，作为低权重的待验证建议；不代表已证实薄弱点。（未解题标签隐藏）");
            if (novel)
                reasons.push("可拓宽近期训练的知识覆盖；方向标签默认隐藏。");
            if (shift)
                reasons.push(`依据你近期的难度反馈，将参考难度调整 ${shift > 0 ? "+" : ""}${shift}，仍遵守所选区间。`);
            if (c.inPlan)
                reasons.push("已在现有计划中，因此降低优先级；可继续关联到其他计划。");
            if (c.practiced)
                reasons.push("曾经训练过，重复程度已计入排序。");
            if (!c.tags.length)
                reasons.push("官方标签缺失；仅依据难度与训练记录推荐，不推测知识方向。");
            if (feedback)
                reasons.push("你曾反馈这道题不合适，因此降低优先级；候选不足时仍可能出现。");
            return { problem: { id: c.id, contestId: c.contestId, index: c.index, name: c.name, rating: c.rating }, reasons, refs, factors, score, inPlan: c.inPlan, practiced: c.practiced };
        }).sort((a, b) => b.score - a.score || a.problem.id.localeCompare(b.problem.id));
        const best = scored[0]!;
        selected.push(best);
        const candidate = pool.find(c => c.id === best.problem.id)!;
        candidate.tags.forEach(t => usedTags.add(t));
        pool = pool.filter(c => c.id !== best.problem.id);
    }
    return { items: selected, profile, target, shift, reused, preferences: p, configured: Boolean(e.preferences), revision: e.revision,
        limitations: "确定性 V1，仅对数据库按难度与主题分层选出的最多 600 个候选排序；Rating 缺失的题不推荐，主题训练排除缺 Tags 题。推荐排序分数不是选手能力分。" };
}
export type RecommendationResult = ReturnType<typeof recommend> & {
    syncedAt: string | null;
    stale: boolean;
    notice: string | null;
    candidateCount: number;
};
export type AbilityProfile = ReturnType<typeof abilityProfile>;
