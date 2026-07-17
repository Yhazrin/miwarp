/**
 * Pending JSON-RPC request registry.
 *
 * Single responsibility: correlate request ids with their Promise resolvers,
 * manage per-request timeouts, and reject all pending on disconnect.
 *
 * Structured errors preserve message/code/data (never `[object Object]`).
 */

import { systemTimers, type TimeoutApi } from "./timer-api";

export interface RpcError {
  message: string;
  code?: number;
  data?: unknown;
}

class RequestTimeoutError extends Error {
  readonly code = "IPC_TIMEOUT";
  readonly data: { requestId: string; timeoutMs: number };

  constructor(requestId: string, timeoutMs: number) {
    super(`IPC_TIMEOUT: request ${requestId} did not respond in ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.data = { requestId, timeoutMs };
  }
}

export interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Generation at which this request was created — stale on reconnect */
  generation: number;
}

export class RequestRegistry {
  private pending = new Map<string, PendingEntry>();
  private nextId = 0;

  constructor(private readonly timers: TimeoutApi = systemTimers) {}

  get size(): number {
    return this.pending.size;
  }

  /** Generate a unique request id */
  allocateId(): string {
    return `req_${++this.nextId}`;
  }

  /**
   * Register a pending request. Returns the id.
   * The caller is responsible for sending the message over the wire.
   */
  register<T>(
    id: string,
    generation: number,
    timeoutMs: number,
  ): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
    let outerResolve!: (value: T) => void;
    let outerReject!: (error: Error) => void;

    const promise = new Promise<T>((resolve, reject) => {
      outerResolve = resolve;
      outerReject = reject;
    });

    const timer =
      timeoutMs > 0
        ? this.timers.setTimeout(() => {
            this.pending.delete(id);
            outerReject(new RequestTimeoutError(id, timeoutMs));
          }, timeoutMs)
        : null;

    this.pending.set(id, {
      resolve: (v) => {
        if (timer) this.timers.clearTimeout(timer);
        outerResolve(v as T);
      },
      reject: (e) => {
        if (timer) this.timers.clearTimeout(timer);
        outerReject(e);
      },
      timer,
      generation,
    });

    return { promise, resolve: outerResolve, reject: outerReject };
  }

  /**
   * Resolve a pending request by id.
   * Returns true if found and resolved, false otherwise.
   */
  resolve(id: string, result: unknown): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(result);
    return true;
  }

  /**
   * Reject a pending request by id with a structured RPC error.
   */
  rejectWithError(id: string, error: RpcError): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    const err = new Error(error.message);
    err.name = "RpcError";
    Object.defineProperty(err, "code", { value: error.code, enumerable: true });
    Object.defineProperty(err, "data", { value: error.data, enumerable: true });
    entry.reject(err);
    return true;
  }

  /**
   * Reject all pending requests. Called on disconnect.
   * Only rejects requests matching the given generation (current connection).
   */
  rejectAll(reason: string | Error, generation?: number): void {
    for (const [id, entry] of this.pending) {
      if (generation !== undefined && entry.generation !== generation) continue;
      if (entry.timer) this.timers.clearTimeout(entry.timer);
      entry.reject(typeof reason === "string" ? new Error(reason) : reason);
      this.pending.delete(id);
    }
  }

  /**
   * Reject all pending requests that belong to an older generation.
   * Called after reconnect to clean up stale requests.
   */
  rejectStale(currentGeneration: number, reason: string | Error): void {
    for (const [id, entry] of this.pending) {
      if (entry.generation < currentGeneration) {
        if (entry.timer) this.timers.clearTimeout(entry.timer);
        entry.reject(typeof reason === "string" ? new Error(reason) : reason);
        this.pending.delete(id);
      }
    }
  }

  /** Clear everything (for disposal) */
  dispose(reason: Error = new Error("Transport disposed")): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) this.timers.clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
  }
}
