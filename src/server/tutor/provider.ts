import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/http";
import type { TutorConfig } from "./config";
import { modelOutputSchema, type TutorAction } from "@/lib/validation/m2";
export type CompletionOptions = {
  action: TutorAction;
  allowedLevel: number;
  hasThought?: boolean;
  // Absolute route deadline; leave time for authenticated database settlement.
  deadlineAt?: number;
};
export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type UsageAttempt = {
  attempt: number;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
  status: "success" | "rejected" | "timeout" | "error";
  costUsd: number | null;
};
export type LLMResult = { text: string; usage: UsageAttempt[] };
export interface LLMProvider {
  complete(
    messages: LLMMessage[],
    signal?: AbortSignal,
    options?: CompletionOptions,
  ): Promise<LLMResult>;
}
export class ProviderError extends ApiError {
  constructor(
    code: string,
    message: string,
    public usage: UsageAttempt[],
  ) {
    super(code === "LLM_TIMEOUT" ? 504 : 502, code, message);
  }
}
const tokenCount = z.number().int().nonnegative().max(100_000_000);
const envelope = z.object({
  model: z.string().min(1).max(200),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({
          role: z.literal("assistant"),
          content: z.string().nullable(),
        }),
      }),
    )
    .min(1)
    .max(1),
  usage: z
    .object({
      prompt_tokens: tokenCount,
      completion_tokens: tokenCount,
      total_tokens: tokenCount,
    })
    .refine((u) => u.total_tokens >= u.prompt_tokens + u.completion_tokens)
    .optional(),
});
async function boundedBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 2_000_000) {
      await reader.cancel();
      throw new Error("large");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
}
/** Configured effort is a ceiling, never permission to disclose more information. */
export function reasoningEffort(
  config: TutorConfig,
  options?: CompletionOptions,
) {
  const ceiling = config.reasoningEffort ?? "low";
  if (
    !options ||
    options.allowedLevel <= 1 ||
    ["chat", "hint"].includes(options.action)
  )
    return "low";
  if (
    ceiling === "high" &&
    config.maxOutputTokens >= 4096 &&
    ["counterexample", "explain"].includes(options.action)
  )
    return "high";
  if (
    ceiling !== "low" &&
    ["validate", "complexity", "counterexample", "explain"].includes(
      options.action,
    )
  )
    return "medium";
  return "low";
}
function responseSchema(options?: CompletionOptions) {
  const schema = z.toJSONSchema(modelOutputSchema);
  if (options && options.allowedLevel <= 1) {
    // Constrain formatting at generation as well as checking it in auditOutput.
    // No model prose is authorized at L0/L1; blank drafts cannot supply a quote.
    schema.properties!.content = { type: "string", enum: [""] };
    schema.properties!.disclosureLevel = {
      type: "integer",
      minimum: 0,
      maximum: options.allowedLevel,
    };
    if (options.hasThought === false)
      schema.properties!.quote = { type: "string", enum: [""] };
  }
  return schema;
}
export class OpenAICompatibleProvider implements LLMProvider {
  constructor(
    private config: TutorConfig,
    private fetcher: typeof fetch = fetch,
    private timeoutMs = config.timeoutMs ?? 45_000,
    private pause: (ms: number, signal?: AbortSignal) => Promise<void> = (
      ms,
      signal,
    ) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("cancelled"));
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        }, ms);
        const cancel = () => {
          clearTimeout(timer);
          reject(new Error("cancelled"));
        };
        signal?.addEventListener("abort", cancel, { once: true });
      }),
  ) {}
  async complete(
    messages: LLMMessage[],
    signal?: AbortSignal,
    options?: CompletionOptions,
  ): Promise<LLMResult> {
    if (
      !messages.length ||
      messages.reduce((n, m) => n + m.content.length, 0) >
        this.config.maxInputChars
    )
      throw new ApiError(
        413,
        "LLM_INPUT_TOO_LARGE",
        "上下文超过输入限制，请缩短题面或草稿。",
      );
    const usage: UsageAttempt[] = [];
    // Both attempts and backoff share one budget. DB lease is 180s; route is 180s.
    const remaining = Math.min(
      120000,
      (options?.deadlineAt ?? Infinity) - Date.now() - 50000,
    );
    if (remaining <= 0 || signal?.aborted)
      throw new ProviderError(
        "LLM_TIMEOUT",
        "模型请求已取消或超时，请稍后重试。",
        usage,
      );
    const budget = AbortSignal.timeout(Math.floor(remaining));
    const lifetime = signal ? AbortSignal.any([signal, budget]) : budget;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const combined = AbortSignal.any([lifetime, timeout]);
      let record: UsageAttempt = {
        attempt,
        model: this.config.model,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        durationMs: 0,
        status: "error",
        costUsd: null,
      };
      try {
        combined.throwIfAborted();
        const response = await this.fetcher(
          `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            redirect: "error",
            cache: "no-store",
            signal: combined,
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: this.config.model,
              messages,
              stream: false,
              [this.config.tokenParameter]: this.config.maxOutputTokens,
              ...(this.config.apiProfile === "gemini"
                ? { reasoning_effort: reasoningEffort(this.config, options) }
                : {}),
              ...(this.config.responseFormat === "json_schema"
                ? {
                    response_format: {
                      type: "json_schema",
                      json_schema: {
                        name: "tutor_response",
                        strict: true,
                        schema: responseSchema(options),
                      },
                    },
                  }
                : {}),
            }),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          record.durationMs = Date.now() - started;
          usage.push(record);
          if ([429, 503].includes(response.status) && attempt === 1) {
            await this.pause(350, lifetime);
            continue;
          }
          throw new ProviderError(
            "LLM_UPSTREAM_ERROR",
            "模型服务暂时拒绝请求，请稍后重试。",
            usage,
          );
        }
        const parsed = envelope.safeParse(await boundedBody(response));
        if (!parsed.success)
          throw new ProviderError(
            "LLM_INVALID_RESPONSE",
            "模型服务返回了不符合契约的响应。",
            usage,
          );
        const result = parsed.data;
        const tokens = result.usage;
        record = {
          ...record,
          model: [this.config.apiKey, this.config.signingSecret].some(
            (secret) => result.model.includes(secret),
          )
            ? "redacted-provider-model"
            : result.model,
          inputTokens: tokens?.prompt_tokens ?? null,
          outputTokens: tokens?.completion_tokens ?? null,
          totalTokens: tokens?.total_tokens ?? null,
          durationMs: Date.now() - started,
          status: "success",
          costUsd:
            tokens &&
            // Extra unclassified usage may be billable thinking. Never underprice it.
            tokens.total_tokens ===
              tokens.prompt_tokens + tokens.completion_tokens &&
            this.config.apiProfile !== "gemini" &&
            this.config.inputPrice !== undefined &&
            this.config.outputPrice !== undefined
              ? (tokens.prompt_tokens * this.config.inputPrice +
                  tokens.completion_tokens * this.config.outputPrice) /
                1_000_000
              : null,
        };
        usage.push(record);
        const choice = result.choices[0]!;
        if (
          record.model === "redacted-provider-model" ||
          (tokens && tokens.completion_tokens > this.config.maxOutputTokens) ||
          (tokens &&
            this.config.apiProfile === "gemini" &&
            tokens.total_tokens - tokens.prompt_tokens >
              this.config.maxOutputTokens) ||
          choice.finish_reason !== "stop" ||
          !choice.message.content ||
          choice.message.content.length > 24_000
        ) {
          record.status = "rejected";
          throw new ProviderError(
            "LLM_INVALID_RESPONSE",
            "模型输出不完整或过长，已拒绝展示。请检查输出预算；思考 token 可能占用预算。",
            usage,
          );
        }
        return { text: choice.message.content, usage };
      } catch (error) {
        if (!usage.some((u) => u.attempt === attempt)) {
          record.durationMs = Date.now() - started;
          record.status = combined.aborted ? "timeout" : "error";
          usage.push(record);
        }
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          combined.aborted ? "LLM_TIMEOUT" : "LLM_UPSTREAM_ERROR",
          combined.aborted
            ? "模型请求已取消或超时，请稍后重试。"
            : "模型服务连接失败，请检查配置后重试。",
          usage,
        );
      }
    }
    throw new ProviderError(
      "LLM_UPSTREAM_ERROR",
      "模型服务暂时无法响应。",
      usage,
    );
  }
}
/** Test injection only. Never selected by runtime configuration. */
export class MockProvider implements LLMProvider {
  calls: LLMMessage[][] = [];
  constructor(private result: LLMResult | Error) {}
  async complete(messages: LLMMessage[]) {
    this.calls.push(messages);
    if (this.result instanceof Error) throw this.result;
    return structuredClone(this.result);
  }
}
