import { requireContext } from "@/server/auth";
import { learningRepository } from "@/server/learning/repository";
import { abilityProfile } from "@/features/learning/engine";
import { handle, json } from "@/server/http";
import { skillQuerySchema } from "@/lib/validation/learning";
import { skillIntelligence } from "@/features/learning/intelligence";
export function GET(request: Request) { return handle(async () => { const { client } = await requireContext(); const query=skillQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams)); const repo=learningRepository(client); const e = await repo.evidence(); const profile=abilityProfile(e); const intelligence=skillIntelligence(e,query.window,Date.now()); if(e.official) await repo.assertRevision(e.revision,e.official.revision); else await repo.assertRevision(e.revision); return json({ profile, intelligence, preferences: e.preferences, revision: e.revision }); }); }
