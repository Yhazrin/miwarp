/**
 * navigation-model — pure TypeScript model for the layout's navigation tree
 * and page-detection derivations. No Svelte 5 runes here; this module exports
 * plain constants and predicates so consumers (layout / AppShell / tests)
 * can compute "which page am I on" without owning any reactive state.
 *
 * Why a separate file:
 *   The original +layout.svelte held the 12-entry navItems array, the
 *   `pathIsChat` / `pathIsSettings` helpers, and the `isXxxPage` $derived
 *   booleans inline. They were the most stable part of the layout but still
 *   bloated the file. Pulling them into a pure module lets the layout stay
 *   focused on wiring, lets AppShell render the rail off the same source of
 *   truth, and lets unit tests pin the navigation surface without mounting
 *   the entire layout component.
 *
 * Rule of thumb: if a navigation predicate doesn't need `$state` /
 * `$derived` / `$effect`, it belongs here.
 */
import { t } from "$lib/i18n/index.svelte";
import { routeNeedsLayoutContentPanel } from "$lib/layout-chrome-context";

type NavItemGroup "core" | "workspace" | "collaboration" | "extensions" | "system";

export type NavItem = {
  path: string;
  /** Resolved label function — keep as a thunk so the rail re-renders on locale switch. */
  label: () => string;
  icon: string;
  group: NavItemGroup;
};

/**
 * Navigation entries grouped by function:
 *   - core: chat + scheduled-tasks (the day-to-day surfaces)
 *   - workspace: per-cwd project tools (workbench / explorer / history / personal)
 *   - collaboration: teams (multi-agent shared resources)
 *   - extensions: plugin marketplace
 *   - system: usage + settings
 *
 * Keeping them in distinct groups reduces the "workspace vs teams/fleet"
 * overlap feeling — the rail renders a divider when group changes.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  // Core
  { path: "/chat", label: () => t("nav_chat"), icon: "message", group: "core" },
  {
    path: "/scheduled-tasks",
    label: () => t("nav_scheduledTasks"),
    icon: "schedule",
    group: "core",
  },
  // Project tools (single-user, per-cwd)
  { path: "/explorer", label: () => t("nav_explorer"), icon: "folder", group: "workspace" },
  { path: "/history", label: () => t("nav_history"), icon: "clock", group: "workspace" },
  { path: "/personal", label: () => t("nav_personal"), icon: "circle-user", group: "workspace" },
  // Collaboration: teams (fleet / digital-workforce page hidden — UX still rough)
  { path: "/teams", label: () => t("nav_teams"), icon: "users", group: "collaboration" },
  // Extensions
  { path: "/plugins", label: () => t("nav_extend"), icon: "zap", group: "extensions" },
  // System
  { path: "/usage", label: () => t("nav_usage"), icon: "chart", group: "system" },
  { path: "/settings", label: () => t("nav_settings"), icon: "settings", group: "system" },
];

// ── Path predicates (string-only, no reactive state) ───────────────────

export function pathIsChat(pathname: string): boolean {
  return pathname === "/chat" || pathname === "/";
}

export function pathIsSettings(pathname: string): boolean {
  return pathname.startsWith("/settings");
}

export function pathIsChatOrSettingsTransition(from: string, to: string): boolean {
  return (pathIsChat(from) && pathIsSettings(to)) || (pathIsSettings(from) && pathIsChat(to));
}

function pathStartsWithHub(pathname: string, prefix: string): boolean {
  return pathname.startsWith(prefix);
}

// ── Page-detection booleans (consumed by $derived in AppShell / layout) ─

export interface PageKinds {
  readonly currentPath: string;
  readonly isChatPage: boolean;
  readonly isPluginsPage: boolean;
  readonly isExplorerPage: boolean;
  readonly isTeamsPage: boolean;
  readonly isScheduledTasksPage: boolean;
  readonly isSettingsPage: boolean;
  readonly needsLayoutContentPanel: boolean;
  /** Match-and-capture the scheduled-task hub id from the URL (empty when not on /scheduled-tasks/:id). */
  readonly selectedScheduledTaskId: string;
}

export function describeCurrentPage(currentPath: string): PageKinds {
  const hubMatch = currentPath.match(/^\/scheduled-tasks\/([^/]+)/);
  return {
    currentPath,
    isChatPage: pathIsChat(currentPath),
    isPluginsPage: currentPath.startsWith("/plugins"),
    isExplorerPage: currentPath.startsWith("/explorer"),
    isTeamsPage: currentPath.startsWith("/teams"),
    isScheduledTasksPage: currentPath.startsWith("/scheduled-tasks"),
    isSettingsPage: pathIsSettings(currentPath),
    needsLayoutContentPanel: routeNeedsLayoutContentPanel(currentPath),
    selectedScheduledTaskId: hubMatch ? (hubMatch[1] ?? "") : "",
  };
}

/**
 * Resolve a breadcrumb label for the current route. Order: explicit nav
 * match → release-notes fallback → generic app name. Pure function so
 * AppShell can call it from a `$derived`.
 */
export function resolvePageName(currentPath: string): string {
  for (const item of NAV_ITEMS) {
    if (currentPath.startsWith(item.path)) return item.label();
  }
  if (currentPath.startsWith("/release-notes")) return t("release_cliChangelog");
  return t("layout_appName");
}
