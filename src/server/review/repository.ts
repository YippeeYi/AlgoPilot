import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createReviewSchema, reviewSchema, reviewResultSchema } from "@/lib/validation/review";
import { ApiError, databaseError } from "@/server/http";
import { signTutorPayload } from "@/server/tutor/repository";
function check(error: {
    code?: string;
} | null) {
    const codes: Record<string, [
        number,
        string,
        string
    ]> = {
        AP001: [403, "CONTEST_AI_DISABLED", "比赛模式禁止 AI 复盘。"],
        AP003: [429, "DAILY_LIMIT_REACHED", "今日 AI 请求额度已用完（UTC）。"],
        AP004: [409, "TUTOR_BUSY", "已有 AI 请求正在进行。"],
        AP006: [409, "REVIEW_REQUEST_FAILED", "上次请求已结束，请重新生成。"],
    };
    if (error?.code && codes[error.code]) {
        const [s, c, m] = codes[error.code]!;
        throw new ApiError(s, c, m);
    }
    if (error?.code === "42501")
        throw new ApiError(503, "REVIEW_STORAGE_NOT_CONFIGURED", "请检查复盘迁移与服务端签名配置。");
    databaseError(error);
}
const columns = "id,user_id,session_id,problem_id,problem_url,statement_snapshot,code_snapshot,code_hash,source,file_name,submission_id,verdict_source,official_verdict,source_match,authorization_event,notes,revision,created_at,edited_at";
export function reviewRepository(client: SupabaseClient<Database>, userId: string) {
    return {
        async hasRequest(id: string, requestId: string) {
            await this.get(id);
            const { data, error } = await client.from("review_requests").select("id")
                .eq("review_id", id).eq("id", requestId).maybeSingle();
            check(error);
            if (!data) return false;
            z.object({ id: z.uuid() }).parse(data);
            return true;
        },
        async list() {
            const { data, error } = await client.from("code_reviews").select(columns).eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
            check(error);
            return z.array(reviewSchema).parse(data);
        },
        async get(id: string) {
            const { data, error } = await client.from("code_reviews").select(columns).eq("id", id).eq("user_id", userId).maybeSingle();
            check(error);
            if (!data)
                throw new ApiError(404, "NOT_FOUND", "未找到可访问的复盘。");
            return reviewSchema.parse(data);
        },
        async results(id: string) {
            await this.get(id);
            const { data, error } = await client.from("review_requests").select("id,review_id,question,analysis,model,prompt_version,created_at").eq("review_id", id).eq("status", "completed").order("created_at", { ascending: false }).limit(30);
            check(error);
            return z.array(reviewResultSchema).parse(data);
        },
        async create(input: z.infer<typeof createReviewSchema>, problemId?: string) {
            const { data, error } = problemId ? await client.rpc("create_cf_review", {p_problem_id:problemId,p_input:input}) : await client.rpc("create_code_review", { p_input: input });
            check(error);
            return this.get(z.uuid().parse(data));
        },
        async edit(id: string, revision: number, notes: string) {
            const { error } = await client.rpc("edit_code_review", { p_id: id, p_revision: revision, p_notes: notes });
            check(error);
            return this.get(id);
        },
        async reserve(payload: Record<string, unknown>, secret: string) {
            const { data, error } = await client.rpc("review_reserve", signTutorPayload(payload, userId, secret));
            check(error);
            return z.object({ cached: z.boolean(), leaseNonce: z.uuid().optional() }).parse(data);
        },
        async finish(payload: Record<string, unknown>, secret: string) {
            const { data, error } = await client.rpc("review_finish", signTutorPayload(payload, userId, secret));
            check(error);
            return z.object({ accepted: z.boolean() }).parse(data);
        },
    };
}
export type ReviewRepository = ReturnType<typeof reviewRepository>;
