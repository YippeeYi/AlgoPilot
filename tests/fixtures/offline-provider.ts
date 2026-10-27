// Explicit test dependencies. Never imported by the production runtime factory.
import { OpenAICompatibleProvider } from "@/server/tutor/provider";
import type { TutorConfig } from "@/server/tutor/config";
import type { GenerationPolicy } from "@/server/llm/execution-gate";

const offlinePolicy: GenerationPolicy = Object.freeze({ check: () => ({ allowed: true, mode: "offline-mock" } as const) });
export function offlineProvider(
  config: TutorConfig, fetcher: typeof fetch, timeoutMs?: number,
  pause?: (ms: number, signal?: AbortSignal) => Promise<void>,
) {
  if (fetcher === globalThis.fetch) throw new Error("Explicit in-memory fixture transport required");
  return new OpenAICompatibleProvider(config, fetcher, timeoutMs, pause, offlinePolicy);
}

export function createLoopbackFixtureProvider(config: TutorConfig) {
  if (config.baseUrl !== "http://127.0.0.1:54002/v1" || config.model !== "fixture-http-model" ||
      config.apiKey !== "fixture-llm-key-not-real" || config.signingSecret !== "ab".repeat(32))
    throw new Error("Only the isolated synthetic HTTP fixture is supported");
  const transport: typeof fetch = (url, init) => {
    if (url !== "http://127.0.0.1:54002/v1/chat/completions" || init?.redirect !== "error" ||
        new Headers(init.headers).get("Authorization") !== "Bearer fixture-llm-key-not-real" ||
        JSON.parse(String(init.body)).model !== "fixture-http-model")
      throw new Error("Offline fixture destination refused");
    return fetch(url, init);
  };
  return new OpenAICompatibleProvider(config, transport, undefined, undefined, offlinePolicy);
}
