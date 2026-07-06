import type { TaskRun, UserSettings } from "$lib/types";

/** Left titlebar actions shared between layout toolbar and SessionStatusBar tier 2. */
export type LayoutChromeContext = {
  readonly state: { sidebarOpen: boolean };
  toggleSidebar: () => void;
  newChat: () => void;
  openCliBrowser: () => void;
  openSettings: () => void;
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
    pathname.startsWith("/scheduled-tasks") ||
    // P0-4: cold-start /workbench must mount its project sidebar; without
    // this match the layout treats the route as "no content panel" and the
    // WorkbenchSidebar never renders, hiding every project from the user.
    pathname.startsWith("/workbench")
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
 *  (e.g. /workbench) can skip a redundant list_runs / list_runs_lite IPC at
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
  console.log("[resolveLayoutCachedRuns] start", {
    hasCache: !!cache,
    cacheRunsLen: cache?.runs.length,
  });
  if (!cache) return null;
  if (cache.runs.length > 0) {
    console.log(
      "[resolveLayoutCachedRuns] fast path, runs=",
      cache.runs.length,
      "in",
      (performance.now() - t0).toFixed(1),
      "ms",
    );
    return cache.runs;
  }
  // Defense-in-depth: race the gate against a timeout so a stuck backend
  // (e.g. listRuns() throws and the gate never fires) doesn't hang
  // /workbench forever. The consumer falls back to its own IPC when we
  // return null.
  const timeoutMs = opts.timeoutMs ?? 8_000;
  console.log("[resolveLayoutCachedRuns] awaiting gate with timeoutMs=", timeoutMs);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<TaskRun[] | null>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn("[resolveLayoutCachedRuns] gate timeout fired after", timeoutMs, "ms");
      resolve(null);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([cache.whenReady(), timeoutPromise]);
    console.log(
      "[resolveLayoutCachedRuns] resolved in",
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
