import { requireContext } from "@/server/auth";
import { learningRepository } from "@/server/learning/repository";
import { savePreferencesSchema } from "@/lib/validation/learning";
import { handle, json, readJson } from "@/server/http";
export function POST(request: Request) { return handle(async () => { const { client } = await requireContext(); const input = await readJson(request, savePreferencesSchema); await learningRepository(client).write({ action: "preferences", ...input }); return json({ saved: true }); }); }
