/**
 * PermissionCoordinator: single-flight state machine for "user clicked
 * Allow / Deny → backend acknowledged".
 *
 * Invariants:
 *  - One request ↔ one transport submit. Double-click + rapid retry +
 *    single-vs-batch concurrency are all coalesced on `(runId, requestId)`.
 *  - Identity is captured at click time. A late response whose captured
 *    runId no longer matches the active run is silently dropped (the
 *    session has moved on); the backend already returned `unknown_request`
 *    would have done the same.
 *  - One terminal transition per request. A subsequent `respond()` call
 *    for an already-settled request is a no-op; the original outcome
 *    stands. This avoids the "deny catch branch optimistically resolves
 *    again" bug from the previous handler.
 *  - Transport failures preserve `failed` state with a typed error and
 *    surface a Retry handle. They do NOT optimistically resolve.
 *  - Permanent allow is not modeled. The CLI accepts session-scoped
 *    rules in `updatedPermissions`; the backend's NEVER_ALLOW_TOOLS
 *    remains the authority for plan-mode tools.
 *
 * Breadcrumb policy: events log only `runId`, `requestId`, `toolName`,
 * `state`, `latencyMs`, `code` (on failure). They never include tool
 * input, path/command arguments, prompts, deny messages, or raw
 * permission-suggestion payloads.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import {
  classifyFailure,
  isPermissionError,
  PermissionError,
} from "./permission-coordinator/failure";
import { resolveGeneration } from "./permission-coordinator/identity";
import {
  DEFAULT_MAX_RETRYABLE,
  DEFAULT_SUBMIT_TIMEOUT_MS,
  resolveMaxRetryable,
  resolveSubmitTimeout,
} from "./permission-coordinator/policy";
import {
  beginSubmit,
  cancelStale,
  emitToListeners,
  isTerminalState,
  transitionToFailed,
  transitionToResolved,
  transitionToTerminated,
  type InFlightPermissionRecord,
  type TransitionContext,
} from "./permission-coordinator/transitions";
import type {
  PermissionCoordinatorOptions,
  PermissionDecision,
  PermissionEvent,
  PermissionFailure,
  PermissionListener,
  PermissionRequest,
  PermissionRequestState,
  PermissionRespondOptions,
  PermissionSnapshot,
} from "./permission-coordinator/types";

const systemTimers: {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
} = {
  setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
  clearTimeout: (handle: unknown) => {
    if (handle != null) clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** Composite key for inFlight map: runId:requestId. */
function compositeKey(runId: string, requestId: string): string {
  return `${runId}:${requestId}`;
}

/** Maximum terminal records kept for UI inspection before sweep. */
const MAX_TERMINAL_RECORDS = 32;

export { PermissionError, isPermissionError, classifyFailure };
export type {
  PermissionCoordinatorOptions,
  PermissionDecision,
  PermissionEvent,
  PermissionFailure,
  PermissionListener,
  PermissionRequestState,
  PermissionRespondOptions,
  PermissionSnapshot,
};

export class PermissionCoordinator {
  /** In-flight records keyed by composite `runId:requestId`. */
  private readonly inFlight = new Map<string, InFlightPermissionRecord>();
  /** Retryable records keyed by composite `runId:requestId`. */
  private readonly retryable = new Map<
    string,
    import("./permission-coordinator/types").RetryablePermissionRecord
  >();
  private readonly listeners = new Set<PermissionListener>();
  private readonly maxRetryable: number;
  private readonly submitTimeoutMs: number;
  private readonly timers: {
    setTimeout: (handler: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
  };
  private readonly onFailure?: PermissionCoordinatorOptions["onFailure"];
  private readonly onResolved?: PermissionCoordinatorOptions["onResolved"];
  private generation: number;
  private disposed = false;

  constructor(options: PermissionCoordinatorOptions = {}) {
    this.submitTimeoutMs = resolveSubmitTimeout(options.submitTimeoutMs, DEFAULT_SUBMIT_TIMEOUT_MS);
    this.maxRetryable = resolveMaxRetryable(options.maxRetryable, DEFAULT_MAX_RETRYABLE);
    this.timers = options.timers ?? systemTimers;
    this.onFailure = options.onFailure;
    this.onResolved = options.onResolved;
    this.generation = Math.max(0, options.initialGeneration ?? 0);
  }

  private get context(): TransitionContext {
    return {
      inFlight: this.inFlight,
      retryable: this.retryable,
      maxRetryable: this.maxRetryable,
      listeners: this.listeners,
      onFailure: this.onFailure,
      onResolved: this.onResolved,
      getGeneration: () => this.generation,
      timers: this.timers,
    };
  }

  /** Current connection generation. Bumped by the run/session owner. */
  get connectionGeneration(): number {
    return this.generation;
  }

  /**
   * Last runId observed by the page effect that drives
   * `reconcileActiveRun`. Used as a cheap signal so we don't reconcile
   * twice on the same navigation.
   */
  lastActiveRunId: string | null = null;

  /** Snapshot of all tracked in-flight requests. Used by UI projections. */
  snapshot(): PermissionSnapshot[] {
    const list: PermissionSnapshot[] = [];
    for (const record of this.inFlight.values()) {
      list.push({
        runId: record.runId,
        requestId: record.requestId,
        toolName: record.toolName,
        state: record.state,
        failure: record.failure,
        decidedAt: record.decidedAt,
      });
    }
    return list;
  }

  /** Whether this coordinator has any in-flight request for the given run. */
  hasPending(runId?: string): boolean {
    if (!runId) return this.inFlight.size > 0;
    for (const record of this.inFlight.values()) {
      if (record.runId === runId && !record.settled) return true;
    }
    return false;
  }

  /** Whether a single request is currently being submitted (race guard). */
  isSubmitting(runId: string, requestId: string): boolean {
    const key = compositeKey(runId, requestId);
    const record = this.inFlight.get(key);
    if (!record || record.settled) return false;
    return record.state === "submitting";
  }

  /** Subscribe to lifecycle events. Returns an unsubscribe function. */
  subscribe(listener: PermissionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Register a new request with the coordinator. Idempotent on
   * `(runId, requestId)` — re-registering an existing record is a
   * no-op (and the UI sees the existing state). Returns the current
   * snapshot of the record.
   */
  register(request: PermissionRequest): PermissionSnapshot {
    if (this.disposed) {
      return {
        runId: request.runId,
        requestId: request.requestId,
        toolName: request.toolName,
        state: "cancelled",
        failure: { code: "transport", message: "Coordinator disposed", retryable: false },
      };
    }
    const key = compositeKey(request.runId, request.requestId);
    const existing = this.inFlight.get(key);
    if (existing) {
      return {
        runId: existing.runId,
        requestId: existing.requestId,
        toolName: existing.toolName,
        state: existing.state,
        failure: existing.failure,
        decidedAt: existing.decidedAt,
      };
    }
    const record: InFlightPermissionRecord = {
      runId: request.runId,
      requestId: request.requestId,
      toolName: request.toolName,
      state: "pending",
      settled: false,
      generation: this.generation,
      receivedAt: request.receivedAt,
      resolve: () => undefined,
      reject: () => undefined,
    };
    this.inFlight.set(key, record);
    return {
      runId: record.runId,
      requestId: record.requestId,
      toolName: record.toolName,
      state: record.state,
      failure: undefined,
      decidedAt: undefined,
    };
  }

  /**
   * Drop a pending request that has been cancelled by the CLI
   * (`control_request` cancelled / actor dead / run ended). Mirrors
   * the wire-level `already_cancelled` error but is invoked from
   * the event stream rather than the IPC layer.
   */
  markCancelled(runId: string, requestId: string, reason: string): boolean {
    const key = compositeKey(runId, requestId);
    const record = this.inFlight.get(key);
    if (!record || record.settled) return false;
    transitionToTerminated(this.context, record, "cancelled", reason);
    return true;
  }

  /**
   * Cancel every in-flight request for a run (used when the run is
   * disposed / replaced by another). Mirrors `cancelForRun` in the
   * SendCoordinator but is keyed by `runId` (no clientMessageId
   * equivalent exists).
   */
  cancelForRun(runId: string, reason = "Run disposed"): number {
    const cancelled = cancelStale(
      this.context,
      (record) => record.runId === runId && !record.settled,
      reason,
      "cancelled",
    );
    if (cancelled > 0) dbg("permissions", "cancelForRun", { runId, cancelled });
    return cancelled;
  }

  /**
   * Cancel any in-flight request whose captured `runId` no longer
   * matches the active run. Called by the run/session owner when the
   * user switches runs.
   */
  reconcileActiveRun(activeRunId: string | null): number {
    const cancelled = cancelStale(
      this.context,
      (record) => !record.settled && (activeRunId == null || record.runId !== activeRunId),
      activeRunId ? "Active run switched" : "Active run lost",
    );
    if (cancelled > 0) dbg("permissions", "reconcileActiveRun", { activeRunId, cancelled });
    return cancelled;
  }

  /**
   * Bump the connection generation. Cancels every in-flight request
   * whose captured generation is older. Returns the new generation.
   */
  bumpGeneration(next?: number): number {
    if (this.disposed) return this.generation;
    const target = next ?? this.generation + 1;
    if (target <= this.generation) return this.generation;
    this.generation = target;
    cancelStale(
      this.context,
      (record) => record.generation < target && !record.settled,
      "Generation bumped",
    );
    return this.generation;
  }

  /**
   * Submit a decision for a registered request. Resolves on backend
   * ack; rejects with a typed {@link PermissionError} on transport
   * failure. The returned promise is the SAME instance for concurrent
   * callers of the same `(runId, requestId)` — double-click dedupe.
   */
  respond(options: PermissionRespondOptions): Promise<void> {
    if (this.disposed) {
      return Promise.reject(
        new PermissionError(classifyFailure("transport", "Coordinator disposed", false)),
      );
    }
    const { runId, requestId, toolName, decision, transport } = options;
    const generation = resolveGeneration(options.generation, this.generation);
    const key = compositeKey(runId, requestId);
    let record = this.inFlight.get(key);
    if (record && record.settled) {
      // Already resolved → short-circuit. The UI sees the original
      // outcome; double-click cannot double-resolve.
      return Promise.resolve();
    }
    if (record && record.state === "submitting" && record.promise) {
      // Another caller is already in flight for this same request.
      // Return the SAME promise instance so double-click dedupes.
      return record.promise;
    }
    if (!record) {
      // The UI fired `respond()` without first calling `register()`.
      // Auto-register so the lifecycle is observable end-to-end.
      record = {
        runId,
        requestId,
        toolName,
        state: "pending",
        settled: false,
        generation,
        receivedAt: Date.now(),
        resolve: () => undefined,
        reject: () => undefined,
      };
      this.inFlight.set(key, record);
    }

    // Run-identity guard: a stale caller (e.g. response rendered for
    // a previous run that was already disposed) must not contact the
    // backend. This catches the "respond fired after run switch"
    // race that the previous handler shipped.
    if (record.runId !== runId) {
      transitionToTerminated(
        this.context,
        record,
        "stale",
        `runId mismatch: captured=${runId} stored=${record.runId}`,
      );
      return Promise.reject(
        new PermissionError(classifyFailure("run_mismatch", "Run identity changed", false)),
      );
    }

    // Setup a promise whose resolve/reject are owned by the record so
    // the coordinator can settle it from `markCancelled` /
    // `transitionToFailed` paths. Store on record for same-Promise dedupe.
    let resolveOuter!: () => void;
    let rejectOuter!: (err: Error) => void;
    const outer = new Promise<void>((res, rej) => {
      resolveOuter = res;
      rejectOuter = rej;
    });
    record.resolve = resolveOuter;
    record.reject = rejectOuter;
    record.promise = outer;
    record.decision = decision;
    record.transport = transport;
    beginSubmit(this.context, record);

    const request: PermissionRequest = {
      runId,
      requestId,
      toolName,
      receivedAt: record.receivedAt,
    };

    // Capture the start of the submit for latency / timeout.
    if (this.submitTimeoutMs > 0) {
      record.ttlTimer = this.timers.setTimeout(() => {
        if (record!.settled) return;
        const failure = classifyFailure("timeout", "Permission response timed out", true);
        transitionToFailed(this.context, record!, failure, request);
        rejectOuter(new PermissionError(failure));
      }, this.submitTimeoutMs);
    }

    // Single-flight guard: do NOT await the user-supplied transport
    // concurrently. If the same respond() call fires twice in the
    // same tick, the second one sees state="submitting" above and
    // coalesces.
    void Promise.resolve()
      .then(() => transport())
      .then(
        () => {
          if (record!.settled) {
            // Cancellation raced with ack; the record is already
            // moved to a terminal state and the outer promise was
            // rejected. Resolve outer so coalesced callers don't hang.
            resolveOuter();
            return;
          }
          const state: "allowed" | "denied" =
            decision.kind === "deny" || decision.kind === "deny-stop" ? "denied" : "allowed";
          transitionToResolved(this.context, record!, state, request);
          resolveOuter();
        },
        (err: unknown) => {
          if (record!.settled) {
            resolveOuter();
            return;
          }
          const failure = isPermissionError(err)
            ? err
            : new PermissionError(
                classifyFailure(
                  "transport",
                  err instanceof Error ? err.message : String(err),
                  true,
                ),
              );
          transitionToFailed(this.context, record!, failure, request);
          rejectOuter(failure);
        },
      );

    return outer;
  }

  /**
   * Cancel a single in-flight respond. Currently used by the UI
   * "Cancel" / dispose paths. Idempotent.
   */
  cancel(runId: string, requestId: string, reason = "Cancelled"): boolean {
    return this.markCancelled(runId, requestId, reason);
  }

  /** Dispose the coordinator. After dispose every method is a no-op. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of Array.from(this.inFlight.values())) {
      if (record.settled) continue;
      transitionToTerminated(this.context, record, "cancelled", "Coordinator disposed");
    }
    this.inFlight.clear();
    this.inFlight.clear();
    this.retryable.clear();
    this.listeners.clear();
  }

  /**
   * Inspect a single request's current state. Used by tests and UI
   * to project the per-card status.
   */
  inspect(runId: string, requestId: string): PermissionSnapshot | null {
    const key = compositeKey(runId, requestId);
    const record = this.inFlight.get(key);
    if (!record) return null;
    return {
      runId: record.runId,
      requestId: record.requestId,
      toolName: record.toolName,
      state: record.state,
      failure: record.failure,
      decidedAt: record.decidedAt,
    };
  }

  /**
   * Re-emit the current state of a request (e.g. when a UI component
   * re-mounts and needs the latest snapshot). Listeners must be
   * idempotent — they receive the same `event.state` as already
   * observed.
   */
  replay(runId: string, requestId: string): void {
    const key = compositeKey(runId, requestId);
    const record = this.inFlight.get(key);
    if (!record) return;
    const event: PermissionEvent = {
      state: record.state,
      runId: record.runId,
      requestId: record.requestId,
      toolName: record.toolName,
      failure: record.failure,
      latencyMs: record.decidedAt ? record.decidedAt - record.receivedAt : undefined,
      at: record.decidedAt ?? Date.now(),
    };
    emitToListeners(this.listeners, event);
  }

  /** Whether a request is in a terminal state. */
  isTerminal(runId: string, requestId: string): boolean {
    const key = compositeKey(runId, requestId);
    const record = this.inFlight.get(key);
    return !!record && isTerminalState(record.state);
  }

  /**
   * Sweep settled terminal records that have been observed by the UI.
   * Called after `snapshot()` is consumed to prevent unbounded growth.
   * Keeps at most `MAX_TERMINAL_RECORDS` terminal entries; retryable
   * records are preserved in the retryable map.
   */
  sweepTerminal(): number {
    let swept = 0;
    const terminal: string[] = [];
    for (const [key, record] of this.inFlight) {
      if (record.settled) terminal.push(key);
    }
    // Keep the most recent MAX_TERMINAL_RECORDS terminal records.
    if (terminal.length <= MAX_TERMINAL_RECORDS) return 0;
    const toRemove = terminal.length - MAX_TERMINAL_RECORDS;
    for (let i = 0; i < toRemove; i++) {
      this.inFlight.delete(terminal[i]);
      swept++;
    }
    return swept;
  }
}
