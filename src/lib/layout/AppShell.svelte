<!--
  AppShell — the root layout's outer shell. Renders the sidebar (icon
  rail + content panel) and the main pane, plus the overlay / modals /
  toast chrome that live at the root level.

  Owns the template that previously lived directly inside
  `src/routes/+layout.svelte`. All state is sourced from the layout-
  scoped stores (project-selection-store, runs-sidebar-store,
  session-folder-store, explorer-tree-store, team-sidebar-store) and
  the singleton stores that already existed pre-refactor (team-store,
  keybindings, etc.).

  The component does NOT own any `$state` beyond the chrome booleans
  that are local to the shell (sidebar collapse / width / drag state,
  dialog open flags, plugin section, etc.). Everything else flows
  from stores so the shell can be reasoned about as a render function
  over the union of layout stores.

  No setContext / IPC / transport.listen calls here — those live in
  +layout.svelte's onMount, which composes this shell + a window
  controller.
-->
<script lang="ts">
  import "../../app.css";
  import "$lib/styles/sidebar-animations.css";

  // ── Stores & state ──────────────────────────────────────────────
  import { page } from "$app/stores";
  import { goto, afterNavigate, beforeNavigate } from "$app/navigation";
  import { get } from "svelte/store";
  import { setContext, untrack, getContext } from "svelte";

  import { t } from "$lib/i18n/index.svelte";

  import {
    LAYOUT_CHROME_CONTEXT_KEY,
    SETTINGS_CACHE_CONTEXT_KEY,
    type LayoutChromeContext,
    type SettingsCacheContext,
  } from "$lib/layout-chrome-context";
  import {
    NAV_ITEMS,
    describeCurrentPage,
    pathIsChat,
    pathIsChatOrSettingsTransition,
    resolvePageName,
  } from "$lib/layout/navigation-model";

  import { projectSelectionStore as pss } from "$lib/layout/project-selection-store.svelte";
  import { runsSidebarStore as rss } from "$lib/layout/runs-sidebar-store.svelte";
  import { sessionFolderStore as sfs } from "$lib/layout/session-folder-store.svelte";
  import { explorerTreeStore as ets } from "$lib/layout/explorer-tree-store.svelte";
  import { teamSidebarStore as tss } from "$lib/layout/team-sidebar-store.svelte";

  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
  import { attentionQueueStore } from "$lib/stores/attention-queue-store.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { TeamStore } from "$lib/stores/team-store.svelte";
  import { KeybindingStore } from "$lib/stores/keybindings.svelte";
  import { chatViewCache } from "$lib/chat/chat-view-cache.svelte";
  import { getChatTimelineResetHandle } from "$lib/chat/chat-timeline-reset-registry";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";
  import { themeStore } from "$lib/stores/theme-store.svelte";

  import { writeActiveSessionId } from "$lib/utils/chat-persistence";
  import { beginRouteTransition, endRouteTransition } from "$lib/utils/route-transition";
  import { armChatSettingsHop } from "$lib/utils/chat-settings-nav";
  import { EVT_RUNS_CHANGED, EVT_PROJECT_CHANGED } from "$lib/utils/bus-events";
  import { clampUiZoom, layoutPx } from "$lib/utils/ui-zoom";
  import { IS_MAC } from "$lib/utils/platform";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { openDirectoryInFinder } from "$lib/api";
  import {
    buildEnrichedProjectFolders,
    sessionFoldersForWorkspace,
    getWorkspaceMascotStatus,
    autoExpandForRun,
    expandForProjectChange,
    normalizeCwd,
  } from "$lib/utils/sidebar-groups";
  import { cwdDisplayLabel, truncate, snippetAround, relativeTime } from "$lib/utils/format";
  import { escapeHtml } from "$lib/utils/ansi";
  import type { PluginSection } from "$lib/utils/plugin-sections";

  // ── Components ──────────────────────────────────────────────────
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import TopWindowDrag from "$lib/components/TopWindowDrag.svelte";
  import UpdateBanner from "$lib/components/UpdateBanner.svelte";
  import VersionMismatchBanner from "$lib/components/VersionMismatchBanner.svelte";
  import SettingsSidebar from "$lib/components/settings/SettingsSidebar.svelte";
  import ScheduledTasksSidebar from "$lib/components/ScheduledTasksSidebar.svelte";
  import WorkspaceSidebar from "$lib/components/workspace/WorkspaceSidebar.svelte";
  import WorkbenchSidebar from "$lib/components/workbench/WorkbenchSidebar.svelte";
  import ProjectFolderItem from "$lib/components/ProjectFolderItem.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import OverlayStack from "$lib/components/layout/OverlayStack.svelte";
  import ToastHost from "$lib/components/ToastHost.svelte";
  import type { Component } from "svelte";

  import { getLastTarget } from "$lib/utils/remote-cwd";

  // ── Props ───────────────────────────────────────────────────────
  let { children } = $props();

  // ── Top-level chrome booleans ───────────────────────────────────
  let commandPaletteOpen = $state(false);
  let showSetupWizard = $state(false);
  let showAbout = $state(false);
  let showCliBrowser = $state(false);
  let permissionsModalOpen = $state(false);
  let updateCenterOpen = $state(false);
  let bundledAppVersion = $state<string | null>(null);

  // Version chip
  function formatAppVersion(version: string | null): string {
    const normalized = version?.trim().replace(/^v/, "");
    return normalized ? `v${normalized}` : "v...";
  }
  const sidebarVersion = $derived(
    formatAppVersion(
      appUpdateCoordinator.state.offer?.currentVersion ??
        appUpdateCoordinator.state.upToDateVersion ??
        bundledAppVersion,
    ),
  );
  const sidebarUpdateAvailable = $derived(appUpdateCoordinator.hasUpdate);
  const sidebarVersionChecked = $derived(appUpdateCoordinator.state.lastCheckedAt !== null);

  // Sidebar collapse + width (kept at the shell level so the resize
  // handler can mutate them directly without round-tripping through a
  // store; the layout persists the width via layout-bootstrap helpers).
  let sidebarOpen = $state(true);
  let sidebarWidth = $state(280);
  let sidebarResizing = $state(false);
  let sidebarGhostX = $state(0);
  let sidebarGhostEl: HTMLElement | null = $state(null);

  // Folder picker dialog
  let folderPickerOpen = $state(false);
  let folderPickerInitialHost = $state<string | null>(null);
  let folderPickerInitialPath = $state("");

  // Workspace settings modal
  let workspaceSettingsOpen = $state(false);
  let workspaceSettingsCwd = $state("");
  let workspaceSettingsAlias = $state("");

  // ── Deferred (lazy) modal slots — dynamic-imported on first use ────
  // Mirrors the +layout.svelte pre-refactor makeModalSlot pattern: keep the
  // eager bundle lean, only fetch the modal chunk when the user opens one.
  type DeferredModal = Component<any>;
  type ModalSlot = { Component: DeferredModal | null; ensure: () => Promise<void> };
  function makeModalSlot(loader: () => Promise<{ default: DeferredModal }>): ModalSlot {
    let Component = $state<DeferredModal | null>(null);
    let inflight: Promise<void> | null = null;
    const ensure = async (): Promise<void> => {
      if (Component) return;
      if (inflight) return inflight;
      inflight = (async () => {
        const mod = await loader();
        Component = mod.default;
      })();
      try {
        await inflight;
      } finally {
        inflight = null;
      }
    };
    return {
      get Component() {
        return Component;
      },
      ensure,
    };
  }
  const aboutModal = makeModalSlot(() => import("$lib/components/AboutModal.svelte"));
  const updateCenter = makeModalSlot(() => import("$lib/components/UpdateCenter.svelte"));
  const permissionsModal = makeModalSlot(() => import("$lib/components/PermissionsModal.svelte"));
  const workspaceSettingsModal = makeModalSlot(
    () => import("$lib/components/WorkspaceSettingsModal.svelte"),
  );
  const sidebarModals = makeModalSlot(() => import("$lib/components/sidebar/SidebarModals.svelte"));

  // Pre-fetch modal chunks the first time their flag flips on, so the
  // first open is instant. Pure side-effect on $state reads.
  $effect(() => {
    if (showAbout) void aboutModal.ensure();
    if (permissionsModalOpen) void permissionsModal.ensure();
    if (workspaceSettingsOpen) void workspaceSettingsModal.ensure();
    if (anySidebarModalOpen) void sidebarModals.ensure();
  });

  // Delete-confirm flows
  let deleteConfirmOpen = $state(false);
  let deleteTarget: import("$lib/utils/sidebar-groups").ConversationGroup | null = $state(null);
  let batchDeleteConfirmOpen = $state(false);
  let removeProjectConfirmOpen = $state(false);
  let removeProjectTarget = $state("");

  // Batch selection
  let selectedGroupKeys = $state(new Set<string>());
  let lastSelectedKey = $state("");
  let batchModeActive = $derived(selectedGroupKeys.size > 0);

  // Drag state for session pointer-drag
  let dragRunId = $state<string | null>(null);
  let dragOverFolderId = $state<string | null>(null);
  let dragOverUnfolderedKey = $state<string | null>(null);
  let sessionDragLabel = $state("");
  let sessionDragX = $state(0);
  let sessionDragY = $state(0);

  // Plugin section navigation
  let pluginActiveSection = $state<string>("overview");
  const pluginSections: PluginSection[] = [
    { id: "overview", label: () => t("sidebar_overview"), icon: "overview" },
    { id: "skills", label: () => t("sidebar_skills"), icon: "sparkles" },
    { id: "sources", label: () => t("sidebar_skillSources"), icon: "sources" },
    { id: "mcp", label: () => t("sidebar_mcpServers"), icon: "server" },
    { id: "hooks", label: () => t("sidebar_hooks"), icon: "webhook" },
    { id: "plugins", label: () => t("sidebar_plugins"), icon: "package" },
    { id: "agents", label: () => t("sidebar_agents"), icon: "agents" },
  ];
  setContext("pluginSection", {
    get active() {
      return pluginActiveSection;
    },
    set active(v: string) {
      pluginActiveSection = v;
    },
  });

  // ── Page-derived booleans (delegated to navigation-model) ───────
  let currentPath = $derived($page.url.pathname);
  let pageInfo = $derived(describeCurrentPage(currentPath));
  let {
    isChatPage,
    isPluginsPage,
    isExplorerPage,
    isTeamsPage,
    isScheduledTasksPage,
    isWorkspacePage,
    isWorkbenchPage,
    isSettingsPage,
    needsLayoutContentPanel,
    selectedScheduledTaskId,
  } = $derived(pageInfo);
  let pageName = $derived(resolvePageName(currentPath));
  let selectedRunId = $derived($page.url.searchParams.get("run") ?? "");

  const attentionQueueBadgeCount = $derived(
    attentionQueueStore.openItems.length + attentionQueueStore.acknowledgedItems.length,
  );

  // ── Stores exposed via context (set by +layout.svelte) ─────────
  const teamStore = getContext<TeamStore>("teamStore");
  const keybindingStore = getContext<KeybindingStore>("keybindings");
  const settingsCache = getContext<SettingsCacheContext | undefined>(SETTINGS_CACHE_CONTEXT_KEY);

  // ── Settings-driven UI flags (consumed from the layout cache) ──
  const settings = $derived(settingsCache?.settings ?? null);
  const iconRailEnabled = $derived(settings?.icon_rail_enabled !== false);
  const mascotEnabled = $derived(settings?.mascot_enabled !== false);
  const uiZoom = $derived(clampUiZoom(settings?.ui_zoom));
  const nativeWindowGlassEnabled = $derived(settings?.native_window_glass_enabled !== false);

  // ── Helper functions ────────────────────────────────────────────
  // formatAppVersion is defined above (version chip section)

  function navigateToChatRun(
    targetRunId: string,
    opts: { scrollTo?: string; replaceState?: boolean } | undefined = undefined,
  ) {
    getChatTimelineResetHandle()?.shrinkVisibleRender(24);
    requestAnimationFrame(() => {
      let href = `/chat?run=${encodeURIComponent(targetRunId)}`;
      if (opts?.scrollTo) href += `&scrollTo=${encodeURIComponent(opts.scrollTo)}`;
      goto(href, opts?.replaceState ? { replaceState: true } : undefined);
    });
  }

  function newChat() {
    getChatTimelineResetHandle()?.shrinkVisibleRender(24);
    requestAnimationFrame(() => {
      goto("/chat?new=1");
    });
  }

  function getNavItemHref(item: { path: string; icon: string }): string {
    if (item.icon === "message") return chatViewCache.lastChatHref || "/chat";
    return item.path;
  }

  function newChatInFolder(cwd: string) {
    const normalized = normalizeCwd(cwd);
    if (!normalized) return;
    pss.setProjectCwd(normalized);
    if (!pss.pinnedCwds.includes(normalized)) pss.pin(normalized);
    window.dispatchEvent(new CustomEvent(EVT_PROJECT_CHANGED, { detail: { cwd: normalized } }));
    chatViewCache.lastRunId = "";
    goto(`/chat?new=1&folder=${encodeURIComponent(normalized)}`);
  }

  function newChatInSubFolder(parentCwd: string, subFolderId: string) {
    const normalized = normalizeCwd(parentCwd);
    if (!normalized || !subFolderId) return;
    pss.setProjectCwd(normalized);
    if (!pss.pinnedCwds.includes(normalized)) pss.pin(normalized);
    window.dispatchEvent(new CustomEvent(EVT_PROJECT_CHANGED, { detail: { cwd: normalized } }));
    chatViewCache.lastRunId = "";
    goto(
      `/chat?new=1&folder=${encodeURIComponent(normalized)}&sf=${encodeURIComponent(subFolderId)}`,
    );
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }
  setContext("toggleSidebar", toggleSidebar);

  // layout chrome context (consumed by /chat /workbench etc.)
  let layoutChromeState = $state({ sidebarOpen: true });
  $effect(() => {
    layoutChromeState.sidebarOpen = sidebarOpen && needsLayoutContentPanel;
  });
  setContext<LayoutChromeContext>(LAYOUT_CHROME_CONTEXT_KEY, {
    get state() {
      return layoutChromeState;
    },
    toggleSidebar,
    newChat,
    openCliBrowser: () => {
      showCliBrowser = true;
    },
    openSettings: () => {
      beginRouteTransition();
      void goto("/settings").finally(endRouteTransition);
    },
  });

  function highlightMatch(text: string, query: string): string {
    if (!query.trim()) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const q = escapeHtml(query.trim());
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return escaped.replace(re, "<mark>$1</mark>");
  }

  // ── Sidebar enrich + selection ──────────────────────────────────
  const enrichedProjectFolders = $derived.by(() => {
    if (!needsLayoutContentPanel) return [];
    return buildEnrichedProjectFolders(
      rss.runs,
      sfs.sessionFolders,
      rss.favoriteRunIds,
      pss.pinnedCwds,
      pss.removedCwds,
      scheduledTasksStore.tasks,
      scheduledTasksStore.runs,
    );
  });
  const selectableFolders = $derived(enrichedProjectFolders.filter((f) => !f.isUncategorized));
  const foldersForMoveDialog = $derived(
    sessionFoldersForWorkspace(sfs.sessionFolders, pss.projectCwd),
  );
  const anySidebarModalOpen = $derived(
    deleteConfirmOpen ||
      batchDeleteConfirmOpen ||
      removeProjectConfirmOpen ||
      sfs.folderCreateOpen ||
      sfs.folderRenameOpen ||
      sfs.folderDeleteOpen ||
      sfs.moveToFolderOpen,
  );

  // ── Filtered search results ─────────────────────────────────────
  const removedCwdSet = $derived(new Set(pss.removedCwds.map(normalizeCwd)));
  const visibleSearchResults = $derived.by(() => {
    if (rss.searchResults.length === 0) return rss.searchResults;
    if (removedCwdSet.size === 0) return rss.searchResults;
    const runCwdMap = new Map<string, string>();
    for (const run of rss.runs) runCwdMap.set(run.id, normalizeCwd(run.cwd));
    return rss.searchResults.filter((result) => {
      const cwd = runCwdMap.get(result.runId);
      if (cwd === undefined) return true;
      if (!cwd) return true;
      return !removedCwdSet.has(cwd);
    });
  });

  const filteredTeams = $derived(tss.filteredTeams(teamStore));

  // ── Sidebar resize (ghost-line) ─────────────────────────────────
  function screenKey(): string {
    try {
      if (typeof window !== "undefined" && window.screen) {
        return `${window.screen.width}x${window.screen.height}`;
      }
    } catch {
      /* SSR or restricted */
    }
    return "default";
  }

  let resizeCleanup: (() => void) | null = null;
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let pendingWidth = startWidth;
    sidebarResizing = true;
    sidebarGhostX = e.clientX;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture?.(e.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    function onMove(ev: PointerEvent) {
      pendingWidth = Math.min(500, Math.max(180, startWidth + (ev.clientX - startX)));
      const x = startX + (pendingWidth - startWidth);
      if (sidebarGhostEl) sidebarGhostEl.style.left = `${x - 1}px`;
    }
    function cleanup() {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      sidebarWidth = pendingWidth;
      sidebarResizing = false;
      sidebarGhostEl = null;
      resizeCleanup = null;
      try {
        localStorage.setItem(`ocv:sidebar-width:${screenKey()}`, String(sidebarWidth));
      } catch {
        /* ignore */
      }
    }
    function onUp() {
      cleanup();
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    resizeCleanup = cleanup;
  }

  // ── Drag-and-drop (session pointer-drag) ────────────────────────
  function folderKeyForRun(run: { parent_cwd?: string | null; cwd: string }): string {
    const cwd = normalizeCwd(run.parent_cwd ?? run.cwd);
    return cwd === "" ? "uncategorized" : `cwd:${cwd}`;
  }

  function applySessionDropHighlight(
    target: { type: string; folderId?: string; workspaceKey?: string } | null,
  ) {
    dragOverFolderId = target?.type === "folder" ? (target.folderId ?? null) : null;
    dragOverUnfolderedKey = target?.type === "unfoldered" ? (target.workspaceKey ?? null) : null;
  }

  function handleSessionDragStart(runId: string, label: string, e: PointerEvent) {
    dragRunId = runId;
    sessionDragLabel = label;
    sessionDragX = e.clientX;
    sessionDragY = e.clientY;
    import("$lib/utils/session-drag-state").then((m) => m.setSessionDragActive(true));
  }

  function handleSessionDragMove(e: PointerEvent) {
    sessionDragX = e.clientX;
    sessionDragY = e.clientY;
    // Best-effort: full highlight logic lives in session-drag-state and
    // was tied to the original layout effect. The store version is
    // wired by +layout.svelte.
    void e;
  }

  async function handleSessionDragEnd(e: PointerEvent) {
    const runId = dragRunId;
    dragRunId = null;
    dragOverFolderId = null;
    dragOverUnfolderedKey = null;
    sessionDragLabel = "";
    if (!runId) return;
    const {
      setSessionDragOverSplit,
      setSessionDragActive,
      findSessionDropTarget,
      findSessionSplitDropTarget,
    } = await import("$lib/utils/session-drag-state");
    setSessionDragOverSplit(false);
    setSessionDragActive(false);
    const pathname = get(page).url.pathname;
    const overSplit = pathIsChat(pathname) && findSessionSplitDropTarget(e.clientX, e.clientY);
    const dropTarget = overSplit ? null : findSessionDropTarget(e.clientX, e.clientY);
    if (overSplit) {
      const { addSplitPane } = await import("$lib/split/split-workspace-lifecycle");
      await addSplitPane(runId);
      return;
    }
    if (!dropTarget) return;
    const run = rss.runs.find((r) => r.id === runId);
    if (!run) return;
    try {
      if (dropTarget.type === "folder") {
        const { moveRunToFolder } = await import("$lib/api");
        await moveRunToFolder(runId, dropTarget.folderId);
        rss.applyFolderMoveLocally([runId], dropTarget.folderId);
        sfs.ensureSubFolderExpanded(dropTarget.folderId);
      } else {
        if (folderKeyForRun(run) !== dropTarget.workspaceKey) return;
        const { moveRunToFolder } = await import("$lib/api");
        await moveRunToFolder(runId, null);
        rss.applyFolderMoveLocally([runId], null);
      }
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
    } catch (err) {
      dbg("layout", "session pointer-drop moveRunToFolder failed", { err });
    }
  }

  // ── Delete / batch / project-remove flows ───────────────────────
  function requestDeleteConversation(conv: import("$lib/utils/sidebar-groups").ConversationGroup) {
    deleteTarget = conv;
    deleteConfirmOpen = true;
  }

  async function confirmDeleteConversation() {
    const conv = deleteTarget;
    deleteConfirmOpen = false;
    deleteTarget = null;
    if (!conv) return;
    await rss.softDelete(conv.runs.map((r) => r.id));
    if (conv.runs.some((r) => r.id === selectedRunId)) goto("/chat");
  }

  async function confirmHardDeleteConversation() {
    const conv = deleteTarget;
    deleteConfirmOpen = false;
    deleteTarget = null;
    if (!conv) return;
    await rss.hardDelete(conv.runs.map((r) => r.id));
    if (conv.runs.some((r) => r.id === selectedRunId)) goto("/chat");
  }

  function cancelDeleteConversation() {
    deleteConfirmOpen = false;
    deleteTarget = null;
  }

  function enterBatchMode(groupKey: string) {
    selectedGroupKeys = new Set([groupKey]);
    lastSelectedKey = groupKey;
  }

  function toggleSelectConversation(groupKey: string, e: MouseEvent) {
    const allKeys: string[] = [];
    for (const folder of enrichedProjectFolders) {
      for (const conv of folder.conversations) allKeys.push(conv.groupKey);
      for (const sf of folder.subFolders ?? []) {
        for (const conv of sf.conversations) allKeys.push(conv.groupKey);
      }
    }
    if (selectedGroupKeys.size > 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const newSet = new Set(selectedGroupKeys);
      if (newSet.has(groupKey)) newSet.delete(groupKey);
      else newSet.add(groupKey);
      selectedGroupKeys = newSet;
      lastSelectedKey = groupKey;
      return;
    }
    if (e.shiftKey && lastSelectedKey) {
      const fromIdx = allKeys.indexOf(lastSelectedKey);
      const toIdx = allKeys.indexOf(groupKey);
      if (fromIdx >= 0 && toIdx >= 0) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const newSet = new Set(selectedGroupKeys);
        for (let i = start; i <= end; i++) newSet.add(allKeys[i]);
        selectedGroupKeys = newSet;
      }
    } else if (e.metaKey || e.ctrlKey) {
      const newSet = new Set(selectedGroupKeys);
      if (newSet.has(groupKey)) newSet.delete(groupKey);
      else newSet.add(groupKey);
      selectedGroupKeys = newSet;
    } else {
      selectedGroupKeys = new Set();
      lastSelectedKey = groupKey;
      return;
    }
    lastSelectedKey = groupKey;
  }

  function clearBatchSelection() {
    selectedGroupKeys = new Set();
    lastSelectedKey = "";
  }

  function collectSelectedRunIds(): string[] {
    const keys = new Set(selectedGroupKeys);
    const ids: string[] = [];
    for (const folder of enrichedProjectFolders) {
      for (const conv of folder.conversations) {
        if (keys.has(conv.groupKey)) ids.push(...conv.runs.map((r) => r.id));
      }
      for (const sf of folder.subFolders ?? []) {
        for (const conv of sf.conversations) {
          if (keys.has(conv.groupKey)) ids.push(...conv.runs.map((r) => r.id));
        }
      }
    }
    return ids;
  }

  async function batchDelete() {
    const ids = collectSelectedRunIds();
    batchDeleteConfirmOpen = false;
    clearBatchSelection();
    if (ids.length === 0) return;
    await rss.softDelete(ids);
    if (ids.includes(selectedRunId)) goto("/chat");
  }

  async function batchHardDelete() {
    const ids = collectSelectedRunIds();
    batchDeleteConfirmOpen = false;
    clearBatchSelection();
    if (ids.length === 0) return;
    await rss.hardDelete(ids);
    if (ids.includes(selectedRunId)) goto("/chat");
  }

  function requestRemoveProject(cwd: string) {
    removeProjectTarget = normalizeCwd(cwd);
    removeProjectConfirmOpen = true;
  }

  function confirmRemoveProject() {
    const normalized = removeProjectTarget;
    removeProjectConfirmOpen = false;
    removeProjectTarget = "";
    if (!normalized) return;
    pss.removeProject(normalized);
  }

  function cancelRemoveProject() {
    removeProjectConfirmOpen = false;
    removeProjectTarget = "";
  }

  function pickFolder() {
    folderPickerInitialHost = null;
    folderPickerInitialPath = pss.projectCwd;
    folderPickerOpen = true;
  }

  /** Persist a user-typed alias for a workspace by mutating UserSettings
   *  through the standard updateUserSettings path. The USER_SETTINGS_CHANGED_EVENT
   *  bridge in +layout.svelte will pick the change up and refresh downstream
   *  consumers. */
  async function saveWorkspaceAlias(cwd: string, alias: string): Promise<void> {
    const normalized = normalizeCwd(cwd);
    const current = settings?.workspace_aliases ?? {};
    const updated: Record<string, string> = { ...current };
    if (alias.trim()) {
      updated[normalized] = alias.trim();
    } else {
      delete updated[normalized];
    }
    try {
      const { updateUserSettings } = await import("$lib/api");
      await updateUserSettings({ workspace_aliases: updated });
      dbg("layout", "workspace alias saved", { cwd: normalized, alias });
    } catch (e) {
      dbgWarn("layout", "save workspace alias failed", e);
    }
  }

  /** Open the move-to-folder dialog for the selected conversation group(s). */
  function requestMoveToFolder(conv: import("$lib/utils/sidebar-groups").ConversationGroup): void {
    sfs.requestMove(conv.runs.map((r) => r.id));
  }

  /** Confirm the move-to-folder selection. */
  function doMoveToFolder(): void {
    void sfs.doMoveFromDialog();
  }

  function onFolderPicked(result: { hostName: string | null; path: string }) {
    const { hostName, path } = result;
    if (!path) return;
    if (hostName) {
      goto(`/chat?host=${encodeURIComponent(hostName)}&folder=${encodeURIComponent(path)}`);
      return;
    }
    const normalized = normalizeCwd(path) || "";
    if (normalized && pss.removedCwds.includes(normalized)) pss.unremoveProject(normalized);
    pss.setProjectCwd(normalized);
  }

  /** Setup wizard completion: just close; settings auto-rerun via the
   *  USER_SETTINGS_CHANGED_EVENT bridge in +layout.svelte. */
  function handleSetupComplete(): void {
    showSetupWizard = false;
  }

  /** CLI import ran a run; navigate to the chat. */
  async function loadRuns(): Promise<void> {
    await rss.loadRuns();
  }

  function toggleProject(folderKey: string) {
    pss.toggleProject(folderKey);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && selectedGroupKeys.size > 0) {
      clearBatchSelection();
      return;
    }
    keybindingStore.dispatch(e);
  }

  // ── Derived: titlebar / sidebar geometry ────────────────────────
  const windowChromeLeftInset = $derived.by(() => {
    const z = uiZoom;
    const actionsInset = layoutPx(IS_MAC ? 80 : 12, z);
    const control = layoutPx(IS_MAC ? 12 : 14, z);
    const gap = layoutPx(IS_MAC ? 8 : 6, z);
    if (isChatPage) return Math.round(actionsInset + layoutPx(8, z));
    let actions = 1;
    if (!isSettingsPage) actions += 1;
    if (needsLayoutContentPanel) actions += 2;
    return Math.round(
      actionsInset + actions * control + Math.max(0, actions - 1) * gap + layoutPx(8, z),
    );
  });
  const titlebarBandHeight = $derived(Math.round(layoutPx(32, uiZoom)));
  const sidebarEffectiveWidth = $derived(
    !iconRailEnabled
      ? sidebarOpen && needsLayoutContentPanel
        ? sidebarWidth
        : 0
      : sidebarOpen && needsLayoutContentPanel
        ? 44 + sidebarWidth
        : 44,
  );
  const sidebarLogicallyCollapsed = $derived(!sidebarOpen || !needsLayoutContentPanel);

  // ── Cross-tab auto-expand (run → folder / cwd → folder) ────────
  let _prevAutoExpandRunId = "";
  let _prevAutoExpandRunsLen = 0;
  $effect(() => {
    if (!isChatPage) return;
    const runId = selectedRunId;
    const runsLen = rss.runs.length;
    const runChanged = runId !== _prevAutoExpandRunId;
    const runsChanged = runsLen !== _prevAutoExpandRunsLen;
    if (!runChanged && !runsChanged) return;
    _prevAutoExpandRunId = runId;
    _prevAutoExpandRunsLen = runsLen;
    if (!runId) return;
    const next = autoExpandForRun(runId, enrichedProjectFolders, pss.expandedProjects);
    if (next) pss.replaceExpanded(next);
  });

  let _prevAutoExpandCwd = "";
  $effect(() => {
    const cwd = pss.projectCwd;
    if (cwd === _prevAutoExpandCwd) return;
    _prevAutoExpandCwd = cwd;
    if (!cwd) return;
    const folderKey = `cwd:${cwd}`;
    const next = expandForProjectChange(folderKey, pss.expandedProjects);
    if (next) pss.replaceExpanded(next);
  });

  // Persist expandedProjects, prune stale keys after runs have loaded
  $effect(() => {
    if (!needsLayoutContentPanel) return;
    if (!rss.runsLoadSucceededOnce) return;
    pss.persistAndPruneExpanded(new Set(enrichedProjectFolders.map((f) => f.folderKey)));
  });

  // Persist active session id (auto-restore on next launch)
  $effect(() => {
    const id = selectedRunId;
    untrack(() => writeActiveSessionId(id));
  });

  // Project workspaces list → workspaces store (for chat welcome picker)
  $effect(() => {
    if (!needsLayoutContentPanel) return;
    workspacesStore.list = enrichedProjectFolders.map((f) => ({
      cwd: f.cwd,
      label: f.isUncategorized ? t("sidebar_uncategorized") : cwdDisplayLabel(f.cwd),
      isUncategorized: f.isUncategorized,
    }));
  });

  // Update workspaces-store visible: defensive reset of projectCwd
  $effect(() => {
    if (!needsLayoutContentPanel) return;
    if (!pss.projectCwd) return;
    const key = normalizeCwd(pss.projectCwd);
    const validCwds = new Set([
      ...selectableFolders.map((f) => normalizeCwd(f.cwd)),
      ...pss.pinnedCwds.map(normalizeCwd),
    ]);
    if (!validCwds.has(key)) {
      pss.setProjectCwd("");
    }
  });

  // Explorer tree: reload when projectCwd or route changes
  let _prevExplorerCwd: string | undefined;
  $effect(() => {
    if (!isExplorerPage) return;
    const _cwd = pss.projectCwd;
    if (_cwd) {
      void ets.loadRootTree(_cwd);
      _prevExplorerCwd = _cwd;
    } else if (!rss.runsLoadSucceededOnce) {
      return;
    } else if (rss.runs.length > 0) {
      const fallback = ets.pickRecentRunsFallback(rss.runs);
      if (fallback) {
        pss.setProjectCwd(fallback);
        _prevExplorerCwd = fallback;
      } else {
        ets.fileTree = [];
        ets.treeLoading = false;
        _prevExplorerCwd = _cwd;
      }
    } else {
      ets.fileTree = [];
      ets.treeLoading = false;
      _prevExplorerCwd = _cwd;
    }
  });

  // Native window glass class toggle
  $effect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("native-glass-enabled", nativeWindowGlassEnabled);
  });

  // Plugin section sync from URL on /plugins
  afterNavigate(({ to }) => {
    if (to?.url.pathname.startsWith("/plugins")) {
      const section = to.url.searchParams.get("section");
      if (section && pluginSections.some((s) => s.id === section)) {
        pluginActiveSection = section;
      }
    }
    const hubMatch = to?.url.pathname.match(/^\/scheduled-tasks\/([^/]+)/);
    if (hubMatch) {
      const hubTaskId = hubMatch[1];
      const hubFolder = enrichedProjectFolders.find((folder) =>
        folder.scheduledTaskHubs.some((hub) => hub.taskId === hubTaskId),
      );
      if (hubFolder) pss.toggleProject(hubFolder.folderKey);
    }
  });

  // Route transition + chat/settings hop arming
  beforeNavigate(({ from, to }) => {
    if (!from || !to) return;
    if (pathIsChatOrSettingsTransition(from.url.pathname, to.url.pathname)) {
      beginRouteTransition();
      armChatSettingsHop();
    }
  });
  afterNavigate(() => {
    endRouteTransition();
  });

  // ── Bridge: listen for chrome CustomEvents dispatched by +layout ─
  // The layout owns side-effect state (keybindings, event bus) but
  // AppShell owns the chrome booleans. The layout forwards commands
  // via `miwarp:layout-*` CustomEvents; AppShell consumes them here.
  $effect(() => {
    if (typeof window === "undefined") return;
    const onToggleSidebar = () => (sidebarOpen = !sidebarOpen);
    const onToggleCommandPalette = () => (commandPaletteOpen = !commandPaletteOpen);
    const onNewChat = () => newChat();
    const onShowWizard = () => (showSetupWizard = true);
    const onOpenPermissions = () => (permissionsModalOpen = true);
    const onExplorerFileSelected = (e: Event) => {
      ets.explorerSelectedFile = (e as CustomEvent).detail?.path ?? "";
    };
    const onAppVersion = (e: Event) => {
      bundledAppVersion = (e as CustomEvent).detail ?? null;
    };
    window.addEventListener("miwarp:layout-toggle-sidebar", onToggleSidebar);
    window.addEventListener("miwarp:layout-toggle-command-palette", onToggleCommandPalette);
    window.addEventListener("miwarp:layout-new-chat", onNewChat);
    window.addEventListener("miwarp:layout-show-wizard", onShowWizard);
    window.addEventListener("miwarp:layout-open-permissions", onOpenPermissions);
    window.addEventListener("miwarp:layout-explorer-file-selected", onExplorerFileSelected);
    window.addEventListener("miwarp:layout-app-version", onAppVersion);
    return () => {
      window.removeEventListener("miwarp:layout-toggle-sidebar", onToggleSidebar);
      window.removeEventListener("miwarp:layout-toggle-command-palette", onToggleCommandPalette);
      window.removeEventListener("miwarp:layout-new-chat", onNewChat);
      window.removeEventListener("miwarp:layout-show-wizard", onShowWizard);
      window.removeEventListener("miwarp:layout-open-permissions", onOpenPermissions);
      window.removeEventListener("miwarp:layout-explorer-file-selected", onExplorerFileSelected);
      window.removeEventListener("miwarp:layout-app-version", onAppVersion);
    };
  });
</script>

{#snippet explorerEmptyAction()}
  {#if !getLastTarget()}
    <button
      type="button"
      class="mt-2 rounded-md border border-sidebar-border bg-sidebar px-3 py-1.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      onclick={() => pickFolder()}
    >
      {t("sidebar_openFolder")}
    </button>
  {/if}
{/snippet}

{#snippet treeNodes(nodes: import("$lib/layout/explorer-tree-store.svelte").TreeNode[])}
  {#each nodes as node}
    <button
      type="button"
      class="flex w-full items-center gap-1 py-0.5 text-[13px] transition-colors
        text-sidebar-foreground hover:bg-sidebar-accent/50
        {ets.explorerSelectedFile === node.fullPath ? 'bg-sidebar-accent/70' : ''}"
      style="padding-left: {8 + node.depth * 12}px"
      onclick={() => (node.is_dir ? ets.toggleFolder(node) : ets.selectFile(node))}
    >
      {#if node.is_dir}
        <Icon
          name="chevron-right"
          size="xs"
          class="shrink-0 transition-transform duration-150 {node.expanded ? 'rotate-90' : ''}"
        />
        <svg
          class="h-3.5 w-3.5 shrink-0 text-[hsl(var(--miwarp-status-info)/0.7)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path
            d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
          /></svg
        >
      {:else}
        <span class="w-3 shrink-0"></span>
        <svg
          class="h-3.5 w-3.5 shrink-0 opacity-40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path
            d="M14 2v4a2 2 0 0 0 2 2h4"
          /></svg
        >
      {/if}
      <span class="min-w-0 truncate">{node.name}</span>
    </button>
    {#if node.is_dir && node.expanded}
      {@render treeNodes(node.children)}
    {/if}
  {/each}
{/snippet}

<svelte:window onkeydown={handleKeydown} />

<div
  class="relative flex w-screen overflow-hidden"
  style="min-height: 100vh; height: 100dvh; --sidebar-effective-width: {sidebarEffectiveWidth}px;"
>
  <aside
    class="sidebar-container shrink-0 text-sidebar-foreground"
    class:glass-sidebar={!nativeWindowGlassEnabled}
    class:native-glass-sidebar={nativeWindowGlassEnabled}
    class:native-glass-sidebar-disabled={!nativeWindowGlassEnabled}
    class:sidebar-collapsed={sidebarLogicallyCollapsed}
    class:sidebar-no-icon-rail={!iconRailEnabled}
    class:sidebar-no-transition={sidebarResizing}
    style="width: {sidebarEffectiveWidth}px; --sidebar-inner-width: {sidebarWidth}px"
  >
    {#if iconRailEnabled}
      <div class="sidebar-icon-rail flex w-[44px] flex-col items-center">
        <div class="relative w-full shrink-0 h-[var(--miwarp-titlebar-band)]" aria-hidden="true">
          <WindowDragArea class="absolute inset-0" />
        </div>

        <nav class="flex flex-1 flex-col items-center gap-1 py-2 pt-2">
          {#each NAV_ITEMS as item, idx}
            {#if idx > 0 && item.group !== NAV_ITEMS[idx - 1].group}
              <div class="my-1 h-px w-5 bg-border/40"></div>
            {/if}
            {@const isActive = currentPath.startsWith(item.path)}
            <a
              href={getNavItemHref(item)}
              class="relative flex h-9 w-9 items-center justify-center rounded-md transition-all duration-150 no-underline active:scale-95
                {isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'hover:bg-sidebar-accent/50 text-sidebar-foreground'}"
              title={item.label()}
            >
              {#if isActive}
                <span class="absolute left-0 top-1.5 h-5 w-[3px] rounded-r-full bg-primary"></span>
              {/if}
              {#if item.icon === "message"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg
                >
              {:else if item.icon === "folder"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path
                    d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
                  /></svg
                >
              {:else if item.icon === "layout"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path
                    d="M9 21V9"
                  /></svg
                >
              {:else if item.icon === "monitor"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path
                    d="M12 17v4"
                  /></svg
                >
              {:else if item.icon === "clock"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg
                >
              {:else if item.icon === "circle-user"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><circle cx="12" cy="12" r="10" /><circle cx="12" cy="10" r="3" /><path
                    d="M7 20.66A8 8 0 0 1 12 18a8 8 0 0 1 5 2.66"
                  /></svg
                >
              {:else if item.icon === "users"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle
                    cx="9"
                    cy="7"
                    r="4"
                  /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path
                    d="M16 3.13a4 4 0 0 1 0 7.75"
                  /></svg
                >
              {:else if item.icon === "zap"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path
                    d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
                  /></svg
                >
              {:else if item.icon === "chart"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d="M3 3v18h18" /><path d="M7 16l4-4 4 4 5-7" /></svg
                >
              {:else if item.icon === "settings"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  /><circle cx="12" cy="12" r="3" /></svg
                >
              {:else if item.icon === "schedule"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg
                >
              {/if}
            </a>
          {/each}
        </nav>

        <div class="flex flex-col items-center gap-1 pb-2">
          {#if attentionQueueBadgeCount > 0}
            <span class="h-2 w-2 rounded-full bg-primary" title={String(attentionQueueBadgeCount)}
            ></span>
          {/if}
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            title={`miwarp ${sidebarVersion}`}
            onclick={() => (showAbout = true)}
            aria-label={`miwarp ${sidebarVersion}`}
          >
            <span class="text-[10px] font-semibold tracking-tight">{sidebarVersion}</span>
          </button>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            title={t("nav_settings")}
            onclick={() => {
              beginRouteTransition();
              void goto("/settings").finally(endRouteTransition);
            }}
            aria-label={t("nav_settings")}
          >
            <svg
              class="h-[18px] w-[18px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              /><circle cx="12" cy="12" r="3" /></svg
            >
          </button>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            title={themeStore.isDark
              ? t("layout_themeTitle_dark")
              : themeStore.mode === "system"
                ? t("layout_themeTitle_system", { default: t("layout_themeTitle_light") })
                : t("layout_themeTitle_light")}
            onclick={() => themeStore.cycleTheme()}
            aria-label={t("settings_toggleTheme")}
          >
            {#if themeStore.mode === "system"}
              <!-- System mode: half-moon / half-sun -->
              <svg
                class="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><circle cx="12" cy="12" r="4" /><path
                  d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
                /></svg
              >
            {:else if themeStore.isDark}
              <!-- Dark: moon -->
              <svg
                class="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg
              >
            {:else}
              <!-- Light: sun -->
              <svg
                class="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><circle cx="12" cy="12" r="4" /><path
                  d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
                /></svg
              >
            {/if}
          </button>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            title={themeStore.colorScheme === "warm"
              ? t("layout_schemeTitle_warm")
              : t("layout_schemeTitle_neutral")}
            onclick={() =>
              themeStore.setColorScheme(themeStore.colorScheme === "warm" ? "neutral" : "warm")}
            aria-label={t("settings_toggleColorScheme")}
          >
            <svg
              class="h-[18px] w-[18px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle
                cx="17.5"
                cy="10.5"
                r=".5"
                fill="currentColor"
              /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle
                cx="6.5"
                cy="12"
                r=".5"
                fill="currentColor"
              /><path
                d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"
              /></svg
            >
          </button>
        </div>
      </div>
    {/if}

    {#if needsLayoutContentPanel}
      <div class="sidebar-content-panel">
        <div
          class="sidebar-inner flex flex-col h-full relative"
          class:sidebar-inner-collapsed={!sidebarOpen}
        >
          <div class="relative shrink-0 h-[var(--miwarp-titlebar-band)]" aria-hidden="true">
            <WindowDragArea class="absolute inset-0" />
          </div>
          {#if isChatPage}
            <div class="no-drag relative z-10 shrink-0 px-3 pb-2.5 pt-1">
              <input
                type="text"
                bind:value={rss.runSearchQuery}
                oninput={() => rss.onDeepQueryInput()}
                placeholder={t("sidebar_searchChats")}
                class="w-full min-w-0 rounded-full border border-sidebar-border bg-sidebar px-3.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50"
              />
            </div>
          {/if}

          {#if isPluginsPage}
            <div class="flex-1 overflow-y-auto py-2">
              {#each pluginSections as section}
                {@const isActive = pluginActiveSection === section.id}
                <button
                  type="button"
                  class="flex w-full items-center gap-2 py-2 px-3 text-xs font-medium transition-colors
                  {isActive
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
                  onclick={() => {
                    pluginActiveSection = section.id;
                    goto(`/plugins?section=${section.id}`, { replaceState: true, noScroll: true });
                  }}
                >
                  {#if section.icon === "overview"}
                    <svg
                      class="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect width="7" height="7" x="3" y="3" rx="1" /><rect
                        width="7"
                        height="7"
                        x="14"
                        y="3"
                        rx="1"
                      /><rect width="7" height="7" x="14" y="14" rx="1" /><rect
                        width="7"
                        height="7"
                        x="3"
                        y="14"
                        rx="1"
                      /></svg
                    >
                  {:else if section.icon === "sparkles"}
                    <svg
                      class="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path
                        d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"
                      /></svg
                    >
                  {:else if section.icon === "sources"}
                    <svg
                      class="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path
                        d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
                      /><path d="M8 7h8" /><path d="M8 11h8" /></svg
                    >
                  {:else if section.icon === "server"}
                    <svg
                      class="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect
                        width="20"
                        height="8"
                        x="2"
                        y="14"
                        rx="2"
                        ry="2"
                      /><line x1="6" x2="6.01" y1="6" y2="6" /><line
                        x1="6"
                        x2="6.01"
                        y1="18"
                        y2="18"
                      /></svg
                    >
                  {:else if section.icon === "webhook"}
                    <svg
                      class="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path
                        d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"
                      /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /><path
                        d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8H12"
                      /></svg
                    >
                  {:else if section.icon === "package"}
                    <svg
                      class="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path d="m7.5 4.27 9 5.15" /><path
                        d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                      /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg
                    >
                  {:else if section.icon === "agents"}
                    <svg
                      class="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path
                        d="M2 14h2"
                      /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg
                    >
                  {/if}
                  <span class="min-w-0 truncate">{section.label()}</span>
                </button>
              {/each}
            </div>
          {:else if isExplorerPage}
            <div class="flex-1 overflow-y-auto px-1 py-1">
              {#if !pss.projectCwd}
                {@const lastRemote = getLastTarget()}
                <EmptyState
                  iconName="folder-open"
                  title={lastRemote
                    ? t("layout_remoteFileTreeUnavailable")
                    : t("sidebar_selectProjectBrowse")}
                  action={explorerEmptyAction}
                  class="py-8"
                />
              {:else if ets.treeLoading}
                <div class="flex items-center justify-center py-12">
                  <Spinner size="sm" />
                </div>
              {:else if ets.fileTree.length === 0}
                <EmptyState
                  iconName="folder-open"
                  title={t("sidebar_emptyDirectory")}
                  class="py-8"
                />
              {:else}
                {@render treeNodes(ets.fileTree)}
              {/if}
            </div>
          {:else if isTeamsPage}
            <div class="px-2 pt-2 pb-1 shrink-0 flex items-center justify-between gap-2">
              <input
                type="text"
                bind:value={tss.teamStoreSearchQuery}
                placeholder={t("sidebar_searchTeams")}
                class="w-full min-w-0 rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50"
              />
              <a
                href="/teams"
                class="shrink-0 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
                title={t("teamsPage_quickLaunch")}
              >
                +
              </a>
            </div>
            <div class="flex-1 overflow-y-auto px-2 py-1">
              {#if teamStore.loading}
                <div class="flex items-center justify-center py-6">
                  <Spinner size="sm" />
                </div>
              {:else if filteredTeams.length === 0}
                <div class="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
                  <p class="text-xs text-muted-foreground">{t("sidebar_noActiveTeams")}</p>
                  <a
                    href="/teams"
                    class="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    {t("teamsPage_quickLaunch")} →
                  </a>
                </div>
              {:else}
                {#each filteredTeams as team}
                  <button
                    type="button"
                    class="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors mb-0.5
                      {teamStore.selectedTeam === team.name
                      ? 'bg-sidebar-accent text-sidebar-foreground'
                      : 'hover:bg-sidebar-accent/50 text-sidebar-foreground'}"
                    onclick={() => teamStore.selectTeam(team.name)}
                  >
                    <div class="flex items-center gap-1.5">
                      <span class="h-2 w-2 rounded-full bg-miwarp-status-info shrink-0"></span>
                      <span class="text-[13px] font-medium min-w-0 truncate">{team.name}</span>
                    </div>
                    {#if team.description}
                      <p class="text-xs text-muted-foreground truncate pl-3.5">
                        {team.description}
                      </p>
                    {/if}
                    <div class="flex items-center gap-2 pl-3.5 text-xs text-muted-foreground">
                      <span>{t("sidebar_members", { count: String(team.member_count) })}</span>
                      <span>{t("sidebar_tasks", { count: String(team.task_count) })}</span>
                    </div>
                  </button>
                {/each}
              {/if}
            </div>
          {:else if isSettingsPage}
            <SettingsSidebar />
          {:else if isScheduledTasksPage}
            <ScheduledTasksSidebar />
          {:else if isWorkspacePage}
            <WorkspaceSidebar settings={null} />
          {:else if isWorkbenchPage}
            <WorkbenchSidebar />
          {:else if isChatPage}
            {#if rss.runSearchQuery.trim()}
              <div class="sidebar-scroll flex-1 overflow-y-auto">
                {#if rss.searching && visibleSearchResults.length === 0}
                  <div class="flex items-center justify-center py-10">
                    <Spinner size="sm" />
                  </div>
                {:else if !rss.searching && visibleSearchResults.length === 0}
                  <div class="flex items-center justify-center px-3 py-10 text-center">
                    <p class="text-xs text-muted-foreground">{t("runs_noMatching")}</p>
                  </div>
                {:else}
                  {#each visibleSearchResults as result}
                    <button
                      type="button"
                      class="w-full text-left flex flex-col gap-0.5 px-3 py-2 hover:bg-sidebar-accent/50 transition-colors text-sidebar-foreground"
                      onclick={() => {
                        rss.runSearchQuery = "";
                        rss.searchResults = [];
                        navigateToChatRun(result.runId, {
                          scrollTo: result.matchedEventId || result.matchedTs,
                        });
                      }}
                    >
                      <p class="text-[12px] min-w-0 line-clamp-2 break-all">
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html highlightMatch(
                          snippetAround(result.matchedText, rss.runSearchQuery, 80),
                          rss.runSearchQuery,
                        )}
                      </p>
                      <div class="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                        <span class="flex-1 min-w-0 truncate"
                          >{result.runName || truncate(result.runPrompt, 30)}</span
                        >
                        <span class="ml-auto shrink-0">{relativeTime(result.matchedTs)}</span>
                      </div>
                    </button>
                  {/each}
                {/if}
              </div>
            {:else}
              <div class="sidebar-scroll flex-1 overflow-y-auto px-2 py-1">
                {#each enrichedProjectFolders as folder (folder.folderKey)}
                  <ProjectFolderItem
                    {folder}
                    label={folder.isUncategorized
                      ? t("sidebar_uncategorized")
                      : cwdDisplayLabel(folder.cwd)}
                    expanded={pss.expandedProjects.has(folder.folderKey)}
                    {selectedRunId}
                    onToggle={() => toggleProject(folder.folderKey)}
                    onSelectConversation={navigateToChatRun}
                    onDelete={requestDeleteConversation}
                    onMoveToFolder={(runIds, folderId) => sfs.requestMove(runIds, folderId)}
                    {selectedGroupKeys}
                    {batchModeActive}
                    onBatchClick={toggleSelectConversation}
                    onLongPressSelect={enterBatchMode}
                    onSessionDragStart={handleSessionDragStart}
                    onSessionDragMove={handleSessionDragMove}
                    onSessionDragEnd={handleSessionDragEnd}
                    onRemove={folder.isUncategorized
                      ? undefined
                      : () => requestRemoveProject(folder.cwd)}
                    onNewChat={folder.isUncategorized
                      ? undefined
                      : () => newChatInFolder(folder.cwd)}
                    onNewChatInSubFolder={folder.isUncategorized
                      ? undefined
                      : (sf) => newChatInSubFolder(folder.cwd, sf.folderId)}
                    subFolders={folder.subFolders ?? []}
                    scheduledTaskHubs={folder.scheduledTaskHubs ?? []}
                    {selectedScheduledTaskId}
                    onSelectScheduledHub={(taskId) => goto(`/scheduled-tasks/${taskId}`)}
                    expandedSubFolders={sfs.expandedSubFolders}
                    onToggleSubFolder={(k) => sfs.toggleSubFolder(k)}
                    onCreateSubFolder={folder.isUncategorized
                      ? undefined
                      : () => sfs.openCreateDialog(folder.cwd)}
                    onRenameSubFolder={(sf) => {
                      const f = sfs.sessionFolders.find((x) => x.id === sf.folderId);
                      if (f) sfs.openRenameDialog(f);
                    }}
                    onDeleteSubFolder={(sf) => {
                      const f = sfs.sessionFolders.find((x) => x.id === sf.folderId);
                      if (f) sfs.openDeleteDialog(f);
                    }}
                    dragOverSubFolderKey={dragOverFolderId ? `sf:${dragOverFolderId}` : null}
                    dragOverUnfoldered={dragOverUnfolderedKey === folder.folderKey}
                    {dragRunId}
                    onOpenDirectory={folder.isUncategorized
                      ? undefined
                      : () => {
                          openDirectoryInFinder(folder.cwd).catch(() => {});
                        }}
                    showMascot={mascotEnabled && !folder.isUncategorized}
                    mascotStatus={getWorkspaceMascotStatus(folder)}
                  />
                {/each}

                {#if enrichedProjectFolders.length === 0}
                  <div class="flex flex-col items-center gap-2 px-3 py-6 text-center">
                    <Icon name="check" size="md" class="text-muted-foreground/30" />
                    <p class="text-xs text-muted-foreground">{t("sidebar_workingTreeClean")}</p>
                  </div>
                {/if}
              </div>
              {#if selectedGroupKeys.size > 0}
                <div class="flex flex-col gap-0.5 border-t px-2 py-1.5 bg-sidebar-accent/30">
                  <div class="flex items-center gap-1">
                    <span class="text-[11px] text-muted-foreground px-1">
                      {t("sidebar_batchSelected", { count: String(selectedGroupKeys.size) })}
                    </span>
                    <button
                      type="button"
                      class="ml-auto rounded px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
                      onclick={() => (batchDeleteConfirmOpen = true)}
                      title={t("sidebar_batchDelete")}
                    >
                      {t("sidebar_batchDelete")}
                    </button>
                    <button
                      type="button"
                      class="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent transition-colors"
                      onclick={clearBatchSelection}
                      title={t("sidebar_batchClear")}
                    >
                      {t("sidebar_batchClear")}
                    </button>
                  </div>
                  <p class="px-1 text-[10px] text-muted-foreground/60">
                    {t("sidebar_batchModeHint")}
                  </p>
                </div>
              {/if}
            {/if}
          {/if}
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[hsl(var(--miwarp-accent-primary)/0.3)] active:bg-[hsl(var(--miwarp-accent-primary)/0.5)] transition-colors z-10"
          onpointerdown={startResize}
        ></div>
      </div>
    {/if}
  </aside>

  <div class="sidebar-main-corner-bridge" aria-hidden="true"></div>

  {#if sidebarResizing}
    <div
      bind:this={sidebarGhostEl}
      class="fixed top-0 bottom-0 z-[9999] pointer-events-none bg-primary"
      style="left: {sidebarGhostX -
        1}px; width: 3px; box-shadow: 0 0 8px hsl(var(--primary) / 0.6);"
    ></div>
  {/if}

  {#if dragRunId}
    <div
      class="fixed z-[9999] pointer-events-none max-w-[220px] truncate rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-lg"
      style="left: {sessionDragX + 12}px; top: {sessionDragY + 12}px;"
    >
      {sessionDragLabel}
    </div>
  {/if}

  <div class="app-main-shell flex flex-col overflow-hidden relative">
    <div
      class="absolute top-0 left-0 right-0 h-11 pointer-events-none"
      data-tauri-drag-region
      aria-hidden="true"
      style="-webkit-app-region: drag; z-index: 0;"
    ></div>
    <VersionMismatchBanner />
    <div class="pointer-events-none absolute right-3 top-2 z-20">
      <UpdateBanner onOpenCenter={() => (updateCenterOpen = true)} />
    </div>
    <main class="miwarp-main-surface flex-1 min-h-0 overflow-hidden flex flex-col">
      <div class="flex-1 min-h-0 flex flex-col">
        {@render children()}
      </div>
    </main>
  </div>
</div>

<TopWindowDrag height={titlebarBandHeight} leftInset={windowChromeLeftInset} />

<OverlayStack
  bind:commandPaletteOpen
  commandPaletteCwd={pss.projectCwd || "/"}
  onOpenFolderBrowser={pickFolder}
  {showSetupWizard}
  onSetupComplete={handleSetupComplete}
  bind:folderPickerOpen
  {folderPickerInitialHost}
  {folderPickerInitialPath}
  {onFolderPicked}
  {showCliBrowser}
  onCliBrowserClose={() => (showCliBrowser = false)}
  onCliBrowserImported={(runId: string) => {
    showCliBrowser = false;
    void rss.loadRuns();
    navigateToChatRun(runId);
  }}
/>

{#if showAbout}
  {#if aboutModal.Component}
    {@const C = aboutModal.Component}
    <C bind:open={showAbout} onOpenUpdateCenter={() => (updateCenterOpen = true)} />
  {/if}
{/if}

{#if updateCenterOpen}
  {#if updateCenter.Component}
    {@const C = updateCenter.Component}
    <C bind:open={updateCenterOpen} />
  {/if}
{/if}

{#if permissionsModalOpen}
  {#if permissionsModal.Component}
    {@const C = permissionsModal.Component}
    <C bind:open={permissionsModalOpen} cwd={pss.projectCwd} />
  {/if}
{/if}

{#if workspaceSettingsOpen}
  {#if workspaceSettingsModal.Component}
    {@const C = workspaceSettingsModal.Component}
    <C
      bind:open={workspaceSettingsOpen}
      cwd={workspaceSettingsCwd}
      currentAlias={workspaceSettingsAlias}
      onClose={() => {
        workspaceSettingsOpen = false;
        workspaceSettingsCwd = "";
        workspaceSettingsAlias = "";
      }}
      onSave={(alias: string) => saveWorkspaceAlias(workspaceSettingsCwd, alias)}
      onRemove={workspaceSettingsCwd
        ? () => {
            requestRemoveProject(workspaceSettingsCwd);
            workspaceSettingsOpen = false;
          }
        : undefined}
    />
  {/if}
{/if}

{#if anySidebarModalOpen}
  {#if sidebarModals.Component}
    {@const C = sidebarModals.Component}
    <C
      bind:deleteConfirmOpen
      onDeleteSoft={confirmDeleteConversation}
      onDeleteHard={confirmHardDeleteConversation}
      onDeleteCancel={cancelDeleteConversation}
      bind:batchDeleteConfirmOpen
      batchDeleteCount={selectedGroupKeys.size}
      onBatchSoftDelete={batchDelete}
      onBatchHardDelete={batchHardDelete}
      onBatchDeleteCancel={() => (batchDeleteConfirmOpen = false)}
      bind:removeProjectConfirmOpen
      onRemoveProject={confirmRemoveProject}
      onRemoveProjectCancel={cancelRemoveProject}
      bind:folderCreateOpen={sfs.folderCreateOpen}
      bind:folderCreateName={sfs.folderCreateName}
      onCreateFolder={() => sfs.doCreate()}
      bind:folderRenameOpen={sfs.folderRenameOpen}
      bind:folderRenameName={sfs.folderRenameName}
      onRenameFolder={() => sfs.doRename()}
      bind:folderDeleteOpen={sfs.folderDeleteOpen}
      folderDeleteTargetName={sfs.folderDeleteTarget?.name ?? ""}
      onDeleteFolderKeep={() => sfs.doDelete(false)}
      onDeleteFolderCascade={() => sfs.doDelete(true)}
      bind:moveToFolderOpen={sfs.moveToFolderOpen}
      moveToFolderCount={sfs.moveToFolderRunIds.length}
      bind:moveToFolderSelectedId={sfs.moveToFolderSelectedId}
      moveToFolderOptions={foldersForMoveDialog}
      onMoveToFolder={doMoveToFolder}
    />
  {/if}
{/if}

<ToastHost />
