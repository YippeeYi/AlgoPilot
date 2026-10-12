import "server-only";
import { createHash } from "node:crypto";
import { ApiError } from "@/server/http";
import type { TutorAction } from "@/lib/validation/m2";
import type { TutorRepository } from "./repository";
import type { TutorConfig } from "./config";
import {
  OpenAICompatibleProvider,
  ProviderError,
  type LLMProvider,
  type UsageAttempt,
} from "./provider";
import { buildPrompt, PROMPT_VERSION } from "./prompts";
import { auditOutput } from "./audit";
/** A single orchestrator. Database admission/finalization enforce durable policy and leases. */
export async function runTutor(
  repo: TutorRepository,
  config: TutorConfig,
  id: string,
  input: { action: TutorAction; message: string; requestId: string },
  signal?: AbortSignal,
  provider: LLMProvider = new OpenAICompatibleProvider(config),
  deadlineAt?: number,
) {
  const session = await repo.getSession(id);
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
  const state = await repo.state(id);
  if (input.action === "explain" && state.allowedLevel !== 5)
    throw new ApiError(403, "L5_REQUIRED", "完整解析需要 L5 二次明确确认。");
  const [history, versions] = await Promise.all([
    repo.history(id),
    repo.thoughts(id),
  ]);
  const context = {
    statement: session.statement_snapshot,
    thought: session.thought_draft,
    code: session.code_draft,
    versions: versions.map((v) => ({ version: v.version, content: v.content })),
    history: history
      .filter((m) => m.disclosure_level <= state.allowedLevel)
      .map((m) => ({ role: m.role, content: m.content })),
    allowedLevel: state.allowedLevel,
    action: input.action,
    message: input.message,
  };
  const messages = buildPrompt(context, config.maxInputChars);
  if (messages.reduce((n, m) => n + m.content.length, 0) > config.maxInputChars)
    throw new ApiError(
      413,
      "LLM_INPUT_TOO_LARGE",
      "题面与当前草稿超过模型输入限制，请缩短后再分析。",
    );
  const reserved = await repo.reserve(
    {
      operation: "reserve",
      sessionId: id,
      requestId: input.requestId,
      action: input.action,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      dailyLimit: config.dailyLimit,
      contextEvidence: {
        thought: session.thought_draft,
        code: ["debug", "complexity"].includes(input.action)
          ? session.code_draft
          : "",
        thoughtRevision: session.thought_revision,
        codeRevision: session.code_revision,
        thoughtVersions: versions.map((v) => ({
          id: v.id,
          version: v.version,
        })),
        promptVersion: PROMPT_VERSION,
      },
    },
    config.signingSecret,
  );
  if (reserved.cached)
    return {
      messages: await repo.history(id),
      state: await repo.state(id),
      cached: true,
    };
  if (!reserved.leaseNonce || reserved.allowedLevel === undefined)
    throw new ApiError(503, "INVALID_LEASE", "训练分析状态异常，请重新加载。");
  // Authorization is read at transactional admission, never taken from chat or client fields.
  context.allowedLevel = reserved.allowedLevel;
  const settlement = {
    operation: "finish",
    sessionId: id,
    requestId: input.requestId,
    leaseNonce: reserved.leaseNonce,
    userMessage: input.message,
    promptVersion: PROMPT_VERSION,
    thoughtRevision: session.thought_revision,
    codeRevision: session.code_revision,
  };
  let usage: UsageAttempt[] = [];
  try {
    const result = await provider.complete(
      buildPrompt(context, config.maxInputChars),
      signal,
      {
        action: input.action,
        allowedLevel: reserved.allowedLevel,
        hasThought: Boolean(session.thought_draft.trim()),
        deadlineAt,
      },
    );
    usage = result.usage;
    const audited = auditOutput(result.text, {
      allowedLevel: reserved.allowedLevel,
      action: input.action,
      thought: session.thought_draft,
      statement: session.statement_snapshot,
      message: input.message,
      previousAssistant: history
        .filter((m) => m.role === "assistant")
        .map((m) => m.content),
      secrets: [config.apiKey, config.signingSecret],
    });
    const finished = await repo.finish(
      { ...settlement, success: true, ...audited, usage },
      config.signingSecret,
    );
    if (!finished.accepted)
      throw new ApiError(
        409,
        "TUTOR_RESPONSE_DISCARDED",
        "训练状态已改变或请求过期，分析结果未展示。模型可能已经产生用量。",
      );
    const [messages, currentState] = await Promise.all([
      repo.history(id),
      repo.state(id),
    ]);
    return {
      messages,
      state: currentState,
      cached: false,
    };
  } catch (error) {
    if (error instanceof ProviderError) usage = error.usage;
    // No raw model text, upstream errors, prompt contents, keys, or reasoning persisted on failure.
    await repo.finish(
      {
        ...settlement,
        success: false,
        errorCode: error instanceof ApiError ? error.code : "TUTOR_FAILURE",
        usage: usage.map((u) => ({
          ...u,
          status: u.status === "success" ? "rejected" : u.status,
        })),
      },
      config.signingSecret,
    );
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "TUTOR_FAILURE", "AI 分析失败，未展示未审核内容。");
  }
}
