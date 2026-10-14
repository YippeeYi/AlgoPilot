import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";
import { catalogPageSchema, type catalogQuerySchema } from "@/lib/validation/m3";
import { signTutorPayload } from "@/server/tutor/repository";
import { ApiError, databaseError } from "@/server/http";
export function cfSigningSecret() {
    const master = process.env.TUTOR_RPC_SIGNING_SECRET;
    const secret = process.env.CODEFORCES_RPC_SIGNING_SECRET || (master && /^[a-fA-F0-9]{64,128}$/.test(master) ? createHmac("sha256", master).update("algopilot/cf/v1").digest("hex") : undefined);
    if (!secret || !/^[a-f0-9]{64,128}$/.test(secret)) throw new ApiError(503, "CF_SYNC_NOT_CONFIGURED", "Codeforces 同步签名未配置，请检查配置指南。");
    return secret;
}
export function cfRepository(client: SupabaseClient<Database>, userId: string) {
    return {
        async read(query: z.infer<typeof catalogQuerySchema>) {
            const { data, error } = await client.rpc("cf_catalog", { p_query: query });
            databaseError(error);
            return catalogPageSchema.parse(data);
        },
        async sync(payload: Record<string, unknown>) {
            const secret = cfSigningSecret();
            const { data, error } = await client.rpc("cf_sync", signTutorPayload({ operation: "cf_sync", ...payload }, userId, secret));
            if (error?.code === "42501")
                throw new ApiError(503, "CF_SYNC_NOT_CONFIGURED", "题库同步签名配置不匹配。");
            databaseError(error);
            return z.object({ acquired: z.boolean().optional(), nonce: z.uuid().optional(), waitMs: z.number().nonnegative().max(10000).optional(), accepted: z.boolean().optional() }).parse(data);
        },
    };
}
export type CfRepository = ReturnType<typeof cfRepository>;
