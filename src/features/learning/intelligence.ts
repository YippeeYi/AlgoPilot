import { latestProblems, officialItems, type EvidenceRef } from "./engine";
import { learningTopics, type LearningEvidence, type SkillWindow } from "@/lib/validation/learning";

// Descriptive evidence rules, NOT scoring weights, an Elo model, or a prediction of mastery.
export const skillRules = Object.freeze({ version: "evidence-diagnostics/1", minimum: 5, concernMinimum: 2, concernRatio: 0.4, concentrationMinimum: 10, concentrationRatio: 0.8, limit: 500 });
const day = 86_400_000;
const timestamp = (v: string) => Date.parse(v);
const ref = (id: string): EvidenceRef => ({ kind: "training", id });
const knownOutcome = (s: LearningEvidence["sessions"][number]) => ["solved_self_reported", "unsolved", "abandoned"].includes(s.outcome ?? "");
const solved = (s: LearningEvidence["sessions"][number]) => s.outcome === "solved_self_reported";
const concern = (s: LearningEvidence["sessions"][number]) => s.maxHint >= 3 || s.outcome === "unsolved" || s.outcome === "abandoned";
const median = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length ? a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2 : null;
};
export function skillIntelligence(e: LearningEvidence, window: SkillWindow, now: number) {
  if (!Number.isFinite(now)) throw Error("Invalid analysis time");
  const start = window === "all" ? null : now - Number(window) * day;
  const inWindow = (s: { createdAt: string }) => timestamp(s.createdAt) <= now && (start === null || timestamp(s.createdAt) > start);
  // Normalize timestamps, then deduplicate BEFORE the window. Repeated history is never a new sample.
  const normalized = [...e.sessions].filter(s => Number.isFinite(timestamp(s.createdAt)) && timestamp(s.createdAt) <= now)
    .map(s => ({ ...s, tags: s.status === "completed" && (solved(s) || s.maxHint === 5) ? [...new Set(s.tags)] : [], createdAt: new Date(timestamp(s.createdAt)).toISOString() }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const sessions = normalized.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; }).slice(0, skillRules.limit);
  const completed = latestProblems({ ...e, sessions });
  const training = completed.filter(inWindow);
  const normalizedOfficial = e.official ? { ...e.official, items: e.official.items.filter(s => Number.isFinite(timestamp(s.createdAt)) && timestamp(s.createdAt) <= now)
    .map(s => ({ ...s, createdAt: new Date(timestamp(s.createdAt)).toISOString() })) } : undefined;
  const official = officialItems({ ...e, official: normalizedOfficial }).slice(0, skillRules.limit).filter(inWindow);
  const topics = learningTopics.map(topic => {
    const rows = training.filter(s => s.tags.includes(topic));
    const eligible = rows.filter(knownOutcome), concerns = eligible.filter(concern), successes = eligible.filter(solved);
    const sufficient = eligible.length >= skillRules.minimum;
    const action = sufficient && concerns.length >= skillRules.concernMinimum && concerns.length / eligible.length >= skillRules.concernRatio;
    const accepted = official.filter(s => s.tags.includes(topic));
    const last = rows[0]?.createdAt ?? null;
    return { topic, trainingSamples: rows.length, knownOutcomes: eligible.length, selfReportedSolved: successes.length,
      highHints: rows.filter(s => s.maxHint >= 3).length, concernSamples: concerns.length,
      // Explicit numerator/denominator, never a CF acceptance rate or independence rate.
      completion: sufficient ? { numerator: successes.length, denominator: eligible.length } : null,
      officialAccepted: accepted.length, lastTrainingCreatedAt: last,
      status: !sufficient ? "insufficient" as const : action ? "practice_signal" as const : successes.length / eligible.length >= 0.8 ? "documented_practice" as const : "mixed" as const,
      confidence: sufficient ? "有限训练证据（含自报）" : "样本不足，无法判断",
      refs: rows.map(s => ref(s.id)),
      officialRefs: accepted.map(s => ({ kind: "official_submission" as const, id: s.id, submissionId: s.submissionId, contestId: s.contestId, handle: e.official!.handle!, observedAt: s.observedAt })),
      action: action ? { topic, window } : null };
  });
  const bands = [...new Set([...training, ...official].filter(s => s.rating !== null).map(s => Math.floor(s.rating! / 400) * 400))].sort((a, b) => a - b).map(min => {
    const rows = training.filter(s => s.rating !== null && s.rating >= min && s.rating < min + 400);
    const accepted = official.filter(s => s.rating !== null && s.rating >= min && s.rating < min + 400);
    const eligible = rows.filter(knownOutcome);
    return { min, max: min + 399, trainingSamples: rows.length, selfReportedSolved: rows.filter(solved).length, highHints: rows.filter(s => s.maxHint >= 3).length,
      completion: eligible.length >= skillRules.minimum ? { numerator: eligible.filter(solved).length, denominator: eligible.length } : null,
      officialAccepted: accepted.length, refs: rows.map(s => ref(s.id)) };
  });
  const summary = (rows: typeof training) => {
    const rated = rows.filter(s => solved(s) && s.rating !== null);
    return { completedProblems: rows.length, selfReportedSolved: rows.filter(solved).length, ratedSolved: rated.length,
      medianSolvedRating: rated.length >= skillRules.minimum ? median(rated.map(s => s.rating!)) : null,
      highHints: rows.filter(s => s.maxHint >= 3).length, refs: rows.map(s => ref(s.id)) };
  };
  const recent = summary(training);
  const previous = start === null ? null : summary(completed.filter(s => timestamp(s.createdAt) <= start && timestamp(s.createdAt) > start - Number(window) * day));
  const tagged = training.filter(s => s.tags.length), top = [...topics].sort((a, b) => b.trainingSamples - a.trainingSamples || a.topic.localeCompare(b.topic))[0];
  const concentration = tagged.length >= skillRules.concentrationMinimum && top && top.trainingSamples / tagged.length >= skillRules.concentrationRatio
    ? { topic: top.topic, numerator: top.trainingSamples, denominator: tagged.length, refs: top.refs } : null;
  return { version: skillRules.version, window, asOf: new Date(now).toISOString(), start: start === null ? null : new Date(start).toISOString(),
    coverage: { loadedTraining: sessions.length, totalTraining: e.totalSessions, truncated: e.totalSessions > sessions.length,
      officialEnabled: Boolean(e.official?.enabled && e.official.handle), officialAccepted: official.length,
      missingRating: training.filter(s => s.rating === null).length, missingVisibleTags: training.filter(s => !s.tags.length).length,
      unlinkedCompleted: sessions.filter(s => s.status === "completed" && !s.problemId && inWindow(s)).length,
      activeOrPaused: sessions.filter(s => s.status !== "completed" && inWindow(s)).length },
    recent, previous, topics, bands, concentration,
    // Compare descriptive sample medians only. Never label this as improvement/decline of ability.
    medianChange: recent.medianSolvedRating !== null && previous?.medianSolvedRating != null ? recent.medianSolvedRating - previous.medianSolvedRating : null,
    limitations: ["窗口按训练创建时间；不是完成时间、解题耗时或训练量的完整历史。范围为 (起点, 本次读取时间]，全部指已加载证据。",
      "每题取已加载窗口中最新完成训练，再按时间筛选；未结束训练不进入完成比例，未记录结果不进入比例分母。",
      "完成比例只指这些已结束且结果明确的训练中的自报解出比例；不等于真实成功概率或独立完成率。",
      "高等级提示与未解记录取并集，不重复计数；方向关联不证明知识点是困难原因。少于5个明确结果不输出比例或专项诊断。",
      "官方窗口按每题最新已观察 OK 的提交时间（最多500题），不是首次AC数；没有 WA/全尝试序列，不能计算首次成功、多次尝试成功率或判定稳定实力。",
      "两个时间段的中位数差只是所选题目构成变化，不能证明能力进步或退步；官方 OK 不与自报分母混合。",
      "缺少可见 Tags 可能是未解题披露限制；没有记录不等于未训练，公开账号归属/独立性仍未知。",
      "AI 复盘继续作为原画像中的独立待验证建议，不作为本诊断的成功事实。"] };
}
export type SkillIntelligence = ReturnType<typeof skillIntelligence>;
