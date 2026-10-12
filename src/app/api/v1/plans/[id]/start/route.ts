import { requireContext } from "@/server/auth";
import { planRepository } from "@/server/plans/repository";
import { planStartSchema } from "@/lib/validation/m3";
import { sessionSchema } from "@/lib/validation/m1";
import { routeId } from "@/server/api";
import { handle, json, readJson, databaseError, ApiError } from "@/server/http";
export function POST(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return handle(async () => { const { client, user } = await requireContext(); const input = await readJson(request, planStartSchema); const detail = await planRepository(client, user.id).detail(await routeId(c)); if (!detail.items.some(i => i.id === input.itemId))
    throw new ApiError(404, "NOT_FOUND", "未找到可访问的计划题目。"); const { data, error } = await client.rpc("start_cf_session", { p_input: input }); databaseError(error); return json({ session: sessionSchema.parse(data?.[0]) }, 201); }); }
