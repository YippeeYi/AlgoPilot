import { requireContext } from "@/server/auth";
import { learningRepository } from "@/server/learning/repository";
import { cfRepository } from "@/server/codeforces/repository";
import { catalog } from "@/server/codeforces/catalog";
import { catalogQuerySchema } from "@/lib/validation/m3";
import { recommendationQuerySchema } from "@/lib/validation/learning";
import { recommend, recommendationTarget } from "@/features/learning/engine";
import { handle, json, readJson } from "@/server/http";
export function POST(request: Request) {
    return handle(async () => {
        const { client, user } = await requireContext();
        const input = await readJson(request, recommendationQuerySchema);
        const repo = learningRepository(client);
        const evidence = await repo.evidence();
        const { preferences, target } = recommendationTarget(evidence);
        const cache = await catalog(cfRepository(client, user.id), catalogQuerySchema.parse({ limit: 1 }));
        const candidates = await repo.candidates(preferences, target);
        const recommendations = recommend(evidence, candidates.items, input.exclude);
        await repo.assertRevision(evidence.revision);
        return json({ ...recommendations, candidateCount: candidates.total, syncedAt: cache.syncedAt, stale: cache.stale, notice: cache.notice });
    });
}
