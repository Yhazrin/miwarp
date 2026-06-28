/**
 * layout-bootstrap — pure-TypeScript helpers used during the root layout's
 * initial onMount / first-paint path. NO Svelte runes, NO component
 * instantiation. Anything that needs `$state` or `$effect` stays in the
 * layout component itself; this file only owns:
 *
 *   - localStorage parse / persist helpers with safe defaults
 *   - sidebar width resolver (screen-keyed) with legacy migration
 *   - UserSettings → UserSettingsBus event glue (settings → toast / zoom)
 *   - Splash-screen teardown (one-shot)
 *   - Platform-credentials migration (api_key → platform_credentials)
 *
 * Why extract these:
 *   The original +layout.svelte `loadSettings()` / `migrateCredentialsIfNeeded`
 *   / `loadSidebarWidth()` block was 60+ lines of inline business logic that
 *   could only be tested by mounting the full layout. Pulling them into pure
 *   helpers lets the layout script shrink to ~10 wiring lines and lets the
 *   behaviour tests exercise the migration / parse paths directly.
 *
 * Rule of thumb: if it does not need `$state` / `$derived` / `$effect` /
 * SvelteKit navigation primitives, it belongs here or in a service module.
 */
import { getUserSettings, updateUserSettings, USER_SETTINGS_CHANGED_EVENT } from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import {
  normalizeProcessVisibility,
  persistCachedProcessVisibility,
} from "$lib/utils/process-visibility";
import { LS_PROJECT_CWD, LS_SETTINGS_CWD, LS_SIDEBAR_WIDTH } from "$lib/utils/storage-keys";
import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";
import { normalizeCwd } from "$lib/utils/sidebar-groups";
import type { PlatformCredential, UserSettings } from "$lib/types";

// ── Sidebar width ───────────────────────────────────────────────────────

/**
 * Returns a stable cache key for sidebar width, scoped to the current
 * screen resolution so a 4K monitor doesn't inherit a 13" ultrabook width.
 * Falls back to "default" in SSR / restricted environments.
 */
export function sidebarWidthKey(): string {
  try {
    if (typeof window !== "undefined" && window.screen) {
      return `${window.screen.width}x${window.screen.height}`;
    }
  } catch {
    /* SSR / restricted env */
  }
  return "default";
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 500;
const SIDEBAR_DEFAULT = 280;

/**
 * Resolve the initial sidebar width:
 *   1. Try the screen-keyed cache entry.
 *   2. Lazily migrate the legacy `LS_SIDEBAR_WIDTH` value if found.
 *   3. Fall back to the default (280).
 */
export function loadSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT;
  const key = `ocv:sidebar-width:${sidebarWidthKey()}`;
  let raw = parseInt(localStorage.getItem(key) ?? "", 10);
  if (!Number.isFinite(raw)) {
    const legacy = parseInt(localStorage.getItem(LS_SIDEBAR_WIDTH) ?? "", 10);
    if (Number.isFinite(legacy)) {
      raw = legacy;
      try {
        localStorage.setItem(key, String(legacy));
      } catch {
        /* ignore quota */
      }
    }
  }
  return Number.isFinite(raw) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw)) : SIDEBAR_DEFAULT;
}

/** Clamp + persist a new sidebar width. */
export function persistSidebarWidth(width: number): void {
  if (typeof window === "undefined") return;
  const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));
  try {
    localStorage.setItem(`ocv:sidebar-width:${sidebarWidthKey()}`, String(clamped));
  } catch {
    /* ignore quota */
  }
}

// ── Saved CWD ───────────────────────────────────────────────────────────

/** Read the persisted cwd (already-normalized). Empty string when unset. */
export function loadSavedProjectCwd(): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeCwd(localStorage.getItem(LS_PROJECT_CWD) ?? "") || "";
  } catch {
    return "";
  }
}

/** Defensive parser for `LS_EXPANDED_PROJECTS` (string[] only). */
export function loadExpandedProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem("ocv:expanded-projects");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v: unknown) => typeof v === "string")) {
      return new Set(parsed as string[]);
    }
  } catch {
    /* corrupted data, keep empty */
  }
  return new Set();
}

/** Defensive parser for `LS_PINNED_CWDS` (string[] only). */
export function loadPinnedCwds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("ocv:pinned-cwds");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v: unknown) => typeof v === "string")
      ? (parsed as string[])
      : [];
  } catch {
    return [];
  }
}

// ── UserSettings glue ───────────────────────────────────────────────────

/**
 * Apply the side-effects of a freshly-loaded UserSettings:
 *   - canonicalize process visibility + persist for next cold start
 *   - mirror working_directory into LS_SETTINGS_CWD so non-layout entry
 *     points (e.g. /workbench picker) can pre-seed
 *   - initialize onboarding wizard flag
 *   - apply zoom + visual-performance CSS class
 * Returns the updated `shouldShowWizard` flag and the normalized cwd
 * (caller is responsible for assigning it into projectCwd).
 */
export interface AppliedSettings {
  settings: UserSettings;
  normalizedCwd: string;
  showSetupWizard: boolean;
}

export async function applyUserSettings(settings: UserSettings): Promise<AppliedSettings> {
  persistCachedProcessVisibility(normalizeProcessVisibility(settings.process_visibility));
  const normalizedWd = normalizeCwd(settings.working_directory);
  try {
    if (normalizedWd) {
      localStorage.setItem(LS_SETTINGS_CWD, normalizedWd);
    } else {
      localStorage.removeItem(LS_SETTINGS_CWD);
    }
  } catch {
    /* ignore quota */
  }
  return {
    settings,
    normalizedCwd: normalizedWd,
    showSetupWizard: !settings.onboarding_completed,
  };
}

/**
 * One-time migration: synthesize a `PlatformCredential` from a legacy
 * `anthropic_api_key` so the platform_credentials picker has at least one
 * entry on first launch after the migration.
 *
 * Idempotent: returns silently if `platform_credentials` is already
 * populated. Only mutates the persisted settings when migration succeeds.
 */
export async function migrateCredentialsIfNeeded(settings: UserSettings): Promise<void> {
  if (settings.platform_credentials && settings.platform_credentials.length > 0) return;
  if (!settings.anthropic_api_key) return;

  let platformId = "anthropic";
  if (settings.anthropic_base_url) {
    const match = PLATFORM_PRESETS.find(
      (p) => p.base_url && settings.anthropic_base_url === p.base_url,
    );
    platformId = match?.id ?? "custom-migrated";
  }

  const cred: PlatformCredential = {
    platform_id: platformId,
    api_key: settings.anthropic_api_key,
    base_url: settings.anthropic_base_url || undefined,
    auth_env_var: settings.auth_env_var || undefined,
    ...(platformId === "custom-migrated" ? { name: "Migrated" } : {}),
  };

  try {
    await updateUserSettings({
      platform_credentials: [cred],
      active_platform_id: platformId,
    } as Partial<UserSettings>);
    dbg("layout", "migrated credentials", { platformId });
  } catch (e) {
    dbgWarn("layout", "credential migration failed:", e);
  }
}

/**
 * Settings loader with a single-flight promise. Concurrent callers
 * (e.g. /settings page asking for `whenReady()`) receive the same in-flight
 * promise so the layout makes exactly one `getUserSettings()` IPC.
 *
 * `refresh()` clears the cached promise so the next call re-runs the IPC —
 * used by retry paths (e.g. /personal "settings failed → retry" button)
 * that need to recover after a transient backend failure without
 * double-fetching while a normal load is still in flight.
 */
export function createSettingsLoader(): {
  start: () => Promise<UserSettings | null>;
  refresh: () => Promise<UserSettings | null>;
  promise: () => Promise<UserSettings | null> | null;
} {
  let inFlight: Promise<UserSettings | null> | null = null;
  // Refreshes get their own gate: a `refresh()` always issues a fresh IPC,
  // but concurrent refreshes dedupe with each other so 5 rapid retry clicks
  // don't fire 5 IPCs.
  let refreshInFlight: Promise<UserSettings | null> | null = null;
  const load = (): Promise<UserSettings | null> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        return await getUserSettings();
      } catch (e) {
        dbgWarn("layout", "loadSettings failed", e);
        return null;
      }
    })();
    return inFlight;
  };
  const refresh = (): Promise<UserSettings | null> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      inFlight = null;
      try {
        return await load();
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  };
  return {
    start: load,
    refresh,
    promise: () => inFlight,
  };
}

/**
 * Listener applied to USER_SETTINGS_CHANGED_EVENT: applies the same side
 * effects as a fresh load (process-visibility cache, zoom, visual-perf).
 * Returns an unregister fn.
 */
export function applySettingsChanged(settings: UserSettings): void {
  try {
    persistCachedProcessVisibility(normalizeProcessVisibility(settings.process_visibility));
  } catch {
    /* ignore */
  }
}

export { USER_SETTINGS_CHANGED_EVENT };
