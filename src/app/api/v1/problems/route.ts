import { requireContext } from "@/server/auth";
import { cfRepository } from "@/server/codeforces/repository";
import { catalog } from "@/server/codeforces/catalog";
import { catalogQuerySchema } from "@/lib/validation/m3";
import { handle, json, ApiError, assertSameOrigin } from "@/server/http";
export function GET(request: Request) { return handle(async () => { const { client, user } = await requireContext(); const query = catalogQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams)); return json(await catalog(cfRepository(client, user.id), query)); }); }
export function POST(request: Request) { return handle(async () => { await requireContext(); assertSameOrigin(request); throw new ApiError(410, "CUSTOM_PROBLEMS_RETIRED", "新题目请从 Codeforces 题库选择。已有私人题目保留在训练历史中。"); }); }
