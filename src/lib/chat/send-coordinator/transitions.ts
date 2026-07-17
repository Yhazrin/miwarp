/**
 * Lifecycle transitions and bulk operations for {@link SendCoordinator}.
 *
 * Each submit moves through exactly one terminal transition:
 * `submitting → accepted | failed | cancelled`. The terminal side effects
 * (removal from `inFlight` / `queued`, retryable retention, event
 * emission, hook invocation) are bundled here so the public class can
 * delegate rather than re-implement the bookkeeping.
 *
 * Bulk operations iterate the bounded maps and apply the same terminal
 * semantics, preserving the "one terminal transition per submit" invariant
 * by short-circuiting on `record.settled`.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type {
  InFlightRecord,
  RetryableRecord,
  SendFailure,
  SendListener,
  SendStatusEvent,
} from "./types";
import {
  addAcknowledgedBounded,
  addRetryableBounded,
  clearSubmitTimeoutTimer,
  clearTtlTimer,
  rejectRecord,
} from "./queue-policy";
import type { BoundedMapState } from "./queue-policy";

export interface TransitionContext {
  /** All four bounded maps — see {@link BoundedMapState}. */
  maps: BoundedMapState;
  /** Per-map capacity for `retryable` (FIFO eviction). */
  maxRetryable: number;
  /** Per-map capacity for `acknowledged` (FIFO eviction). */
  maxAcknowledged: number;
  /** Timer API for TTL bookkeeping. */
  timers: import("$lib/transport").TimeoutApi;
  /** Subscriber set; failures are isolated via try/catch. */
  listeners: Set<SendListener>;
  /** Hook invoked on the first accepted transition. */
  onAccepted?: (event: SendStatusEvent) => void;
  /** Hook invoked on the first failed transition. */
  onFailure?: (event: SendStatusEvent) => void;
  /** Live connection generation — needed for {@link addAcknowledgedBounded}. */
  currentGeneration: () => number;
}

/** Fan-out a status event to all listeners, isolating listener exceptions. */
export function emitToListeners(listeners: Set<SendListener>, event: SendStatusEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      dbgWarn("send", "listener.error", { error: e });
    }
  }
}

/**
 * Mark a record as accepted. Removes it from `inFlight` / `queued`,
 * clears its TTL timer, retains the id in the `acknowledged` ledger, and
 * emits a `SendStatusEvent`. Idempotent: a re-call on an already-settled
 * record is a no-op.
 */
export function completeWithAccepted(ctx: TransitionContext, record: InFlightRecord): void {
  if (record.settled) return;
  record.settled = true;
  record.state = "accepted";
  ctx.maps.inFlight.delete(record.clientMessageId);
  ctx.maps.queued.delete(record.clientMessageId);
  clearTtlTimer(ctx.timers, record);
  clearSubmitTimeoutTimer(ctx.timers, record);
  ctx.maps.retryable.delete(record.clientMessageId);
  addAcknowledgedBounded(
    ctx.maps,
    ctx.maxAcknowledged,
    record.clientMessageId,
    ctx.currentGeneration(),
  );
  const event: SendStatusEvent = {
    state: "accepted",
    runId: record.runId,
    clientMessageId: record.clientMessageId,
    cause: record.cause,
    generation: record.generation,
  };
  ctx.onAccepted?.(event);
  emitToListeners(ctx.listeners, event);
}

/**
 * Mark a record as failed. Retains retryable records (with the captured
 * failure) for `retry()` to reuse. Idempotent: a re-call on an
 * already-settled record is a no-op.
 */
export function transitionToFailed(
  ctx: TransitionContext,
  record: InFlightRecord,
  failure: SendFailure,
  label: string,
): void {
  if (record.settled) return;
  record.settled = true;
  record.state = "failed";
  record.failure = failure;
  ctx.maps.inFlight.delete(record.clientMessageId);
  ctx.maps.queued.delete(record.clientMessageId);
  clearTtlTimer(ctx.timers, record);
  clearSubmitTimeoutTimer(ctx.timers, record);
  if (failure.retryable) {
    addRetryableBounded(ctx.maps, ctx.maxRetryable, record, failure);
  } else {
    ctx.maps.retryable.delete(record.clientMessageId);
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
  ctx.onFailure?.(event);
  emitToListeners(ctx.listeners, event);
}

/**
 * Mark a record as cancelled. Always drops the record from the retryable
 * ledger (cancellation is not retryable in the same shape as a transport
 * failure). Idempotent: a re-call on an already-settled record is a
 * no-op.
 */
export function transitionToCancelled(
  ctx: TransitionContext,
  record: InFlightRecord,
  failure: SendFailure,
  label: string,
): void {
  if (record.settled) return;
  record.settled = true;
  record.state = "cancelled";
  record.failure = failure;
  ctx.maps.inFlight.delete(record.clientMessageId);
  ctx.maps.queued.delete(record.clientMessageId);
  clearTtlTimer(ctx.timers, record);
  clearSubmitTimeoutTimer(ctx.timers, record);
  ctx.maps.retryable.delete(record.clientMessageId);
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
  emitToListeners(ctx.listeners, event);
}

const STALE_GENERATION_FAILURE: SendFailure = {
  code: "stale_generation",
  message: "Connection regenerated before delivery",
  retryable: true,
};

/** Cancel every queued record whose captured generation is older than the live one. */
function cancelStaleQueued(ctx: TransitionContext, currentGeneration: number): number {
  if (currentGeneration <= 0) return 0;
  let cancelled = 0;
  for (const [clientId, record] of Array.from(ctx.maps.queued.entries())) {
    if (record.generation >= currentGeneration || record.settled) continue;
    transitionToCancelled(ctx, record, STALE_GENERATION_FAILURE, "stale-queued");
    ctx.maps.queued.delete(clientId);
    rejectRecord(record, STALE_GENERATION_FAILURE);
    cancelled += 1;
  }
  return cancelled;
}

/** Cancel every in-flight record whose captured generation is older than the live one. */
function cancelStaleInFlight(ctx: TransitionContext, currentGeneration: number): number {
  if (currentGeneration <= 0) return 0;
  let cancelled = 0;
  for (const [clientId, record] of Array.from(ctx.maps.inFlight.entries())) {
    if (record.generation >= currentGeneration || record.settled) continue;
    transitionToFailed(ctx, record, STALE_GENERATION_FAILURE, "stale-in-flight");
    ctx.maps.inFlight.delete(clientId);
    rejectRecord(record, STALE_GENERATION_FAILURE);
    cancelled += 1;
  }
  return cancelled;
}

export function cancelStaleGenerations(ctx: TransitionContext, currentGeneration: number): number {
  const queued = cancelStaleQueued(ctx, currentGeneration);
  const inFlight = cancelStaleInFlight(ctx, currentGeneration);
  const total = queued + inFlight;
  if (total > 0) {
    dbgWarn("send", "cancelStaleGenerations", { currentGeneration, cancelled: total });
  }
  return total;
}

/** Cancel every queued record matching `predicate`. */
export function cancelMatchingQueued(
  ctx: TransitionContext,
  predicate: (record: InFlightRecord) => boolean,
  failure: SendFailure,
  label: string,
): number {
  let cancelled = 0;
  for (const [clientId, record] of Array.from(ctx.maps.queued.entries())) {
    if (!predicate(record) || record.settled) continue;
    transitionToCancelled(ctx, record, failure, label);
    ctx.maps.queued.delete(clientId);
    rejectRecord(record, failure);
    cancelled += 1;
  }
  return cancelled;
}

/** Cancel every in-flight record matching `predicate`. */
export function cancelMatchingInFlight(
  ctx: TransitionContext,
  predicate: (record: InFlightRecord) => boolean,
  failure: SendFailure,
  label: string,
): number {
  let cancelled = 0;
  for (const [clientId, record] of Array.from(ctx.maps.inFlight.entries())) {
    if (!predicate(record) || record.settled) continue;
    transitionToCancelled(ctx, record, failure, label);
    ctx.maps.inFlight.delete(clientId);
    rejectRecord(record, failure);
    cancelled += 1;
  }
  return cancelled;
}

/** Cancel every queued record regardless of identity (used when leaving the connected phase). */
export function cancelAllQueued(
  ctx: TransitionContext,
  failure: SendFailure,
  label: string,
): number {
  let cancelled = 0;
  for (const [clientId, record] of Array.from(ctx.maps.queued.entries())) {
    if (record.settled) continue;
    transitionToCancelled(ctx, record, failure, label);
    ctx.maps.queued.delete(clientId);
    rejectRecord(record, failure);
    cancelled += 1;
  }
  return cancelled;
}

/**
 * Drain the queued map into in-flight in FIFO order. Records whose
 * captured generation is older than `targetGen` are cancelled without
 * re-dispatch (reconnect-storm single-flush invariant). Returns the
 * number of records dispatched.
 */
export function drainQueue(
  ctx: TransitionContext,
  targetGen: number,
  onDispatch: (record: InFlightRecord) => void,
): number {
  if (ctx.maps.queued.size === 0) return 0;

  // Snapshot FIFO order. JS Map iteration is insertion-ordered.
  const drained: InFlightRecord[] = [];
  for (const record of ctx.maps.queued.values()) {
    drained.push(record);
  }

  let dispatched = 0;
  let cancelledStale = 0;
  for (const record of drained) {
    clearTtlTimer(ctx.timers, record);
    if (record.generation < targetGen) {
      // Old generation captured before the latest reconnect — cancel,
      // do NOT re-dispatch. The reconnect-storm single-flush invariant
      // explicitly forbids replaying an already-buffered submit across
      // a new generation.
      cancelledStale += 1;
      transitionToCancelled(ctx, record, STALE_GENERATION_FAILURE, "reconcile-stale");
      ctx.maps.queued.delete(record.clientMessageId);
      rejectRecord(record, STALE_GENERATION_FAILURE);
      continue;
    }
    ctx.maps.queued.delete(record.clientMessageId);
    record.state = "submitting";
    ctx.maps.inFlight.set(record.clientMessageId, record);
    dispatched += 1;
    onDispatch(record);
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

/** Drop every pending record (used by `dispose`). */
export function disposeAll(ctx: TransitionContext, failure: SendFailure): void {
  for (const record of ctx.maps.inFlight.values()) {
    record.settled = true;
    clearTtlTimer(ctx.timers, record);
    clearSubmitTimeoutTimer(ctx.timers, record);
    rejectRecord(record, failure);
  }
  for (const record of ctx.maps.queued.values()) {
    record.settled = true;
    clearTtlTimer(ctx.timers, record);
    rejectRecord(record, failure);
  }
  ctx.maps.inFlight.clear();
  ctx.maps.queued.clear();
  ctx.maps.retryable.clear();
  ctx.maps.acknowledged.clear();
}

/** Test helper: snapshot every pending record into a debug-friendly shape. */
export function snapshotPending(maps: BoundedMapState): {
  runId: string;
  state: InFlightRecord["state"];
  clientMessageId: string;
  queued: boolean;
  generation: number;
}[] {
  const inflight = Array.from(maps.inFlight.values()).map((r) => ({
    runId: r.runId,
    state: r.state,
    clientMessageId: r.clientMessageId,
    queued: false,
    generation: r.generation,
  }));
  const queued = Array.from(maps.queued.values()).map((r) => ({
    runId: r.runId,
    state: r.state,
    clientMessageId: r.clientMessageId,
    queued: true,
    generation: r.generation,
  }));
  return [...inflight, ...queued];
}

/** Re-export `RetryableRecord` so consumers can import from one place. */
export type {InFlightRecord};
