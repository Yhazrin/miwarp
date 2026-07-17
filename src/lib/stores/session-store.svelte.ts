/**
 * Re-export barrel for backwards compatibility.
 *
 * All consumers import from `$lib/stores/session-store.svelte` — this file
 * re-exports from the directory index so existing import paths continue to work.
 */
export { SessionStore, sessionStore } from "./session-store/index.svelte";
export type { ElicitationState, TaskNotificationItem } from "./session-store/index.svelte";
