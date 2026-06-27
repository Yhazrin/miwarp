/**
 * TransportController — owns phase transitions, spawn/response timeouts,
 * and stream-mode detection.
 *
 * Extracted from session-store (Worker-4 P0/P1/P2 refactor, item #5
 * "Phase Transition Guard"). Wraps three concerns that were previously
 * inlined on the store:
 *   1. `_setPhase(to)` — uses `assertTransition` from types so an invalid
 *      phase move throws synchronously during dev.
 *   2. Spawn / response timeout pair — fires when the CLI does not respond
 *      to a "start" / "send" within a deadline.
 *   3. `_isStreamMode(ctx)` — true when we are in stream-json mode AND
 *      the run is alive; batch replay uses a separate code path.
 *
 * The store hands the controller callbacks (`onSpawnTimeout`,
 * `onResponseTimeout`) because the actual recovery (phase → failed,
 * `error` field) lives on the store.
 */

import { assertTransition, type SessionPhase } from "$lib/stores/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

export type TransportEventKind = "spawn" | "response";

export interface TransportTimeouts {
  spawnMs: number;
  responseMs: number;
}

export interface TransportTimers {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const systemTimers: TransportTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => {
    if (handle != null) clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export const DEFAULT_TIMEOUTS: TransportTimeouts = {
  spawnMs: 30_000,
  responseMs: 60_000,
};

export interface TransportControllerOptions {
  timers?: TransportTimers;
  timeouts?: Partial<TransportTimeouts>;
  onSpawnTimeout: (runId: string) => void;
  onResponseTimeout: (runId: string) => void;
}

export class TransportController {
  private readonly timers: TransportTimers;
  private readonly spawnMs: number;
  private readonly responseMs: number;
  private readonly onSpawnTimeout: (runId: string) => void;
  private readonly onResponseTimeout: (runId: string) => void;

  private spawnTimer: ReturnType<typeof setTimeout> | null = null;
  private responseTimer: ReturnType<typeof setTimeout> | null = null;
  private isTimeoutError = false;

  constructor(options: TransportControllerOptions) {
    this.timers = options.timers ?? systemTimers;
    this.spawnMs = options.timeouts?.spawnMs ?? DEFAULT_TIMEOUTS.spawnMs;
    this.responseMs = options.timeouts?.responseMs ?? DEFAULT_TIMEOUTS.responseMs;
    this.onSpawnTimeout = options.onSpawnTimeout;
    this.onResponseTimeout = options.onResponseTimeout;
  }

  /**
   * Apply a phase transition with invariant checking. Stores it on the
   * provided setter so the caller can wire to its own `$state` field.
   */
  setPhase(store: { phase: SessionPhase }, to: SessionPhase): void {
    const from = store.phase;
    if (from === to) return;
    try {
      assertTransition(from, to);
    } catch (err) {
      dbgWarn("phase", "invalid transition", { from, to, err });
    }
    store.phase = to;
  }

  startSpawnTimeout(runId: string): void {
    this.clearSpawnTimeout();
    this.spawnTimer = this.timers.setTimeout(() => {
      dbg("transport", "spawn-timeout", { runId });
      this.spawnTimer = null;
      this.isTimeoutError = true;
      this.onSpawnTimeout(runId);
    }, this.spawnMs) as ReturnType<typeof setTimeout> | null;
  }

  clearSpawnTimeout(): void {
    if (this.spawnTimer === null) return;
    this.timers.clearTimeout(this.spawnTimer);
    this.spawnTimer = null;
  }

  startResponseTimeout(runId: string): void {
    this.clearResponseTimeout();
    this.responseTimer = this.timers.setTimeout(() => {
      dbg("transport", "response-timeout", { runId });
      this.responseTimer = null;
      this.isTimeoutError = true;
      this.onResponseTimeout(runId);
    }, this.responseMs) as ReturnType<typeof setTimeout> | null;
  }

  clearResponseTimeout(): void {
    if (this.responseTimer === null) return;
    this.timers.clearTimeout(this.responseTimer);
    this.responseTimer = null;
  }

  clearTimeoutError(): void {
    this.isTimeoutError = false;
  }

  get timeoutError(): boolean {
    return this.isTimeoutError;
  }

  /**
   * Stream mode is "true when the run uses stream-json AND the session is
   * alive". During batch replay the store temporarily sets phase to
   * "running" before events are loaded — we want to skip the tools
   * mirror write path during that window.
   */
  isStreamMode(opts: { useStream: boolean; sessionAlive: boolean }): boolean {
    return opts.useStream && opts.sessionAlive;
  }

  /** Cancel all timers (page teardown). */
  dispose(): void {
    this.clearSpawnTimeout();
    this.clearResponseTimeout();
  }
}
