import "server-only";
import { z } from "zod";
import { cfIndex, cfKey, cfMetadataSchema, type CfMetadata } from "@/lib/validation/m3";
const problem = z.object({ contestId: z.number().int().positive().max(2147483647).optional(), index: cfIndex, name: z.string().trim().min(1).max(200), type: z.enum(["PROGRAMMING", "QUESTION"]), rating: z.number().int().min(0).max(10000).optional(), tags: z.array(z.string().min(1).max(100)).max(50).optional() });
const response = z.object({ status: z.literal("OK"), result: z.object({ problems: z.array(problem).min(1).max(50000), problemStatistics: z.array(z.object({ contestId: z.number().int().positive().optional(), index: cfIndex, solvedCount: z.number().int().nonnegative() })).max(50000) }) });
export function parseProblemset(raw: unknown): CfMetadata[] {
    const data = response.parse(raw);
    const statistics = new Map<string, number>();
    for (const s of data.result.problemStatistics) {
        if (s.contestId === undefined)
            continue;
        const key = cfKey(s.contestId, s.index);
        if (statistics.has(key))
            throw new Error("Duplicate CF statistics");
        statistics.set(key, s.solvedCount);
    }
    const seen = new Set<string>();
    return data.result.problems.flatMap(p => {
        // CF also defines problemsetName-only objects; this product needs contestId + index.
        if (p.contestId === undefined)
            return [];
        const key = cfKey(p.contestId, p.index);
        if (seen.has(key))
            throw new Error("Duplicate CF problem");
        seen.add(key);
        return [cfMetadataSchema.parse({ contestId: p.contestId, index: p.index, name: p.name, rating: p.rating ?? null, tags: p.tags ?? [], solvedCount: statistics.get(key) ?? null })];
    });
}
