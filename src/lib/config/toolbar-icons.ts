/**
 * v1.0.6 / 5.1 Top toolbar icon configuration.
 *
 * 11 slot positions, 5 visible when the toolbar is collapsed. The order
 * encoded here is the source of truth for both render order and which
 * icons surface in the collapsed state (first 5 entries).
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
  /** Group label used for divider placement in expanded state. */
  group: "core" | "workspace" | "extensions" | "system";
}

export const TOOLBAR_ICONS: ToolbarIconDef[] = [
  { id: "new-session", labelKey: "toolbar_newSession", icon: "plus", href: null, group: "core" },
  { id: "workspace", labelKey: "toolbar_workspace", icon: "folder", href: null, group: "core" },
  { id: "model", labelKey: "toolbar_model", icon: "bot", href: null, group: "core" },
  { id: "slash", labelKey: "toolbar_slash", icon: "zap", href: null, group: "core" },
  {
    id: "progress",
    labelKey: "toolbar_progress",
    icon: "check-square",
    href: null,
    group: "core",
  },
  {
    id: "files",
    labelKey: "nav_explorer",
    icon: "folder-open",
    href: "/explorer",
    group: "workspace",
  },
  { id: "memory", labelKey: "nav_memory", icon: "scroll-text", href: "/memory", group: "workspace" },
  { id: "history", labelKey: "nav_history", icon: "clock", href: "/history", group: "workspace" },
  {
    id: "scheduled",
    labelKey: "nav_scheduledTasks",
    icon: "clock",
    href: "/scheduled-tasks",
    group: "extensions",
  },
  { id: "plugins", labelKey: "nav_extend", icon: "package", href: "/plugins", group: "extensions" },
  { id: "settings", labelKey: "nav_settings", icon: "settings", href: "/settings", group: "system" },
];

/** Always-visible slots when the toolbar is collapsed. */
export const COLLAPSED_VISIBLE_COUNT = 5;
