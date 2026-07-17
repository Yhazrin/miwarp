import type { TaskRun, UserSettings } from "$lib/types";
import { dbg } from "$lib/utils/debug";

/** Left titlebar actions shared between layout toolbar and SessionStatusBar tier 2. */
export type LayoutChromeContext = {
  readonly state: { sidebarOpen: boolean };
  toggleSidebar: () => void;
  newChat: () => void;
  openCliBrowser: () => void;
  openSettings: () => void;
  /** Called when a workspace folder is expanded in the sidebar. The chat page
   *  uses this to show the workspace overview for the selected project. */
  selectWorkspace: (cwd: string) => void;
  /** Register a callback for workspace selection events. Called by the chat
   *  page on mount; cleared on unmount. */
  onSelectWorkspaceChange: (cb: ((cwd: string) => void) | null) => void;
};

export const LAYOUT_CHROME_CONTEXT_KEY = "layoutChrome";

/** Routes that render the layout sidebar content panel (project tree + sessions). */
export function routeNeedsLayoutContentPanel(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/chat" ||
    pathname.startsWith("/plugins") ||
    pathname.startsWith("/explorer") ||
    pathname.startsWith("/teams") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/scheduled-tasks")
  );
}

/** v1.0.9 perf: exposes the layout's already-loaded UserSettings so child
 *  pages (especially /settings) can skip a redundant getUserSettings() IPC. */
export const SETTINGS_CACHE_CONTEXT_KEY = "layoutSettingsCache";
export type SettingsCacheContext = {
  /** Returns the latest UserSettings loaded by the layout, or null if not yet loaded. */
  readonly settings: UserSettings | null;
  /** Awaits the layout's in-flight settings load (dedupes concurrent callers). */
  whenReady: () => Promise<UserSettings | null>;
  /** Forces a fresh IPC, clearing any cached promise. Used by retry paths
   *  (e.g. /personal "settings failed → retry") that need to recover from a
   *  transient backend failure. */
  refresh: () => Promise<UserSettings | null>;
};

export async function resolveLayoutCachedSettings(
  cache: SettingsCacheContext | undefined,
): Promise<UserSettings | null> {
  if (!cache) return null;
  const immediate = cache.settings;
  if (immediate) return immediate;
  return cache.whenReady();
}

/** v1.0.10 perf: exposes the layout's already-loaded runs list so child pages
 *  can skip a redundant list_runs / list_runs_lite IPC at
 *  mount time. The runs may still be a cache-first hydration when layout
 *  used readRunsListCache(); consumers should treat them as "best effort,
 *  eventually consistent" — the layout itself reconciles in the background. */
export const RUNS_CACHE_CONTEXT_KEY = "layoutRunsCache";
export type RunsCacheContext = {
  /** Returns the latest runs loaded by the layout, or [] if not yet loaded. */
  readonly runs: TaskRun[];
  /** Awaits the layout's in-flight first runs load (dedupes concurrent callers). */
  whenReady: () => Promise<TaskRun[]>;
};

export async function resolveLayoutCachedRuns(
  cache: RunsCacheContext | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<TaskRun[] | null> {
  const t0 = performance.now();
  dbg("layout-chrome", "resolveLayoutCachedRuns start", {
    hasCache: !!cache,
    cacheRunsLen: cache?.runs.length,
  });
  if (!cache) return null;
  if (cache.runs.length > 0) {
    dbg(
      "layout-chrome",
      "resolveLayoutCachedRuns fast path, runs=",
      cache.runs.length,
      "in",
      (performance.now() - t0).toFixed(1),
      "ms",
    );
    return cache.runs;
  }
  // Defense-in-depth: race the gate against a timeout so a stuck backend
  // (e.g. listRuns() throws and the gate never fires) doesn't hang
  // the consumer forever. The consumer falls back to its own IPC when we
  // return null.
  const timeoutMs = opts.timeoutMs ?? 8_000;
  dbg("layout-chrome", "resolveLayoutCachedRuns awaiting gate with timeoutMs=", timeoutMs);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<TaskRun[] | null>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn("[resolveLayoutCachedRuns] gate timeout fired after", timeoutMs, "ms");
      resolve(null);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([cache.whenReady(), timeoutPromise]);
    dbg(
      "layout-chrome",
      "resolveLayoutCachedRuns resolved in",
      (performance.now() - t0).toFixed(1),
      "ms, count=",
      result?.length ?? null,
    );
    return result;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

/** Demand-driven layout bootstrap (runs / teams / attention). */
export const BOOTSTRAP_DEMAND_CONTEXT_KEY = "bootstrapDemand";
export type { BootstrapDemandController } from "$lib/layout/layout-bootstrap-demand";
