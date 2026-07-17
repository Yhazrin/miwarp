/**
 * Chat page state composable.
 * Groups UI-only reactive state that doesn't live in the session store.
 */
import type { UserSettings, AgentSettings } from "$lib/types";
import type { ProcessVisibility } from "$lib/utils/process-visibility";
import { getCachedProcessVisibility, normalizeProcessVisibility } from "$lib/utils/process-visibility";
import type { SessionIslandAlignment } from "$lib/utils/session-island-alignment";
import { normalizeSessionIslandAlignment } from "$lib/utils/session-island-alignment";
import { chatViewCache } from "$lib/chat/chat-view-cache.svelte";
import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
import type { SessionStatusBar } from "$lib/components/SessionStatusBar.svelte";
import type { PromptInputSnapshot } from "$lib/types";

export function createChatState() {
  let settings = $state<UserSettings | null>(null);
  let agentSettings = $state<AgentSettings | null>(null);
  let resuming = $state(false);
  /** Suppress "Session ended" flash during tool approval restart cycle. */
  let approving = $state(false);
  let sidebarCollapsed = $state(chatViewCache.sidebarCollapsed);
  let shortcutHelpOpen = $state(false);
  let statusBarRef: SessionStatusBar | undefined = $state();
  let stashedInput: PromptInputSnapshot | null = $state(null);
  let sidebarRequestedTab = $state<ToolActivityPanelTab | null>(null);
  let mcpPanelOpen = $state(false);

  let processVisibility = $state<ProcessVisibility>(getCachedProcessVisibility());
  let sessionIslandAlignmentOverride = $state<SessionIslandAlignment | null>(null);

  const sessionIslandAlignment = $derived(
    sessionIslandAlignmentOverride ??
      (settings != null
        ? normalizeSessionIslandAlignment(settings.session_island_alignment)
        : "center"),
  );

  // Tool panel state
  let toolPanelActiveTab = $state<ToolActivityPanelTab>(chatViewCache.toolPanelActiveTab);
  let toolPanelIndicators = $state({ context: false, files: false, tasks: false });
  let requestedPreviewPath = $state<string | null>(chatViewCache.requestedPreviewPath);
  let requestedPreviewUrl = $state<string | null>(null);

  // Permission status overlay
  let permissionStatusOverlay = $state<{
    payload: import("$lib/chat/send-status-presentation").PermissionStatusInput;
    version: number;
  } | null>(null);

  // Toast overlay
  let toastOverlay = $state<import("$lib/stores/toast-store.svelte").Toast | null>(null);
  let toastOverlayVersion = $state(0);

  // Status bar expansion
  let statusBarExpanded = $state(
    typeof window !== "undefined"
      ? localStorage.getItem("ocv:statusbar-expanded") !== "false"
      : true,
  );

  function pushPermissionStatus(
    payload: import("$lib/chat/send-status-presentation").PermissionStatusInput,
  ): void {
    permissionStatusOverlay = { payload, version: Date.now() };
  }

  function clearPermissionStatusOverlay(): void {
    permissionStatusOverlay = null;
  }

  function clearToastOverlay(): void {
    toastOverlay = null;
  }

  function openPreviewForPath(path: string, toggleSidebar: () => void) {
    if (!path) return;
    requestedPreviewPath = path;
    sidebarRequestedTab = "files";
    if (sidebarCollapsed) toggleSidebar();
  }

  function syncProcessVisibility(s: UserSettings | null) {
    processVisibility =
      s != null ? normalizeProcessVisibility(s.process_visibility) : getCachedProcessVisibility();
  }

  return {
    get settings() { return settings; },
    set settings(v: UserSettings | null) { settings = v; },
    get agentSettings() { return agentSettings; },
    set agentSettings(v: AgentSettings | null) { agentSettings = v; },
    get resuming() { return resuming; },
    set resuming(v: boolean) { resuming = v; },
    get approving() { return approving; },
    set approving(v: boolean) { approving = v; },
    get sidebarCollapsed() { return sidebarCollapsed; },
    set sidebarCollapsed(v: boolean) { sidebarCollapsed = v; },
    get shortcutHelpOpen() { return shortcutHelpOpen; },
    set shortcutHelpOpen(v: boolean) { shortcutHelpOpen = v; },
    get statusBarRef() { return statusBarRef; },
    set statusBarRef(v: SessionStatusBar | undefined) { statusBarRef = v; },
    get stashedInput() { return stashedInput; },
    set stashedInput(v: PromptInputSnapshot | null) { stashedInput = v; },
    get sidebarRequestedTab() { return sidebarRequestedTab; },
    set sidebarRequestedTab(v: ToolActivityPanelTab | null) { sidebarRequestedTab = v; },
    get mcpPanelOpen() { return mcpPanelOpen; },
    set mcpPanelOpen(v: boolean) { mcpPanelOpen = v; },
    get processVisibility() { return processVisibility; },
    set processVisibility(v: ProcessVisibility) { processVisibility = v; },
    get sessionIslandAlignmentOverride() { return sessionIslandAlignmentOverride; },
    set sessionIslandAlignmentOverride(v: SessionIslandAlignment | null) { sessionIslandAlignmentOverride = v; },
    get sessionIslandAlignment() { return sessionIslandAlignment; },
    get toolPanelActiveTab() { return toolPanelActiveTab; },
    set toolPanelActiveTab(v: ToolActivityPanelTab) { toolPanelActiveTab = v; },
    get toolPanelIndicators() { return toolPanelIndicators; },
    set toolPanelIndicators(v: { context: boolean; files: boolean; tasks: boolean }) { toolPanelIndicators = v; },
    get requestedPreviewPath() { return requestedPreviewPath; },
    set requestedPreviewPath(v: string | null) { requestedPreviewPath = v; },
    get requestedPreviewUrl() { return requestedPreviewUrl; },
    set requestedPreviewUrl(v: string | null) { requestedPreviewUrl = v; },
    get permissionStatusOverlay() { return permissionStatusOverlay; },
    get toastOverlay() { return toastOverlay; },
    set toastOverlay(v: import("$lib/stores/toast-store.svelte").Toast | null) { toastOverlay = v; },
    get toastOverlayVersion() { return toastOverlayVersion; },
    set toastOverlayVersion(v: number) { toastOverlayVersion = v; },
    get statusBarExpanded() { return statusBarExpanded; },
    set statusBarExpanded(v: boolean) { statusBarExpanded = v; },
    pushPermissionStatus,
    clearPermissionStatusOverlay,
    clearToastOverlay,
    openPreviewForPath,
    syncProcessVisibility,
  };
}

type ChatState ReturnType<typeof createChatState>;
