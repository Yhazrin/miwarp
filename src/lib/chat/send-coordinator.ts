/**
 * SendCoordinator: state machine for "user pressed Send → agent
 * acknowledges receipt" with v1.0.9 Phase 2 reconnect-aware buffering.
 *
 * Phase 1 invariants: one in-flight slot per clientMessageId; run identity
 * captured at submit time so session switches cannot cross-route;
 * submit-accepted (transport resolved) is distinguished from
 * transport-available (connection up); typed failure with retryable
 * surfaced; one terminal transition per submit.
 *
 * Phase 2 additions: bounded reconnect-aware queue keyed by
 * clientMessageId; generation tracking with `stale_generation` cancel;
 * bounded maps with FIFO eviction; per-queue TTL via TimeoutApi;
 * `cancelled` terminal state.
 *
 * The coordinator does NOT know about the prompt input store directly.
 * The caller owns the draft and clears it via `subscribe()` on accept.
 *
 * Orchestration is split across focused submodules; this file owns the
 * public class surface, the transport phase/generation state, and the
 * emit fan-out. See `./send-coordinator/` for the cohesive helpers.
 */
import { systemTimers, type TimeoutApi } from "$lib/transport";
import { uuid } from "$lib/utils/uuid";
import { dbg, dbgWarn } from "$lib/utils/debug";

import { SendCoordinatorError } from "./send-coordinator/failure";
import { generateClientMessageId, resolveGeneration } from "./send-coordinator/identity";
import {
  applyTransportPhase,
  bumpGeneration as bumpGenerationPure,
} from "./send-coordinator/phase-machine";
import {
  DEFAULT_MAX_ACKNOWLEDGED,
  DEFAULT_MAX_QUEUED,
  DEFAULT_MAX_RETRYABLE,
  DEFAULT_QUEUE_TTL_MS,
  DEFAULT_SUBMIT_TIMEOUT_MS,
} from "./send-coordinator/policy";
import {
  clearSubmitTimeoutTimer,
  clearTtlTimer,
  findPendingRecord,
  rejectRecord,
} from "./send-coordinator/queue-policy";
import type { BoundedMapState } from "./send-coordinator/queue-policy";
import {
  cancelMatchingInFlight,
  cancelMatchingQueued,
  completeWithAccepted,
  disposeAll,
  drainQueue,
  emitToListeners,
  snapshotPending,
  transitionToCancelled,
  transitionToFailed,
} from "./send-coordinator/transitions";
import {
  dispatchSubmit,
  expireQueueEntry,
  invokeTransport,
  queueSubmit,
} from "./send-coordinator/submit-pipeline";
import type {
  InFlightRecord,
  RetryableRecord,
  SendCoordinatorOptions,
  SendDraft,
  SendFailure,
  SendListener,
  SendState,
  SendStatusEvent,
  SendSubmitOptions,
  TransportPhase,
  TransportPhaseEvent,
  TransportPhaseListener,
} from "./send-coordinator/types";

export { SendCoordinatorError } from "./send-coordinator/failure";

export type {
  SendCoordinatorOptions,
  SendDraft,
  SendFailure,
  SendListener,
  SendState,
  SendStatusEvent,
  SendSubmitOptions,
  TransportPhase,
  TransportPhaseEvent,
  TransportPhaseListener,
};

export class SendCoordinator {
  private readonly maps: BoundedMapState = {
    inFlight: new Map<string, InFlightRecord>(),
    queued: new Map<string, InFlightRecord>(),
    retryable: new Map<string, RetryableRecord>(),
    acknowledged: new Map<string, number>(),
  };

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

  private get context() {
    return {
      maps: this.maps,
      maxRetryable: this.maxRetryable,
      maxAcknowledged: this.maxAcknowledged,
      timers: this.timers,
      listeners: this.listeners,
      onAccepted: this.onAccepted,
      onFailure: this.onFailure,
      currentGeneration: () => this.generation,
    };
  }

  private get phaseMachine() {
    return {
      getPhase: () => this.phase,
      setPhase: (p: TransportPhase) => {
        this.phase = p;
      },
      getGeneration: () => this.generation,
      setGeneration: (g: number) => {
        this.generation = g;
      },
      context: this.context,
    };
  }

  get busy(): boolean {
    return this.maps.inFlight.size > 0 || this.maps.queued.size > 0;
  }

  get pendingCount(): number {
    return this.maps.inFlight.size + this.maps.queued.size;
  }

  get queuedCount(): number {
    return this.maps.queued.size;
  }

  get retryableCount(): number {
    return this.maps.retryable.size;
  }

  get transportPhase(): TransportPhase {
    return this.phase;
  }

  get connectionGeneration(): number {
    return this.generation;
  }

  get canSubmit(): boolean {
    return this.phase === "connected";
  }

  isSubmitting(runId?: string): boolean {
    if (!runId) return this.busy;
    for (const record of this.maps.inFlight.values()) {
      if (record.runId === runId && record.state === "submitting") return true;
    }
    return false;
  }

  hasPending(runId?: string): boolean {
    if (!runId) return this.pendingCount > 0;
    for (const record of this.maps.inFlight.values()) {
      if (record.runId === runId) return true;
    }
    for (const record of this.maps.queued.values()) {
      if (record.runId === runId) return true;
    }
    return false;
  }

  subscribe(listener: SendListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeTransport(listener: TransportPhaseListener): () => void {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  /**
   * Update the transport phase. If the new phase is `connected`, callers
   * should follow with `reconcile({ generation, healthy: true })` to
   * drain the queue. Phase changes bump generation and cancel stale
   * records when leaving `connected`.
   */
  setTransportPhase(
    phase: TransportPhase,
    options: { generation?: number; reconcile?: boolean } = {},
  ): number {
    if (this.disposed) return this.generation;
    const previousPhase = this.phase;
    const previousGeneration = this.generation;
    const result = applyTransportPhase(this.phaseMachine, phase, options);
    if (result.phaseChanged || previousGeneration !== result.generation) {
      this.emitTransportPhase({
        phase,
        generation: result.generation,
        previousPhase,
        previousGeneration,
        cancelled: result.cancelled,
      });
    }
    if (options.reconcile && phase === "connected") {
      this.reconcile({ generation: this.generation, healthy: true });
    }
    return result.generation;
  }

  /**
   * Advance the connection generation. Cancels every record whose captured
   * generation is older. Single-flight reconnect-storm invariant: at most
   * one drain per generation. Returns the new generation.
   */
  bumpGeneration(nextGeneration?: number): number {
    if (this.disposed) return this.generation;
    const previousGeneration = this.generation;
    const result = bumpGenerationPure(this.phaseMachine, nextGeneration);
    if (result.generation !== previousGeneration) {
      this.emitTransportPhase({
        phase: this.phase,
        generation: result.generation,
        previousPhase: this.phase,
        previousGeneration,
        cancelled: result.cancelled,
      });
    }
    return result.generation;
  }

  /**
   * Drain the queue once, in FIFO order. Transport must be `connected`.
   * Returns the number of submits dispatched. Old-generation records are
   * cancelled before dispatch (reconnect-storm single-flush guarantee).
   */
  reconcile(options: { generation?: number; healthy: boolean }): number {
    if (this.disposed || !options.healthy) return 0;
    const targetGen =
      typeof options.generation === "number" && options.generation > this.generation
        ? (this.generation = options.generation)
        : this.generation;
    return drainQueue(this.context, targetGen, (record) => {
      void invokeTransport(this.pipelineContext, record);
    });
  }

  /**
   * Submit a user message. Resolves on submit-accepted; rejects with
   * `SendCoordinatorError` on terminal failure. Caller should NOT clear
   * the draft on rejection.
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
    const clientMessageId = generateClientMessageId(this.uuidFactory, options.clientMessageId);
    const generation = resolveGeneration(options.generation, this.generation);

    // Idempotency: same id already accepted → resolve immediately.
    if (this.maps.acknowledged.has(clientMessageId)) {
      return Promise.resolve({ clientMessageId });
    }
    // Same id already in flight or queued → return the same promise.
    const existing =
      this.maps.inFlight.get(clientMessageId) ?? this.maps.queued.get(clientMessageId);
    if (existing) {
      return existing.promise;
    }
    // Same id was a retryable failure → drop the stale record.
    this.maps.retryable.delete(clientMessageId);

    if (this.phase !== "connected") {
      return queueSubmit(this.pipelineContext, options, clientMessageId, generation, () =>
        this.expireQueueEntry(clientMessageId),
      );
    }
    return dispatchSubmit(this.pipelineContext, options, clientMessageId, generation, (record) =>
      invokeTransport(this.pipelineContext, record),
    );
  }

  /**
   * Retry a previously-failed submit. Re-uses the same `clientMessageId`
   * so the backend's accepted-ledger dedupe kicks in. Returns `null` if
   * no retryable record exists.
   */
  retry(clientMessageId: string): Promise<{ clientMessageId: string }> | null {
    const record = this.maps.retryable.get(clientMessageId);
    if (!record) return null;
    this.maps.retryable.delete(clientMessageId);
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

  /** Cancel a single pending submit by `clientMessageId`. No-op if not pending. */
  cancel(clientMessageId: string, reason = "Cancelled by user"): boolean {
    const record = this.maps.inFlight.get(clientMessageId) ?? this.maps.queued.get(clientMessageId);
    if (!record || record.settled) return false;
    const failure: SendFailure = { code: "stale_identity", message: reason, retryable: false };
    transitionToCancelled(this.context, record, failure, "cancel");
    this.maps.inFlight.delete(clientMessageId);
    this.maps.queued.delete(clientMessageId);
    clearTtlTimer(this.timers, record);
    clearSubmitTimeoutTimer(this.timers, record);
    rejectRecord(record, failure);
    return true;
  }

  /** Mark the submit as queued. Caller (e.g. browser transport) signals buffer hold. */
  markQueued(runId: string, clientMessageId?: string): boolean {
    const record = findPendingRecord(this.maps, runId, clientMessageId);
    if (!record || record.state !== "submitting" || record.settled) return false;
    record.state = "queued";
    this.emit({
      state: "queued",
      runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      generation: record.generation,
      queueDepth: this.maps.queued.size,
    });
    return true;
  }

  /** Acknowledge the submit as fully accepted by the backend. Idempotent on `clientMessageId`. */
  acknowledge(runId: string, clientMessageId?: string): boolean {
    const record = findPendingRecord(this.maps, runId, clientMessageId);
    if (record) {
      if (clientMessageId && record.clientMessageId !== clientMessageId) return false;
      completeWithAccepted(this.context, record);
      return true;
    }
    if (clientMessageId && this.maps.acknowledged.has(clientMessageId)) return true;
    return false;
  }

  /** Abort a submit (e.g. session killed). Surfaces failed transition for draft restore. */
  abort(runId: string, reason: string, clientMessageId?: string): void {
    const record = findPendingRecord(this.maps, runId, clientMessageId);
    if (!record || record.settled) return;
    transitionToFailed(
      this.context,
      record,
      { code: "unknown", message: reason, retryable: false, cause: "aborted" },
      "aborted",
    );
    this.maps.inFlight.delete(record.clientMessageId);
    this.maps.queued.delete(record.clientMessageId);
    clearTtlTimer(this.timers, record);
    clearSubmitTimeoutTimer(this.timers, record);
  }

  /** Cancel any pending submits for a run (when run is disposed/replaced). */
  cancelForRun(runId: string, reason = "Run disposed", clientMessageId?: string): void {
    const failure: SendFailure = { code: "stale_identity", message: reason, retryable: false };
    const filter = (record: InFlightRecord) =>
      record.runId === runId && (!clientMessageId || record.clientMessageId === clientMessageId);
    const queued = cancelMatchingQueued(this.context, filter, failure, "cancelled-queued");
    const inflight = cancelMatchingInFlight(this.context, filter, failure, "cancelled");
    const cancelled = queued + inflight;
    if (cancelled > 0) dbg("send", "cancelForRun", { runId, cancelled });
  }

  /** Drop any pending submit whose runId no longer matches the active run. Returns count dropped. */
  reconcileActiveRun(activeRunId: string | null | undefined): number {
    const failure: SendFailure = {
      code: "stale_identity",
      message: activeRunId ? "Active run switched" : "Active run lost",
      retryable: false,
    };
    const match = (record: InFlightRecord): boolean =>
      !record.settled && (activeRunId == null || record.runId !== activeRunId);
    const queued = cancelMatchingQueued(this.context, match, failure, "reconcile-queued");
    const inflight = cancelMatchingInFlight(this.context, match, failure, "reconcile");
    return queued + inflight;
  }

  /**
   * Dispose the coordinator. Drops listeners, cancels every pending
   * record, clears timers + maps. After dispose all public methods are
   * no-ops or reject with `transport_unavailable`.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeAll(this.context, {
      code: "transport_unavailable",
      message: "Coordinator disposed",
      retryable: false,
    });
    this.listeners.clear();
    this.transportListeners.clear();
    this.phase = "disposed";
  }

  /** Test helper: snapshot pending state (in-flight + queued). */
  _debugSnapshot(): {
    runId: string;
    state: SendState;
    clientMessageId: string;
    queued: boolean;
    generation: number;
  }[] {
    return snapshotPending(this.maps);
  }

  private get pipelineContext() {
    return {
      maps: this.maps,
      context: this.context,
      timers: this.timers,
      maxQueued: this.maxQueued,
      queueTtlMs: this.queueTtlMs,
      submitTimeoutMs: this.submitTimeoutMs,
      emit: (event: SendStatusEvent) => this.emit(event),
    };
  }

  private expireQueueEntry(clientMessageId: string): void {
    expireQueueEntry(this.pipelineContext, clientMessageId);
  }

  private emit(event: SendStatusEvent): void {
    emitToListeners(this.listeners, event);
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
