import { defaultPreferences, type LearningCandidate, type LearningEvidence } from "@/lib/validation/learning";
import { candidatePolicyVersion, teachingMetadata, topicMatch, trainingCompatibility } from "./problem-fit";
// Ranking units, not a player ability score. Centralized for audit and tuning.
export const recommendationVersion = "deterministic/1.3-official";
export const recommendationWeights = Object.freeze({ difficulty: 40, weakness: 22, goal: 16, novelty: 10, diversity: 12, plannedPenalty: 24, feedbackPenalty: 60, reviewSuggestion: 6 });
export const topicMatchWeights = Object.freeze({ core: 1, tagsOnly: 0.75, related: 0.25 });
export const recommendationTopicMatch = (p: Pick<LearningCandidate, "contestId" | "index" | "tags">, topic: string) => topicMatch(p, topic, topicMatchWeights);
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
    return text.split(/[。；;.!?！？\n]|但是|但|\bbut\b/i).filter(clause => !/没有|不存在|并无|无需|未发现|无明显|不需要|不必|\bwithout\b|\bno\b|\bnot\b/i.test(clause)).join("；");
}
export type EvidenceRef = {
    kind: "training" | "ai_review" | "user_feedback" | "official_submission";
    id: string;
    reviewId?: string;
    submissionId?: number;
    contestId?: number;
    handle?: string;
    observedAt?: string;
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
export function officialItems(e: LearningEvidence) {
    if (!e.official?.enabled || !e.official.handle) return [];
    const seen = new Set<string>();
    return [...e.official.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.submissionId - a.submissionId).filter(s => {
        const key = `${s.contestId}/${s.index}`; if (seen.has(key)) return false; seen.add(key); return true;
    });
}
function officialRef(e: LearningEvidence, item: ReturnType<typeof officialItems>[number]): EvidenceRef {
    return { kind: "official_submission", id: item.id, submissionId: item.submissionId, contestId: item.contestId, handle: e.official!.handle!, observedAt: item.observedAt };
}
export function abilityProfile(e: LearningEvidence) {
    const samples = latestProblems(e);
    const official = officialItems(e);
    const tags = [...new Set([...samples, ...official].flatMap(s => s.tags))].sort();
    const directions = tags.map(topic => {
        const rows = samples.filter(s => s.tags.includes(topic));
        const confirmed = official.filter(s => s.tags.includes(topic));
        const count = new Set([...rows.map(s => s.problemId), ...confirmed.map(s => s.problemId ?? `cf:${s.contestId}/${s.index}`)]).size;
        const highHints = rows.filter(s => s.maxHint >= 3);
        const unresolved = rows.filter(s => s.outcome === "unsolved" || s.outcome === "abandoned");
        const solved = rows.filter(s => s.outcome === "solved_self_reported");
        // No hint doesn't prove independence: external help is unknown in legacy records.
        const lowHintSolved = solved.filter(s => s.maxHint <= 1);
        return { topic, samples: count, trainingSamples: rows.length, officialAccepted: confirmed.length, officialRefs: confirmed.map(s => officialRef(e, s)), selfReportedSolved: solved.length, highHints: highHints.length, unresolved: unresolved.length, lowHintSolved: lowHintSolved.length,
            confidence: count < learningLimits.adequateSamples ? "样本不足" : confirmed.length ? "有限证据（公开账号归属未验，独立性未知）" : "有限可信（含自报）",
            suggestion: highHints.length + unresolved.length > 0 ? "暂定加强方向：存在高等级提示或未解记录，建议继续验证。" : "继续收集证据；不能据此断言已掌握。",
            refs: rows.map(s => ({ kind: "training" as const, id: s.id })),
            // Repeated attempts at the same problem count once; tags aren't causal proof.
            weakness: Math.min(1, (highHints.length + unresolved.length) / Math.max(rows.length, 3)) };
    });
    const bands = [...new Set([...samples, ...official].filter(s => s.rating !== null).map(s => Math.floor(s.rating! / 400) * 400))].sort((a, b) => a - b).map(min => {
        const rows = samples.filter(s => s.rating !== null && s.rating >= min && s.rating < min + 400);
        const confirmed = official.filter(s => s.rating !== null && s.rating >= min && s.rating < min + 400);
        const count = new Set([...rows.map(s => s.problemId), ...confirmed.map(s => s.problemId ?? `cf:${s.contestId}/${s.index}`)]).size;
        return { min, max: min + 399, samples: count, trainingSamples: rows.length, officialAccepted: confirmed.length, selfReportedSolved: rows.filter(s => s.outcome === "solved_self_reported").length, highHints: rows.filter(s => s.maxHint >= 3).length, confidence: count < 5 ? "样本不足" : confirmed.length ? "有限证据（公开账号归属未验，独立性未知）" : "有限可信（含自报）" };
    });
    const reviews = e.preferences?.reviewEvidence ? e.reviews : [];
    const reviewDirections = Object.entries(aliases).flatMap(([topic, pattern]) => {
        const rows = reviews.filter(r => pattern.test(riskClauses(r.knowledge)) || pattern.test(riskClauses(r.risks)));
        return rows.length ? [{ topic, samples: rows.length, source: "AI 推测（未验证）", refs: rows.map(r => ({ kind: "ai_review" as const, id: r.id, reviewId: r.reviewId })) }] : [];
    });
    const recurringIssues = Object.entries(issuePatterns).flatMap(([key, pattern]) => {
        const rows = reviews.filter(r => pattern.test(riskClauses(r.risks)));
        return rows.length ? [{ key, samples: rows.length, confidence: "AI 推测（未验证）", recurring: rows.length >= 2, refs: rows.map(r => ({ kind: "ai_review" as const, id: r.id, reviewId: r.reviewId })) }] : [];
    });
    return { official: { enabled: Boolean(e.official?.enabled), handle: e.official?.handle ?? null, ownershipVerified: false as const,
        analyzedAccepted: official.length, totalAcceptedProblems: e.official?.enabled ? e.official.totalAcceptedProblems : 0,
        lastSyncedAt: e.official?.lastSyncedAt ?? null, lastFullScanAt: e.official?.lastFullScanAt ?? null, fullScanUpperId: e.official?.fullScanUpperId ?? null }, totalSessions: e.totalSessions, analyzedSessions: e.sessions.length, distinctCompletedProblems: samples.length, directions, bands, reviewDirections, recurringIssues,
        hintDistribution: Array.from({ length: 6 }, (_, level) => ({ level, samples: e.sessions.filter(s => s.maxHint === level).length })),
        thoughtRecordedSessions: e.sessions.filter(s => s.thoughtCount > 0).length,
        sources: { official: "CF 官方事实：已关联的公开账号有 OK 提交；归属、独立性与复盘源码一致性未验证。", metadata: "CF 官方题目元数据（Rating 不是选手能力）", outcome: "用户自报；不会被关联公开账号的官方结果覆盖", hints: "AlgoPilot 实际已看最高等级，不等于授权等级", review: "已授权的结构化 AI 复盘，未经执行或正确性验证" },
        limitations: ["官方仅分析最近 500 道不同已观察 OK 题；全历史已知 AC 过滤在数据库执行。", "未到尾部或增量仍在进行时，不把未观察到 AC 解释为未完成；历史到尾部也不是实时原子快照。", "官方低难度 AC 只补充相应难度覆盖，不提升参考难度，也不消除真实提示依赖。", "这是最近 500 次训练窗口画像，不代表长期全部能力；旧方向未出现不表示已掌握。", "缺少提示不能证明独立完成；外部题解使用可能未知。", "同题只取最近一次完成训练；重复训练不增加知识方向样本量。", "题目 Tags 只能表明关联方向，不能证明卡点由该知识点造成。", "未自报解出且未查看 L5 的题目不展开知识方向；保留难度与提示统计。", "复盘仅取每题最新分析、最多 200 题；词汇匹配不能证明 AI 判断正确。", ...(e.totalSessions > e.sessions.length ? ["仅分析最近 500 次训练，较早记录未纳入画像。"] : [])] };
}
export function recommendationTarget(e: LearningEvidence) {
    const p = e.preferences ?? defaultPreferences;
    const completed = latestProblems(e).filter(s => s.outcome === "solved_self_reported" && s.rating !== null);
    const ratings = completed.map(s => s.rating!).sort((a, b) => a - b);
    const middle = Math.floor(ratings.length / 2);
    const median = ratings.length ? ratings.length % 2 ? ratings[middle]! : (ratings[middle - 1]! + ratings[middle]!) / 2 : null;
    const relevant = [...e.feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).filter(f => f.rating !== null && f.rating >= p.min && f.rating <= p.max).slice(0, learningLimits.feedbackWindow);
    const requestedShift = Math.max(-learningLimits.feedbackMaxShift, Math.min(learningLimits.feedbackMaxShift, relevant.reduce((n, f) => n + (f.kind === "too_easy" ? learningLimits.feedbackStep : f.kind === "too_hard" ? -learningLimits.feedbackStep : 0), 0)));
    const highHintSamples = completed.filter(s => s.maxHint >= 3).length;
    const base = ratings.length >= 3 && median !== null ? median - (highHintSamples * 2 >= ratings.length ? 100 : 0) : (p.min + p.max) / 2;
    // Report actual movement after hard-range clipping, separately from requested feedback.
    const baseTarget = Math.round(Math.max(p.min, Math.min(p.max, base)));
    const target = Math.round(Math.max(p.min, Math.min(p.max, base + requestedShift)));
    const shift = target - baseTarget;
    return { preferences: p, target, baseTarget, requestedShift, shift, historySamples: ratings.length, historyRefs: completed.slice(0, 20).map(s => ({ kind: "training" as const, id: s.id })), feedbackRefs: relevant.filter(f => f.kind !== "off_goal").map(f => ({ kind: "user_feedback" as const, id: f.id })) };
}
export function recommend(e: LearningEvidence, candidates: LearningCandidate[], exclude: string[] = []) {
    const profile = abilityProfile(e);
    const { preferences: p, target, shift, requestedShift, feedbackRefs, historySamples, historyRefs } = recommendationTarget(e);
    const recent = [...e.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, learningLimits.recentSessions);
    const official = officialItems(e);
    const recentOfficial = official.filter(s => s.rating !== null && s.rating >= p.min && s.rating <= p.max).slice(0, learningLimits.recentSessions);
    const recentTags = new Set([...recent, ...recentOfficial].flatMap(s => s.tags));
    const solved = new Set(e.sessions.filter(s => s.outcome === "solved_self_reported").map(s => s.problemId));
    official.forEach(s => { if(s.problemId) solved.add(s.problemId); });
    const unique = new Map(candidates.map(c => [c.id, c]));
    let pool = [...unique.values()].filter(c => !["interactive", "language_not_cpp"].includes(trainingCompatibility(c)) && c.rating !== null && c.rating >= p.min && c.rating <= p.max && (p.repeat || !solved.has(c.id)) && (!p.themes.length || c.tags.some(t => p.themes.includes(t as typeof p.themes[number]))));
    const alternatives = pool.filter(c => !exclude.includes(c.id));
    const reused = alternatives.length < Math.min(learningLimits.recommendations, pool.length);
    pool = [...alternatives, ...(reused ? pool.filter(c => exclude.includes(c.id)) : [])];
    // These evidence signals are invariant within a request. Reusing them avoids
    // rebuilding up to 500/200 record references in each of five greedy rounds.
    // Only round coverage is dynamic; weights, factors and result order are unchanged.
    const signals = new Map(pool.map(c => {
        const directions = profile.directions.filter(d => recommendationTopicMatch(c, d.topic).strength > 0 && d.weakness > 0);
        const matches = [...new Set([...directions.map(d => d.topic), ...p.themes.filter(t => recommendationTopicMatch(c, t).strength > 0)])].map(t => recommendationTopicMatch(c, t));
        const officialCoverage = recentOfficial.filter(s => s.tags.some(t => c.tags.includes(t)));
        const ai = profile.reviewDirections.filter(d => c.tags.includes(d.topic));
        const difficulty = recommendationWeights.difficulty * Math.max(0, 1 - Math.abs(c.rating! - target) / Math.max(200, p.max - p.min));
        const weakness = recommendationWeights.weakness * Math.max(0, ...directions.map(d => d.weakness * recommendationTopicMatch(c, d.topic).strength));
        const theme = p.themes.some(t => c.tags.includes(t));
        const novel = c.tags.length > 0 && c.tags.some(t => !recentTags.has(t));
        const feedback = e.feedback.find(f => f.problemId === c.id);
        const repeatedRecently = recent.some(s => s.problemId === c.id);
        const refs: EvidenceRef[] = [...new Map([...directions.flatMap(d => d.refs), ...ai.flatMap(d => d.refs), ...officialCoverage.map(s => officialRef(e, s)), ...feedbackRefs, ...(historySamples >= 3 ? historyRefs : []), ...(feedback ? [{ kind: "user_feedback" as const, id: feedback.id }] : [])].map(r => [r.id, r])).values()];
        return [c.id, { directions, matches, officialCoverage, ai, difficulty, weakness, theme, novel, feedback, repeatedRecently, refs }] as const;
    }));
    const usedTags = new Set<string>();
    const selected = [];
    while (pool.length && selected.length < learningLimits.recommendations) {
        const scored = pool.map(c => {
            const { directions, matches, officialCoverage, ai, difficulty, weakness, theme, novel, feedback, repeatedRecently, refs } = signals.get(c.id)!;
            const diversity = c.tags.length > 0 && c.tags.some(t => !usedTags.has(t));
            const factors = { difficulty, weakness, goal: p.goal === "independence" ? weakness / recommendationWeights.weakness * recommendationWeights.goal : p.goal === "explore" ? Number(novel) * recommendationWeights.goal : Math.max(0, ...p.themes.map(t => recommendationTopicMatch(c, t).strength)) * recommendationWeights.goal,
                novelty: Number(novel) * recommendationWeights.novelty - Number(repeatedRecently) * recommendationWeights.novelty,
                diversity: Number(diversity) * recommendationWeights.diversity, plan: c.inPlan ? -recommendationWeights.plannedPenalty : 0,
                feedback: feedback ? -recommendationWeights.feedbackPenalty : 0, review: ai.length ? recommendationWeights.reviewSuggestion : 0, reroll: exclude.includes(c.id) ? -recommendationWeights.feedbackPenalty : 0 };
            const score = Object.values(factors).reduce((a, b) => a + b, 0);
            // Do not send candidate tags, nor name a hidden algorithm in default recommendations.
            const reasons = [`CF 题目 Rating ${c.rating}，位于${e.preferences ? "你选择的" : "暂定冷启动"} ${p.min}–${p.max} 区间；本轮参考难度 ${target}。`];
            if (historySamples >= 3)
                reasons.push(`参考难度结合 ${historySamples} 道不同题目的自报解出 Rating 中位数与实际提示依赖；不是能力评级，仍以所选范围为界。`);
            if (!e.preferences)
                reasons.push("尚未保存自评；使用保守区间，可先选择你愿意挑战的难度。此范围不是能力结论。");
            if (directions.length)
                reasons.push(`与你的已完成训练中待加强方向相关：依据 ${new Set(directions.flatMap(d => d.refs.map(r => r.id))).size} 道题的实际提示与自报结果；关联不等于因果，仍需验证。（未解题标签隐藏）`);
            if (theme)
                reasons.push(`官方标签关联你主动选择的主题：${p.themes.filter(t => c.tags.includes(t)).join("、")}；标签命中不保证是核心解法。`);
            if (matches.some(m => m.basis === "source_checked"))
                reasons.push("相关训练任务已对照官方题面与题解核验，专项匹配按完整强度加权；这是 AI 来源核验，仍待真人复核，不表示算法是唯一必需解法。（未解题方向隐藏）");
            if (matches.some(m => m.basis === "tags_only"))
                reasons.push("相关方向仅有官方 Tags，核心学习任务尚未核验；相应专项匹配按 0.75 强度加权，适配仍有不确定性。（未解题方向隐藏）");
            if (matches.some(m => m.basis === "related"))
                reasons.push("来源核验支持关联方向，但该方向不是所核验解法的核心训练任务；相应专项匹配按 0.25 强度加权，不代表该题没有训练价值。（未解题方向隐藏）");
            if (trainingCompatibility(c) === "special_unverified")
                reasons.push("官方特殊题标记的具体限制尚未核验；未因该标记一律排除，开始前请在 CF 官网确认语言和环境要求。");
            if (ai.length)
                reasons.push("已授权 AI 复盘提及相关知识，作为低权重的待验证建议；不代表已证实薄弱点。（未解题标签隐藏）");
            if (officialCoverage.length)
                reasons.push(`关联公开账号 ${e.official!.handle} 在所选难度区间有 ${officialCoverage.length} 道相关方向的已观察官方 OK，参与近期覆盖与新颖度判断；不证明属于本人或独立完成。（未解题方向隐藏）`);
            if (novel)
                reasons.push(recentTags.size ? "可拓宽已记录的近期知识覆盖；方向标签默认隐藏。" : "本轮考虑知识覆盖；尚无可比较的近期知识记录，方向标签默认隐藏。");
            if (diversity)
                reasons.push("补充本轮此前尚未覆盖的知识方向，获得多样性加权；标签默认隐藏。");
            if (factors.goal > 0)
                reasons.push(p.goal === "independence" ? "本轮独立解题目标额外优先考虑有训练证据的待加强方向。" : p.goal === "explore" ? "本轮探索目标额外优先考虑近期未覆盖方向。" : "本轮均衡目标对你选择的主题加权。");
            if (requestedShift)
                reasons.push(`依据近期难度反馈请求调整 ${requestedShift > 0 ? "+" : ""}${requestedShift}；所选范围内本轮实际调整 ${shift > 0 ? "+" : ""}${shift}，参考难度为 ${target}。`);
            if (c.inPlan)
                reasons.push("已在现有计划中，因此降低优先级；可继续关联到其他计划。");
            if (c.practiced)
                reasons.push(repeatedRecently ? "最近 20 次训练中出现过这道题，本轮已做重复降权。" : "曾经训练过；最近 20 次中未出现，本轮不额外做近期重复降权。");
            if (!c.tags.length)
                reasons.push("官方标签缺失；仅依据难度与训练记录推荐，不推测知识方向。");
            if (feedback)
                reasons.push("你曾反馈这道题不合适，因此降低优先级；候选不足时仍可能出现。");
            if (factors.reroll < 0)
                reasons.push("替代候选不足，保留上一轮题目并额外降权；本轮没有随机更换结果。");
            return { topicFit: { version: teachingMetadata.version, bases: [...new Set(matches.map(m => m.basis))] }, problem: { id: c.id, contestId: c.contestId, index: c.index, name: c.name, rating: c.rating }, reasons, refs, factors, score, inPlan: c.inPlan, practiced: c.practiced };
        }).sort((a, b) => b.score - a.score || a.problem.id.localeCompare(b.problem.id));
        const best = scored[0]!;
        selected.push(best);
        const candidate = pool.find(c => c.id === best.problem.id)!;
        candidate.tags.forEach(t => usedTags.add(t));
        pool = pool.filter(c => c.id !== best.problem.id);
    }
    return { version: recommendationVersion, candidatePolicyVersion, items: selected, profile, target, requestedShift, shift, reused, preferences: p, configured: Boolean(e.preferences), revision: e.revision,
        limitations: "确定性 V1，仅对数据库按难度与主题分层选出的最多 600 个候选排序；Rating 缺失的题不推荐，主题训练排除缺 Tags 题。推荐排序分数不是选手能力分。" + (e.official?.enabled ? ` 官方只排除已观察的 OK；${e.official.lastFullScanAt ? "此前历史曾扫描到公开尾部，但不是当前实时原子快照" : "公开历史仍未到尾部"}，未观察到 AC 不表示未完成。官方覆盖不证明账号归属/独立性，不自动提高参考难度。` : "") };
}
export type RecommendationResult = ReturnType<typeof recommend> & {
    syncedAt: string | null;
    stale: boolean;
    notice: string | null;
    candidateCount: number;
};
export type AbilityProfile = ReturnType<typeof abilityProfile>;
