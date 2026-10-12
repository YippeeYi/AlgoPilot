import { z } from "zod";
import { ApiError } from "@/server/http";
import { requireContext } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { createReviewSchema } from "@/lib/validation/review";
import { reviewRepository } from "@/server/review/repository";
export function GET() { return handle(async () => { const { client, user } = await requireContext(); return json({ items: await reviewRepository(client, user.id).list() }); }); }
export function POST(request: Request) {
    return handle(async () => {
        const { client, user } = await requireContext();
        const { problemId, ...body } = await readJson(request, createReviewSchema.safeExtend({ problemId: z.uuid().optional() }));
        const input = createReviewSchema.parse(body);
        if (!input.sessionId && !problemId)
            throw new ApiError(422, "CF_PROBLEM_REQUIRED", "请先选择 Codeforces 题目。");
        return json({ review: await reviewRepository(client, user.id).create(input, problemId) }, 201);
    });
}
