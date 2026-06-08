/**
 * v1.0.6 / 5.1 Top toolbar icon configuration.
 *
 * Layout rule:
 *   Collapsed → 4 core icons centered.
 *   Expanded  → same 4 core icons stay centered; flanked by workspace + system icons.
 *
 *  Three groups separated by dividers:
 *    [files, memory, history]  |  [new-session, workspace, model, slash]  |  [progress, scheduled, plugins, settings]
 */
import type { LucideIconName } from "$lib/lucide-icon";

export type ToolbarIconId =
  | "new-session"
  | "workspace"
  | "model"
  | "slash"
  | "progress"
  | "files"
  | "memory"
  | "history"
  | "scheduled"
  | "plugins"
  | "settings";

export interface ToolbarIconDef {
  id: ToolbarIconId;
  /** i18n key (will be passed to t()) */
  labelKey: string;
  /** Lucide icon name (resolved by the Icon component) */
  icon: LucideIconName;
  /** Route to navigate to. `null` for action buttons (no nav). */
  href: string | null;
  /** Layout group — determines position relative to the center core group. */
  group: "left" | "core" | "right";
}

// ── Left flanking group (workspace tools) ──
const LEFT_GROUP: ToolbarIconDef[] = [
  { id: "files", labelKey: "nav_explorer", icon: "folder-open", href: "/explorer", group: "left" },
  { id: "memory", labelKey: "nav_memory", icon: "scroll-text", href: "/memory", group: "left" },
  { id: "history", labelKey: "nav_history", icon: "clock", href: "/history", group: "left" },
];

// ── Center core group (always visible) ──
const CORE_GROUP: ToolbarIconDef[] = [
  { id: "new-session", labelKey: "toolbar_newSession", icon: "plus", href: null, group: "core" },
  { id: "workspace", labelKey: "toolbar_workspace", icon: "folder", href: null, group: "core" },
  { id: "model", labelKey: "toolbar_model", icon: "bot", href: null, group: "core" },
  { id: "slash", labelKey: "toolbar_slash", icon: "zap", href: null, group: "core" },
];

// ── Right flanking group (extensions + system) ──
const RIGHT_GROUP: ToolbarIconDef[] = [
  { id: "progress", labelKey: "toolbar_progress", icon: "check-square", href: null, group: "right" },
  { id: "scheduled", labelKey: "nav_scheduledTasks", icon: "clock", href: "/scheduled-tasks", group: "right" },
  { id: "plugins", labelKey: "nav_extend", icon: "package", href: "/plugins", group: "right" },
  { id: "settings", labelKey: "nav_settings", icon: "settings", href: "/settings", group: "right" },
];

/** Full ordered list: left → core → right. */
export const TOOLBAR_ICONS: ToolbarIconDef[] = [...LEFT_GROUP, ...CORE_GROUP, ...RIGHT_GROUP];

/** Core icons (always visible in both collapsed and expanded states). */
export const CORE_ICONS: ToolbarIconDef[] = CORE_GROUP;

/** Number of icons visible when collapsed (= core group size). */
export const COLLAPSED_VISIBLE_COUNT = CORE_GROUP.length;

/** Group boundaries for divider insertion in expanded mode. */
export const TOOLBAR_GROUPS = {
  left: LEFT_GROUP,
  core: CORE_GROUP,
  right: RIGHT_GROUP,
} as const;
