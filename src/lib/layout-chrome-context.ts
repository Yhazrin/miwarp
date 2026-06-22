import type { UserSettings } from "$lib/types";

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
    pathname === "/chat" ||
    pathname === "/" ||
    pathname.startsWith("/plugins") ||
    pathname.startsWith("/explorer") ||
    pathname.startsWith("/memory") ||
    pathname.startsWith("/teams")
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
};

export async function resolveLayoutCachedSettings(
  cache: SettingsCacheContext | undefined,
): Promise<UserSettings | null> {
  if (!cache) return null;
  const immediate = cache.settings;
  if (immediate) return immediate;
  return cache.whenReady();
}
