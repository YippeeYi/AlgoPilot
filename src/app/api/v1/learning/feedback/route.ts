import { requireContext } from "@/server/auth";
import { learningRepository } from "@/server/learning/repository";
import { feedbackSchema } from "@/lib/validation/learning";
import { handle, json, readJson } from "@/server/http";
export function POST(request: Request) { return handle(async () => { const { client } = await requireContext(); const input = await readJson(request, feedbackSchema); await learningRepository(client).write({ action: "feedback", ...input }); return json({ saved: true }); }); }
