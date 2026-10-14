import type { CodeReview } from "@/lib/validation/review";
import type { TutorAction, TutorMessage } from "@/lib/validation/m2";
import type { TrainingSession, Problem, Thought } from "@/lib/validation/m1";

// 与 M1/M2 migrations 对齐；应用响应仍经过 Zod 与显式字段选择。
type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};
type ReadTable<Row> = Omit<Table<Row>, "Insert" | "Update"> & {
  Insert: never;
  Update: never;
};
type SessionRow = TrainingSession & {
  max_hint_seen: number;
  used_external_editorial: boolean | null;
  create_request_id: string;
};
type ProblemRow = Problem & {
  owner_id: string | null;
  contest_id: number | null;
  problem_index: string | null;
  tags: string[];
  canonical_url: string | null;
  create_request_id: string | null;
};
export type Database = {
  public: {
    Tables: {
      training_plans: ReadTable<import("@/lib/validation/m3").TrainingPlan & {user_id:string}>;
      code_reviews: ReadTable<CodeReview>;
      review_requests: ReadTable<{id:string;review_id:string;question:string;analysis:unknown;model:string|null;prompt_version:string|null;created_at:string;status:string}>;
      profiles: Table<{
        id: string;
        cf_handle: string | null;
        preferences: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>;
      problems: Table<ProblemRow>;
      training_sessions: Table<SessionRow>;
      thought_snapshots: Table<Thought & { request_id: string }>;
      tutor_messages: ReadTable<TutorMessage>;
      tutor_authorizations: ReadTable<{
        session_id: string;
        allowed_level: number;
        revision: number;
        updated_at: string;
      }>;
      hint_events: ReadTable<{
        id: string;
        session_id: string;
        request_id: string;
        kind: "authorization" | "l5_challenge" | "disclosure" | "full_reveal";
        level: number;
        created_at: string;
      }>;
      llm_usage: ReadTable<{
        id: string;
        request_id: string;
        attempt: number;
        provider: "openai-compatible";
        model: string;
        input_tokens: number | null;
        output_tokens: number | null;
        total_tokens: number | null;
        unclassified_tokens: number | null;
        duration_ms: number;
        status: "success" | "rejected" | "timeout" | "error";
        cost_usd: number | null;
        created_at: string;
      }>;
      tutor_requests: ReadTable<{
        id: string;
        user_id: string;
        session_id: string;
        fingerprint: string;
        context_evidence: Record<string, unknown>;
        action: TutorAction;
        allowed_level: number;
        status: "pending" | "completed" | "failed";
        lease_nonce: string;
        lease_until: string;
        error_code: string | null;
        created_at: string;
        finished_at: string | null;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      learning_evidence: {Args:Record<string, never>;Returns:unknown};
      learning_candidates: {Args:{p_query:unknown};Returns:unknown};
      learning_write: {Args:{p_input:unknown};Returns:unknown};
      cf_catalog: {Args:{p_query:unknown};Returns:unknown};
      cf_sync: {Args:{p_payload:string;p_signature:string};Returns:unknown};
      plan_write: {Args:{p_id:string;p_input:unknown};Returns:unknown};
      plan_detail: {Args:{p_id:string};Returns:unknown};
      start_cf_session: {Args:{p_input:unknown};Returns:SessionRow[]};
      supplement_cf_context: {Args:{p_id:string;p_content:string;p_revision:number;p_request_id:string};Returns:unknown};
      create_cf_review: {Args:{p_problem_id:string;p_input:unknown};Returns:unknown};
      create_code_review: {Args:{p_input: import("zod").infer<typeof import("@/lib/validation/review").createReviewSchema>};Returns:unknown};
      edit_code_review: {Args:{p_id:string;p_revision:number;p_notes:string};Returns:unknown};
      review_reserve: {Args:{p_payload:string;p_signature:string};Returns:unknown};
      review_finish: {Args:{p_payload:string;p_signature:string};Returns:unknown};
      tutor_state: { Args: { p_id: string }; Returns: unknown };
      tutor_hint: {
        Args: {
          p_id: string;
          p_operation: string;
          p_revision: number;
          p_request_id: string;
          p_challenge: string | null;
        };
        Returns: unknown;
      };
      tutor_reserve: {
        Args: { p_payload: string; p_signature: string };
        Returns: unknown;
      };
      tutor_finish: {
        Args: { p_payload: string; p_signature: string };
        Returns: unknown;
      };
      create_custom_problem: {
        Args: { p_title: string; p_statement: string; p_request_id: string };
        Returns: ProblemRow[];
      };
      create_untimed_session: {Args:{p_problem_id:string|null;p_statement:string|null;p_mode:string;p_request_id:string};Returns:SessionRow[]};
      create_training_session: {
        Args: {
          p_problem_id: string | null;
          p_statement: string | null;
          p_mode: string;
          p_request_id: string;
        };
        Returns: SessionRow[];
      };
      transition_training_session: {
        Args: {
          p_id: string;
          p_action: string;
          p_expected_revision: number;
          p_outcome: string | null;
        };
        Returns: SessionRow[];
      };
      save_training_draft: {
        Args: {
          p_id: string;
          p_kind: string;
          p_content: string;
          p_expected_revision: number;
        };
        Returns: SessionRow[];
      };
      append_training_thought: {
        Args: {
          p_id: string;
          p_content: string;
          p_expected_revision: number;
          p_request_id: string;
        };
        Returns: { session: SessionRow; thought: Thought };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
