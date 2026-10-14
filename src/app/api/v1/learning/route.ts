import { requireContext } from "@/server/auth";
import { learningRepository } from "@/server/learning/repository";
import { abilityProfile } from "@/features/learning/engine";
import { handle, json } from "@/server/http";
export function GET() { return handle(async () => { const { client } = await requireContext(); const e = await learningRepository(client).evidence(); return json({ profile: abilityProfile(e), preferences: e.preferences, revision: e.revision }); }); }
