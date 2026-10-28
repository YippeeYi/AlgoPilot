import {z} from 'zod';
import {skillFocusSchema,skillWindowSchema} from './learning';
import {idSchema,outcomeSchema} from './m1';
export const trackingSchema=z.object({available:z.boolean(),items:z.array(z.object({id:idSchema,problemId:idSchema})).max(5)});
export type TrackingResult=z.infer<typeof trackingSchema>;
export const trainingChoiceSchema=z.object({id:idSchema,action:z.enum(['start','skip'])}).strict();
export const feedbackQuerySchema=z.object({window:skillWindowSchema.default('30'),sessionId:idSchema.optional()}).strict();
export const trainingChoiceResultSchema=z.object({sessionId:idSchema.nullable(),resumed:z.boolean()});
export const trainingFeedbackSchema=z.object({available:z.boolean(),total:z.number().int().nonnegative(),asOf:z.string(),items:z.array(z.object({
  id:idSchema,runId:idSchema,problemId:idSchema,contestId:z.number(),index:z.string(),issuedAt:z.string(),
  focus:skillFocusSchema.nullable(),baseline:z.object({samples:z.number(),concerns:z.number(),solved:z.number()}).nullable(),
  skippedAt:z.string().nullable(),chosenAt:z.string().nullable(),sessionId:idSchema.nullable(),originated:z.boolean(),
  sessionStatus:z.enum(['active','paused','completed']).nullable(),outcome:outcomeSchema.nullable(),endedAt:z.string().nullable(),
  official:z.enum(['disabled','not_synced','observed_ok','not_observed']),officialSyncedAt:z.string().nullable(),
})).max(200)});
export type TrainingFeedback=z.infer<typeof trainingFeedbackSchema>;
export type TrainingFeedbackItem=TrainingFeedback['items'][number];
