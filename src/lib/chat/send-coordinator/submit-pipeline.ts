/**
 * Submit pipeline for {@link SendCoordinator}.
 *
 * Holds the four submit-time helpers that operate on a record after it
 * has been constructed: queueing into the bounded buffer, dispatching
 * directly to the transport, awaiting the transport promise, and TTL
 * expiry. These helpers share the same {@link SubmitPipelineContext} so
 * the orchestrator class can stay thin.
 */
import type { TimeoutApi } from "$lib/transport";
import { dbg } from "$lib/utils/debug";
import { SendCoordinatorError, toSendFailure } from "./failure";
import { createInFlightRecord } from "./identity";
import {
  clearSubmitTimeoutTimer,
  dropOldestQueued,
  rejectRecord,
  setupTtlTimer,
} from "./queue-policy";
import type { BoundedMapState } from "./queue-policy";
import { completeWithAccepted, transitionToFailed } from "./transitions";
import type { TransitionContext } from "./transitions";
import type { InFlightRecord, SendFailure, SendStatusEvent, SendSubmitOptions } from "./types";

export interface SubmitPipelineContext {
  maps: BoundedMapState;
  context: TransitionContext;
  timers: TimeoutApi;
  maxQueued: number;
  queueTtlMs: number;
  /** How long before an in-flight submit is considered timed out (ms). */
  submitTimeoutMs: number;
  /** Emit a status event to the orchestrator's listener set. */
  emit: (event: SendStatusEvent) => void;
}

/**
 * Park a submit in the bounded queue. If the queue is at capacity the
 * oldest entry is dropped with `queue_full` (retryable). A TTL timer is
 * scheduled to expire the entry if the transport does not recover.
 */
export function queueSubmit(
  ctx: SubmitPipelineContext,
  options: SendSubmitOptions,
  clientMessageId: string,
  generation: number,
  onExpire: () => void,
): Promise<{ clientMessageId: string }> {
  // Bounded queue: drop the oldest queued entry if we're at capacity.
  if (ctx.maps.queued.size >= ctx.maxQueued) {
    const oldest = dropOldestQueued(ctx.maps);
    if (oldest) {
      const failure: SendFailure = {
        code: "queue_full",
        message: "Send queue full; oldest message dropped",
        retryable: true,
      };
      transitionToFailed(ctx.context, oldest, failure, "queue-full");
      rejectRecord(oldest, failure);
    }
  }

  const record = createInFlightRecord(options, clientMessageId, generation, "queued");
  ctx.maps.queued.set(clientMessageId, record);
  record.ttlTimer = setupTtlTimer(ctx.timers, onExpire, ctx.queueTtlMs);

  ctx.emit({
    state: "queued",
    runId: record.runId,
    clientMessageId,
    cause: record.cause,
    generation,
    queueDepth: ctx.maps.queued.size,
  });

  dbg("send", "submit.queued", {
    runId: record.runId,
    clientMessageId,
    cause: record.cause,
    generation,
    queueDepth: ctx.maps.queued.size,
  });

  return record.promise;
}

/** Dispatch a submit directly to the transport (no queueing). */
export function dispatchSubmit(
  ctx: SubmitPipelineContext,
  options: SendSubmitOptions,
  clientMessageId: string,
  generation: number,
  onTransport: (record: InFlightRecord) => Promise<void>,
): Promise<{ clientMessageId: string }> {
  const record = createInFlightRecord(options, clientMessageId, generation, "submitting");
  ctx.maps.inFlight.set(clientMessageId, record);

  // Schedule a submit timeout. If the record is still not settled when
  // the timer fires, transition it to failed with code "timeout".
  if (ctx.submitTimeoutMs > 0) {
    record.submitTimeoutTimer = ctx.timers.setTimeout(() => {
      if (record.settled) return;
      const failure: SendFailure = {
        code: "timeout",
        message: `Submit timed out after ${ctx.submitTimeoutMs}ms`,
        retryable: true,
      };
      transitionToFailed(ctx.context, record, failure, "submit-timeout");
      ctx.maps.inFlight.delete(record.clientMessageId);
      rejectRecord(record, failure);
    }, ctx.submitTimeoutMs);
  }

  ctx.emit({
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

  void onTransport(record);
  return record.promise;
}

/** Expire a queued entry that exceeded its TTL window. */
export function expireQueueEntry(ctx: SubmitPipelineContext, clientMessageId: string): void {
  const record = ctx.maps.queued.get(clientMessageId);
  if (!record || record.settled) return;
  ctx.maps.queued.delete(clientMessageId);
  const failure: SendFailure = {
    code: "queue_expired",
    message: "Queued submit expired before connection recovered",
    retryable: true,
  };
  transitionToFailed(ctx.context, record, failure, "queue-expired");
  rejectRecord(record, failure);
}

/**
 * Await a record's transport promise and resolve it on accept. On
 * rejection, classify the error via {@link toSendFailure} and surface a
 * `failed` transition. Re-throws if the record was settled by another
 * path while the transport was in flight (cancellation, stale generation).
 */
export async function invokeTransport(
  ctx: SubmitPipelineContext,
  record: InFlightRecord,
): Promise<void> {
  const transport = record.transport;
  try {
    await transport(record.clientMessageId);
  } catch (rawError) {
    clearSubmitTimeoutTimer(ctx.timers, record);
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
    transitionToFailed(ctx.context, record, failure, "transport rejected");
    rejectRecord(record, failure);
    return;
  }
  clearSubmitTimeoutTimer(ctx.timers, record);
  if (record.settled) {
    rejectRecord(
      record,
      record.failure ?? {
        code: "stale_identity",
        message: "Submit was cancelled",
        retryable: false,
      },
    );
    return;
  }
  completeWithAccepted(ctx.context, record);
  record.resolve({ clientMessageId: record.clientMessageId });
}
