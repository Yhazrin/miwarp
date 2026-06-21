/**
 * Bounded queue / TTL helpers for {@link SendCoordinator}.
 *
 * The coordinator retains four maps (`inFlight`, `queued`, `retryable`,
 * `acknowledged`) each capped to a configurable max size. When a map
 * reaches its limit, the oldest entry is evicted (Map iteration order is
 * insertion-ordered). Queued records additionally carry a TTL timer that
 * is cleared on settle, drain, dispose, or explicit cancel.
 *
 * The helpers in this file are pure data-structure operations — they do
 * not emit events or invoke hooks. Lifecycle transitions live in
 * `transitions.ts`.
 */
import type { TimeoutApi } from "$lib/transport";
import { dbgWarn } from "$lib/utils/debug";
import { SendCoordinatorError } from "./failure";
import type { InFlightRecord, RetryableRecord, SendFailure } from "./types";

export interface BoundedMapState {
  inFlight: Map<string, InFlightRecord>;
  queued: Map<string, InFlightRecord>;
  retryable: Map<string, RetryableRecord>;
  acknowledged: Map<string, number>;
}

/** Drop and return the oldest queued entry, if any. */
export function dropOldestQueued(state: BoundedMapState): InFlightRecord | undefined {
  const oldestKey = state.queued.keys().next().value as string | undefined;
  if (!oldestKey) return undefined;
  const oldest = state.queued.get(oldestKey);
  if (oldest) {
    state.queued.delete(oldestKey);
    return oldest;
  }
  return undefined;
}

/** Drop the oldest retryable entry if the retryable map is at capacity. */
export function evictOldestRetryableIfFull(state: BoundedMapState, maxRetryable: number): void {
  if (state.retryable.size < maxRetryable) return;
  const oldestKey = state.retryable.keys().next().value as string | undefined;
  if (oldestKey !== undefined) state.retryable.delete(oldestKey);
}

/** Drop the oldest acknowledged id if the acknowledged map is at capacity. */
export function evictOldestAcknowledgedIfFull(
  state: BoundedMapState,
  maxAcknowledged: number,
): void {
  if (state.acknowledged.size < maxAcknowledged) return;
  const oldestKey = state.acknowledged.keys().next().value as string | undefined;
  if (oldestKey !== undefined) state.acknowledged.delete(oldestKey);
}

export function addRetryableBounded(
  state: BoundedMapState,
  maxRetryable: number,
  record: InFlightRecord,
  failure: SendFailure,
): void {
  evictOldestRetryableIfFull(state, maxRetryable);
  state.retryable.set(record.clientMessageId, {
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

export function addAcknowledgedBounded(
  state: BoundedMapState,
  maxAcknowledged: number,
  clientMessageId: string,
  generation: number,
): void {
  evictOldestAcknowledgedIfFull(state, maxAcknowledged);
  state.acknowledged.set(clientMessageId, generation);
}

/**
 * Schedule a TTL expiry callback for a queued entry. Returns `undefined`
 * when the TTL is disabled (≤ 0) so callers can skip the cleanup branch.
 */
export function setupTtlTimer(
  timers: TimeoutApi,
  onExpire: () => void,
  ttlMs: number,
): ReturnType<typeof setTimeout> | undefined {
  if (ttlMs <= 0) return undefined;
  return timers.setTimeout(onExpire, ttlMs);
}

/** Clear the TTL timer attached to a record, swallowing clearTimeout errors. */
export function clearTtlTimer(timers: TimeoutApi, record: InFlightRecord): void {
  if (record.ttlTimer === undefined) return;
  try {
    timers.clearTimeout(record.ttlTimer);
  } catch (e) {
    dbgWarn("send", "clearTimeout failed", { error: e });
  }
  record.ttlTimer = undefined;
}

/**
 * Find a pending record by `clientMessageId` (preferred) or by `runId`.
 * The id match is exact; the runId match returns the first hit in
 * `inFlight` then `queued` (insertion order).
 */
export function findPendingRecord(
  state: BoundedMapState,
  runId: string,
  clientMessageId?: string,
): InFlightRecord | undefined {
  if (clientMessageId) {
    const record = state.inFlight.get(clientMessageId) ?? state.queued.get(clientMessageId);
    if (record && record.runId === runId) return record;
    return undefined;
  }
  for (const record of state.inFlight.values()) {
    if (record.runId === runId) return record;
  }
  for (const record of state.queued.values()) {
    if (record.runId === runId) return record;
  }
  return undefined;
}

/** Reject a record's promise with a structured {@link SendFailure}. */
export function rejectRecord(record: InFlightRecord, failure: SendFailure): void {
  record.reject?.(new SendCoordinatorError(failure));
}
