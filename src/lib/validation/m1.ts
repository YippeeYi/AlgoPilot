import { z } from "zod";

export const idSchema = z.uuid();
export const outcomeSchema = z.enum([
  "not_recorded",
  "solved_self_reported",
  "unsolved",
  "abandoned",
]);
export const createProblemSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    statement: z.string().max(64_000).default(""),
    requestId: idSchema,
  })
  .strict();
export const createSessionSchema = z
  .object({
    problemId: idSchema.optional(),
    statementSnapshot: z.string().max(64_000).optional(),
    timerEnabled: z.boolean().optional(),
    mode: z.enum(["practice", "contest"]).default("practice"),
    requestId: idSchema,
  })
  .strict();
const revisionSchema = z.number().int().min(0).max(2_147_483_646);
export const transitionSchema = z
  .object({
    action: z.enum(["pause", "resume", "finish"]),
    expectedRevision: revisionSchema,
    outcome: outcomeSchema.optional(),
  })
  .strict()
  .refine((v) =>
    v.action === "finish" ? v.outcome !== undefined : v.outcome === undefined,
  );
export const saveDraftSchema = z
  .object({ content: z.string().max(64_000), expectedRevision: revisionSchema })
  .strict();
export const appendThoughtSchema = saveDraftSchema
  .extend({ content: z.string().min(1).max(64_000), requestId: idSchema })
  .strict();
export const listSchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();
export const loginSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(128),
    next: z.string().max(2048).optional(),
  })
  .strict();
export const registerSchema = loginSchema
  .extend({ password: z.string().min(8).max(128) })
  .strict();

export const sessionSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  problem_id: idSchema.nullable(),
  statement_snapshot: z.string(),
  mode: z.enum(["practice", "contest"]),
  phase: z.enum(["thinking", "implementing", "checking", "finished"]),
  status: z.enum(["active", "paused", "completed"]),
  started_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  active_seconds: z.number().int().nonnegative(),
  resumed_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  state_revision: z.number().int().nonnegative(),
  code_draft: z.string(),
  code_revision: z.number().int().nonnegative(),
  thought_draft: z.string(),
  thought_revision: z.number().int().nonnegative(),
  outcome: outcomeSchema.nullable(),
});
export const problemSchema = z.object({
  id: idSchema,
  platform: z.enum(["custom", "codeforces"]),
  title: z.string(),
  statement: z.string().nullable(),
  rating: z.number().nullable(),
  created_at: z.string(),
});
export const thoughtSchema = z.object({
  id: idSchema,
  session_id: idSchema,
  version: z.number().int().positive(),
  content: z.string(),
  created_at: z.string(),
});
export type TrainingSession = z.infer<typeof sessionSchema>;
export type Problem = z.infer<typeof problemSchema>;
export type Thought = z.infer<typeof thoughtSchema>;
