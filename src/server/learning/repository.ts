import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { candidatesSchema, evidenceSchema, type LearningPreferences } from "@/lib/validation/learning";
import { z } from "zod";
import { candidatePolicyVersion } from "@/features/learning/problem-fit";
import { ApiError, databaseError } from "@/server/http";
export function learningRepository(client: SupabaseClient<Database>) {
    return {
        async assertRevision(expected: number) {
            const {data,error}=await client.from("learning_preferences").select("revision").maybeSingle();
            databaseError(error);
            const current=z.object({revision:z.number().int().nonnegative()}).nullable().parse(data);
            if ((current?.revision ?? 0) !== expected)
                throw new ApiError(409,"LEARNING_EVIDENCE_CHANGED","学习偏好或证据授权已更新，请重新请求。旧推荐未展示。");
        },
        async evidence() { const { data, error } = await client.rpc("learning_evidence", {}); databaseError(error); return evidenceSchema.parse(data); },
        async candidates(p: LearningPreferences, target: number) { const { data, error } = await client.rpc("learning_candidates", { p_query: { min: p.min, max: p.max, themes: p.themes, repeat: p.repeat, target } }); databaseError(error); const pool = candidatesSchema.parse(data); if (pool.policyVersion !== candidatePolicyVersion) throw new ApiError(503, "CANDIDATE_POLICY_UNAVAILABLE", "推荐筛选版本尚未就绪，请检查数据库增量迁移。"); return pool; },
        async write(input: Record<string, unknown>) { const { error } = await client.rpc("learning_write", { p_input: input }); databaseError(error); },
    };
}
