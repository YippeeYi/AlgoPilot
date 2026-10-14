import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";
import { cfAccountStateSchema } from "@/lib/validation/cf-account";
import { cfCursorSchema } from "@/features/learning/cf-cursor";
import { signTutorPayload } from "@/server/tutor/repository";
import { cfSigningSecret } from "./repository";
import { ApiError, databaseError } from "@/server/http";
const internalResponse = z.object({ acquired: z.boolean().optional(), replayed: z.boolean().optional(), accepted: z.boolean().optional(), nonce: z.uuid().optional(), scope: z.uuid().nullable().optional(),
    handle: z.string().nullable().optional(), registrationSeconds: z.number().nullable().optional(), waitMs: z.number().nonnegative().max(10000).optional(), from: z.number().int().positive().optional(),
    head: cfCursorSchema.optional(), history: cfCursorSchema.optional(), pendingFrom: z.number().int().positive().nullable().optional() });
export function cfAccountRepository(client: SupabaseClient<Database>, userId: string) {
    return {
        async state() { const { data, error } = await client.rpc("cf_account_state", {}); databaseError(error); return cfAccountStateSchema.parse(data); },
        async command(payload: Record<string, unknown>) {
            const signed = signTutorPayload({ operation: "cf_account", ...payload }, userId, cfSigningSecret());
            const { data, error } = await client.rpc("cf_account_command", signed);
            if (error?.code === "42501") throw new ApiError(503, "CF_SYNC_NOT_CONFIGURED", "Codeforces 签名配置不匹配。");
            databaseError(error); return internalResponse.parse(data);
        },
    };
}
export type CfAccountRepository = ReturnType<typeof cfAccountRepository>;
