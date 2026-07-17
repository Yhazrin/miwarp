/**
 * Split pane session adapter — bridges SplitWorkspaceStore (state) and
 * sessionStore (the single underlying session instance).
 *
 * Strategy (v1.0.8 P0):
 * - Active pane: delegated to `sessionStore.loadRun` which has its own
 *   `_loadGen` guard. After load completes, we re-check `pane.loadGeneration`
 *   AND a store-wide `switchGeneration` captured at call site, so a
 *   switch-active during the await is correctly discarded.
 * - Inactive pane: fetches `getRun + getBusEvents` once into `cachedSnapshot`.
 *   The raw bus events are kept on the snapshot so PR-3's
 *   `SplitPaneSnapshotView` can replay them into TimelineEntry rows on
 *   demand (without holding the live sessionStore reference).
 * - `cancel(pane)` bumps `pane.loadGeneration` so any in-flight post-await
 *   assignments to that pane are dropped.
 *
 * Dependency injection: the adapter never imports the `splitWorkspaceStore`
 * singleton. The current `switchGeneration` is passed in by the caller
 * (typically the lifecycle layer that already holds the store reference).
 * This keeps the adapter testable in isolation — pass whatever gen you want.
 *
 * Why a separate adapter: sessionStore is a 3932-line god store. Adding
 * multi-pane state directly into it would explode complexity. The adapter
 * keeps god-store single-responsibility while letting split panes share
 * the existing transport / snapshot cache / generation guard machinery.
 */

import type { BusEvent } from "$lib/types";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import * as api from "$lib/api";
import { type PaneState, type PaneSnapshot } from "./split-workspace-store.svelte";

export interface XtermLike {
  clear(): void;
  writeText(s: string): void;
}

/**
 * Read-only cache for an inactive pane. Extends `PaneSnapshot` with raw bus
 * events so the snapshot view can replay them without going back to the
 * network. Lives on `pane.cachedSnapshot` but is accessed via this narrower
 * type so the extra field is intentional, not accidental.
 */
export interface PaneSnapshotWithRaw extends PaneSnapshot {
  rawBusEvents: BusEvent[];
}

/** Caller-provided store switch generation. Bundled so callers pass one arg. */
export interface AdapterCtx {
  /** Value of `splitWorkspaceStore.switchGeneration` at call time. */
  switchGeneration: number;
}

class SplitPaneSessionAdapter {
  // ── Active pane path ─────────────────────────────────────────────────────

  /**
   * Load `pane.runId` into the shared sessionStore so it becomes the live
   * active session. Captures the pane's `loadGeneration` AND the store-wide
   * `switchGeneration` at call time; discards post-await writes that no
   * longer match either guard.
   */
  async activate(
    store: SessionStore,
    pane: PaneState,
    ctx: AdapterCtx,
    xtermRef?: XtermLike,
  ): Promise<void> {
    const gen = pane.loadGeneration;
    const txGen = ctx.switchGeneration;
    try {
      await store.loadRun(pane.runId, xtermRef);
      // Two-tier guard: pane may have been reloaded (gen) OR the user may
      // have switched panes (txGen). Either mismatch means "stale, abort".
      if (pane.loadGeneration !== gen || ctx.switchGeneration !== txGen) return;
      pane.loadState = "ready";
      pane.errorState = null;
    } catch (e) {
      if (pane.loadGeneration !== gen || ctx.switchGeneration !== txGen) return;
      pane.loadState = "error";
      pane.errorState = { code: "load_failed", message: String(e) };
    }
  }

  // ── Inactive pane path ──────────────────────────────────────────────────

  /**
   * Populate `pane.cachedSnapshot` with a read-only view of the run. Idempotent
   * — skips if the snapshot is already populated. Re-fetches if `force`.
   */
  async fetchSnapshot(
    sessionStore: SessionStore,
    pane: PaneState,
    ctx: AdapterCtx,
    force = false,
  ): Promise<PaneSnapshot | null> {
    if (!force && pane.cachedSnapshot) return pane.cachedSnapshot;
    const gen = pane.loadGeneration;
    const txGen = ctx.switchGeneration;
    try {
      const run = await api.getRun(pane.runId);
      if (pane.loadGeneration !== gen || ctx.switchGeneration !== txGen) return null;

      const events = await api.getBusEvents(pane.runId);
      if (pane.loadGeneration !== gen || ctx.switchGeneration !== txGen) return null;

      const { timeline, tools, turnUsages } = sessionStore.buildSnapshotFromEvents(run, events);

      // Track the latest event timestamp so P2-3 can show a "new content"
      // indicator when fetchedAt < latestEventTime (i.e. the bus saw
      // something newer than what the snapshot covers).
      let latestEventTime = 0;
      for (const ev of events) {
        // Bus events use `timestamp_ms` (epoch millis). Some events omit
        // it; skip those — `fetchedAt` will always be > 0 for a real fetch
        // so we never false-positive on "newer than snapshot".
        const ts = (ev as { timestamp_ms?: number }).timestamp_ms ?? 0;
        if (ts > latestEventTime) latestEventTime = ts;
      }

      const snapshot: PaneSnapshotWithRaw = {
        run,
        timeline,
        tools,
        turnUsages,
        rawBusEvents: events,
        fetchedAt: Date.now(),
        latestEventTime,
      };
      pane.cachedSnapshot = snapshot as PaneSnapshot;
      pane.loadState = "ready";
      pane.errorState = null;
      return pane.cachedSnapshot;
    } catch (e) {
      if (pane.loadGeneration !== gen || ctx.switchGeneration !== txGen) return null;
      pane.loadState = "error";
      pane.errorState = { code: "load_failed", message: String(e) };
      return null;
    }
  }

  /**
   * Read a pane's cached snapshot with raw events attached. Returns null if
   * no snapshot has been captured yet. Use this from `SplitPaneSnapshotView`
   * to render an inactive pane's history.
   */
  readSnapshotWithRaw(pane: PaneState): PaneSnapshotWithRaw | null {
    if (!pane.cachedSnapshot) return null;
    return pane.cachedSnapshot as PaneSnapshotWithRaw;
  }

  // ── Lifecycle helpers ───────────────────────────────────────────────────

  /**
   * Cancel any in-flight work for `pane`. Safe to call multiple times.
   * Bumps `pane.loadGeneration` so adapter post-await writes are dropped.
   * Does NOT bump switchGeneration — that's only for store-wide events
   * (setActive / removePane / exit), not per-pane cancellation.
   */
  cancel(pane: PaneState): void {
    pane.loadGeneration++;
    pane.cachedSnapshot = null;
  }

  /**
   * Switch the active pane: capture a snapshot of the leaving pane (if any),
   * then load the entering pane into sessionStore. `setActive` must have
   * already updated `pane.runtimeState` so the UI sees consistent state
   * during the await. The `ctx` is read again after each await via the
   * latest `switchGeneration` value, so a re-entrant switch is handled.
   */
  async switchActive(
    store: SessionStore,
    leaving: PaneState | null,
    entering: PaneState,
    ctx: AdapterCtx,
    xtermRef?: XtermLike,
  ): Promise<void> {
    // Snapshot the leaving pane BEFORE awaiting so we don't miss events that
    // arrive between the await below and the snapshot.
    if (leaving && !leaving.cachedSnapshot) {
      await this.fetchSnapshot(store, leaving, ctx);
    }
    await this.activate(store, entering, ctx, xtermRef);
  }

  /**
   * Cancel all in-flight work for every pane in the list. Used on `exit()`
   * and on hot reload.
   */
  cancelAll(panes: readonly PaneState[]): void {
    for (const p of panes) {
      p.loadGeneration++;
      p.cachedSnapshot = null;
    }
  }
}

export const splitPaneSessionAdapter = new SplitPaneSessionAdapter();
