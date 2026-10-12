import { requireContext } from "@/server/auth";
import { routeId } from "@/server/api";
import { handle, json, readJson } from "@/server/http";
import { reviewEditSchema } from "@/lib/validation/review";
import { reviewRepository } from "@/server/review/repository";
import { readTutorConfig } from "@/server/tutor/config";
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export function GET(_request: Request, context: Context) { return handle(async () => { const { client, user } = await requireContext(); const id = await routeId(context); const repo = reviewRepository(client, user.id); const [review, results] = await Promise.all([repo.get(id), repo.results(id)]); return json({ review, results, configured: Boolean(readTutorConfig()) }); }); }
export function PATCH(request: Request, context: Context) { return handle(async () => { const { client, user } = await requireContext(); const id = await routeId(context); const input = await readJson(request, reviewEditSchema); return json({ review: await reviewRepository(client, user.id).edit(id, input.revision, input.notes) }); }); }
