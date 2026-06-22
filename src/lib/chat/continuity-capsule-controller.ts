/**
 * Continuity Capsule Controller — v1.0.9
 *
 * Thin orchestrator around `continuity-capsule.ts` that:
 *   - Debounces state writes (default 500ms)
 *   - Flushes synchronously on `flush()` and on `pagehide` / `beforeunload`
 *   - Tracks a "generation" so a late save callback from a previous run
 *     cannot overwrite the current run's state
 *   - Exposes a one-shot `consumePendingRestore()` so the chat page only
 *     applies the restore exactly once per page lifetime
 *
 * The controller is intentionally **non-reactive** — it has no Svelte
 * runes. The chat page reads from it imperatively and the controller
 * subscribes to Svelte state via plain callbacks. This keeps the data
 * model decoupled from the page's reactive graph and prevents accidental
 * circular reactivity (the controller writing to itself driving more
 * reactivity).
 */

import {
  CAPSULE_TTL_MS,
  readRunState,
  isRunStateFresh,
  removeRunState,
  touchRunState,
  type ContinuityAnchor,
  type ContinuityDraft,
  type ContinuityInspector,
} from "./continuity-capsule";
import type { ProcessVisibility } from "$lib/utils/process-visibility";

export const DEFAULT_SAVE_DEBOUNCE_MS = 500;

export interface ContinuitySaveInput {
  runId: string;
  cwd: string;
  draft: ContinuityDraft | null;
  toolFilter: string | null;
  processVisibility: ProcessVisibility;
  anchor: ContinuityAnchor | null;
  inspector: ContinuityInspector;
}

export interface PendingRestore {
  runId: string;
  /** Draft to hydrate PromptInput with (null if the run had no draft). */
  draft: ContinuityDraft | null;
  toolFilter: string | null;
  processVisibility: ProcessVisibility;
  anchor: ContinuityAnchor | null;
  inspector: ContinuityInspector;
  cwd: string;
  /** When the original save happened (epoch ms). */
  savedAt: number;
}

export type FlushReason = "debounce" | "manual" | "pagehide" | "beforeNavigate" | "dispose";

export interface ContinuityCapsuleControllerOptions {
  /** Debounce window for `scheduleSave`. Default 500ms. */
  debounceMs?: number;
  /** Override `setTimeout` / `clearTimeout` for tests. */
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  /** Capture a snapshot of the current run's state. */
  capture: () => ContinuitySaveInput | null;
  /** Optional sink for diagnostics (e.g. `dbg`). */
  onLog?: (event: string, detail: Record<string, unknown>) => void;
}

export class ContinuityCapsuleController {
  private readonly timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  private readonly debounceMs: number;
  private readonly capture: () => ContinuitySaveInput | null;
  private readonly onLog: (event: string, detail: Record<string, unknown>) => void;

  /** Monotonic per-controller generation. Bumped on dispose / on run switch
   *  to invalidate any in-flight debounced save from a stale run. */
  private gen = 0;

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private currentRunId = "";

  /** One-shot pending restore, populated by `seed()`. Consumed exactly once
   *  by `consumePendingRestore()`. */
  private pendingRestore: PendingRestore | null = null;

  private pagehideHandler: (() => void) | null = null;
  private beforeUnloadHandler: (() => void) | null = null;
  private disposed = false;

  constructor(opts: ContinuityCapsuleControllerOptions) {
    this.timers = opts.timers ?? { setTimeout, clearTimeout };
    this.debounceMs = opts.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;
    this.capture = opts.capture;
    this.onLog = opts.onLog ?? (() => {});
  }

  /**
   * Initialize the controller. Registers `pagehide` + `beforeunload`
   * listeners so the latest state always lands on disk before the tab
   * is torn down. Should be called once on chat page mount.
   */
  attach(): void {
    if (typeof window === "undefined" || this.pagehideHandler) return;
    this.pagehideHandler = () => this.flush("pagehide");
    this.beforeUnloadHandler = () => this.flush("pagehide");
    window.addEventListener("pagehide", this.pagehideHandler);
    window.addEventListener("beforeunload", this.beforeUnloadHandler);
  }

  /**
   * Seed a pending restore for `runId` if a fresh capsule entry exists.
   * No-op if the entry is missing or expired. Returns true if a restore is
   * pending; the chat page should then call `consumePendingRestore()` to
   * actually apply it. The one-shot latch guarantees the restore runs
   * exactly once even if multiple effects re-fire.
   */
  seed(runId: string, now: number = Date.now()): boolean {
    if (this.disposed || !runId) return false;
    if (this.pendingRestore && this.pendingRestore.runId === runId) return true;
    this.onLog("seed", { runId });
    if (this.disposed) return false;
    const entry = readRunState(runId, now);
    if (!entry || !isRunStateFresh(entry, now)) return false;
    this.pendingRestore = {
      runId: entry.runId,
      draft: entry.draft,
      toolFilter: entry.toolFilter,
      processVisibility: entry.processVisibility,
      anchor: entry.anchor,
      inspector: entry.inspector,
      cwd: entry.cwd,
      savedAt: entry.savedAt,
    };
    this.currentRunId = runId;
    this.onLog("seed.ready", { runId, savedAt: entry.savedAt });
    return true;
  }

  /**
   * Async variant of `seed` — preferred at chat mount because the
   * synchronous stub return value (false) is only safe to ignore when
   * the caller awaits the result.
   */
  async seedAsync(runId: string, now: number = Date.now()): Promise<boolean> {
    if (this.disposed || !runId) return false;
    if (this.pendingRestore && this.pendingRestore.runId === runId) return true;
    if (this.disposed) return false;
    const entry = readRunState(runId, now);
    if (!entry || !isRunStateFresh(entry, now)) return false;
    this.pendingRestore = {
      runId: entry.runId,
      draft: entry.draft,
      toolFilter: entry.toolFilter,
      processVisibility: entry.processVisibility,
      anchor: entry.anchor,
      inspector: entry.inspector,
      cwd: entry.cwd,
      savedAt: entry.savedAt,
    };
    this.currentRunId = runId;
    this.onLog("seed.ready", { runId, savedAt: entry.savedAt });
    return true;
  }

  /** Returns the pending restore (and clears it). Idempotent. */
  consumePendingRestore(): PendingRestore | null {
    const r = this.pendingRestore;
    this.pendingRestore = null;
    return r;
  }

  /**
   * Switch the active run. Bumps the generation so any in-flight debounce
   * from the previous run cannot fire after the switch, and clears any
   * pending restore. Does NOT auto-flush the previous run — the caller is
   * responsible for invoking `flush()` first if it wants the previous
   * run's latest state on disk. This is the conservative design the
   * fast-run-switch test relies on: stale mid-debounce data should not be
   * written to a run the user is no longer on.
   */
  switchRun(newRunId: string): void {
    if (this.currentRunId && this.currentRunId !== newRunId) {
      this.gen++;
    }
    this.currentRunId = newRunId;
    this.pendingRestore = null;
    this.cancelDebounce();
    this.onLog("switchRun", { runId: newRunId, fromRunId: this.currentRunId });
  }

  /**
   * Schedule a debounced save. Coalesces multiple calls inside the
   * debounce window. The captured snapshot is read inside the timer
   * callback so the most-recent state always lands on disk.
   */
  scheduleSave(runId: string): void {
    if (this.disposed || !runId) return;
    this.currentRunId = runId;
    if (this.debounceHandle) {
      this.timers.clearTimeout(this.debounceHandle);
    }
    const gen = this.gen;
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = null;
      if (gen !== this.gen) return;
      this.flush("debounce");
    }, this.debounceMs);
  }

  /** Synchronous flush. Uses the current run id (or the explicitly
   *  supplied `runIdOverride`) and reads the live snapshot. When neither
   *  is set, the snapshot's own `runId` is used — that is the common case
   *  in tests / debug paths and keeps `flush()` directly usable without
   *  a prior `scheduleSave`. */
  flushSync(reason: FlushReason, runIdOverride?: string): boolean {
    if (this.disposed) return false;
    const input = this.capture();
    if (!input || !input.runId) {
      this.onLog("flush.skipped", { reason, reason2: "no-input" });
      return false;
    }
    const runId = runIdOverride || this.currentRunId || input.runId;
    if (input.runId !== runId) {
      this.onLog("flush.skipped", { reason, runId, inputRunId: input.runId });
      return false;
    }
    const saved = touchRunState(runId, {
      cwd: input.cwd,
      draft: input.draft,
      toolFilter: input.toolFilter,
      processVisibility: input.processVisibility,
      anchor: input.anchor,
      inspector: input.inspector,
    });
    this.onLog("flush", { reason, runId, saved: !!saved });
    return !!saved;
  }

  /** Public flush — synchronous localStorage write. Returns true if the
   *  save landed on disk. Safe to call from `pagehide` / `beforeunload`
   *  since `setItem` is synchronous in the main thread. */
  flush(reason: FlushReason, runIdOverride?: string): boolean {
    return this.flushSync(reason, runIdOverride);
  }

  /** Invalidate a run's state (on user-initiated delete / clear). */
  invalidateRun(runId: string): void {
    if (!runId) return;
    if (this.pendingRestore?.runId === runId) {
      this.pendingRestore = null;
    }
    removeRunState(runId);
    this.onLog("invalidate", { runId });
  }

  private cancelDebounce(): void {
    if (this.debounceHandle) {
      this.timers.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
  }

  /** Tear down the controller. Cancels pending timers, removes pagehide
   *  listener, drops the pending restore. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gen++; // invalidate any in-flight debounce
    this.cancelDebounce();
    if (typeof window !== "undefined") {
      if (this.pagehideHandler) window.removeEventListener("pagehide", this.pagehideHandler);
      if (this.beforeUnloadHandler)
        window.removeEventListener("beforeunload", this.beforeUnloadHandler);
    }
    this.pagehideHandler = null;
    this.beforeUnloadHandler = null;
    this.pendingRestore = null;
    this.onLog("dispose", {});
  }

  /** Test-only: read the internal generation counter. */
  __getGen(): number {
    return this.gen;
  }

  /** Test-only: read the currently-active run id. */
  __getCurrentRunId(): string {
    return this.currentRunId;
  }

  /** Test-only: peek (without consuming) the pending restore. */
  __peekPendingRestore(): PendingRestore | null {
    return this.pendingRestore;
  }

  /** Convenience: returns the TTL constant for sanity checks. */
  static get TTL_MS(): number {
    return CAPSULE_TTL_MS;
  }
}
