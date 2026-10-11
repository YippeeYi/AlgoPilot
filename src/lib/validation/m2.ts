import { z } from "zod";
import { idSchema } from "./m1";
export const tutorActionSchema = z.enum([
  "chat",
  "hint",
  "validate",
  "counterexample",
  "complexity",
  "debug",
  "explain",
]);
export type TutorAction = z.infer<typeof tutorActionSchema>;
export const tutorRequestSchema = z
  .object({
    action: tutorActionSchema,
    message: z.string().trim().min(1).max(6000),
    requestId: idSchema,
  })
  .strict();
export const hintRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("upgrade"),
      revision: z.number().int().min(0).max(2147483646),
      requestId: idSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("begin_l5"),
      revision: z.number().int().min(0).max(2147483646),
      requestId: idSchema,
      confirmation: z.literal("我确认申请完整解析"),
    })
    .strict(),
  z
    .object({
      operation: z.literal("confirm_l5"),
      revision: z.number().int().min(0).max(2147483646),
      requestId: idSchema,
      challengeId: idSchema,
      confirmation: z.literal("我确认完整解析会影响独立完成记录"),
    })
    .strict(),
]);
export const tutorMessageSchema = z.object({
  id: idSchema,
  session_id: idSchema,
  request_id: idSchema,
  ordinal: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  action: tutorActionSchema,
  content: z.string(),
  disclosure_level: z.number().int().min(0).max(5),
  verification: z.enum(["not_applicable", "unverified_candidate"]),
  prompt_version: z.string(),
  thought_revision: z.number().int().min(0).max(2147483646),
  code_revision: z.number().int().min(0).max(2147483646),
  created_at: z.string(),
});
export type TutorMessage = z.infer<typeof tutorMessageSchema>;
export const tutorStateSchema = z.object({
  allowedLevel: z.number().int().min(0).max(5),
  maxSeenLevel: z.number().int().min(0).max(5),
  revision: z.number().int().min(0).max(2147483646),
  used: z.number().int().nonnegative(),
});
export type TutorState = z.infer<typeof tutorStateSchema> & {
  configured: boolean;
  limit: number;
  configurationMessage: string;
};
export const modelOutputSchema = z
  .object({
    disclosureLevel: z.number().int().min(0).max(5),
    focus: z.enum([
      "premise",
      "proof",
      "boundary",
      "complexity",
      "trace",
      "invariant",
    ]),
    quote: z.string().max(240),
    content: z.string().max(16000),
  })
  .strict();
