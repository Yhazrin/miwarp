/**
 * Lifecycle transitions for {@link PermissionCoordinator}.
 *
 * A request moves through at most one terminal transition:
 * `submitting → allowed | denied | failed | stale | cancelled`. The
 * terminal side effects (removal from inFlight, retryable retention,
 * event emission, hook invocation) live here so the public class
 * delegates rather than re-implements the bookkeeping.
 *
 * Bulk operations (cancelForRun, reconcileActiveRun) iterate the
 * bounded map and apply the same terminal semantics, preserving the
 * "one terminal transition per request" invariant by short-circuiting
 * on `record.settled`.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type {
  PermissionDecision,
  PermissionEvent,
  PermissionFailure,
  PermissionListener,
  PermissionRequest,
  PermissionRequestState,
  RetryablePermissionRecord,
} from "./types";
import { boundedSet } from "./policy";

/** Composite key for inFlight/retryable maps: runId:requestId. */
function cKey(runId: string, requestId: string): string {
  return `${runId}:${requestId}`;
}

export interface TransitionContext {
  inFlight: Map<string, InFlightPermissionRecord>;
  retryable: Map<string, RetryablePermissionRecord>;
  maxRetryable: number;
  listeners: Set<PermissionListener>;
  onFailure?: (event: PermissionEvent) => void;
  onResolved?: (event: PermissionEvent) => void;
  getGeneration: () => number;
  timers: {
    setTimeout: (handler: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
  };
}

export interface InFlightPermissionRecord {
  runId: string;
  requestId: string;
  toolName: string;
  state: PermissionRequestState;
  settled: boolean;
  generation: number;
  receivedAt: number;
  decidedAt?: number;
  failure?: PermissionFailure;
  /** Resolver handed to the transport promise so cancellation can surface a real error. */
  resolve: () => void;
  /** Rejector handed to the transport promise. */
  reject: (err: Error) => void;
  /** The promise returned to callers; stored for same-Promise dedupe on concurrent respond(). */
  promise?: Promise<void>;
  /** Decision captured at respond() time; retained for retryable records. */
  decision?: PermissionDecision;
  /** Transport captured at respond() time; retained for retryable records. */
  transport?: () => Promise<void>;
  /** Timer handle for submit timeout. */
  ttlTimer?: unknown;
}

const TERMINAL_STATES: ReadonlySet<PermissionRequestState> = new Set([
  "allowed",
  "denied",
  "failed",
  "stale",
  "cancelled",
  "expired",
]);

export function isTerminalState(state: PermissionRequestState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Fan-out a status event to all listeners, isolating listener exceptions. */
export function emitToListeners(listeners: Set<PermissionListener>, event: PermissionEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      dbgWarn("permissions", "listener.error", { error: String(e) });
    }
  }
}

/** Mark a request as in-flight at `submitting`. Idempotent. */
export function beginSubmit(ctx: TransitionContext, record: InFlightPermissionRecord): void {
  if (record.settled) return;
  record.state = "submitting";
  ctx.inFlight.set(cKey(record.runId, record.requestId), record);
}

/**
 * Mark a request as `allowed` or `denied` on transport ack. Removes
 * from `inFlight`, clears TTL, emits a `PermissionEvent`. Idempotent.
 */
export function transitionToResolved(
  ctx: TransitionContext,
  record: InFlightPermissionRecord,
  state: "allowed" | "denied",
  request: PermissionRequest,
): void {
  if (record.settled) return;
  record.settled = true;
  record.state = state;
  record.decidedAt = Date.now();
  const key = cKey(record.runId, record.requestId);
  ctx.inFlight.delete(key);
  ctx.retryable.delete(key);
  if (record.ttlTimer != null) {
    ctx.timers.clearTimeout(record.ttlTimer);
    record.ttlTimer = undefined;
  }
  const event: PermissionEvent = {
    state,
    runId: record.runId,
    requestId: record.requestId,
    toolName: record.toolName,
    latencyMs: record.decidedAt - record.receivedAt,
    at: record.decidedAt,
  };
  ctx.onResolved?.(event);
  emitToListeners(ctx.listeners, event);
  dbg("permissions", "resolved", {
    state,
    requestId: record.requestId,
    tool: record.toolName,
    latencyMs: event.latencyMs,
  });
}

/**
 * Mark a request as failed (transport rejected). Retains a retryable
 * record when the failure is retryable. Idempotent.
 */
export function transitionToFailed(
  ctx: TransitionContext,
  record: InFlightPermissionRecord,
  failure: PermissionFailure,
  request: PermissionRequest,
): void {
  if (record.settled) return;
  record.settled = true;
  record.state = "failed";
  record.failure = failure;
  record.decidedAt = Date.now();
  const key = cKey(record.runId, record.requestId);
  // Keep in inFlight so UI can project the failed state.
  // sweepTerminal() will clean up later.
  if (record.ttlTimer != null) {
    ctx.timers.clearTimeout(record.ttlTimer);
    record.ttlTimer = undefined;
  }
  if (failure.retryable && record.decision && record.transport) {
    boundedSet(
      ctx.retryable,
      key,
      {
        runId: record.runId,
        requestId: record.requestId,
        toolName: record.toolName,
        decision: record.decision,
        failure,
        transport: record.transport,
        generation: ctx.getGeneration(),
      },
      ctx.maxRetryable,
    );
  } else {
    ctx.retryable.delete(key);
  }
  const event: PermissionEvent = {
    state: "failed",
    runId: record.runId,
    requestId: record.requestId,
    toolName: record.toolName,
    failure,
    latencyMs: record.decidedAt - record.receivedAt,
    at: record.decidedAt,
  };
  ctx.onFailure?.(event);
  emitToListeners(ctx.listeners, event);
  dbg("permissions", "failed", {
    requestId: record.requestId,
    code: failure.code,
    retryable: failure.retryable,
  });
}

/**
 * Mark a request as stale or cancelled without contacting the backend.
 * Surfaces a typed event so the UI can move the card to `stale` /
 * `cancelled` instead of leaving it spinning.
 */
export function transitionToTerminated(
  ctx: TransitionContext,
  record: InFlightPermissionRecord,
  state: "stale" | "cancelled" | "expired",
  reason: string,
): void {
  if (record.settled) return;
  record.settled = true;
  record.state = state;
  record.failure = {
    code:
      state === "stale" ? "run_mismatch" : state === "cancelled" ? "already_cancelled" : "unknown",
    message: reason,
    retryable: false,
  };
  record.decidedAt = Date.now();
  // Keep in inFlight so UI can project the terminal state (stale/cancelled).
  // sweepTerminal() will clean up later.
  if (record.ttlTimer != null) {
    ctx.timers.clearTimeout(record.ttlTimer);
    record.ttlTimer = undefined;
  }
  const event: PermissionEvent = {
    state,
    runId: record.runId,
    requestId: record.requestId,
    toolName: record.toolName,
    failure: record.failure,
    latencyMs: record.decidedAt - record.receivedAt,
    at: record.decidedAt,
  };
  emitToListeners(ctx.listeners, event);
  dbg("permissions", "terminated", {
    state,
    requestId: record.requestId,
    reason,
  });
}

/**
 * Cancel any in-flight request whose generation is older than the
 * provided target. Used when the run is disposed / replaced.
 */
export function cancelStale(
  ctx: TransitionContext,
  predicate: (record: InFlightPermissionRecord) => boolean,
  reason: string,
  state: "stale" | "cancelled" | "expired" = "stale",
): number {
  let cancelled = 0;
  for (const record of Array.from(ctx.inFlight.values())) {
    if (record.settled) continue;
    if (!predicate(record)) continue;
    transitionToTerminated(ctx, record, state, reason);
    cancelled += 1;
  }
  return cancelled;
}
