import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";
import { tutorMessageSchema, tutorStateSchema } from "@/lib/validation/m2";
import { ApiError, databaseError } from "@/server/http";
import { trainingRepository } from "@/server/db/training";
function tutorError(error: { code?: string } | null) {
  const errors: Record<string, [number, string, string]> = {
    AP001: [403, "CONTEST_AI_DISABLED", "比赛模式禁止题目相关 AI 辅助。"],
    AP002: [409, "SESSION_COMPLETED", "已完成的训练不能继续请求 AI。"],
    AP003: [
      429,
      "DAILY_LIMIT_REACHED",
      "今日 AI 请求额度已用完（UTC 次日重置）。",
    ],
    AP004: [409, "TUTOR_BUSY", "已有 AI 分析正在进行，请等待完成。"],
    AP005: [
      409,
      "L5_CONFIRMATION_EXPIRED",
      "完整解析确认已过期或已使用，请重新申请。",
    ],
    AP006: [
      409,
      "TUTOR_REQUEST_FAILED",
      "上次请求已结束，请用新的请求重新尝试。",
    ],
    AP007: [403, "L5_REQUIRED", "完整解析需要 L5 二次明确确认。"],
  };
  if (error?.code && errors[error.code]) {
    const [status, code, message] = errors[error.code]!;
    throw new ApiError(status, code, message);
  }
  if (error?.code === "42501")
    throw new ApiError(
      503,
      "TUTOR_STORAGE_NOT_CONFIGURED",
      "AI 可信记录写入未配置，请检查 M2 迁移、签名密钥及数据库额度上限。",
    );
  databaseError(error);
}
export function signTutorPayload(
  payload: Record<string, unknown>,
  userId: string,
  secret: string,
) {
  const p_payload = JSON.stringify({
    ...payload,
    userId,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });
  return {
    p_payload,
    p_signature: createHmac("sha256", secret).update(p_payload).digest("hex"),
  };
}
export function tutorRepository(
  client: SupabaseClient<Database>,
  userId: string,
) {
  const training = trainingRepository(client, userId);
  return {
    getSession: training.get.bind(training),
    thoughts: (id: string) => training.thoughts(id, 0, 3),
    async hasRequest(id: string, requestId: string) {
      await training.get(id);
      // Only existence is read; reserve remains authoritative for status and fingerprint.
      const { data, error } = await client.from("tutor_requests").select("id")
        .eq("session_id", id).eq("id", requestId).maybeSingle();
      tutorError(error);
      if (!data) return false;
      z.object({ id: z.uuid() }).parse(data);
      return true;
    },
    async state(id: string) {
      await training.get(id);
      const { data, error } = await client.rpc("tutor_state", { p_id: id });
      tutorError(error);
      return tutorStateSchema.parse(data);
    },
    async history(id: string, before?: number) {
      await training.get(id);
      let query = client
        .from("tutor_messages")
        .select(
          "id,session_id,request_id,ordinal,role,action,content,disclosure_level,verification,prompt_version,thought_revision,code_revision,created_at",
        )
        .eq("session_id", id)
        .order("ordinal", { ascending: false })
        .limit(50);
      if (before) query = query.lt("ordinal", before);
      const { data, error } = await query;
      tutorError(error);
      return z.array(tutorMessageSchema).parse(data).reverse();
    },
    async hint(
      id: string,
      input: {
        operation: string;
        revision: number;
        requestId: string;
        challengeId?: string;
      },
    ) {
      await training.get(id);
      const { data, error } = await client.rpc("tutor_hint", {
        p_id: id,
        p_operation: input.operation,
        p_revision: input.revision,
        p_request_id: input.requestId,
        p_challenge: input.challengeId ?? null,
      });
      tutorError(error);
      return z
        .object({
          allowedLevel: z.number().int().min(0).max(5),
          revision: z.number().int().nonnegative(),
          challengeId: z.uuid().optional(),
          expiresAt: z.string().optional(),
        })
        .parse(data);
    },
    async reserve(payload: Record<string, unknown>, secret: string) {
      const { data, error } = await client.rpc(
        "tutor_reserve",
        signTutorPayload(payload, userId, secret),
      );
      tutorError(error);
      return z
        .object({
          cached: z.boolean(),
          requestId: z.uuid(),
          leaseNonce: z.uuid().optional(),
          allowedLevel: z.number().int().min(0).max(5).optional(),
        })
        .parse(data);
    },
    async finish(payload: Record<string, unknown>, secret: string) {
      const { data, error } = await client.rpc(
        "tutor_finish",
        signTutorPayload(payload, userId, secret),
      );
      tutorError(error);
      return z.object({ accepted: z.boolean() }).parse(data);
    },
  };
}
export type TutorRepository = ReturnType<typeof tutorRepository>;
