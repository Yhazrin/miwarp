/**
 * Centralised window event names (the "ocv:*" bus).
 *
 * RULE: every `window.dispatchEvent / addEventListener / removeEventListener`
 * that uses an "ocv:*" event name MUST import from here.
 */

// ── Run lifecycle ───────────────────────────────────────────────────────
export const EVT_RUNS_CHANGED = "ocv:runs-changed";

// ── CWD / project ──────────────────────────────────────────────────────
export const EVT_CWD_CHANGED = "ocv:cwd-changed";
export const EVT_PROJECT_CHANGED = "ocv:project-changed";

// ── Favorites ───────────────────────────────────────────────────────────
export const EVT_FAVORITES_CHANGED = "ocv:favorites-changed";

// ── Permissions ─────────────────────────────────────────────────────────
export const EVT_OPEN_PERMISSIONS = "ocv:open-permissions";

// ── Status bar ──────────────────────────────────────────────────────────
export const EVT_STATUSBAR_TOGGLE = "ocv:statusbar-toggle";

// ── Summarize ───────────────────────────────────────────────────────────
export const EVT_SUMMARIZE_CHAT = "ocv:summarize-chat";
export const EVT_SUMMARIZE_CHAT_ACK = "ocv:summarize-chat-ack";

// ── Memory ──────────────────────────────────────────────────────────────
export const EVT_MEMORY_FILE_SELECTED = "ocv:memory-file-selected";
export const EVT_MEMORY_FILE_SAVED = "ocv:memory-file-saved";
export const EVT_MEMORY_SELECT = "ocv:memory-select";

// ── Explorer ────────────────────────────────────────────────────────────
export const EVT_EXPLORER_FILE = "ocv:explorer-file";
export const EVT_EXPLORER_DIFF = "ocv:explorer-diff";
export const EVT_EXPLORER_FILE_SELECTED = "ocv:explorer-file-selected";

// ── File dirty ──────────────────────────────────────────────────────────
export const EVT_FILE_DIRTY = "ocv:file-dirty";

// ── Wizard ──────────────────────────────────────────────────────────────
export const EVT_SHOW_WIZARD = "ocv:show-wizard";

// ── Multi-agent ─────────────────────────────────────────────────────────
export const EVT_OPEN_MULTI_AGENT = "ocv:open-multi-agent";

// ── Export ──────────────────────────────────────────────────────────────
export const EVT_EXPORT_HTML = "ocv:export-html";
export const EVT_EXPORT_HTML_ACK = "ocv:export-html-ack";

// ── New session / progress ──────────────────────────────────────────────
export const EVT_NEW_SESSION = "ocv:new-session";
export const EVT_TOGGLE_PROGRESS_PANEL = "ocv:toggle-progress-panel";

// ── Memory (additional) ─────────────────────────────────────────────────
export const EVT_MEMORY_FILE_CREATED = "ocv:memory-file-created";
