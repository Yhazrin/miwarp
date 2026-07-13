/**
 * runs-sidebar-store — owns the sidebar-facing runs state:
 *   - the runs list (TaskRun[]) with cache-first + incremental sync
 *   - sidebar favorites (PromptFavorite[])
 *   - deep-search query/results (debounced, requestId-guarded)
 *
 * The original +layout.svelte inlined `loadRuns`, `loadSidebarFavorites`,
 * `onDeepQueryInput`, `doDeepSearch`, and the `runsReadyPromise` gate that
 * downstream pages use to skip a duplicate `list_runs` IPC at mount time.
 * Pulling them into a single rune store:
 *   - keeps the cache-first / incremental / poll-fallback sequencing in one
 *     file instead of three mixed $effect blocks
 *   - exposes a single `runsReadyPromise` getter that the layout wires into
 *     the existing RUNS_CACHE_CONTEXT_KEY (contract unchanged)
 *   - gives the workspace sidebar a single import for runs + favorites
 *
 * Behaviour-equivalence contract (refactor — no functional change):
 *   - First load: IDB cache → IPC listRunsLite → IDB write-back (background)
 *   - Subsequent loads: incremental listRunsSince, merged in-memory, IDB
 *     merge in background; EVT_RUNS_CHANGED on the window bus still fires
 *     from the layout (we keep that wiring there)
 *   - 60s fallback poll when the tab is visible
 *   - Deep search: 300ms debounce, requestId-guarded (stale responses drop)
 */
import {
  listRunsLite,
  listRunsSince,
  listPromptFavorites,
  searchPrompts,
  softDeleteRuns,
  hardDeleteRuns,
} from "$lib/api";
import {
  readRunsListCache,
  writeRunsListCache,
  mergeRunsIntoCache,
  removeRunFromCache,
} from "$lib/utils/runs-list-cache";
import { useIncrementalRunsSync } from "$lib/backend-capabilities.svelte";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { DEEP_SEARCH_DEBOUNCE_MS, RUNS_POLL_INTERVAL_MS } from "$lib/utils/layout-timings";
import { EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
import type { TaskRun, PromptFavorite, PromptSearchResult } from "$lib/types";

/**
 * Singleton store for the layout's sidebar runs / favorites / search state.
 */
export class RunsSidebarStore {
  runs = $state<TaskRun[]>([]);
  sidebarFavorites = $state<PromptFavorite[]>([]);
  runSearchQuery = $state<string>("");
  searchResults = $state<PromptSearchResult[]>([]);
  searching = $state<boolean>(false);
  searchRequestId = 0;
  runsLoadSucceededOnce = $state<boolean>(false);

  /** Derived: Set of favorited run IDs for O(1) lookup in render code. */
  get favoriteRunIds(): Set<string> {
    return new Set(this.sidebarFavorites.map((f) => f.runId));
  }

  // ── Runs ready gate ────────────────────────────────────────────────
  // The original layout exposed this through RUNS_CACHE_CONTEXT_KEY so
  // /workbench can `await layoutRunsCache.whenReady()` and skip its own
  // initial listRuns IPC. The store owns the promise so the layout only
  // has to wire it through setContext.

  private _runsReadyResolve: ((value: TaskRun[]) => void) | null = null;
  private _runsReadyPromise: Promise<TaskRun[]> = new Promise<TaskRun[]>((resolve) => {
    this._runsReadyResolve = resolve;
  });

  /** Awaitable gate — resolves on the first successful loadRuns(). */
  whenRunsReady(): Promise<TaskRun[]> {
    if (this.runs.length > 0) return Promise.resolve(this.runs);
    return this._runsReadyPromise;
  }

  /** Force-resolve the gate (idempotent). Called after the first successful load. */
  private _signalRunsReadyOnce(): void {
    if (!this._runsReadyResolve) return;
    const resolve = this._runsReadyResolve;
    this._runsReadyResolve = null;
    Promise.resolve().then(() => resolve(this.runs));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /** Guard: prevents concurrent / re-entrant loadRuns calls. */
  private _loadRunsInFlight = false;

  /** Load runs. Cache-first on cold start; incremental after that. */
  async loadRuns(): Promise<void> {
    if (this._loadRunsInFlight) return;
    this._loadRunsInFlight = true;
    if (!this.runsLoadSucceededOnce) {
      try {
        const cached = await readRunsListCache();
        if (cached.length > 0) {
          this.runs = cached;
          dbg("layout", "loadRuns: cache-first hit", { count: cached.length });
        }
      } catch (e) {
        dbgWarn("layout", "loadRuns: cache read failed", e);
      }
    }
    try {
      if (this._lastRunsSync && this.runsLoadSucceededOnce && useIncrementalRunsSync()) {
        const changed = await listRunsSince(this._lastRunsSync);
        if (changed.length > 0) {
          const map = new Map(this.runs.map((r) => [r.id, r]));
          for (const r of changed) {
            if (r.deleted_at) {
              map.delete(r.id);
            } else {
              map.set(r.id, r);
            }
          }
          this.runs = [...map.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
          void mergeRunsIntoCache(changed.filter((r) => !r.deleted_at));
        }
      } else {
        // The sidebar only needs run metadata for its initial projection.
        // Reading every events.jsonl just to derive previews blocks browser
        // startup for seconds once a user has a large local history.
        const fresh = await listRunsLite();
        this.runs = fresh;
        void writeRunsListCache(fresh);
      }
      this._lastRunsSync = new Date().toISOString();
      this.runsLoadSucceededOnce = true;
    } catch (e) {
      console.warn("[loadRuns] IPC failed", e);
      dbgWarn("layout", "loadRuns failed", e);
      // Defense-in-depth: signal readiness even on failure so consumers
      // (e.g. /workbench awaiting resolveLayoutCachedRuns) don't hang
      // forever waiting for runs that will never arrive.
    } finally {
      this._loadRunsInFlight = false;
      this._signalRunsReadyOnce();
    }
  }

  private _lastRunsSync: string | null = null;

  /** 60s visibility-aware poll. Returns a stop() function. */
  startPoll(): () => void {
    if (typeof window === "undefined") return () => {};
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void this.loadRuns();
    }, RUNS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }

  // ── Favorites ──────────────────────────────────────────────────────

  async loadSidebarFavorites(): Promise<void> {
    try {
      this.sidebarFavorites = await listPromptFavorites();
    } catch {
      /* silently fail */
    }
  }

  // ── Deep search ────────────────────────────────────────────────────

  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Trigger a debounced deep search. Safe to call on every keystroke;
   * consecutive calls within DEEP_SEARCH_DEBOUNCE_MS collapse into one
   * `doDeepSearch()` invocation.
   */
  onDeepQueryInput(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => void this.doDeepSearch(), DEEP_SEARCH_DEBOUNCE_MS);
  }

  /**
   * Run the deep search immediately. Stale responses (from a previous
   * `searchRequestId`) are discarded — only the latest result wins.
   */
  async doDeepSearch(): Promise<void> {
    const q = this.runSearchQuery.trim();
    if (!q) {
      this.searchResults = [];
      this.searching = false;
      return;
    }
    this.searching = true;
    const reqId = ++this.searchRequestId;
    try {
      const results = await searchPrompts(q);
      if (reqId !== this.searchRequestId) return;
      this.searchResults = results;
      dbg("layout", "search results", { count: results.length });
    } catch (e) {
      if (reqId !== this.searchRequestId) return;
      dbg("layout", "search error", e);
      this.searchResults = [];
    } finally {
      if (reqId === this.searchRequestId) this.searching = false;
    }
  }

  // ── Mutations used by confirm flows ─────────────────────────────────

  /** Soft-delete the given run IDs and refresh the local list. */
  async softDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await softDeleteRuns(ids);
      for (const id of ids) void removeRunFromCache(id);
      this.runs = this.runs.filter((r) => !ids.includes(r.id));
      this._notifyRunsChanged();
    } catch (e) {
      dbgWarn("layout", "softDelete failed", e);
    }
  }

  /** Hard-delete the given run IDs and refresh the local list. */
  async hardDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await hardDeleteRuns(ids);
      const idSet = new Set(ids);
      this.runs = this.runs.filter((r) => !idSet.has(r.id));
      for (const id of ids) void removeRunFromCache(id);
      this._notifyRunsChanged();
    } catch (e) {
      dbgWarn("layout", "hardDelete failed", e);
    }
  }

  /**
   * Optimistic local replacement after a folder move. The actual IPC
   * call is owned by the session-folder store; this just keeps the
   * sidebar list coherent without a re-fetch.
   */
  applyFolderMoveLocally(ids: string[], folderId: string | null): void {
    this.runs = this.runs.map((r) =>
      ids.includes(r.id) ? { ...r, folder_id: folderId ?? undefined } : r,
    );
    this._notifyRunsChanged();
  }

  private _notifyRunsChanged(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
  }
}

/** Singleton instance for the layout. */
export const runsSidebarStore = new RunsSidebarStore();
