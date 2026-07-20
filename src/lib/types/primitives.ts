// Base type primitives shared across domain modules.
// Extracted to break circular dependency between common.ts and session.ts.

export type RunStatus =
  | "pending"
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "stopped"
  | "waiting_input"
  | "waiting_approval"
  | "error";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_review"
  | "waiting_merge";

/** Per-model usage payload shared by session events and usage views. */
export interface ModelUsageEntry {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_search_requests: number;
  cost_usd: number;
  context_window?: number;
  maxOutputTokens?: number;
}
