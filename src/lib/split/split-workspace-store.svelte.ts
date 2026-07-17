/**
 * Split Workspace store — manages panes for multi-session view (v1.0.8).
 *
 * Lives independently of session-store (which is a 3932-line god store that
 * must NOT be expanded; see CLAUDE.md high-cohesion rules + miwarp-optimization
 * §2.1). SplitWorkspaceStore is purely state + actions; all side effects
 * (loading sessions, snapshots, WS subscription) go through
 * SplitPaneSessionAdapter.
 *
 * Constraints (v1.0.8 P0):
 * - Max 4 panes (`MAX_PANES`).
 * - Same `runId` cannot appear twice; duplicate drop activates existing pane.
 * - Only `activePaneId` is writable through sessionStore; others are read-only
 *   snapshots.
 * - `rightSidebarSuspended` must be true while `enabled` to disable file tree
 *   / git / memory / tool activity / deep search fetches.
 *
 * Gen guards (defense in depth):
 * - `pane.loadGeneration` — per-pane; bumped on remove/cancel. The adapter
 *   captures it at call site and `markLoadResult` discards stale writes.
 * - `switchGeneration` — store-wide; bumped on every `setActive` / `removePane`
 *   / `exit`. The adapter captures it and aborts in-flight IO when the user
 *   has switched away mid-await. The store passes the current value into the
 *   adapter through method parameters (dependency injection), so the adapter
 *   stays decoupled from the singleton — keeps test setup trivial.
 *
 * PaneScrollState (v1.0.9 P2-2): `scrollTop` and `pinned` were never read by
 * any caller — inactive panes are read-only snapshots with no scroll surface
 * to control, and the active pane reuses the chat page's main scroll, not a
 * per-pane one. Only `renderLimit` survived (used by `SplitPaneTimelineView`).
 */

import type { TimelineEntry, TaskRun, HookEvent } from "$lib/types";
import type { TurnUsage } from "$lib/stores/types";

// ── Types ────────────────────────────────────────────────────────────────

export type PaneId = string;
export type LayoutMode = "single" | "dual" | "triple" | "quad";
export type PaneLoadState = "idle" | "loading" | "ready" | "error";
type PaneRuntimeState "active" | "inactive";

interface PaneScrollState {
  /** Max entries to render at once; consumed by `SplitPaneTimelineView`. */
  renderLimit: number;
}

export interface PaneErrorState {
  code: "load_failed" | "stale_dropped" | "aborted";
  message: string;
}

/**
 * Read-only cached view of a pane's run. Only populated for inactive panes.
 * Active panes read live from `sessionStore` directly.
 */
export interface PaneSnapshot {
  run: TaskRun;
  timeline: TimelineEntry[];
  tools: HookEvent[];
  turnUsages: TurnUsage[];
  /** Wall-clock time the snapshot was fetched. */
  fetchedAt: number;
  /**
   * Latest event timestamp observed in the bus events that built this
   * snapshot. Compared against `fetchedAt` to detect new content the user
   * hasn't seen yet (drives the "new content" red dot in P2-3).
   */
  latestEventTime: number;
}

export interface PaneState {
  paneId: PaneId;
  runId: string;
  loadState: PaneLoadState;
  runtimeState: PaneRuntimeState;
  /** Bumped on (re)load; `markLoadResult` discards mismatched writes. */
  loadGeneration: number;
  scrollState: PaneScrollState;
  errorState: PaneErrorState | null;
  cachedSnapshot: PaneSnapshot | null;
}

export interface EnterOptions {
  cwd?: string | null;
  activeRunId?: string | null;
}

export interface AddPaneOptions {
  /** When true (e.g. enter()), don't toast on duplicate or limit. */
  silent?: boolean;
  /** Make this pane active after adding. Defaults to true. */
  makeActive?: boolean;
}

export type SplitToastKind = "info" | "error";
export type SplitToastFn = (message: string, kind?: SplitToastKind) => void;

// ── Constants ────────────────────────────────────────────────────────────

export const MAX_PANES = 4;

/** Max slots for a given layout mode. */
export function maxSlotsForLayout(mode: LayoutMode): number {
  switch (mode) {
    case "single":
      return 1;
    case "dual":
      return 2;
    case "triple":
      return 3;
    case "quad":
      return 4;
  }
}

// ── Store ────────────────────────────────────────────────────────────────

export class SplitWorkspaceStore {
  enabled = $state(false);
  panes: PaneState[] = $state([]);
  activePaneId: PaneId | null = $state(null);
  layoutMode: LayoutMode = $state("single");
  rightSidebarSuspended = $state(false);
  /** Saved cwd before entering split mode — used to restore sidebar binding. */
  preSplitCwd: string | null = $state(null);
  /** Toast sink — chat page wires `showToast` here on init. */
  onToast: SplitToastFn | null = null;

  /**
   * Store-wide switch generation. Bumped on every transaction that changes
   * the active pane or the pane set (setActive / removePane / exit). The
   * adapter captures this value at call site and aborts in-flight IO when
   * the user has switched away mid-await. Independent from `pane.loadGeneration`
   * so a stale write can be rejected even when the pane itself is still around.
   */
  switchGeneration: number = 0;

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Enter split mode. Idempotent: if already enabled, no-op.
   * If `activeRunId` is given, seeds the first pane (silent — no toast).
   */
  enter(opts: EnterOptions = {}): void {
    if (this.enabled) return;
    this.enabled = true;
    this.rightSidebarSuspended = true;
    this.preSplitCwd = opts.cwd ?? null;
    this.layoutMode = "single";
    if (opts.activeRunId) {
      this.addPane(opts.activeRunId, { silent: true, makeActive: true });
    }
  }

  /**
   * Exit split mode. Cancels all in-flight pane loads, clears panes,
   * restores sidebar. Caller is responsible for routing the active run
   * back to the normal chat surface (e.g. `sessionStore.loadRun`).
   */
  exit(): void {
    if (!this.enabled) return;
    // Bump gen on every pane to invalidate any in-flight adapter work.
    for (const p of this.panes) {
      p.loadGeneration++;
      p.cachedSnapshot = null;
    }
    this.panes = [];
    this.activePaneId = null;
    this.enabled = false;
    this.layoutMode = "single";
    this.rightSidebarSuspended = false;
    this.preSplitCwd = null;
    // Store-wide gen bump — any adapter call that captured the previous value
    // will see the mismatch and discard its post-await write.
    this.switchGeneration++;
  }

  // ── Pane ops ────────────────────────────────────────────────────────────

  /**
   * Add a pane for `runId`. Deduplicates by runId — if a pane with the same
   * runId exists, just activates it (toasts "duplicate" unless `silent`).
   * If panes.length >= MAX_PANES, toasts "limit reached" unless `silent`.
   */
  addPane(runId: string, opts: AddPaneOptions = {}): PaneState | null {
    if (!this.enabled) return null;
    if (!runId) return null;

    const existing = this.panes.find((p) => p.runId === runId);
    if (existing) {
      if (!opts.silent) this._toast("split_mode_duplicateRun", "info");
      this.setActive(existing.paneId);
      return existing;
    }

    if (this.panes.length >= MAX_PANES) {
      if (!opts.silent) this._toast("split_mode_paneLimitReached", "error");
      return null;
    }

    const pane: PaneState = {
      paneId: makePaneId(),
      runId,
      loadState: "loading",
      runtimeState: opts.makeActive === false ? "inactive" : "active",
      loadGeneration: 1,
      scrollState: { renderLimit: 200 },
      errorState: null,
      cachedSnapshot: null,
    };
    this.panes = [...this.panes, pane];
    if (pane.runtimeState === "active") {
      for (const existing of this.panes) {
        if (existing.paneId !== pane.paneId) {
          existing.runtimeState = "inactive";
        }
      }
      this.activePaneId = pane.paneId;
    }
    // Keep layoutMode consistent with pane count (caller may still override).
    this.layoutMode = this._inferLayoutMode();
    return pane;
  }

  /**
   * Remove a pane. Cancels any in-flight load for it. If the removed pane
   * was active, activates the first remaining pane (if any); if no panes
   * remain, calls `exit()` automatically.
   */
  removePane(paneId: PaneId): void {
    const idx = this.panes.findIndex((p) => p.paneId === paneId);
    if (idx < 0) return;
    const removed = this.panes[idx];
    // Invalidate any pending async work for this pane.
    removed.loadGeneration++;
    removed.cachedSnapshot = null;

    const wasActive = this.activePaneId === paneId;
    this.panes = this.panes.filter((p) => p.paneId !== paneId);

    if (wasActive) {
      if (this.panes.length > 0) {
        const next = this.panes[0];
        for (const p of this.panes) {
          p.runtimeState = p.paneId === next.paneId ? "active" : "inactive";
        }
        this.activePaneId = next.paneId;
      } else {
        this.exit();
        return;
      }
    }
    this.layoutMode = this._inferLayoutMode();
    // Store-wide gen bump so any in-flight adapter work for the removed pane
    // (or any other pane mid-switch) is discarded post-await.
    this.switchGeneration++;
  }

  /**
   * Atomically switch the active pane. Caller is responsible for routing
   * the actual session load via `splitPaneSessionAdapter.switchActive`.
   * This method only mutates PaneState metadata; adapter does the IO.
   */
  setActive(paneId: PaneId): void {
    if (!this.enabled) return;
    if (this.activePaneId === paneId) return;
    const target = this.panes.find((p) => p.paneId === paneId);
    if (!target) return;
    const prev = this.panes.find((p) => p.paneId === this.activePaneId) ?? null;
    if (prev) {
      prev.runtimeState = "inactive";
      // Invalidate any future stale writes for the leaving pane.
      prev.loadGeneration++;
    }
    target.runtimeState = "active";
    this.activePaneId = paneId;
    // Store-wide gen bump — any in-flight adapter call that captured the
    // previous gen will abort its post-await state write.
    this.switchGeneration++;
  }

  // ── Layout ──────────────────────────────────────────────────────────────

  /**
   * Set layout mode. Rejected if the new mode has fewer slots than current
   * pane count (would silently hide panes). Toast + noop in that case.
   */
  setLayoutMode(mode: LayoutMode): void {
    if (this.panes.length > maxSlotsForLayout(mode)) {
      this._toast("split_mode_layoutWouldHide", "error");
      return;
    }
    this.layoutMode = mode;
  }

  // ── Adapter callback (gen-guarded write) ────────────────────────────────

  /**
   * Record the result of an async pane load. Discards writes whose
   * generation no longer matches the current `pane.loadGeneration`,
   * preventing stale async results from overwriting fresher state.
   */
  markLoadResult(
    paneId: PaneId,
    capturedGen: number,
    result:
      | { ok: true; snapshot?: PaneSnapshot | null; loadState?: PaneLoadState }
      | { ok: false; error: PaneErrorState },
  ): void {
    const pane = this.panes.find((p) => p.paneId === paneId);
    if (!pane) return;
    if (pane.loadGeneration !== capturedGen) {
      // Stale: pane was reloaded or removed during the await. Discard.
      return;
    }
    if (result.ok) {
      pane.loadState = result.loadState ?? "ready";
      pane.errorState = null;
      if (result.snapshot !== undefined) {
        pane.cachedSnapshot = result.snapshot;
      }
    } else {
      pane.loadState = "error";
      pane.errorState = result.error;
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private _inferLayoutMode(): LayoutMode {
    const n = this.panes.length;
    if (n <= 1) return "single";
    if (n === 2) return "dual";
    if (n === 3) return "triple";
    return "quad";
  }

  private _toast(key: string, kind: SplitToastKind): void {
    // Lazy import to avoid circular deps; chat page wires `onToast` on init.
    if (!this.onToast) return;
    // Defer to caller's i18n by passing the key; chat page resolves it.
    this.onToast(key, kind);
  }
}

// ── Singleton + utilities ─────────────────────────────────────────────────

export const splitWorkspaceStore = new SplitWorkspaceStore();

/** Cheap uuid-ish id (good enough for in-memory pane tracking). */
function makePaneId(): PaneId {
  return `pane_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
