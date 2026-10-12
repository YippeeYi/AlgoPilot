import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";
import {
  problemSchema,
  sessionSchema,
  thoughtSchema,
} from "@/lib/validation/m1";
import { ApiError, databaseError } from "@/server/http";

const sessionFields =
  "id,user_id,problem_id,statement_snapshot,mode,phase,status,started_at,created_at,updated_at,active_seconds,resumed_at,ended_at,state_revision,code_draft,code_revision,thought_draft,thought_revision,outcome";
const problemFields = "id,platform,title,statement,rating,created_at";
const thoughtFields = "id,session_id,version,content,created_at";

export function trainingRepository(
  client: SupabaseClient<Database>,
  userId: string,
) {
  return {
    async list(offset = 0, limit = 30) {
      const { data, error } = await client
        .from("training_sessions")
        .select(sessionFields)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + limit - 1);
      databaseError(error);
      return z.array(sessionSchema).parse(data);
    },
    async get(id: string) {
      const { data, error } = await client
        .from("training_sessions")
        .select(sessionFields)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      databaseError(error);
      if (!data) throw new ApiError(404, "NOT_FOUND", "未找到可访问的训练。");
      return sessionSchema.parse(data);
    },
    async problems(offset = 0, limit = 30) {
      const { data, error } = await client
        .from("problems")
        .select(problemFields)
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + limit - 1);
      databaseError(error);
      return z.array(problemSchema).parse(data);
    },
    async problem(id: string) {
      const { data, error } = await client
        .from("problems")
        .select(problemFields)
        .eq("id", id)
        .maybeSingle();
      databaseError(error);
      return data ? problemSchema.parse(data) : null;
    },
    async createProblem(input: {
      title: string;
      statement: string;
      requestId: string;
    }) {
      const { data, error } = await client.rpc("create_custom_problem", {
        p_title: input.title,
        p_statement: input.statement,
        p_request_id: input.requestId,
      });
      databaseError(error);
      return problemSchema.parse(data?.[0]);
    },
    async create(input: {
      problemId?: string;
      statementSnapshot?: string;
      mode: string;
      requestId: string;
    }) {
      const { data, error } = await client.rpc("create_training_session", {
        p_problem_id: input.problemId ?? null,
        p_statement: input.statementSnapshot ?? null,
        p_mode: input.mode,
        p_request_id: input.requestId,
      });
      databaseError(error);
      return sessionSchema.parse(data?.[0]);
    },
    async transition(
      id: string,
      input: { action: string; expectedRevision: number; outcome?: string },
    ) {
      await this.get(id);
      const { data, error } = await client.rpc("transition_training_session", {
        p_id: id,
        p_action: input.action,
        p_expected_revision: input.expectedRevision,
        p_outcome: input.outcome ?? null,
      });
      databaseError(error);
      return sessionSchema.parse(data?.[0]);
    },
    async draft(
      id: string,
      kind: "code" | "thought",
      input: { content: string; expectedRevision: number },
    ) {
      await this.get(id);
      const { data, error, status } = await client.rpc("save_training_draft", {
        p_id: id,
        p_kind: kind,
        p_content: input.content,
        p_expected_revision: input.expectedRevision,
      });
      databaseError(error, { operation: "save_training_draft", status });
      return sessionSchema.parse(data?.[0]);
    },
    async thoughts(id: string, offset = 0, limit = 30) {
      await this.get(id);
      const { data, error } = await client
        .from("thought_snapshots")
        .select(thoughtFields)
        .eq("session_id", id)
        .order("version", { ascending: false })
        .range(offset, offset + limit - 1);
      databaseError(error);
      return z.array(thoughtSchema).parse(data);
    },
    async append(
      id: string,
      input: { content: string; expectedRevision: number; requestId: string },
    ) {
      await this.get(id);
      const { data, error } = await client.rpc("append_training_thought", {
        p_id: id,
        p_content: input.content,
        p_expected_revision: input.expectedRevision,
        p_request_id: input.requestId,
      });
      databaseError(error);
      return z
        .object({ session: sessionSchema, thought: thoughtSchema })
        .parse(data);
    },
  };
}
