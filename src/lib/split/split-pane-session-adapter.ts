/**
 * Split pane session adapter — bridges SplitWorkspaceStore (state) and
 * sessionStore (the single underlying session instance).
 *
 * Strategy (v1.0.8 P0):
 * - Active pane: delegated to `sessionStore.loadRun` which has its own
 *   `_loadGen` guard. After load completes, we re-check `pane.loadGeneration`
 *   so a switch-active that happens during the await is correctly discarded.
 * - Inactive pane: fetches `getRun + getBusEvents` once into `cachedSnapshot`.
 *   The raw bus events are kept on the snapshot so PR-3's
 *   `SplitPaneSnapshotView` can replay them into TimelineEntry rows on
 *   demand (without holding the live sessionStore reference).
 * - `cancel(pane)` bumps `pane.loadGeneration` so any in-flight post-await
 *   assignments to that pane are dropped.
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

class SplitPaneSessionAdapter {
  // ── Active pane path ─────────────────────────────────────────────────────

  /**
   * Load `pane.runId` into the shared sessionStore so it becomes the live
   * active session. Captures the pane's `loadGeneration` at call time and
   * discards any post-await state writes that no longer match it.
   */
  async activate(store: SessionStore, pane: PaneState, xtermRef?: XtermLike): Promise<void> {
    const gen = pane.loadGeneration;
    try {
      await store.loadRun(pane.runId, xtermRef);
      // sessionStore.loadRun has its own _loadGen; we layer our own on top
      // so a switch-active during the await is correctly discarded here too.
      if (pane.loadGeneration !== gen) return;
      pane.loadState = "ready";
      pane.errorState = null;
    } catch (e) {
      if (pane.loadGeneration !== gen) return;
      pane.loadState = "error";
      pane.errorState = { code: "load_failed", message: String(e) };
    }
  }

  // ── Inactive pane path ──────────────────────────────────────────────────

  /**
   * Populate `pane.cachedSnapshot` with a read-only view of the run. Idempotent
   * — skips if the snapshot is already populated. Re-fetches if `force`.
   */
  async fetchSnapshot(pane: PaneState, force = false): Promise<PaneSnapshot | null> {
    if (!force && pane.cachedSnapshot) return pane.cachedSnapshot;
    const gen = pane.loadGeneration;
    try {
      const run = await api.getRun(pane.runId);
      if (pane.loadGeneration !== gen) return null;

      const events = await api.getBusEvents(pane.runId);
      if (pane.loadGeneration !== gen) return null;

      const snapshot: PaneSnapshotWithRaw = {
        run,
        timeline: [],
        tools: [],
        turnUsages: [],
        rawBusEvents: events,
        fetchedAt: Date.now(),
      };
      // PaneSnapshot is a structural subset of PaneSnapshotWithRaw; cast is
      // safe because the extra `rawBusEvents` field is only consumed via the
      // narrower type above.
      pane.cachedSnapshot = snapshot as PaneSnapshot;
      pane.loadState = "ready";
      pane.errorState = null;
      return pane.cachedSnapshot;
    } catch (e) {
      if (pane.loadGeneration !== gen) return null;
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
   */
  cancel(pane: PaneState): void {
    pane.loadGeneration++;
    pane.cachedSnapshot = null;
  }

  /**
   * Switch the active pane: capture a snapshot of the leaving pane (if any),
   * then load the entering pane into sessionStore. `setActive` must have
   * already updated `pane.runtimeState` so the UI sees consistent state
   * during the await.
   */
  async switchActive(
    store: SessionStore,
    leaving: PaneState | null,
    entering: PaneState,
    xtermRef?: XtermLike,
  ): Promise<void> {
    // Snapshot the leaving pane BEFORE awaiting so we don't miss events that
    // arrive between the await below and the snapshot.
    if (leaving && !leaving.cachedSnapshot) {
      await this.fetchSnapshot(leaving);
    }
    await this.activate(store, entering, xtermRef);
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
