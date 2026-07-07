/**
 * v1.0.6 follow-up: settings tab registry.
 *
 * New tabs register here with a label, icon, and group.
 * Tab components are lazy-loaded in SettingsPanels.svelte.
 */

export type SettingsTabId =
  | "appearance"
  | "theme"
  | "providers"
  | "devices"
  | "shortcuts"
  | "remote-hosts"
  | "cli-behavior"
  | "worktree"
  | "runtimes"
  | "notifications"
  | "data-debug"
  | "updates";

export type SettingsNavGroupId = "display" | "integration" | "automation" | "system";

export interface SettingsNavGroup {
  id: SettingsNavGroupId;
  labelKey: string;
  fallbackLabel: string;
}

export interface SettingsTabDef {
  id: SettingsTabId;
  labelKey: string;
  fallbackLabel: string;
  /** SVG path data; rendered inside a 16x16 viewBox. */
  iconPath: string;
  groupId: SettingsNavGroupId;
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  { id: "display", labelKey: "settings_nav_display", fallbackLabel: "Display" },
  { id: "integration", labelKey: "settings_nav_integration", fallbackLabel: "Integration" },
  { id: "automation", labelKey: "settings_nav_automation", fallbackLabel: "Automation" },
  { id: "system", labelKey: "settings_nav_system", fallbackLabel: "System" },
];

// Placeholder icons (16x16 lucide-style paths). Phase 2 will swap to the
// Icon component once tabs are extracted; for now the registry drives
// the navigation rendering shape and can be filled in alongside each tab.
const ICON_EYE = "M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5Zm6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z";
const ICON_PALETTE =
  "M12 3a9 9 0 0 0 0 18 2 2 0 0 0 1.4-3.9 1 1 0 0 0-.7-1.3l-1-.7a1 1 0 0 1 .5-1.7 4 4 0 0 0 4-4 9 9 0 0 0-4.2-7.4ZM6.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z";
const ICON_KEY =
  "M14 7a4 4 0 1 0-3.5 6.6L8 16.1V19h2.9l2.5-2.5V19h2.9v-2.9h2.4L21 13.5l-3.6-3.6A4 4 0 0 0 14 7Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z";
const ICON_MOBILE =
  "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 4v12h10V6H7Z";
const ICON_KEYBOARD =
  "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 4v2h2V9H5Zm4 0v2h2V9H9Zm4 0v2h2V9h-2Zm4 0v2h2V9h-2ZM7 13v2h10v-2H7Z";
const ICON_SERVER =
  "M3 4h18a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm0 10h18a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Zm2 2h2v-2H5v2Zm4 0h2v-2H9v2Z";
const ICON_TERMINAL =
  "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 3 3 3-3 3 1.5 1.5L11 11l-3.5-3.5L6 9Zm5 4h4v-1.5h-4V12Z";
const ICON_GIT_BRANCH =
  "M6 3a3 3 0 0 1 1 5.83V15a3 3 0 1 1-2 0V8.83A3 3 0 0 1 6 3Zm12 4a3 3 0 0 1-1 5.83V14a3 3 0 0 1-3 3h-3v2.17a3 3 0 1 1-2 0V15h3a1 1 0 0 0 1-1v-1.17A3 3 0 0 1 18 7Z";
const ICON_BELL =
  "M12 2a6 6 0 0 0-6 6v3.5L4 14v1h16v-1l-2-2.5V8a6 6 0 0 0-6-6Zm-2 14a2 2 0 0 0 4 0h-4Z";
const ICON_DATABASE =
  "M5 5c0-1.7 3.6-3 7-3s7 1.3 7 3v2c0 1.7-3.6 3-7 3s-7-1.3-7-3V5Zm0 5c0 1.7 3.6 3 7 3s7-1.3-7-3v-1.5c-1.4 1.3-4 2.1-7 2.1s-5.6-.8-7-2.1V10Zm0 5c0 1.7 3.6 3 7 3s7-1.3-7-3v-1.5c-1.4 1.3-4 2.1-7 2.1s-5.6-.8-7-2.1V15Z";
const ICON_CPU =
  "M4 4h8v8H4V4Zm2 2v4h4V6H6Zm8-2h4v4h-4V4Zm2 2v2h2V6h-2Zm-8 8H4v4h4v-4Zm2 2v2h2v-2H8Zm8 0h2v2h-2v-2Zm-2 2h-2v2h2v-2Zm4-8h-2v2h2V6Z";
const ICON_REFRESH_CW =
  "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5";

export const SETTINGS_TABS: SettingsTabDef[] = [
  {
    id: "appearance",
    labelKey: "settings_tab_appearance",
    fallbackLabel: "Appearance",
    iconPath: ICON_EYE,
    groupId: "display",
  },
  {
    id: "theme",
    labelKey: "settings_tab_theme",
    fallbackLabel: "Theme",
    iconPath: ICON_PALETTE,
    groupId: "display",
  },
  // HIDDEN: providers tab is a v1.0.6 follow-up shell — CLI mode block is
  // missing and callbacks are no-op stubs. Re-enable once the tab is wired
  // to settings + platform-presets end-to-end.
  //   {
  //     id: "providers",
  //     labelKey: "settings_tab_providers",
  //     fallbackLabel: "Providers",
  //     iconPath: ICON_KEY,
  //     groupId: "integration",
  //   },
  {
    id: "devices",
    labelKey: "settings_tab_devices",
    fallbackLabel: "Devices",
    iconPath: ICON_MOBILE,
    groupId: "integration",
  },
  {
    id: "shortcuts",
    labelKey: "settings_tab_shortcuts",
    fallbackLabel: "Shortcuts",
    iconPath: ICON_KEYBOARD,
    groupId: "automation",
  },
  {
    id: "remote-hosts",
    labelKey: "settings_tab_remote",
    fallbackLabel: "Remote Hosts",
    iconPath: ICON_SERVER,
    // SSH host config is "where can this MiWarp reach", which is a network
    // connection concept — same family as the web server / mobile pairing
    // on the Devices tab. Keeping it in `integration` makes the sidebar
    // signal "all connection setup lives here" rather than scattering
    // networking across automation.
    groupId: "integration",
  },
  {
    id: "cli-behavior",
    labelKey: "settings_tab_cliConfig",
    fallbackLabel: "CLI Behavior",
    iconPath: ICON_TERMINAL,
    groupId: "automation",
  },
  {
    id: "worktree",
    labelKey: "settings_tab_worktree",
    fallbackLabel: "Worktree",
    iconPath: ICON_GIT_BRANCH,
    groupId: "automation",
  },
  {
    id: "runtimes",
    labelKey: "settings_tab_runtimes",
    fallbackLabel: "Runtimes",
    iconPath: ICON_CPU,
    groupId: "automation",
  },
  {
    id: "notifications",
    labelKey: "settings_tab_notifications",
    fallbackLabel: "Notifications",
    iconPath: ICON_BELL,
    groupId: "system",
  },
  {
    id: "data-debug",
    labelKey: "settings_tab_data",
    fallbackLabel: "Data & Debug",
    iconPath: ICON_DATABASE,
    groupId: "system",
  },
  {
    id: "updates",
    labelKey: "settings_tab_updates",
    fallbackLabel: "Updates",
    iconPath: ICON_REFRESH_CW,
    groupId: "system",
  },
];

/** Legacy tab id → new tab id. Used by +page.svelte to keep old URLs working. */
export const LEGACY_TAB_MAP: Record<string, SettingsTabId> = {
  general: "appearance",
  // `connection` historically mapped to the `providers` tab, but that tab is
  // currently hidden (see SETTINGS_TABS TODO). Fall back to `appearance` so
  // old URLs still land somewhere sensible.
  connection: "appearance",
  mobile: "devices",
  "cli-config": "cli-behavior",
  shortcuts: "shortcuts",
  remote: "remote-hosts",
  notifications: "notifications",
  debug: "data-debug",
  data: "data-debug",
  updates: "updates",
};

export function getTab(id: SettingsTabId): SettingsTabDef | undefined {
  return SETTINGS_TABS.find((t) => t.id === id);
}

export function tabsByGroup(): Record<SettingsNavGroupId, SettingsTabDef[]> {
  const out: Record<SettingsNavGroupId, SettingsTabDef[]> = {
    display: [],
    integration: [],
    automation: [],
    system: [],
  };
  for (const t of SETTINGS_TABS) out[t.groupId].push(t);
  return out;
}

/** Resolve a tab id from URL: handles both new and legacy ids. */
export function resolveTabId(raw: string | null | undefined): SettingsTabId {
  if (!raw) return "appearance";
  if ((SETTINGS_TABS as SettingsTabDef[]).some((t) => t.id === raw)) {
    return raw as SettingsTabId;
  }
  return LEGACY_TAB_MAP[raw] ?? "appearance";
}
