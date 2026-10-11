import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/http";
const schema = z
  .object({
    provider: z.literal("openai-compatible"),
    baseUrl: z.url().refine((v) => {
      const u = new URL(v);
      return (
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
      );
    }),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1),
    signingSecret: z.string().regex(/^[a-fA-F0-9]{64,128}$/),
    dailyLimit: z.coerce.number().int().min(1).max(1000).default(30),
    maxInputChars: z.coerce.number().int().min(2000).max(64000).default(24000),
    maxOutputTokens: z.coerce.number().int().min(100).max(8000).default(1200),
    tokenParameter: z
      .enum(["max_completion_tokens", "max_tokens"])
      .default("max_completion_tokens"),
    inputPrice: z.coerce.number().min(0).max(1000).optional(),
    outputPrice: z.coerce.number().min(0).max(1000).optional(),
    apiProfile: z.enum(["generic", "gemini"]).optional(),
    reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
    responseFormat: z.enum(["none", "json_schema"]).optional(),
    timeoutMs: z.coerce.number().int().min(1000).max(120000).optional(),
  })
  .refine(
    (c) => !c.model.includes(c.apiKey) && !c.model.includes(c.signingSecret),
  );
export type TutorConfig = z.infer<typeof schema>;
export function readTutorConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TutorConfig | null {
  // Only Google's documented endpoint is auto-detected. Gateways opt in explicitly.
  let gemini = false;
  try {
    const url = new URL(env.LLM_BASE_URL ?? "");
    gemini =
      url.protocol === "https:" &&
      url.hostname === "generativelanguage.googleapis.com" &&
      url.pathname.replace(/\/$/, "") === "/v1beta/openai" &&
      Boolean(env.LLM_MODEL?.startsWith("gemini-"));
  } catch {
    /* Invalid URLs are rejected below without logging input. */
  }
  const profile = env.LLM_API_PROFILE || (gemini ? "gemini" : "generic");
  const r = schema.safeParse({
    provider: env.LLM_PROVIDER,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY,
    signingSecret: env.TUTOR_RPC_SIGNING_SECRET,
    dailyLimit: env.LLM_DAILY_REQUEST_LIMIT || undefined,
    maxInputChars: env.LLM_MAX_INPUT_CHARS || undefined,
    maxOutputTokens:
      env.LLM_MAX_OUTPUT_TOKENS || (profile === "gemini" ? 4096 : undefined),
    tokenParameter:
      env.LLM_TOKEN_PARAMETER ||
      (profile === "gemini" ? "max_tokens" : undefined),
    inputPrice: env.LLM_INPUT_USD_PER_MILLION_TOKENS || undefined,
    outputPrice: env.LLM_OUTPUT_USD_PER_MILLION_TOKENS || undefined,
    apiProfile: profile,
    reasoningEffort: env.LLM_REASONING_EFFORT || "low",
    responseFormat:
      env.LLM_RESPONSE_FORMAT ||
      (profile === "gemini" ? "json_schema" : "none"),
    timeoutMs: env.LLM_TIMEOUT_MS || (profile === "gemini" ? 60000 : 45000),
  });
  return r.success ? r.data : null;
}
export function requireTutorConfig() {
  const c = readTutorConfig();
  if (!c)
    throw new ApiError(
      503,
      "LLM_NOT_CONFIGURED",
      "AI 未配置：请在服务端设置模型、API Key 和 Tutor RPC 签名密钥，并应用 M2 迁移。",
    );
  return c;
}
