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
