import { z } from "zod";
import { idSchema } from "./m1";
export const cfIndex = z.string().regex(/^[A-Z0-9]{1,16}$/);
export function cfKey(contestId: number, index: string) { return /^\d+$/.test(index) ? `${contestId}/${index}` : `${contestId}${index}`; }
export function cfUrl(contestId: number, index: string) { return `https://codeforces.com/problemset/problem/${contestId}/${index}`; }
export function locateCodeforces(query: string): string {
    const value = query.trim();
    if (!/^https?:/i.test(value))
        return value;
    const u = new URL(value);
    const m = u.pathname.match(/^\/(?:problemset\/problem\/(\d+)\/([A-Z0-9]{1,16})|(?:contest|gym)\/(\d+)\/problem\/([A-Z0-9]{1,16}))\/?$/i);
    if (u.protocol !== "https:" || u.hostname !== "codeforces.com" || u.port || u.username || u.password || u.search || u.hash || !m)
        throw new Error("仅接受 Codeforces 官方 HTTPS 题目链接。");
    const contest = Number(m[1] ?? m[3]);
    if (!Number.isSafeInteger(contest) || contest < 1 || contest > 2147483647)
        throw new Error("题号无效。");
    return cfKey(contest, (m[2] ?? m[4])!.toUpperCase());
}
export const catalogQuerySchema = z.object({
    q: z.string().trim().max(200).default("").transform((s, ctx) => { try {
        return locateCodeforces(s);
    }
    catch {
        ctx.addIssue({ code: "custom", message: "CF URL 无效" });
        return z.NEVER;
    } }),
    min: z.coerce.number().int().min(0).max(10000).optional(),
    max: z.coerce.number().int().min(0).max(10000).optional(),
    tags: z.string().max(500).default(""),
    sort: z.enum(["newest", "solved_desc", "solved_asc"]).default("newest"),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(30),
}).strict().refine(v => v.min === undefined || v.max === undefined || v.min <= v.max);
export const cfMetadataSchema = z.object({ contestId: z.number().int().positive().max(2147483647), index: cfIndex, name: z.string().trim().min(1).max(200), rating: z.number().int().min(0).max(10000).nullable(), tags: z.array(z.string().min(1).max(100)).max(50), solvedCount: z.number().int().nonnegative().nullable() }).strict();
export const catalogProblemSchema = cfMetadataSchema.extend({ id: idSchema });
export type CatalogProblem = z.infer<typeof catalogProblemSchema>;
export type CfMetadata = z.infer<typeof cfMetadataSchema>;
export const catalogPageSchema = z.object({ items: z.array(catalogProblemSchema), total: z.number().int(), syncedAt: z.string().nullable(), stale: z.boolean(), tags: z.array(z.string()) });
export type CatalogPage = z.infer<typeof catalogPageSchema>;
export const planStatusSchema = z.enum(["planned", "in_progress", "completed"]);
const revision = z.number().int().min(0).max(2147483646);
export const createPlanSchema = z.object({ requestId: idSchema, name: z.string().trim().min(1).max(100), description: z.string().max(2000).default(""), problemIds: z.array(idSchema).max(200).default([]) }).strict();
export const mutatePlanSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("add"), problemIds: z.array(idSchema).min(1).max(200), revision, requestId: idSchema }).strict(),
    z.object({ action: z.literal("remove"), itemId: idSchema, revision, requestId: idSchema }).strict(),
    z.object({ action: z.literal("reorder"), itemIds: z.array(idSchema).max(500), revision, requestId: idSchema }).strict(),
    z.object({ action: z.literal("status"), itemId: idSchema, status: planStatusSchema, revision, requestId: idSchema }).strict(),
    z.object({ action: z.literal("edit"), name: z.string().trim().min(1).max(100), description: z.string().max(2000), archived: z.boolean(), revision, requestId: idSchema }).strict(),
    z.object({ action: z.literal("delete"), revision, requestId: idSchema }).strict(),
]);
export const planSchema = z.object({ id: idSchema, name: z.string(), description: z.string(), archived: z.boolean(), revision: z.number().int(), created_at: z.string(), updated_at: z.string() });
export type TrainingPlan = z.infer<typeof planSchema>;
export const planItemSchema = z.object({ id: idSchema, position: z.number().int(), manual_status: planStatusSchema, problem: catalogProblemSchema, sessions: z.array(z.object({ id: idSchema, status: z.string(), outcome: z.string().nullable(), created_at: z.string(), linked: z.boolean() })), reviews: z.array(z.object({ id: idSchema, session_id: idSchema, created_at: z.string(), analyzed: z.boolean() })), officialStatus: z.literal("not_synced") });
export const planDetailSchema = z.object({ plan: planSchema, items: z.array(planItemSchema) });
export type PlanDetail = z.infer<typeof planDetailSchema>;
export const planStartSchema = z.object({ itemId: idSchema, requestId: idSchema, newSession: z.boolean().default(false), mode: z.enum(["practice", "contest"]).default("practice") }).strict();
