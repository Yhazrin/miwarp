/**
 * Identity and generation helpers for {@link SendCoordinator}.
 *
 * A submit's identity is the tuple `(runId, clientMessageId, generation)`
 * plus the captured draft + transport closure. These helpers construct
 * {@link InFlightRecord} / {@link RetryableRecord} shapes and resolve the
 * effective generation for a submit (the caller's value wins; otherwise
 * the coordinator's current generation is used).
 */
import type {
  InFlightRecord,
  RetryableRecord,
  SendFailure,
  SendState,
  SendSubmitOptions,
} from "./types";

export function generateClientMessageId(uuidFactory: () => string, provided?: string): string {
  return provided ?? uuidFactory();
}

export function resolveGeneration(provided: number | undefined, currentGeneration: number): number {
  return provided ?? currentGeneration;
}

export function createInFlightRecord(
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

export function buildRetryableRecord(
  record: InFlightRecord,
  failure: SendFailure,
): RetryableRecord {
  return {
    clientMessageId: record.clientMessageId,
    runId: record.runId,
    sessionId: record.sessionId,
    draft: record.draft,
    cause: record.cause,
    generation: record.generation,
    failure,
    transport: record.transport,
  };
}
