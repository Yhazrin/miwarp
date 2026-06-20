/**
 * Centralized timing constants for the frontend.
 *
 * Every named duration that the UI uses for "wait this long", "debounce by
 * this much", or "show for this many seconds" lives here. Inline magic
 * numbers (`setTimeout(_, 500)`, `1000`, `2000`, `30_000`) are a smell —
 * they make it impossible to answer "what's our toast auto-dismiss budget?"
 * without grepping the codebase.
 *
 * Rules:
 *   1. If a duration is referenced from more than one file, it goes here.
 *   2. The unit is always milliseconds; name your constant `_MS` so the
 *      call site is self-documenting (`RECOVER_DEBOUNCE_MS` ⇒ ms).
 *   3. Tests that need to assert a delay can import the constant directly.
 *
 * See `docs/architecture/quality-foundation.md` ADR-002.
 */

/** Reconnect base delay for WS transport (exponential backoff, capped at RECONNECT_MAX_MS). */
export const WS_RECONNECT_BASE_MS = 1000;

/** Reconnect maximum delay for WS transport. */
export const WS_RECONNECT_MAX_MS = 30_000;

/** Debounce window for session recovery / re-sync triggers. */
export const RECOVER_DEBOUNCE_MS = 2000;

/** Spawn timeout for new session tasks. */
export const SESSION_SPAWN_TIMEOUT_MS = 30_000;

/** Response timeout for long-running CLI operations. */
export const SESSION_RESPONSE_TIMEOUT_MS = 60_000;

/** Team file-watcher cooldown to prevent event storms. */
export const TEAM_WATCHER_COOLDOWN_MS = 10_000;

/** Tool burst settling: hold expanded state after completion before collapsing. */
export const TOOL_BURST_SETTLING_MS = 400;

/** Tool burst collapse animation duration. */
export const TOOL_BURST_COLLAPSING_MS = 260;

/** Mascot "done" window in the sidebar (transitions to idle state after this). */
export const MASCOT_DONE_WINDOW_MS = 5000;

/** Default idle gap for stream flushing. */
export const STREAM_IDLE_GAP_MS = 100;

/** Debounce for sidebar save (width, expanded state, etc.). */
export const SIDEBAR_DEBOUNCE_SAVE_MS = 400;

/** Long-press threshold for touch interactions. */
export const LONG_PRESS_MS = 480;

/** Settings TTL for the sound feedback service. */
export const SOUND_SETTINGS_TTL_MS = 30_000;

/** Tool tick minimum interval (debounce for tool progress display). */
export const TOOL_TICK_MIN_MS = 280;

/** Archive threshold for sidebar history. */
export const ARCHIVE_THRESHOLD_MS = 60 * 60 * 1000;
