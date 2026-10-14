import { requireContext } from "@/server/auth";
import { learningRepository } from "@/server/learning/repository";
import { abilityProfile } from "@/features/learning/engine";
import { handle, json } from "@/server/http";
export function GET() { return handle(async () => { const { client } = await requireContext(); const repo=learningRepository(client); const e = await repo.evidence(); const profile=abilityProfile(e); if(e.official) await repo.assertRevision(e.revision,e.official.revision); else await repo.assertRevision(e.revision); return json({ profile, preferences: e.preferences, revision: e.revision }); }); }
