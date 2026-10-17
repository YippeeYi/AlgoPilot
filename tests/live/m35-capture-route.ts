// Operator-installed, temporary local acceptance route. Never ship under src/app.
// Only existing getUser-verified JWT reads; no Provider, upstream CF or database writes.
import "server-only";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireContext } from "@/server/auth";
import { ApiError, handle, json, readJson } from "@/server/http";
import { learningRepository } from "@/server/learning/repository";
import { cfAccountRepository } from "@/server/codeforces/account-repository";
import { cfRepository } from "@/server/codeforces/repository";
import { catalogQuerySchema } from "@/lib/validation/m3";
import { recommend, recommendationTarget } from "@/features/learning/engine";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function POST(request: Request) {
    return handle(async () => {
        if (process.env.NODE_ENV !== "development" || !["localhost:3000", "127.0.0.1:3000"].includes(new URL(request.url).host))
            throw new ApiError(404, "NOT_FOUND", "未找到此本地验收入口。");
        await readJson(request, z.object({ phase: z.literal("B-restored-frozen") }).strict());
        const { client, user } = await requireContext();
        const repo = learningRepository(client);
        const state = await cfAccountRepository(client, user.id).state();
        if (state.handle !== "YippeeYi" || !state.enabled) throw new ApiError(409, "ACCEPTANCE_STATE_CHANGED", "需先确认原关联与授权状态。");
        const evidence = await repo.evidence();
        const { preferences, target } = recommendationTarget(evidence);
        // Read the existing cache directly; acceptance must not auto-refresh public metadata.
        const cache = await cfRepository(client, user.id).read(catalogQuerySchema.parse({ limit: 1 }));
        const pool = await repo.candidates(preferences, target);
        const personalized = recommend(evidence, pool.items);
        // Same Rating/Tags/known-completion/training-fit/plan pool and count as A.
        // Fixed seed chosen before reading the pool; the ordering is the M3.4 baseline.
        const seed = "algopilot-m35-technical-1";
        const baseline = [...pool.items].sort((a, b) => Math.abs(a.rating! - target) - Math.abs(b.rating! - target)
            || digest(`${seed}:${a.contestId}/${a.index}`).localeCompare(digest(`${seed}:${b.contestId}/${b.index}`))
            || a.id.localeCompare(b.id)).slice(0, personalized.items.length);
        await repo.assertRevision(evidence.revision, evidence.official?.revision);
        const directory = await mkdtemp(join(tmpdir(), "algopilot-m35-private-"));
        const snapshot = { boundary: "Real JWT/RPC read, technical comparison only; no participant or human outcome", capturedAt: new Date().toISOString(),
            state, evidence, cache: { syncedAt: cache.syncedAt, stale: cache.stale }, pool, personalized, baseline, seed,
            poolSha256: digest(JSON.stringify([...pool.items].sort((a, b) => a.id.localeCompare(b.id)))) };
        const file = join(directory, "frozen-candidates.json");
        await writeFile(file, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600, flag: "wx" });
        return json({ written: true, file, candidateCount: pool.items.length, totalEligible: pool.total,
            poolSha256: snapshot.poolSha256, cacheSyncedAt: cache.syncedAt,
            personalized: personalized.items.map(i => ({ key: `${i.problem.contestId}/${i.problem.index}`, rating: i.problem.rating })),
            baseline: baseline.map(i => ({ key: `${i.contestId}/${i.index}`, rating: i.rating })) });
    });
}
