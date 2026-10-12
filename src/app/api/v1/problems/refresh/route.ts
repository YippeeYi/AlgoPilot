import { z } from "zod";
import { requireContext } from "@/server/auth";
import { cfRepository } from "@/server/codeforces/repository";
import { catalog } from "@/server/codeforces/catalog";
import { catalogQuerySchema } from "@/lib/validation/m3";
import { handle, json, readJson } from "@/server/http";
export function POST(request: Request) { return handle(async () => { const { client, user } = await requireContext(); await readJson(request, z.object({}).strict()); return json(await catalog(cfRepository(client, user.id), catalogQuerySchema.parse({}), true)); }); }
