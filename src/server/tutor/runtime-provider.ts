import "server-only";
import type { TutorConfig } from "./config";
import { OpenAICompatibleProvider } from "./provider";

export function createRuntimeProvider(config: TutorConfig) {
  return new OpenAICompatibleProvider(config);
}
