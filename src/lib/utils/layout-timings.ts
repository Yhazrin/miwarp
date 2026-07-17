/**
 * Layout timing constants — single source of truth for timers / pollers / debounces
 * owned by the root layout.
 *
 * RULE: every raw duration (ms) in src/routes/+layout.svelte MUST be a named export
 * from this file. Inline magic numbers make it impossible to coordinate retry
 * cadences or audit the impact of a tuning change.
 */

export const SPLASH_FADE_MS = 300;
export const SPLASH_REMOVE_DELAY_MS = 300;

/** Fallback poll for the runs list. Primary updates flow through `ocv:runs-changed`. */
export const RUNS_POLL_INTERVAL_MS = 60_000;

/** Fallback poll for the team store. Primary updates flow through team/task events. */
export const TEAMS_POLL_INTERVAL_MS = 60_000;

/** Debounce window for the "team/task event burst → forceRefresh" reconciliation. */
export const TEAM_RESYNC_DEBOUNCE_MS = 300;

/** Debounce for the deep session-search shortcut. */
export const DEEP_SEARCH_DEBOUNCE_MS = 300;

/** Delay between transport.listen() retry attempts (2s, 4s). */
export const LISTEN_RETRY_BASE_DELAY_MS = 2_000;
export const LISTEN_RETRY_MAX_ATTEMPTS = 3;
