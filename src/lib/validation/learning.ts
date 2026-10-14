import { z } from "zod";
import { idSchema } from "./m1";
import { catalogProblemSchema } from "./m3";
// Public CF tag vocabulary; matching AI prose is a suggestion, never a verified weakness.
export const learningTopics = ["implementation", "math", "greedy", "dp", "data structures", "graphs", "trees", "binary search", "number theory", "strings", "combinatorics", "geometry", "bitmasks", "two pointers", "sortings", "dfs and similar", "shortest paths", "flows", "dsu", "constructive algorithms"] as const;
export const preferencesSchema = z.object({ min: z.number().int().min(800).max(3500), max: z.number().int().min(800).max(3500), themes: z.array(z.enum(learningTopics)).max(5).refine(v => new Set(v).size === v.length), goal: z.enum(["balanced", "independence", "explore"]), repeat: z.boolean(), reviewEvidence: z.boolean() }).strict().refine(v => v.min <= v.max);
export type LearningPreferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: LearningPreferences = { min: 800, max: 1200, themes: [], goal: "balanced", repeat: false, reviewEvidence: false };
export const savePreferencesSchema = z.object({ requestId: idSchema, revision: z.number().int().nonnegative().max(2147483646), preferences: preferencesSchema }).strict();
export const feedbackSchema = z.object({ requestId: idSchema, problemId: idSchema, kind: z.enum(["too_easy", "too_hard", "off_goal"]) }).strict();
export const recommendationQuerySchema = z.object({ exclude: z.array(idSchema).max(5).default([]) }).strict();
export const evidenceSchema = z.object({
    preferences: preferencesSchema.nullable(), revision: z.number().int().nonnegative(), totalSessions: z.number().int().nonnegative(),
    sessions: z.array(z.object({ id: idSchema, problemId: idSchema.nullable(), status: z.enum(["active", "paused", "completed"]), outcome: z.string().nullable(), rating: z.number().nullable(), tags: z.array(z.string()), maxHint: z.number().int().min(0).max(5), externalEditorial: z.boolean().nullable(), thoughtCount: z.number().int().nonnegative(), createdAt: z.string() })),
    reviews: z.array(z.object({ id: idSchema, reviewId: idSchema, problemId: idSchema.nullable(), knowledge: z.string(), risks: z.string(), createdAt: z.string() })),
    feedback: z.array(z.object({ id: idSchema, problemId: idSchema, kind: feedbackSchema.shape.kind, rating: z.number().nullable(), createdAt: z.string() })),
});
export type LearningEvidence = z.infer<typeof evidenceSchema>;
export const candidatesSchema = z.object({ items: z.array(catalogProblemSchema.extend({ inPlan: z.boolean(), practiced: z.boolean() })), total: z.number().int().nonnegative() });
export type LearningCandidate = z.infer<typeof candidatesSchema>["items"][number];
