import { z } from "zod";
import { idSchema } from "./m1";
import { cfIndex } from "./m3";
export const cfHandleSchema = z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_.-]+$/);
export const cfAccountInputSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("bind"), requestId: idSchema, revision: z.number().int().nonnegative(), handle: cfHandleSchema }).strict(),
    z.object({ action: z.literal("consent"), requestId: idSchema, revision: z.number().int().nonnegative(), enabled: z.boolean() }).strict(),
    z.object({ action: z.enum(["unlink", "delete"]), requestId: idSchema, revision: z.number().int().nonnegative() }).strict(),
]);
export const cfSyncInputSchema = z.object({ requestId: idSchema, revision: z.number().int().nonnegative() }).strict();
export const officialSubmissionSchema = z.object({ submissionId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), contestId: z.number().int().positive().max(2147483647).nullable(), index: cfIndex.nullable(), createdSeconds: z.number().int().nonnegative().max(253402300799), verdict: z.string().regex(/^[A-Z_]{1,60}$/).nullable() }).strict();
export type OfficialSubmission = z.infer<typeof officialSubmissionSchema>;
export const cfAccountStateSchema = z.object({
    version: z.literal("cf-evidence/1"), revision: z.number().int().nonnegative(), evidenceRevision: z.number().int().nonnegative(), handle: cfHandleSchema.nullable(), ownershipVerified: z.literal(false), enabled: z.boolean(),
    lastSyncedAt: z.string().nullable(), lastFullScanAt: z.string().nullable(), fullScanUpperId: z.number().nullable(), oldestObservedAt: z.string().nullable(), highWater: z.number().nullable(),
    historyFrom: z.number().int().positive(), historyInProgress: z.boolean(), observedSubmissions: z.number().int().nonnegative(), acceptedProblems: z.number().int().nonnegative(), pendingSubmissions: z.number().int().nonnegative(),
    status: z.enum(["unlinked", "never", "partial", "idle", "syncing", "failed"]), errorCode: z.string().nullable(),
});
export type CfAccountState = z.infer<typeof cfAccountStateSchema>;
