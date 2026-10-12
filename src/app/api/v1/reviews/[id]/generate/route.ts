import { requireContext } from "@/server/auth";
import { routeId } from "@/server/api";
import { handle, json, readJson } from "@/server/http";
import { reviewRequestSchema } from "@/lib/validation/review";
import { reviewRepository } from "@/server/review/repository";
import { requireTutorConfig } from "@/server/tutor/config";
import { runReview } from "@/server/review/orchestrator";
export const runtime = "nodejs";
export const maxDuration = 180;
export function POST(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) { const deadlineAt = Date.now() + 150000; return handle(async () => { const { client, user } = await requireContext(); const id = await routeId(context); const input = await readJson(request, reviewRequestSchema); const repo = reviewRepository(client, user.id); await repo.get(id); return json(await runReview(repo, requireTutorConfig(), id, input, request.signal, undefined, deadlineAt)); }); }
