import { z } from "zod";

export const generationDenialCodeSchema = z.enum([
  "LLM_FREE_TIER_UNVERIFIED",
  "LLM_GATE_CONFIG_INVALID",
  "LLM_EVIDENCE_INVALID",
  "LLM_EVIDENCE_EXPIRED",
  "LLM_EVIDENCE_SCOPE_MISMATCH",
  "LLM_PAID_TIER_DENIED",
  "LLM_MODEL_NOT_APPROVED",
  "LLM_QUALIFICATION_CHECK_FAILED",
  "LLM_EXECUTION_UNAUTHORIZED",
]);
export type GenerationDenialCode = z.infer<typeof generationDenialCodeSchema>;

export function isGenerationDenied(code: unknown): boolean {
  return generationDenialCodeSchema.safeParse(code).success;
}
