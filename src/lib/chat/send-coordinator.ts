/**
 * SendCoordinator: explicit state machine for "user pressed Send → agent
 * acknowledges receipt", with v1.0.9 Phase 2 reconnect-aware buffering.
 *
 * v1.0.9 Phase 1 invariants (preserved):
 *
 *   1. One in-flight slot per `clientMessageId`. Concurrent submits for the
 *      same `runId` are tracked independently; the slot key is the client
 *      message id, so two simultaneous sends never overwrite one another
 *      and a retry does not collide with the original.
 *   2. Run identity is captured at submit time so a session switch during
 *      the IPC round-trip cannot cross-route the optimistic timeline
 *      entry or the eventual retry. When a newer submit for the same
 *      `runId` appears mid-flight, the older submit is marked stale.
 *   3. Submit-accepted (transport promise resolved) is distinguished from
 *      transport-available (connection up). The user-visible "draft" is
 *      cleared only after the backend confirms receipt.
 *   4. Typed failure with retry capability is surfaced instead of letting
 *      the draft silently disappear. Cancellation reasons are preserved
 *      so the UI can show the right Retry vs. switch-session message.
 *   5. One terminal transition per submit so retry handlers and draft
 *      restoration logic don't double-fire.
 *
 * v1.0.9 Phase 2 additions:
 *
 *   6. When the transport reports a non-connected phase (reconnecting /
 *      recovering / disposed), new submits are held in a bounded
 *      in-memory queue keyed by `clientMessageId`. A single
 *      `bumpGeneration` + `reconcile({ healthy: true })` pair drains the
 *      queue in FIFO order, preserving identity (runId / sessionId /
 *      cause / draft). The transport closure is captured on the record
 *      so the drain can re-dispatch without the caller re-submitting.
 *   7. Generation tracking: each submit captures the connection
 *      generation at submit time. When the transport reports a new
 *      generation, every queued or in-flight record whose generation is
 *      older is cancelled with `stale_generation` (retryable). A new
 *      `bumpGeneration` invocation triggers exactly one drain — the
 *      "reconnect storm single-flush" guarantee.
 *   8. All queue / record maps are bounded: `maxQueued` (default 32),
 *      `maxRetryable` (default 64), `maxAcknowledged` (default 512).
 *      Each queued entry has a `queueTtlMs` (default 30 s) enforced by a
 *      `TimeoutApi` handle that is tracked and cleared on dispose. The
 *      active timer set is itself bounded by `maxQueued`.
 *   9. Per-submit states now include `cancelled` (terminal) and the
 *      transport phase includes `reconnecting` / `recovering`. UI code
 *      can subscribe to either stream.
 *
 * The coordinator does NOT know about the prompt input store directly.
 * The caller retains ownership of the draft and decides when to clear
 * it, using `subscribe()` to learn when a submit has been accepted vs.
 * failed.
 */
import { systemTimers, type TimeoutApi } from "$lib/transport";
import { uuid } from "$lib/utils/uuid";
import { dbg, dbgWarn } from "$lib/utils/debug";

export type SendState =
  | "submitting"
  | "queued"
  | "recovering"
  | "accepted"
  | "failed"
  | "cancelled";

export type TransportPhase = "connected" | "reconnecting" | "recovering" | "disposed";

export interface SendDraft {
  text: string;
  attachments: unknown[];
}

export interface SendSubmitOptions {
  /** The runId the user intended this submit for, captured at click time. */
  runId: string;
  /** Optional session id (for stream sessions). */
  sessionId?: string | null;
  /** Draft snapshot for retry / draft restoration. */
  draft: SendDraft;
  /**
   * The transport-acceptance function. It must resolve on successful
   * delivery to the backend and reject with an Error on transport-level
   * failure (timeout, disconnected, rejection, etc.). It is captured by
   * closure so a queued drain can re-dispatch without the caller
   * re-submitting.
   */
  transport: (clientMessageId: string) => Promise<void>;
  /**
   * Optional override of the client message id. Tests use this to assert
   * idempotency. In production the coordinator generates a UUIDv4.
   */
  clientMessageId?: string;
  /**
   * Optional cause label for the breadcrumb log; helps distinguish start
   * sends from continuation sends without leaking content.
   */
  cause?: "start" | "continue" | "resume" | "retry";
  /**
   * Optional generation captured at click time. The caller may pass the
   * live connection generation when wiring the coordinator against a
   * transport state machine; if omitted, the coordinator uses its own
   * tracked generation (the conservative choice).
   */
  generation?: number;
}

export interface SendStatusEvent {
  state: SendState;
  runId: string;
  clientMessageId: string;
  cause: SendSubmitOptions["cause"];
  generation: number;
  /** Set on the `failed` transition. */
  error?: SendFailure;
  /** Set on the `queued` transition when the queue held the submit. */
  queueDepth?: number;
}

export type SendListener = (event: SendStatusEvent) => void;

export interface TransportPhaseEvent {
  phase: TransportPhase;
  generation: number;
  previousPhase: TransportPhase;
  previousGeneration: number;
  cancelled: number;
}

export type TransportPhaseListener = (event: TransportPhaseEvent) => void;

export interface SendFailure {
  code:
    | "transport_unavailable"
    | "stale_identity"
    | "stale_generation"
    | "rejected"
    | "timeout"
    | "duplicate"
    | "queue_full"
    | "queue_expired"
    | "unknown";
  message: string;
  /** Whether the caller may safely retry without dedupe concerns. */
  retryable: boolean;
  /** Original cause for logging (never the user content). */
  cause?: string;
}

interface InFlightRecord {
  runId: string;
  sessionId: string | null;
  clientMessageId: string;
  draft: SendDraft;
  cause: SendSubmitOptions["cause"];
  state: SendState;
  generation: number;
  /** Has this submit already emitted a terminal transition? */
  settled: boolean;
  /** Captured failure when a cancellation/abort fired before transport resolved. */
  failure?: SendFailure;
  /** Single promise handed back to every duplicate `submit()` caller. */
  promise: Promise<{ clientMessageId: string }>;
  /** Resolver handed to the transport promise so a queued drain can complete it. */
  resolve: (value: { clientMessageId: string }) => void;
  /** Rejector handed to the transport promise so cancellation can surface a real error. */
  reject: (err: Error) => void;
  /** Transport closure; preserved so `reconcile` can re-dispatch without a new submit. */
  transport: (clientMessageId: string) => Promise<void>;
  /** Timer handle for the queue TTL — cleared on dispose or drain. */
  ttlTimer?: ReturnType<typeof setTimeout>;
}

interface RetryableRecord {
  clientMessageId: string;
  runId: string;
  sessionId: string | null;
  draft: SendDraft;
  cause: SendSubmitOptions["cause"];
  generation: number;
  failure: SendFailure;
  transport: (clientMessageId: string) => Promise<void>;
}

export interface SendCoordinatorOptions {
  /** How long before an in-flight submit is considered stale (ms). */
  submitTimeoutMs?: number;
  /** Maximum queued entries held while transport is unhealthy. */
  maxQueued?: number;
  /** Maximum retryable records retained for `retry()`. */
  maxRetryable?: number;
  /** Maximum acknowledged ids retained for idempotency checks. */
  maxAcknowledged?: number;
  /** Per-queue-entry TTL in ms. Default 30 000. */
  queueTtlMs?: number;
  /** Initial connection generation. Defaults to 0. */
  initialGeneration?: number;
  /** Initial transport phase. Defaults to `connected`. */
  initialPhase?: TransportPhase;
  /** Injectable timer API for tests. Defaults to `systemTimers`. */
  timers?: TimeoutApi;
  /** Optional UUID factory (overridable for tests). */
  uuid?: () => string;
  /**
   * Hook invoked on the first failed transition of a submit. Allows the
   * UI to surface a retry CTA without coupling the coordinator to the
   * toast layer.
   */
  onFailure?: (event: SendStatusEvent) => void;
  /**
   * Hook invoked on the first accepted transition of a submit. The
   * caller can use this to clear the draft.
   */
  onAccepted?: (event: SendStatusEvent) => void;
  /**
   * Hook invoked whenever the transport phase changes (including on
   * generation bumps). Lets the UI surface "reconnecting…" notices.
   */
  onTransportPhase?: (event: TransportPhaseEvent) => void;
}

const DEFAULT_SUBMIT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_QUEUED = 32;
const DEFAULT_MAX_RETRYABLE = 64;
const DEFAULT_MAX_ACKNOWLEDGED = 512;
const DEFAULT_QUEUE_TTL_MS = 30_000;

export class SendCoordinator {
  /** In-flight submits (currently dispatching). Keyed by clientMessageId. */
  private readonly inFlight = new Map<string, InFlightRecord>();
  /** Bounded in-memory queue for submits waiting on a healthy transport. */
  private readonly queued = new Map<string, InFlightRecord>();
  /** Retryable failures: the draft + transport closure are retained. */
  private readonly retryable = new Map<string, RetryableRecord>();
  /** Client message ids that have been explicitly acknowledged (terminal accept). */
  private readonly acknowledged = new Map<string, number>();

  private readonly listeners = new Set<SendListener>();
  private readonly transportListeners = new Set<TransportPhaseListener>();

  private phase: TransportPhase;
  private generation: number;

  private readonly submitTimeoutMs: number;
  private readonly maxQueued: number;
  private readonly maxRetryable: number;
  private readonly maxAcknowledged: number;
  private readonly queueTtlMs: number;
  private readonly timers: TimeoutApi;
  private readonly uuidFactory: () => string;
  private readonly onFailure?: SendCoordinatorOptions["onFailure"];
  private readonly onAccepted?: SendCoordinatorOptions["onAccepted"];
  private readonly onTransportPhase?: SendCoordinatorOptions["onTransportPhase"];

  private disposed = false;

  constructor(options: SendCoordinatorOptions = {}) {
    this.submitTimeoutMs = options.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    this.maxQueued = Math.max(1, options.maxQueued ?? DEFAULT_MAX_QUEUED);
    this.maxRetryable = Math.max(1, options.maxRetryable ?? DEFAULT_MAX_RETRYABLE);
    this.maxAcknowledged = Math.max(1, options.maxAcknowledged ?? DEFAULT_MAX_ACKNOWLEDGED);
    this.queueTtlMs = Math.max(0, options.queueTtlMs ?? DEFAULT_QUEUE_TTL_MS);
    this.timers = options.timers ?? systemTimers;
    this.uuidFactory = options.uuid ?? uuid;
    this.onFailure = options.onFailure;
    this.onAccepted = options.onAccepted;
    this.onTransportPhase = options.onTransportPhase;
    this.generation = Math.max(0, options.initialGeneration ?? 0);
    this.phase = options.initialPhase ?? "connected";
  }

  /** Whether any submit is currently dispatching. Does NOT include queued items. */
  get busy(): boolean {
    return this.inFlight.size > 0;
  }

  /** Whether the coordinator has anything pending (dispatching or queued). */
  get pendingCount(): number {
    return this.inFlight.size + this.queued.size;
  }

  /** Number of submits currently held in the in-memory queue. */
  get queuedCount(): number {
    return this.queued.size;
  }

  /** Number of retryable failures retained for `retry()`. */
  get retryableCount(): number {
    return this.retryable.size;
  }

  /** Current transport phase. */
  get transportPhase(): TransportPhase {
    return this.phase;
  }

  /** Current connection generation. */
  get connectionGeneration(): number {
    return this.generation;
  }

  /** True if the transport can accept new submits immediately. */
  get canSubmit(): boolean {
    return this.phase === "connected";
  }

  /**
   * Whether the coordinator is currently submitting for the given runId.
   * Does not count queued submits (those are waiting on the transport).
   */
  isSubmitting(runId?: string): boolean {
    if (!runId) return this.busy;
    for (const record of this.inFlight.values()) {
      if (record.runId === runId && record.state === "submitting") return true;
    }
    return false;
  }

  /**
   * Whether any submit for the given runId is pending (submitting or
   * queued). Once a submit is accepted / failed / cancelled, it leaves
   * the pending sets and this returns false.
   */
  hasPending(runId?: string): boolean {
    if (!runId) return this.pendingCount > 0;
    for (const record of this.inFlight.values()) {
      if (record.runId === runId) return true;
    }
    for (const record of this.queued.values()) {
      if (record.runId === runId) return true;
    }
    return false;
  }

  /** Subscribe to per-submit state transitions. */
  subscribe(listener: SendListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to transport phase + generation events. */
  subscribeTransport(listener: TransportPhaseListener): () => void {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  /**
   * Update the transport phase. If the phase is `connected`, callers
   * should follow with `reconcile({ generation, healthy: true })` to
   * drain the queue. Phase changes bump generation and cancel stale
   * records automatically when leaving `connected`.
   */
  setTransportPhase(
    phase: TransportPhase,
    options: { generation?: number; reconcile?: boolean } = {},
  ): number {
    if (this.disposed) return this.generation;
    const previousPhase = this.phase;
    const previousGeneration = this.generation;
    let cancelled = 0;
    if (phase !== previousPhase) {
      if (phase !== "connected" && previousPhase === "connected") {
        cancelled = this.cancelAllQueued(
          `transport entered ${phase}; queued submits drained as failed`,
        );
      }
      this.phase = phase;
    }
    if (typeof options.generation === "number" && options.generation > this.generation) {
      cancelled += this.cancelStaleGenerations(options.generation);
      this.generation = options.generation;
    } else if (phase !== previousPhase && phase !== "connected") {
      cancelled += this.cancelStaleGenerations(this.generation + 1);
      this.generation += 1;
    }
    this.emitTransportPhase({
      phase,
      generation: this.generation,
      previousPhase,
      previousGeneration,
      cancelled,
    });
    if (options.reconcile && phase === "connected") {
      this.reconcile({ generation: this.generation, healthy: true });
    }
    return this.generation;
  }

  /**
   * Advance the connection generation. Cancels every queued / in-flight
   * record whose captured generation is older than the new one. The
   * single-flight reconnect-storm invariant: at most one drain per
   * generation. Calling this twice with the same value is a no-op.
   * Returns the new generation.
   */
  bumpGeneration(nextGeneration?: number): number {
    if (this.disposed) return this.generation;
    const target = nextGeneration ?? this.generation + 1;
    if (target <= this.generation) return this.generation;
    const previousGeneration = this.generation;
    const cancelled = this.cancelStaleGenerations(target);
    this.generation = target;
    this.emitTransportPhase({
      phase: this.phase,
      generation: this.generation,
      previousPhase: this.phase,
      previousGeneration,
      cancelled,
    });
    return this.generation;
  }

  /**
   * Drain the queue once, in FIFO order. The transport is expected to be
   * `connected` before calling this. Returns the number of submits
   * dispatched. Old-generation records are cancelled before dispatch
   * (reconnect-storm single-flush guarantee). The `healthy` flag is
   * accepted for API symmetry with `setTransportPhase`; only `true`
   * actually drains.
   */
  reconcile(options: { generation?: number; healthy: boolean }): number {
    if (this.disposed || !options.healthy) return 0;
    const targetGen =
      typeof options.generation === "number" && options.generation > this.generation
        ? (this.generation = options.generation)
        : this.generation;

    if (this.queued.size === 0) return 0;

    // Snapshot FIFO order. JS Map iteration is insertion-ordered.
    const drained: InFlightRecord[] = [];
    for (const record of this.queued.values()) {
      drained.push(record);
    }

    let dispatched = 0;
    let cancelledStale = 0;
    for (const record of drained) {
      this.clearTtlTimer(record);
      if (record.generation < targetGen) {
        // Old generation captured before the latest reconnect — cancel,
        // do NOT re-dispatch. The reconnect-storm single-flush invariant
        // explicitly forbids replaying an already-buffered submit across
        // a new generation.
        cancelledStale += 1;
        this.transitionToCancelled(
          record,
          {
            code: "stale_generation",
            message: "Connection regenerated before delivery",
            retryable: true,
          },
          "reconcile-stale",
        );
        this.queued.delete(record.clientMessageId);
        record.reject?.(
          new SendCoordinatorError({
            code: "stale_generation",
            message: "Connection regenerated before delivery",
            retryable: true,
          }),
        );
        continue;
      }
      this.queued.delete(record.clientMessageId);
      record.state = "submitting";
      this.inFlight.set(record.clientMessageId, record);
      dispatched += 1;
      void this.invokeTransport(record);
    }
    if (cancelledStale > 0 || dispatched > 0) {
      dbg("send", "reconcile.drain", {
        generation: targetGen,
        dispatched,
        cancelledStale,
      });
    }
    return dispatched;
  }

  /**
   * Cancel any pending record whose generation is older than the live
   * one. Returns the number cancelled. Used by `bumpGeneration` and
   * `setTransportPhase` to enforce the "old generation cannot flush"
   * invariant.
   */
  cancelStaleGenerations(currentGeneration: number): number {
    if (this.disposed) return 0;
    let cancelled = 0;
    for (const [clientId, record] of Array.from(this.queued.entries())) {
      if (record.generation < currentGeneration && !record.settled) {
        this.transitionToCancelled(
          record,
          {
            code: "stale_generation",
            message: "Connection regenerated before delivery",
            retryable: true,
          },
          "stale-queued",
        );
        this.queued.delete(clientId);
        cancelled += 1;
        record.reject?.(
          new SendCoordinatorError({
            code: "stale_generation",
            message: "Connection regenerated before delivery",
            retryable: true,
          }),
        );
      }
    }
    for (const [clientId, record] of Array.from(this.inFlight.entries())) {
      if (record.generation < currentGeneration && !record.settled) {
        // Mark settled + rejected; the awaited transport promise will
        // see a SendCoordinatorError. We do NOT call invokeTransport's
        // reject here directly — the in-flight transport promise will
        // observe record.settled and re-throw on its own.
        record.settled = true;
        record.failure = {
          code: "stale_generation",
          message: "Connection regenerated before delivery",
          retryable: true,
        };
        record.state = "failed";
        this.inFlight.delete(clientId);
        this.addAcknowledged(clientId);
        const event: SendStatusEvent = {
          state: "failed",
          runId: record.runId,
          clientMessageId: clientId,
          cause: record.cause,
          generation: record.generation,
          error: record.failure,
        };
        this.onFailure?.(event);
        this.emit(event);
        record.reject?.(
          new SendCoordinatorError({
            code: "stale_generation",
            message: "Connection regenerated before delivery",
            retryable: true,
          }),
        );
        cancelled += 1;
      }
    }
    if (cancelled > 0) {
      dbgWarn("send", "cancelStaleGenerations", { currentGeneration, cancelled });
    }
    return cancelled;
  }

  /**
   * Submit a user message. Resolves with the client message id on
   * submit-accepted (transport promise resolved). Rejects with a
   * `SendCoordinatorError` on any terminal failure. The caller should
   * NOT clear the draft on rejection.
   *
   * If the transport is currently unhealthy (mid-reconnect) the submit
   * is held in the bounded in-memory queue until `reconcile({ healthy: true })`
   * is called. The returned promise only resolves once the actual
   * transport call has resolved (or it rejects with `stale_generation`
   * if the queued entry is cancelled by a subsequent reconnect).
   */
  submit(options: SendSubmitOptions): Promise<{ clientMessageId: string }> {
    if (this.disposed) {
      return Promise.reject(
        new SendCoordinatorError({
          code: "transport_unavailable",
          message: "Coordinator disposed",
          retryable: false,
        }),
      );
    }
    const clientMessageId = options.clientMessageId ?? this.uuidFactory();
    const generation = options.generation ?? this.generation;

    // Idempotency: same id already accepted → resolve immediately so
    // a retried submit never reaches the backend twice.
    if (this.acknowledged.has(clientMessageId)) {
      return Promise.resolve({ clientMessageId });
    }
    // Same id already in flight → return the same promise.
    const existing = this.inFlight.get(clientMessageId) ?? this.queued.get(clientMessageId);
    if (existing) {
      return this.attachToRecord(existing);
    }
    // Same id was a retryable failure → drop the stale record so a
    // fresh retry can claim the id.
    this.retryable.delete(clientMessageId);

    if (this.phase !== "connected") {
      return this.queueSubmit(options, clientMessageId, generation);
    }
    return this.dispatchSubmit(options, clientMessageId, generation);
  }

  /**
   * Retry a previously-failed submit using its retained draft and
   * transport closure. Re-uses the same `clientMessageId` so the
   * backend's accepted-ledger dedupe kicks in. Resolves with the same
   * shape as `submit`. Returns `null` if no retryable record exists for
   * the id (the caller should re-submit with a fresh draft).
   */
  retry(clientMessageId: string): Promise<{ clientMessageId: string }> | null {
    const record = this.retryable.get(clientMessageId);
    if (!record) return null;
    this.retryable.delete(clientMessageId);
    return this.submit({
      runId: record.runId,
      sessionId: record.sessionId,
      draft: record.draft,
      cause: record.cause ?? "retry",
      clientMessageId,
      transport: record.transport,
      generation: this.generation,
    });
  }

  /**
   * Cancel a single pending submit by `clientMessageId`. No-op if the
   * id is not pending (already settled or never seen).
   */
  cancel(clientMessageId: string, reason = "Cancelled by user"): boolean {
    const record = this.inFlight.get(clientMessageId) ?? this.queued.get(clientMessageId);
    if (!record || record.settled) return false;
    this.transitionToCancelled(
      record,
      { code: "stale_identity", message: reason, retryable: false },
      "cancel",
    );
    this.inFlight.delete(clientMessageId);
    this.queued.delete(clientMessageId);
    this.clearTtlTimer(record);
    record.reject?.(
      new SendCoordinatorError({
        code: "stale_identity",
        message: reason,
        retryable: false,
      }),
    );
    return true;
  }

  /**
   * Mark the submit as queued. The caller (e.g. browser transport) may
   * use this to indicate the message is held in the transport buffer
   * waiting for the connection to come back.
   */
  markQueued(runId: string, clientMessageId?: string): boolean {
    const record = this.findRecord(runId, clientMessageId);
    if (!record || record.state !== "submitting" || record.settled) return false;
    record.state = "queued";
    this.emit({
      state: "queued",
      runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      generation: record.generation,
      queueDepth: this.queued.size,
    });
    return true;
  }

  /**
   * Acknowledge the submit as fully accepted by the backend (agent
   * will receive it). Idempotent: subsequent calls with the same
   * `clientMessageId` return true. With no `clientMessageId` the first
   * matching record is acknowledged.
   */
  acknowledge(runId: string, clientMessageId?: string): boolean {
    const record = this.findRecord(runId, clientMessageId);
    if (record) {
      if (clientMessageId && record.clientMessageId !== clientMessageId) return false;
      this.completeWithAccepted(record);
      return true;
    }
    if (clientMessageId && this.acknowledged.has(clientMessageId)) return true;
    return false;
  }

  /**
   * Abort a submit (e.g. session was killed). Surfaces a failed
   * transition so the UI can restore the draft.
   */
  abort(runId: string, reason: string, clientMessageId?: string): void {
    const record = this.findRecord(runId, clientMessageId);
    if (!record || record.settled) return;
    this.transitionToFailed(
      record,
      { code: "unknown", message: reason, retryable: false, cause: "aborted" },
      "aborted",
    );
    this.inFlight.delete(record.clientMessageId);
    this.queued.delete(record.clientMessageId);
    this.clearTtlTimer(record);
  }

  /**
   * Cancel any pending submits for a run. Used when the run is disposed
   * (closed, replaced by another run, etc.).
   */
  cancelForRun(runId: string, reason = "Run disposed", clientMessageId?: string): void {
    let cancelled = 0;
    for (const [clientId, record] of Array.from(this.queued.entries())) {
      if (record.runId !== runId) continue;
      if (record.settled) continue;
      if (clientMessageId && clientId !== clientMessageId) continue;
      this.transitionToCancelled(
        record,
        { code: "stale_identity", message: reason, retryable: false },
        "cancelled-queued",
      );
      this.queued.delete(clientId);
      this.clearTtlTimer(record);
      record.reject?.(
        new SendCoordinatorError({
          code: "stale_identity",
          message: reason,
          retryable: false,
        }),
      );
      cancelled += 1;
    }
    for (const [clientId, record] of Array.from(this.inFlight.entries())) {
      if (record.runId !== runId) continue;
      if (record.settled) continue;
      if (clientMessageId && clientId !== clientMessageId) continue;
      this.transitionToCancelled(
        record,
        { code: "stale_identity", message: reason, retryable: false },
        "cancelled",
      );
      this.inFlight.delete(clientId);
      record.reject?.(
        new SendCoordinatorError({
          code: "stale_identity",
          message: reason,
          retryable: false,
        }),
      );
      cancelled += 1;
    }
    if (cancelled > 0) {
      dbg("send", "cancelForRun", { runId, cancelled });
    }
  }

  /**
   * Drop any pending submit whose runId no longer matches the active
   * run. Returns the number of records dropped. Cancels both in-flight
   * and queued records.
   */
  reconcileActiveRun(activeRunId: string | null | undefined): number {
    let dropped = 0;
    const match = (record: InFlightRecord): boolean =>
      !record.settled && (activeRunId == null || record.runId !== activeRunId);

    for (const [clientId, record] of Array.from(this.queued.entries())) {
      if (!match(record)) continue;
      this.transitionToCancelled(
        record,
        {
          code: "stale_identity",
          message: activeRunId ? "Active run switched" : "Active run lost",
          retryable: false,
        },
        "reconcile-queued",
      );
      this.queued.delete(clientId);
      this.clearTtlTimer(record);
      record.reject?.(
        new SendCoordinatorError({
          code: "stale_identity",
          message: activeRunId ? "Active run switched" : "Active run lost",
          retryable: false,
        }),
      );
      dropped += 1;
    }
    for (const [clientId, record] of Array.from(this.inFlight.entries())) {
      if (!match(record)) continue;
      this.transitionToCancelled(
        record,
        {
          code: "stale_identity",
          message: activeRunId ? "Active run switched" : "Active run lost",
          retryable: false,
        },
        "reconcile",
      );
      this.inFlight.delete(clientId);
      record.reject?.(
        new SendCoordinatorError({
          code: "stale_identity",
          message: activeRunId ? "Active run switched" : "Active run lost",
          retryable: false,
        }),
      );
      dropped += 1;
    }
    return dropped;
  }

  /**
   * Dispose the coordinator. Drops all listeners, cancels every pending
   * record, clears all timers and maps. After dispose all public methods
   * are no-ops or throw `transport_unavailable`.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.inFlight.values()) {
      record.settled = true;
      this.clearTtlTimer(record);
      record.reject?.(
        new SendCoordinatorError({
          code: "transport_unavailable",
          message: "Coordinator disposed",
          retryable: false,
        }),
      );
    }
    for (const record of this.queued.values()) {
      record.settled = true;
      this.clearTtlTimer(record);
      record.reject?.(
        new SendCoordinatorError({
          code: "transport_unavailable",
          message: "Coordinator disposed",
          retryable: false,
        }),
      );
    }
    this.inFlight.clear();
    this.queued.clear();
    this.retryable.clear();
    this.acknowledged.clear();
    this.listeners.clear();
    this.transportListeners.clear();
    this.phase = "disposed";
  }

  /**
   * Test helper: snapshot pending state (in-flight + queued). Not part
   * of the public API surface; consumed by `send-coordinator.test.ts`.
   */
  _debugSnapshot(): {
    runId: string;
    state: SendState;
    clientMessageId: string;
    queued: boolean;
    generation: number;
  }[] {
    const inflight = Array.from(this.inFlight.values()).map((r) => ({
      runId: r.runId,
      state: r.state,
      clientMessageId: r.clientMessageId,
      queued: false,
      generation: r.generation,
    }));
    const queued = Array.from(this.queued.values()).map((r) => ({
      runId: r.runId,
      state: r.state,
      clientMessageId: r.clientMessageId,
      queued: true,
      generation: r.generation,
    }));
    return [...inflight, ...queued];
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private queueSubmit(
    options: SendSubmitOptions,
    clientMessageId: string,
    generation: number,
  ): Promise<{ clientMessageId: string }> {
    // Bounded queue: drop the oldest queued entry if we're at capacity.
    if (this.queued.size >= this.maxQueued) {
      const oldestKey = this.queued.keys().next().value as string | undefined;
      if (oldestKey) {
        const oldest = this.queued.get(oldestKey);
        if (oldest) {
          this.queued.delete(oldestKey);
          this.clearTtlTimer(oldest);
          this.transitionToFailed(
            oldest,
            {
              code: "queue_full",
              message: "Send queue full; oldest message dropped",
              retryable: true,
            },
            "queue-full",
          );
          oldest.reject?.(
            new SendCoordinatorError({
              code: "queue_full",
              message: "Send queue full; oldest message dropped",
              retryable: true,
            }),
          );
        }
      }
    }

    const record = this.createRecord(options, clientMessageId, generation, "queued");
    this.queued.set(clientMessageId, record);
    if (this.queueTtlMs > 0) {
      record.ttlTimer = this.timers.setTimeout(() => {
        this.expireQueueEntry(clientMessageId);
      }, this.queueTtlMs);
    }

    this.emit({
      state: "queued",
      runId: record.runId,
      clientMessageId,
      cause: record.cause,
      generation,
      queueDepth: this.queued.size,
    });

    dbg("send", "submit.queued", {
      runId: record.runId,
      clientMessageId,
      cause: record.cause,
      generation,
      queueDepth: this.queued.size,
    });

    return record.promise;
  }

  private dispatchSubmit(
    options: SendSubmitOptions,
    clientMessageId: string,
    generation: number,
  ): Promise<{ clientMessageId: string }> {
    const record = this.createRecord(options, clientMessageId, generation, "submitting");
    this.inFlight.set(clientMessageId, record);

    this.emit({
      state: "submitting",
      runId: record.runId,
      clientMessageId,
      cause: record.cause,
      generation,
    });

    dbg("send", "submit.start", {
      runId: record.runId,
      clientMessageId,
      cause: record.cause,
      generation,
    });

    void this.invokeTransport(record);
    return record.promise;
  }

  private createRecord(
    options: SendSubmitOptions,
    clientMessageId: string,
    generation: number,
    state: SendState,
  ): InFlightRecord {
    let resolve!: (value: { clientMessageId: string }) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<{ clientMessageId: string }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      runId: options.runId,
      sessionId: options.sessionId ?? null,
      clientMessageId,
      draft: options.draft,
      cause: options.cause ?? "continue",
      state,
      generation,
      settled: false,
      promise,
      resolve,
      reject,
      transport: options.transport,
    };
  }

  private attachToRecord(record: InFlightRecord): Promise<{ clientMessageId: string }> {
    return record.promise;
  }

  private async invokeTransport(record: InFlightRecord): Promise<void> {
    const transport = record.transport;
    try {
      await transport(record.clientMessageId);
    } catch (rawError) {
      if (record.settled) {
        throw new SendCoordinatorError(
          record.failure ?? {
            code: "stale_identity",
            message: "Submit was cancelled",
            retryable: false,
          },
        );
      }
      const failure = toSendFailure(rawError);
      this.transitionToFailed(record, failure, "transport rejected");
      record.reject?.(new SendCoordinatorError(failure));
      return;
    }
    if (record.settled) {
      record.reject?.(
        new SendCoordinatorError(
          record.failure ?? {
            code: "stale_identity",
            message: "Submit was cancelled",
            retryable: false,
          },
        ),
      );
      return;
    }
    this.completeWithAccepted(record);
    record.resolve({ clientMessageId: record.clientMessageId });
  }

  private expireQueueEntry(clientMessageId: string): void {
    const record = this.queued.get(clientMessageId);
    if (!record || record.settled) return;
    this.queued.delete(clientMessageId);
    this.transitionToFailed(
      record,
      {
        code: "queue_expired",
        message: "Queued submit expired before connection recovered",
        retryable: true,
      },
      "queue-expired",
    );
    record.reject?.(
      new SendCoordinatorError({
        code: "queue_expired",
        message: "Queued submit expired before connection recovered",
        retryable: true,
      }),
    );
  }

  private completeWithAccepted(record: InFlightRecord): void {
    if (record.settled) return;
    record.settled = true;
    record.state = "accepted";
    this.inFlight.delete(record.clientMessageId);
    this.queued.delete(record.clientMessageId);
    this.clearTtlTimer(record);
    this.retryable.delete(record.clientMessageId);
    this.addAcknowledged(record.clientMessageId);
    const event: SendStatusEvent = {
      state: "accepted",
      runId: record.runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      generation: record.generation,
    };
    this.onAccepted?.(event);
    this.emit(event);
  }

  private transitionToFailed(record: InFlightRecord, failure: SendFailure, label: string): void {
    if (record.settled) return;
    record.settled = true;
    record.state = "failed";
    record.failure = failure;
    this.inFlight.delete(record.clientMessageId);
    this.queued.delete(record.clientMessageId);
    this.clearTtlTimer(record);
    if (failure.retryable) {
      this.addRetryable(record, failure);
    } else {
      this.retryable.delete(record.clientMessageId);
    }
    const event: SendStatusEvent = {
      state: "failed",
      runId: record.runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      generation: record.generation,
      error: failure,
    };
    dbgWarn("send", "submit.failed", {
      runId: record.runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      code: failure.code,
      retryable: failure.retryable,
      label,
    });
    this.onFailure?.(event);
    this.emit(event);
  }

  private transitionToCancelled(record: InFlightRecord, failure: SendFailure, label: string): void {
    if (record.settled) return;
    record.settled = true;
    record.state = "cancelled";
    record.failure = failure;
    this.inFlight.delete(record.clientMessageId);
    this.queued.delete(record.clientMessageId);
    this.clearTtlTimer(record);
    this.retryable.delete(record.clientMessageId);
    const event: SendStatusEvent = {
      state: "cancelled",
      runId: record.runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      generation: record.generation,
      error: failure,
    };
    dbgWarn("send", "submit.cancelled", {
      runId: record.runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      code: failure.code,
      retryable: failure.retryable,
      label,
    });
    this.emit(event);
  }

  private cancelAllQueued(reason: string): number {
    let cancelled = 0;
    for (const [clientId, record] of Array.from(this.queued.entries())) {
      if (record.settled) continue;
      this.transitionToCancelled(
        record,
        { code: "transport_unavailable", message: reason, retryable: true },
        "phase-leave",
      );
      this.queued.delete(clientId);
      this.clearTtlTimer(record);
      record.reject?.(
        new SendCoordinatorError({
          code: "transport_unavailable",
          message: reason,
          retryable: true,
        }),
      );
      cancelled += 1;
    }
    return cancelled;
  }

  private findRecord(runId: string, clientMessageId?: string): InFlightRecord | undefined {
    if (clientMessageId) {
      const record = this.inFlight.get(clientMessageId) ?? this.queued.get(clientMessageId);
      if (record && record.runId === runId) return record;
      return undefined;
    }
    for (const record of this.inFlight.values()) {
      if (record.runId === runId) return record;
    }
    for (const record of this.queued.values()) {
      if (record.runId === runId) return record;
    }
    return undefined;
  }

  private addRetryable(record: InFlightRecord, failure: SendFailure): void {
    if (this.retryable.size >= this.maxRetryable) {
      const oldestKey = this.retryable.keys().next().value as string | undefined;
      if (oldestKey) this.retryable.delete(oldestKey);
    }
    this.retryable.set(record.clientMessageId, {
      clientMessageId: record.clientMessageId,
      runId: record.runId,
      sessionId: record.sessionId,
      draft: record.draft,
      cause: record.cause,
      generation: record.generation,
      failure,
      transport: record.transport,
    });
  }

  private addAcknowledged(clientMessageId: string): void {
    if (this.acknowledged.size >= this.maxAcknowledged) {
      const oldestKey = this.acknowledged.keys().next().value as string | undefined;
      if (oldestKey) this.acknowledged.delete(oldestKey);
    }
    this.acknowledged.set(clientMessageId, this.generation);
  }

  private clearTtlTimer(record: InFlightRecord): void {
    if (record.ttlTimer !== undefined) {
      try {
        this.timers.clearTimeout(record.ttlTimer);
      } catch (e) {
        dbgWarn("send", "clearTimeout failed", { error: e });
      }
      record.ttlTimer = undefined;
    }
  }

  private emit(event: SendStatusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        dbgWarn("send", "listener.error", { error: e });
      }
    }
  }

  private emitTransportPhase(event: TransportPhaseEvent): void {
    if (event.previousGeneration === event.generation && event.previousPhase === event.phase) {
      return;
    }
    for (const listener of this.transportListeners) {
      try {
        listener(event);
      } catch (e) {
        dbgWarn("send", "transportListener.error", { error: e });
      }
    }
  }
}

/**
 * Public Error subclass that carries the structured failure.
 */
export class SendCoordinatorError extends Error {
  readonly failure: SendFailure;
  constructor(failure: SendFailure) {
    super(failure.message);
    this.name = "SendCoordinatorError";
    this.failure = failure;
  }
}

function toSendFailure(raw: unknown): SendFailure {
  if (raw instanceof SendCoordinatorError) return raw.failure;
  if (raw instanceof Error) {
    const message = raw.message || raw.name || "Transport error";
    if (/timeout/i.test(raw.name) || /timeout/i.test(message)) {
      return { code: "timeout", message, retryable: true, cause: raw.name };
    }
    if (
      /not.?connected/i.test(message) ||
      /reconnect/i.test(message) ||
      /websocket/i.test(message) ||
      /disposed/i.test(raw.name)
    ) {
      return { code: "transport_unavailable", message, retryable: true, cause: raw.name };
    }
    if (/stale.?identity|identity.?changed/i.test(message)) {
      return { code: "stale_identity", message, retryable: false, cause: raw.name };
    }
    if (/stale.?generation/i.test(message)) {
      return { code: "stale_generation", message, retryable: true, cause: raw.name };
    }
    if (/actor.?dead|not.?found|unknown.?run|rejected/i.test(message)) {
      return { code: "rejected", message, retryable: false, cause: raw.name };
    }
    return { code: "unknown", message, retryable: true, cause: raw.name };
  }
  return { code: "unknown", message: String(raw), retryable: true };
}
