/**
 * Shared types for session-store reducers.
 *
 * ReduceCtx is the batch context — fields are written in-place by reducers
 * and then committed to live store state by `_commitReduceCtx`.
 */
import type { TimelineEntry, HookEvent } from "$lib/types";
import type { SessionPhase, UsageState, TurnUsage } from "$lib/stores/types";

export interface ReduceCtx {
  tl: TimelineEntry[];
  he: HookEvent[];
  streamText: string;
  thinkingText: string;
  model: string;
  phase: SessionPhase;
  usage: UsageState;
  error: string;
  seenMessageIds: Set<string>;
  seenToolIds: Set<string>;
  /** Track run.status changes from non-terminal run_state events (running/idle). */
  runStatus: string | null;
  /** New session_id from session_init (e.g. fork generates a new CLI session). */
  sessionId: string | null;
  /** Whether this run uses stream-json mode (skip tools mirror writes). */
  isStream: boolean;
  /** Per-turn usage snapshots. */
  turnUsages: TurnUsage[];
  /** tool_use_id → tl[] index (only tool entries, first-match semantics). */
  toolTlIndex: Map<string, number>;
  /** tool_use_id → he[] index (only HookEvent entries with tool_use_id). */
  toolHeIndex: Map<string, number>;
}
