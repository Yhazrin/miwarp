/**
 * Personal page cold-start controller — pure orchestration of the IPC calls
 * the Personal profile page fires on mount. Extracted from `+page.svelte` so
 * the cold-start budget (which APIs block first paint vs which hydrate in
 * the background) is unit-testable without spinning up Svelte.
 *
 * Contract:
 *   - `start()` is non-blocking on activity / skillCount: each one runs in
 *     its own promise and reports back via the injected callbacks. Runtime
 *     probing is intentionally excluded from this route.
 *     First paint is gated only on `settings`.
 *   - `retry()` clears the cached settings promise (single-flight refresh)
 *     and resolves again.
 *   - `continueWithout()` flips the load state to `ready` so the user can
 *     browse the page even when the settings backend is unreachable.
 *
 * The controller deliberately does NOT touch Svelte `$state` or `$effect`;
 * the page binds its own `$state` setters via the returned callbacks. This
 * keeps the controller testable in `node` (vitest default environment).
 */

import { dbgWarn } from "$lib/utils/debug";
import type { SkillSummary, UsageOverview, UserSettings } from "$lib/types";

type PersonalSettingsLoadState "pending" | "ready" | "failed";

export interface PersonalColdStartDeps {
  /** Returns the cached settings synchronously if available, otherwise awaits
   *  the layout's single-flight in-flight load. Mirrors `resolveLayoutCachedSettings`. */
  resolveSettings: () => Promise<UserSettings | null>;
  /** Forces a fresh settings IPC. Used by the retry path. */
  refreshSettings: () => Promise<UserSettings | null>;
  /** Loads the 7-day usage overview. */
  getUsageOverview: () => Promise<UsageOverview>;
  /** Loads the lightweight skill count. Replaces the full `skillStore.loadSkills()`. */
  getSkillSummary: () => Promise<SkillSummary>;
  /** Optional override for `requestIdleCallback`. Returns true if scheduled
   *  asynchronously, false if it ran synchronously (or was bypassed). */
  scheduleIdle: (task: () => void) => boolean;
}

export interface PersonalColdStartCallbacks {
  onSettingsLoad: (state: PersonalSettingsLoadState, settings: UserSettings | null) => void;
  onActivityLoaded: (snapshot: {
    runs7d: number | null;
    totalCostUsd: number | null;
    dailyCost: number[];
  }) => void;
  onSkillCountLoaded: (count: number | null) => void;
}

export interface PersonalColdStartHandle {
  /** Fires `settings` (blocking first paint), then schedules activity +
   *  skillCount via `scheduleIdle` so no IPC competes with route entry. */
  start: () => void;
  /** Re-runs only the settings load with `refreshSettings`. */
  retry: () => Promise<void>;
  /** Marks settings load as `ready` with a placeholder, so the page renders
   *  in read-only mode when the backend is unreachable. */
  continueWithoutSettings: (placeholder: UserSettings) => void;
}

/**
 * Build the controller. All side effects run through `deps` so tests can
 * swap each IPC for a controllable mock without touching the network.
 */
export function createPersonalColdStart(
  deps: PersonalColdStartDeps,
  cb: PersonalColdStartCallbacks,
): PersonalColdStartHandle {
  async function runSettings(): Promise<void> {
    try {
      const resolved = await deps.resolveSettings();
      cb.onSettingsLoad(resolved ? "ready" : "failed", resolved);
    } catch (e) {
      dbgWarn("personal", "settings resolve failed", e);
      cb.onSettingsLoad("failed", null);
    }
  }

  async function runActivity(): Promise<void> {
    try {
      const overview = await deps.getUsageOverview();
      const daily = (overview.daily ?? []).slice(-7).map((d) => d.costUsd ?? 0);
      cb.onActivityLoaded({
        runs7d: overview.totalRuns ?? null,
        totalCostUsd: overview.totalCostUsd ?? null,
        dailyCost: daily,
      });
    } catch (e) {
      dbgWarn("personal", "load activity failed", e);
      cb.onActivityLoaded({ runs7d: null, totalCostUsd: null, dailyCost: [] });
    }
  }

  async function runSkillCount(): Promise<void> {
    try {
      const summary = await deps.getSkillSummary();
      cb.onSkillCountLoaded(summary.total);
    } catch (e) {
      dbgWarn("personal", "load skill summary failed", e);
      cb.onSkillCountLoaded(null);
    }
  }

  return {
    start: () => {
      // 1. Settings — blocks first paint via `settingsLoad` state.
      void runSettings();
      // 2–3. Activity and skill count — defer to idle so IPC + re-renders
      // never compete with route entry / first paint. Runtime discovery is
      // deliberately absent: Personal consumes the static runtime registry.
      deps.scheduleIdle(() => {
        void runActivity();
        void runSkillCount();
      });
    },
    retry: async () => {
      cb.onSettingsLoad("pending", null);
      try {
        const resolved = await deps.refreshSettings();
        cb.onSettingsLoad(resolved ? "ready" : "failed", resolved);
      } catch (e) {
        dbgWarn("personal", "settings refresh failed", e);
        cb.onSettingsLoad("failed", null);
      }
    },
    continueWithoutSettings: (placeholder) => {
      cb.onSettingsLoad("ready", placeholder);
    },
  };
}
