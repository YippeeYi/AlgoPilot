import { describe, expect, it, vi } from "vitest";
import { readTutorConfig, type TutorConfig } from "@/server/tutor/config";
import {
  OpenAICompatibleProvider,
  reasoningEffort,
} from "@/server/tutor/provider";
import { auditOutput } from "@/server/tutor/audit";
const env = {
  LLM_PROVIDER: "openai-compatible",
  LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
  LLM_MODEL: "gemini-3.8-flash",
  LLM_API_KEY: "fixture-key-not-real",
  TUTOR_RPC_SIGNING_SECRET: "ab".repeat(32),
};
const config = readTutorConfig(env)!;
const text = JSON.stringify({
  disclosureLevel: 0,
  focus: "proof",
  quote: "每次选最小值",
  content: "",
});
const messages = [{ role: "user" as const, content: "已有思路" }];
const usage = { prompt_tokens: 9, completion_tokens: 62, total_tokens: 710 };
function response(tokens: unknown = usage, content = text) {
  return new Response(
    JSON.stringify({
      model: "gemini-3.8-flash",
      usage: tokens,
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content,
            thought_signature: "private-signature",
            reasoning_content: "private-thoughts",
          },
        },
      ],
    }),
  );
}
describe("Gemini compatibility (HTTP fixtures, no real provider)", () => {
  it("rejects Gemini combined generation beyond the configured budget while retaining raw usage", async () => {
    await expect(
      new OpenAICompatibleProvider(
        { ...config, maxOutputTokens: 100 },
        vi.fn<typeof fetch>().mockResolvedValue(response()),
      ).complete(messages),
    ).rejects.toMatchObject({
      code: "LLM_INVALID_RESPONSE",
      usage: [
        expect.objectContaining({
          totalTokens: 710,
          outputTokens: 62,
          status: "rejected",
          costUsd: null,
        }),
      ],
    });
  });
  it("preserves vendor 9/62/710, never invents reasoning classification or a partial output cost", async () => {
    const result = await new OpenAICompatibleProvider(
      { ...config, inputPrice: 1, outputPrice: 2 },
      vi.fn<typeof fetch>().mockResolvedValue(response()),
    ).complete(messages);
    expect(result.usage[0]).toMatchObject({
      inputTokens: 9,
      outputTokens: 62,
      totalTokens: 710,
      costUsd: null,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-signature|private-thoughts|reasoningTokens|reasoning_tokens/,
    );
    expect(
      auditOutput(result.text, {
        allowedLevel: 0,
        action: "chat",
        thought: "每次选最小值",
        previousAssistant: [],
        secrets: [env.LLM_API_KEY, env.TUTOR_RPC_SIGNING_SECRET],
      }),
    ).toMatchObject({ disclosureLevel: 0 });
  });
  it.each([
    { ...usage, prompt_tokens: -1 },
    { ...usage, completion_tokens: 1.5 },
    { ...usage, total_tokens: "710" },
    { ...usage, total_tokens: 70 },
    { ...usage, total_tokens: 100000001 },
    { ...usage, prompt_tokens: null },
    { ...usage, total_tokens: null },
    { prompt_tokens: 9, total_tokens: 710 },
  ])(
    "rejects malformed/contradictory/unbounded counters: %j",
    async (tokens) => {
      await expect(
        new OpenAICompatibleProvider(
          config,
          vi.fn<typeof fetch>().mockResolvedValue(response(tokens)),
        ).complete(messages),
      ).rejects.toMatchObject({ code: "LLM_INVALID_RESPONSE" });
    },
  );
  it("extra usage also prevents underpricing on generic gateways; Gemini cost stays unknown even for additive totals", async () => {
    for (const c of [{ ...config, apiProfile: "generic" as const }, config]) {
      const result = await new OpenAICompatibleProvider(
        { ...c, inputPrice: 1, outputPrice: 2 },
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            response(
              c.apiProfile === "gemini"
                ? { ...usage, total_tokens: 71 }
                : usage,
            ),
          ),
      ).complete(messages);
      expect(result.usage[0]?.costUsd).toBeNull();
    }
  });
  it("uses opt-in Gemini low effort and JSON schema without leaking signatures or requesting thoughts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    await new OpenAICompatibleProvider(config, fetcher).complete(
      messages,
      undefined,
      { action: "validate", allowedLevel: 0 },
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({
      reasoning_effort: "low",
      max_tokens: 4096,
      response_format: {
        type: "json_schema",
        json_schema: { strict: true, schema: { additionalProperties: false } },
      },
    });
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(body).not.toHaveProperty("extra_body");
    // Structured output never replaces semantic disclosure auditing.
    expect(() =>
      auditOutput(
        JSON.stringify({
          disclosureLevel: 0,
          focus: "proof",
          quote: "",
          content: "使用动态规划",
        }),
        {
          allowedLevel: 0,
          action: "chat",
          thought: "",
          previousAssistant: [],
          secrets: [],
        },
      ),
    ).toThrow();
  });
  it("generic endpoints receive neither Gemini parameters nor unsolicited structured-output requirements", async () => {
    const generic = readTutorConfig({
      ...env,
      LLM_BASE_URL: "https://fixture.invalid/v1",
    })!;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    await new OpenAICompatibleProvider(generic, fetcher).complete(messages);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("response_format");
    expect(body.max_completion_tokens).toBe(1200);
    expect(
      readTutorConfig({ ...env, LLM_API_PROFILE: "generic" })?.apiProfile,
    ).toBe("generic");
  });
  it("effort respects low levels, action, configured ceiling and high-output budget", () => {
    const high: TutorConfig = { ...config, reasoningEffort: "high" };
    for (const level of [0, 1])
      for (const action of [
        "chat",
        "validate",
        "counterexample",
        "complexity",
      ] as const)
        expect(reasoningEffort(high, { action, allowedLevel: level })).toBe(
          "low",
        );
    expect(reasoningEffort(high, { action: "chat", allowedLevel: 5 })).toBe(
      "low",
    );
    expect(reasoningEffort(high, { action: "validate", allowedLevel: 2 })).toBe(
      "medium",
    );
    expect(
      reasoningEffort(high, { action: "complexity", allowedLevel: 3 }),
    ).toBe("medium");
    expect(reasoningEffort(high, { action: "explain", allowedLevel: 5 })).toBe(
      "high",
    );
    expect(
      reasoningEffort(
        { ...high, maxOutputTokens: 1200 },
        { action: "counterexample", allowedLevel: 3 },
      ),
    ).toBe("medium");
    expect(
      reasoningEffort(
        { ...high, reasoningEffort: "medium" },
        { action: "explain", allowedLevel: 5 },
      ),
    ).toBe("medium");
    expect(
      reasoningEffort(config, { action: "explain", allowedLevel: 5 }),
    ).toBe("low");
  });
  it("validates timeout/effort and honors explicit output/token/format choices", () => {
    expect(readTutorConfig({ ...env, LLM_TIMEOUT_MS: "0" })).toBeNull();
    expect(readTutorConfig({ ...env, LLM_TIMEOUT_MS: "120001" })).toBeNull();
    expect(
      readTutorConfig({ ...env, LLM_REASONING_EFFORT: "unlimited" }),
    ).toBeNull();
    expect(
      readTutorConfig({
        ...env,
        LLM_TIMEOUT_MS: "90000",
        LLM_MAX_OUTPUT_TOKENS: "6000",
        LLM_TOKEN_PARAMETER: "max_completion_tokens",
        LLM_RESPONSE_FORMAT: "none",
      }),
    ).toMatchObject({
      timeoutMs: 90000,
      maxOutputTokens: 6000,
      tokenParameter: "max_completion_tokens",
      responseFormat: "none",
    });
  });
  it("configured timeout cancels one request and does not retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("fixture-timeout")),
            { once: true },
          );
        }),
    );
    await expect(
      new OpenAICompatibleProvider(
        { ...config, timeoutMs: 10 },
        fetcher,
      ).complete(messages),
    ).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("exhausted route budget prevents calls; backoff shares the bounded lifetime", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(
      new OpenAICompatibleProvider(config, fetcher).complete(
        messages,
        undefined,
        { action: "chat", allowedLevel: 0, deadlineAt: Date.now() + 49000 },
      ),
    ).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(new Response("busy", { status: 429 }));
    await expect(
      new OpenAICompatibleProvider(config, fetcher).complete(
        messages,
        undefined,
        { action: "chat", allowedLevel: 0, deadlineAt: Date.now() + 50030 },
      ),
    ).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
