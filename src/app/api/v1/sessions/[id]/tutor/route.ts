import { z } from "zod";
import { requireContext } from "@/server/auth";
import { routeId } from "@/server/api";
import { ApiError, handle, json, readJson } from "@/server/http";
import { tutorRequestSchema } from "@/lib/validation/m2";
import { tutorRepository } from "@/server/tutor/repository";
import { readTutorConfig, requireTutorConfig } from "@/server/tutor/config";
import { runTutor } from "@/server/tutor/orchestrator";
export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return handle(async () => {
    const { client, user } = await requireContext();
    const id = await routeId(context);
    const query = z
      .object({
        before: z.coerce.number().int().positive().max(2147483647).optional(),
      })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const repo = tutorRepository(client, user.id);
    const [state, messages] = await Promise.all([
      repo.state(id),
      repo.history(id, query.before),
    ]);
    const config = readTutorConfig();
    return json({
      state: {
        ...state,
        configured: Boolean(config),
        limit: config?.dailyLimit ?? 0,
        configurationMessage: config
          ? ""
          : "AI 未配置：请在服务端设置模型、API Key 和 Tutor RPC 签名密钥。",
      },
      messages,
      nextBefore: messages.length === 50 ? messages[0]!.ordinal : null,
    });
  });
}
export function POST(request: Request, context: Context) {
  return handle(async () => {
    const { client, user } = await requireContext();
    const id = await routeId(context);
    const input = await readJson(request, tutorRequestSchema);
    const repo = tutorRepository(client, user.id);
    const session = await repo.getSession(id);
    // Policy errors remain authoritative even when no model credentials exist.
    if (session.mode === "contest")
      throw new ApiError(
        403,
        "CONTEST_AI_DISABLED",
        "比赛模式禁止题目相关 AI 辅助。",
      );
    if (session.status === "completed")
      throw new ApiError(
        409,
        "SESSION_COMPLETED",
        "已完成的训练不能继续请求 AI。",
      );
    if (input.action === "explain" && (await repo.state(id)).allowedLevel !== 5)
      throw new ApiError(403, "L5_REQUIRED", "完整解析需要 L5 二次明确确认。");
    const config = requireTutorConfig();
    const result = await runTutor(repo, config, id, input, request.signal);
    return json({
      ...result,
      state: {
        ...result.state,
        configured: true,
        limit: config.dailyLimit,
        configurationMessage: "",
      },
    });
  });
}
