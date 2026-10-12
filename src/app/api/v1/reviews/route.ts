import { requireContext } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { createReviewSchema } from "@/lib/validation/review";
import { reviewRepository } from "@/server/review/repository";
export function GET() { return handle(async () => { const { client, user } = await requireContext(); return json({ items: await reviewRepository(client, user.id).list() }); }); }
export function POST(request: Request) { return handle(async () => { const { client, user } = await requireContext(); const input = await readJson(request, createReviewSchema); return json({ review: await reviewRepository(client, user.id).create(input) }, 201); }); }
