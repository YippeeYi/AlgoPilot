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
function accountDatabaseError(error: { code?: string } | null) {
    if (error?.code === "PGRST202" || error?.code === "42883")
        throw new ApiError(503, "CF_ACCOUNT_RPC_UNAVAILABLE", "账号数据库接口暂不可用，当前无法完成关联。请联系维护者核对迁移和接口缓存后重新加载；这不能单独证明迁移缺失。");
    if (error?.code === "PGRST301" || error?.code === "PGRST303")
        throw new ApiError(401, "UNAUTHENTICATED", "登录已失效，请重新登录后加载账号状态。");
    databaseError(error);
}
function parseResponse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
    const result = schema.safeParse(data);
    if (!result.success) throw new ApiError(503, "CF_ACCOUNT_UNAVAILABLE", "账号服务响应异常，请重新加载账号状态。");
    return result.data;
}
export function cfAccountRepository(client: SupabaseClient<Database>, userId: string) {
    return {
        async state() { const { data, error } = await client.rpc("cf_account_state", {}); accountDatabaseError(error); return parseResponse(cfAccountStateSchema, data); },
        async command(payload: Record<string, unknown>) {
            const signed = signTutorPayload({ operation: "cf_account", ...payload }, userId, cfSigningSecret());
            const { data, error } = await client.rpc("cf_account_command", signed);
            if (error?.code === "42501") throw new ApiError(503, "CF_SYNC_NOT_CONFIGURED", "Codeforces 签名配置不匹配。");
            accountDatabaseError(error); return parseResponse(internalResponse, data);
        },
    };
}
export type CfAccountRepository = ReturnType<typeof cfAccountRepository>;
