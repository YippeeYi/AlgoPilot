import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/http";
import { generationDenialCodeSchema, type GenerationDenialCode } from "@/lib/validation/generation";
import type { TutorConfig } from "@/server/tutor/config";
import type { UsageAttempt } from "@/server/tutor/provider";

export type GenerationScope = {
  operation: "tutor" | "review";
  userId: string;
  resourceId: string;
  requestId: string;
};
export type GenerationDecision =
  | { allowed: false; code: GenerationDenialCode }
  | { allowed: true; mode: "offline-mock" | "verified-free" };
/** Trusted server dependency, never constructed from a request body or environment claims. */
export interface GenerationPolicy {
  check(scope?: GenerationScope): GenerationDecision;
}

const messages: Record<GenerationDenialCode, string> = {
  LLM_FREE_TIER_UNVERIFIED: "免费资格尚未获得可信验证",
  LLM_GATE_CONFIG_INVALID: "生成门禁配置缺失或无效",
  LLM_EVIDENCE_INVALID: "免费资格证据无效",
  LLM_EVIDENCE_EXPIRED: "免费资格证据已失效或过期",
  LLM_EVIDENCE_SCOPE_MISMATCH: "项目或凭据与资格证据不匹配",
  LLM_PAID_TIER_DENIED: "禁止使用付费层级",
  LLM_MODEL_NOT_APPROVED: "Provider 或模型不在批准范围内",
  LLM_QUALIFICATION_CHECK_FAILED: "免费资格检查失败",
  LLM_EXECUTION_UNAUTHORIZED: "缺少当前请求的独立执行授权",
};
export class GenerationGateError extends ApiError {
  // Only prior, actually dispatched attempts may be attached by the Provider.
  usage: UsageAttempt[] = [];
  constructor(code: GenerationDenialCode) {
    super(403, code, `AI 生成已阻止：${messages[code]}。草稿与历史保留。`);
  }
}
export function assertGenerationAllowed(policy: GenerationPolicy, scope?: GenerationScope) {
  let decision: GenerationDecision;
  try { decision = policy.check(scope); }
  catch { throw new GenerationGateError("LLM_QUALIFICATION_CHECK_FAILED"); }
  if (!decision || (decision.allowed !== true && decision.allowed !== false) ||
      (decision.allowed && !["offline-mock", "verified-free"].includes(decision.mode)) ||
      (!decision.allowed && !generationDenialCodeSchema.safeParse(decision.code).success))
    throw new GenerationGateError("LLM_QUALIFICATION_CHECK_FAILED");
  if (!decision.allowed) throw new GenerationGateError(decision.code);
}

const target = z.object({
  provider: z.string().min(1).max(100),
  baseUrl: z.url().refine(value => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
  }),
  model: z.string().min(1).max(200),
  projectRef: z.string().min(1).max(200).nullable(),
  credentialRef: z.string().min(1).max(200).nullable(),
}).strict();
const binding = target.extend({ projectRef: z.string().min(1).max(200), credentialRef: z.string().min(1).max(200) });
const validity = { observedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative() };
const evidence = z.object({
  binding, ...validity,
  tier: z.enum(["free", "paid", "unknown"]),
  billingMode: z.enum(["hard-free-only", "paid-fallback", "unknown"]),
  evidenceRef: z.string().min(1).max(200),
}).strict();
const grant = z.object({
  binding, ...validity,
  scope: z.object({ operation: z.enum(["tutor", "review"]), userId: z.uuid(), resourceId: z.uuid(), requestId: z.uuid() }).strict(),
  grantRef: z.string().min(1).max(200),
  revoked: z.boolean(),
}).strict();
export const qualificationMaxAgeMs = 15 * 60_000;
export const executionMaxAgeMs = 5 * 60_000;
type Verification = { state: "unavailable" | "error" } | { state: "verified"; value: unknown };
export type FreeTierPolicyInput = {
  subject: unknown;
  approved: unknown;
  // "verified" is the contract of an independent verifier, NOT a raw JSON/env claim.
  // No real verifier or grant authority is installed in this release.
  qualification: Verification;
  authorization: Verification;
  scope?: GenerationScope;
  now: number;
};
const sameBinding = (a: z.infer<typeof target>, b: z.infer<typeof target>) =>
  a.provider === b.provider && a.baseUrl === b.baseUrl && a.model === b.model &&
  a.projectRef === b.projectRef && a.credentialRef === b.credentialRef;
function validAt(value: z.infer<typeof evidence> | z.infer<typeof grant>, now: number, maxAge: number) {
  return value.observedAt <= now && value.expiresAt > now && value.expiresAt > value.observedAt &&
    value.expiresAt - value.observedAt <= maxAge && now - value.observedAt <= maxAge;
}
/** Pure decision model for offline verification. An allow result is not a runtime permit. */
export function evaluateFreeTierPolicy(input: FreeTierPolicyInput): GenerationDecision {
  const deny = (code: GenerationDenialCode): GenerationDecision => ({ allowed: false, code });
  if (!input || !input.qualification || !input.authorization) return deny("LLM_GATE_CONFIG_INVALID");
  const subject = target.safeParse(input.subject);
  if (!subject.success || !Number.isSafeInteger(input.now) || input.now < 0) return deny("LLM_GATE_CONFIG_INVALID");
  if (input.qualification.state === "error") return deny("LLM_QUALIFICATION_CHECK_FAILED");
  if (input.qualification.state !== "verified") return deny("LLM_FREE_TIER_UNVERIFIED");
  const checked = evidence.safeParse(input.qualification.value);
  if (!checked.success) return deny("LLM_EVIDENCE_INVALID");
  if (checked.data.tier === "paid" || checked.data.billingMode === "paid-fallback") return deny("LLM_PAID_TIER_DENIED");
  if (checked.data.tier !== "free" || checked.data.billingMode !== "hard-free-only") return deny("LLM_FREE_TIER_UNVERIFIED");
  if (!validAt(checked.data, input.now, qualificationMaxAgeMs)) return deny("LLM_EVIDENCE_EXPIRED");
  if (!sameBinding(subject.data, checked.data.binding)) return deny("LLM_EVIDENCE_SCOPE_MISMATCH");
  const approved = z.array(binding).max(20).safeParse(input.approved);
  if (!approved.success) return deny("LLM_GATE_CONFIG_INVALID");
  if (!approved.data.some(row => sameBinding(row, subject.data))) return deny("LLM_MODEL_NOT_APPROVED");
  if (input.authorization.state === "error") return deny("LLM_QUALIFICATION_CHECK_FAILED");
  if (input.authorization.state !== "verified") return deny("LLM_EXECUTION_UNAUTHORIZED");
  const authorized = grant.safeParse(input.authorization.value);
  if (!authorized.success || !input.scope || authorized.data.revoked ||
      !validAt(authorized.data, input.now, executionMaxAgeMs) || !sameBinding(subject.data, authorized.data.binding) ||
      Object.entries(authorized.data.scope).some(([key, value]) => input.scope?.[key as keyof GenerationScope] !== value))
    return deny("LLM_EXECUTION_UNAUTHORIZED");
  return { allowed: true, mode: "verified-free" };
}

/** No evidence/grant importer, env override, network verifier or live allow path. */
export function productionGenerationPolicy(config: TutorConfig): GenerationPolicy {
  return Object.freeze({ check: () => evaluateFreeTierPolicy({
    subject: { provider: config.provider, baseUrl: config.baseUrl, model: config.model, projectRef: null, credentialRef: null },
    approved: [], qualification: { state: "unavailable" }, authorization: { state: "unavailable" }, now: Date.now(),
  }) });
}
