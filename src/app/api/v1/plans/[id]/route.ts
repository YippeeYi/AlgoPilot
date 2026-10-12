import { requireContext } from "@/server/auth";
import { planRepository } from "@/server/plans/repository";
import { mutatePlanSchema } from "@/lib/validation/m3";
import { routeId } from "@/server/api";
import { handle, json, readJson } from "@/server/http";
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export function GET(_r: Request, c: Context) { return handle(async () => { const { client, user } = await requireContext(); return json(await planRepository(client, user.id).detail(await routeId(c))); }); }
export function PATCH(request: Request, c: Context) { return handle(async () => { const { client, user } = await requireContext(); const id = await routeId(c); const input = await readJson(request, mutatePlanSchema); const repo = planRepository(client, user.id); const result = await repo.write(id, input); return json(result.deleted ? result : await repo.detail(id)); }); }
