import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { candidatesSchema, evidenceSchema, type LearningPreferences } from "@/lib/validation/learning";
import { databaseError } from "@/server/http";
export function learningRepository(client: SupabaseClient<Database>) {
    return {
        async evidence() { const { data, error } = await client.rpc("learning_evidence", {}); databaseError(error); return evidenceSchema.parse(data); },
        async candidates(p: LearningPreferences, target: number) { const { data, error } = await client.rpc("learning_candidates", { p_query: { min: p.min, max: p.max, themes: p.themes, repeat: p.repeat, target } }); databaseError(error); return candidatesSchema.parse(data); },
        async write(input: Record<string, unknown>) { const { error } = await client.rpc("learning_write", { p_input: input }); databaseError(error); },
    };
}
