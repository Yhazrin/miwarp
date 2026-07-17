/**
 * Centralised localStorage key constants.
 *
 * RULE: every `localStorage.getItem/setItem` call MUST use a key from here.
 * Legacy keys (migration-only) are prefixed with `LEGACY_`.
 */

// ── Project / CWD ──────────────────────────────────────────────────────
export const LS_PROJECT_CWD = "ocv:project-cwd";
export const LS_SETTINGS_CWD = "ocv:settings-cwd";
export const LS_EXPANDED_PROJECTS = "ocv:expanded-projects";
export const LS_PINNED_CWDS = "ocv:pinned-cwds";
export const LS_REMOVED_CWDS = "ocv:removed-cwds";
const LS_LEGACY_HIDDEN_CWDS = "ocv:hidden-cwds";

// ── Sidebar ─────────────────────────────────────────────────────────────
export const LS_SIDEBAR_WIDTH = "ocv:sidebar-width";

// ── Chat / Preview ──────────────────────────────────────────────────────
export const LS_PREVIEW_URL = "ocv:preview-url";
const LS_CHAT_VIEW_CACHE = "ocv:chat-view-cache";
export const LS_CLI_VERSION = "ocv:cli-version";

// ── Teams ───────────────────────────────────────────────────────────────
const LS_TEAMS_TAB = "ocv:teams-tab";

// ── Commands ────────────────────────────────────────────────────────────
const LS_RECENT_COMMANDS = "ocv:recent-commands";

// ── Automation ──────────────────────────────────────────────────────────
export const LS_AUTOMATION_SCRIPTS = "ocv:automation-scripts";

// ── Theme (legacy migration only) ───────────────────────────────────────
export const LS_LEGACY_THEME = "ocv:theme";
export const LS_LEGACY_COLOR_SCHEME = "ocv:colorScheme";

// ── Debug ───────────────────────────────────────────────────────────────
export const LS_DEBUG = "ocv:debug";

// ── Tool activity ───────────────────────────────────────────────────────
export const LS_TOOLACTIVITY_WIDTH = "ocv:toolactivity-width";

// ── Usage page ──────────────────────────────────────────────────────────
export const LS_USAGE_RUN_HISTORY_SORT = "ocv:usage-run-history-sort";
