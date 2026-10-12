import { requireContext } from "@/server/auth";
import { planRepository } from "@/server/plans/repository";
import { createPlanSchema } from "@/lib/validation/m3";
import { handle, json, readJson } from "@/server/http";
export function GET() { return handle(async () => { const { client, user } = await requireContext(); return json({ items: await planRepository(client, user.id).list() }); }); }
export function POST(request: Request) { return handle(async () => { const { client, user } = await requireContext(); const input = await readJson(request, createPlanSchema); const repo = planRepository(client, user.id); await repo.write(input.requestId, { action: "create", ...input }); return json(await repo.detail(input.requestId), 201); }); }
