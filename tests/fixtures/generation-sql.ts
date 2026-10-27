// Shared SQL adapter for synthetic tests, not Supabase/PostgREST integration evidence.
import type { TutorRepository } from "@/server/tutor/repository";
import type { ReviewRepository } from "@/server/review/repository";
import { signTutorPayload } from "@/server/tutor/repository";
import { sessionSchema, thoughtSchema } from "@/lib/validation/m1";
import { tutorMessageSchema, tutorStateSchema } from "@/lib/validation/m2";
import { reviewSchema, reviewResultSchema } from "@/lib/validation/review";
const q = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export type SqlRead = <T = unknown>(sql: string) => Promise<T>;
export function sqlGenerationRepositories(read: SqlRead, uid: string, secret: string) {
  const rpc = (name: string, p: Record<string, unknown>) => {
    const signed = signTutorPayload(p, uid, secret);
    return read(`select public.${name}(${q(signed.p_payload)},${q(signed.p_signature)})`);
  };
  const history = async (id: string) => tutorMessageSchema.array().parse(await read(`select coalesce(json_agg(m order by ordinal),'[]') from public.tutor_messages m where session_id=${q(id)}`));
  const results = async (id: string) => reviewResultSchema.array().parse(await read(`select coalesce(json_agg(m order by created_at desc),'[]') from (select id,review_id,question,analysis,model,prompt_version,created_at from public.review_requests where review_id=${q(id)} and status='completed') m`));
  return {
    tutor: { getSession: async (id: string) => sessionSchema.parse(await read(`select to_jsonb(s) from public.training_sessions s where id=${q(id)}`)),
      thoughts: async (id: string) => thoughtSchema.array().parse(await read(`select coalesce(json_agg(t),'[]') from public.thought_snapshots t where session_id=${q(id)}`)),
      state: async (id: string) => tutorStateSchema.parse(await read(`select public.tutor_state(${q(id)})`)), history,
      hasRequest: async (id: string, rid: string) => read<boolean>(`select to_json(exists(select id from public.tutor_requests where session_id=${q(id)} and id=${q(rid)}))`),
      reserve: (p: Record<string, unknown>) => rpc("tutor_reserve", p), finish: (p: Record<string, unknown>) => rpc("tutor_finish", p) } as unknown as TutorRepository,
    review: { get: async (id: string) => reviewSchema.parse(await read(`select to_jsonb(r) from (select id,user_id,session_id,problem_id,problem_url,statement_snapshot,code_snapshot,code_hash,source,file_name,submission_id,verdict_source,official_verdict,source_match,authorization_event,notes,revision,created_at,edited_at from public.code_reviews where id=${q(id)}) r`)), results,
      hasRequest: async (id: string, rid: string) => read<boolean>(`select to_json(exists(select id from public.review_requests where review_id=${q(id)} and id=${q(rid)}))`),
      reserve: (p: Record<string, unknown>) => rpc("review_reserve", p), finish: (p: Record<string, unknown>) => rpc("review_finish", p) } as unknown as ReviewRepository,
  };
}
