import registry from "./problem-annotations.json";
import type { LearningCandidate } from "@/lib/validation/learning";

// A source audit by AI is not a human teaching verdict or an ability fact.
// These are supported learning tasks, never a claim that an algorithm is mandatory.
export const teachingMetadata = registry;
export const candidatePolicyVersion = registry.suitabilityVersion;
const annotations = new Map(registry.problems.filter(a => a.status === "source_checked_by_ai").map(a => [a.key, a]));
export const problemKey = (p: Pick<LearningCandidate, "contestId" | "index">) => `${p.contestId}/${p.index}`;
export function trainingCompatibility(p: Pick<LearningCandidate, "contestId" | "index" | "tags">) {
    if (p.tags.includes("interactive")) return "interactive";
    if (registry.contestRestrictions.some(r => r.contestId === p.contestId && r.status === "source_checked_by_ai")) return "language_not_cpp";
    return p.tags.includes("*special") || p.tags.includes("*special problem") ? "special_unverified" : "ordinary_or_unknown";
}
export function topicMatch(p: Pick<LearningCandidate, "contestId" | "index" | "tags">, topic: string, weights: { core: number; tagsOnly: number; related: number }) {
    const annotation = annotations.get(problemKey(p));
    if (annotation?.coreTopics.includes(topic)) return { strength: weights.core, basis: "source_checked" as const, annotation };
    if (annotation?.relatedTopics.includes(topic)) return { strength: weights.related, basis: "related" as const, annotation };
    // An unmentioned topic is unknown, not disproved by an incomplete annotation.
    return { strength: p.tags.includes(topic) ? weights.tagsOnly : 0, basis: "tags_only" as const, annotation: undefined };
}
