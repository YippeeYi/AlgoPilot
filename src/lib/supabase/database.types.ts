import type { TrainingSession, Problem, Thought } from "@/lib/validation/m1";

// 与 M1 migration 对齐；应用响应仍经过 Zod 与显式字段选择。
type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
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
    };
    Views: Record<string, never>;
    Functions: {
      create_custom_problem: {
        Args: { p_title: string; p_statement: string; p_request_id: string };
        Returns: ProblemRow[];
      };
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
