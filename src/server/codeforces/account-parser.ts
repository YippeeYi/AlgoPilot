import "server-only";
import { z } from "zod";
import { cfHandleSchema, officialSubmissionSchema, type OfficialSubmission } from "@/lib/validation/cf-account";
import { cfIndex } from "@/lib/validation/m3";
export class CfUpstreamError extends Error {
    constructor(public category: "invalid_handle" | "rate_limit" | "http" | "invalid_response" | "network") { super("Codeforces public API unavailable"); }
}
function ok(raw: unknown) {
    const envelope = z.object({ status: z.enum(["OK", "FAILED"]), result: z.unknown().optional(), comment: z.string().optional() }).parse(raw);
    if (envelope.status === "FAILED") {
        if (/call limit exceeded/i.test(envelope.comment ?? "")) throw new CfUpstreamError("rate_limit");
        if (/not found|not exist|invalid handle/i.test(envelope.comment ?? "")) throw new CfUpstreamError("invalid_handle");
        throw new CfUpstreamError("invalid_response");
    }
    return envelope.result;
}
export function parseUserInfo(raw: unknown, requested: string) {
    const users = z.array(z.object({ handle: cfHandleSchema, registrationTimeSeconds: z.number().int().nonnegative() })).length(1).parse(ok(raw));
    const user = users[0]!;
    // No historic alias following: the canonical current handle must match this request.
    if (user.handle.toLowerCase() !== requested.toLowerCase()) throw new CfUpstreamError("invalid_response");
    return { handle: user.handle, registrationSeconds: user.registrationTimeSeconds };
}
export function parseUserStatus(raw: unknown, handle: string, count: number): OfficialSubmission[] {
    const rows = z.array(z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), creationTimeSeconds: z.number().int().nonnegative(),
        problem: z.object({ contestId: z.number().int().positive().max(2147483647).optional(), index: cfIndex }),
        author: z.object({ members: z.array(z.object({ handle: cfHandleSchema })).min(1), ghost: z.boolean().optional() }), verdict: z.string().regex(/^[A-Z_]{1,60}$/).optional() })).max(count).parse(ok(raw));
    const seen = new Set<number>(); let previous = Number.POSITIVE_INFINITY;
    return rows.map(row => {
        if (seen.has(row.id) || row.id >= previous || row.author.ghost || !row.author.members.some(m => m.handle.toLowerCase() === handle.toLowerCase())) throw new CfUpstreamError("invalid_response");
        previous = row.id; seen.add(row.id);
        // Discard language, resource use, test counts, names, personal contact fields and any source.
        return officialSubmissionSchema.parse({ submissionId: row.id, contestId: row.problem.contestId ?? null, index: row.problem.contestId ? row.problem.index : null, createdSeconds: row.creationTimeSeconds, verdict: row.verdict ?? null });
    });
}
