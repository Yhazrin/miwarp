/**
 * Module-level singletons for the chat page.
 *
 * Why this file exists
 * ────────────────────
 * SvelteKit destroys and re-creates the /chat page component every time the
 * user navigates away and back.  Without these singletons, every re-visit
 * pays the full cold-start cost:
 *
 *   • new SessionStore() — timeline/messages wiped, must replay from IPC/IDB
 *   • middleware.destroy() → middleware.start() — re-registers 6+ Tauri event
 *     listeners; middlewareReady stays false until all awaits finish, gating
 *     the run-load $effect
 *   • getUserSettings / getAgentSettings / listRuns — redundant IPC calls
 *
 * With these singletons:
 *   • The SessionStore instance (and its $state fields) survives navigation.
 *     On re-visit the $effect sees store.run?.id === current runId AND phase
 *     is not "empty"/"loading" → skips the expensive loadRun entirely.
 *   • The middleware stays started; isStarted === true → middlewareReady is
 *     set synchronously in onMount, the $effect fires in the next microtask.
 *   • Settings are served from cache (30 s TTL) so the async IPC is skipped
 *     on typical re-visits.
 */

import { SessionStore } from "./session-store.svelte";
import type { UserSettings, AgentSettings } from "$lib/types";

// ── SessionStore singleton ──────────────────────────────────────────────────

let _chatStore: SessionStore | null = null;

/**
 * Returns the persistent chat SessionStore, creating it on first call.
 * The instance is reused across /chat page mounts so conversation state
 * (timeline, run, phase) is never wiped by SvelteKit's page unmount.
 */
export function getChatSessionStore(): SessionStore {
  _chatStore ??= new SessionStore();
  return _chatStore;
}

// ── Settings cache ──────────────────────────────────────────────────────────

const SETTINGS_TTL_MS = 30_000;

let _settings: UserSettings | null = null;
let _settingsFetchedAt = 0;

export function getCachedUserSettings(): UserSettings | null {
  if (_settings && Date.now() - _settingsFetchedAt < SETTINGS_TTL_MS) return _settings;
  return null;
}

export function setCachedUserSettings(s: UserSettings): void {
  _settings = s;
  _settingsFetchedAt = Date.now();
}

let _agentSettings: AgentSettings | null = null;
let _agentSettingsFetchedAt = 0;

export function getCachedAgentSettings(): AgentSettings | null {
  if (_agentSettings && Date.now() - _agentSettingsFetchedAt < SETTINGS_TTL_MS)
    return _agentSettings;
  return null;
}

export function setCachedAgentSettings(s: AgentSettings): void {
  _agentSettings = s;
  _agentSettingsFetchedAt = Date.now();
}
