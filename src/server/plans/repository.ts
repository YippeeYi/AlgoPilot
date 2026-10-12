import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";
import { planDetailSchema, planSchema } from "@/lib/validation/m3";
import { databaseError } from "@/server/http";
export function planRepository(client: SupabaseClient<Database>, userId: string) {
    return {
        async list() { const { data, error } = await client.from("training_plans").select("id,name,description,archived,revision,created_at,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(100); databaseError(error); return z.array(planSchema).parse(data); },
        async detail(id: string) { const { data, error } = await client.rpc("plan_detail", { p_id: id }); databaseError(error); return planDetailSchema.parse(data); },
        async write(id: string, input: Record<string, unknown>) { const { data, error } = await client.rpc("plan_write", { p_id: id, p_input: input }); databaseError(error); return z.object({ id: z.uuid(), deleted: z.boolean() }).parse(data); },
    };
}
