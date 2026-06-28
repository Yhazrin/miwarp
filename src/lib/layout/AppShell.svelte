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
    BOOTSTRAP_DEMAND_CONTEXT_KEY,
    routeNeedsLayoutContentPanel,
    type LayoutChromeContext,
    type SettingsCacheContext,
    type BootstrapDemandController,
  } from "$lib/layout-chrome-context";
  import {
    describeCurrentPage,
    pathIsChat,
    pathIsChatOrSettingsTransition,
    resolvePageName,
  } from "$lib/layout/navigation-model";
  import AppIconRail from "$lib/layout/AppIconRail.svelte";
  import SidebarContentPanel from "$lib/layout/SidebarContentPanel.svelte";
  import ShellMainSurface from "$lib/layout/ShellMainSurface.svelte";

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

  import { writeActiveSessionId } from "$lib/utils/chat-persistence";
  import { beginRouteTransition, endRouteTransition } from "$lib/utils/route-transition";
  import { armChatSettingsHop } from "$lib/utils/chat-settings-nav";
  import { EVT_RUNS_CHANGED, EVT_PROJECT_CHANGED } from "$lib/utils/bus-events";
  import { clampUiZoom, layoutPx } from "$lib/utils/ui-zoom";
  import { IS_MAC } from "$lib/utils/platform";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import {
    buildEnrichedProjectFolders,
    sessionFoldersForWorkspace,
    autoExpandForRun,
    subFolderKeyForRun,
    expandForProjectChange,
    normalizeCwd,
  } from "$lib/utils/sidebar-groups";
  import { sortProjectFolders } from "$lib/utils/workspace-folder-sort";
  import { cwdDisplayLabel } from "$lib/utils/format";
  import { escapeHtml } from "$lib/utils/ansi";
  import type { PluginSection } from "$lib/utils/plugin-sections";

  // ── Components ──────────────────────────────────────────────────
  import OverlayStack from "$lib/components/layout/OverlayStack.svelte";
  import ToastHost from "$lib/components/ToastHost.svelte";
  import type { Component } from "svelte";

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
  const bootstrapDemand = getContext<BootstrapDemandController>(BOOTSTRAP_DEMAND_CONTEXT_KEY);

  $effect(() => {
    bootstrapDemand.ensureForRoute(currentPath);
  });

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
    const folders = buildEnrichedProjectFolders(
      rss.runs,
      sfs.sessionFolders,
      rss.favoriteRunIds,
      pss.pinnedCwds,
      pss.removedCwds,
      scheduledTasksStore.tasks,
      scheduledTasksStore.runs,
    );
    return sortProjectFolders(folders, settings?.workspace_folder_sort_order, {
      aliases: settings?.workspace_aliases ?? {},
    });
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
    const sfKey = subFolderKeyForRun(runId, enrichedProjectFolders);
    if (sfKey) {
      const folderId = sfKey.startsWith("sf:") ? sfKey.slice(3) : sfKey;
      sfs.ensureSubFolderExpanded(folderId);
    }
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
        ets.treeError = null;
        _prevExplorerCwd = _cwd;
      }
    } else {
      ets.fileTree = [];
      ets.treeLoading = false;
      ets.treeError = null;
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
    const fromPath = from.url.pathname;
    const toPath = to.url.pathname;
    if (pathIsChatOrSettingsTransition(fromPath, toPath)) {
      beginRouteTransition();
      armChatSettingsHop();
      return;
    }
    // Collapsing/expanding the sidebar content panel (e.g. /chat → /personal)
    // animates width; skip motion so route entry does not stutter.
    if (routeNeedsLayoutContentPanel(fromPath) !== routeNeedsLayoutContentPanel(toPath)) {
      beginRouteTransition();
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
      <AppIconRail
        {currentPath}
        {getNavItemHref}
        {attentionQueueBadgeCount}
        {sidebarVersion}
        {sidebarVersionChecked}
        {sidebarUpdateAvailable}
        onShowAbout={() => (showAbout = true)}
      />
    {/if}

    {#if needsLayoutContentPanel}
      <SidebarContentPanel
        {sidebarOpen}
        {isChatPage}
        {isPluginsPage}
        {isExplorerPage}
        {isTeamsPage}
        {isScheduledTasksPage}
        {isWorkbenchPage}
        {isSettingsPage}
        {pluginActiveSection}
        {pluginSections}
        {enrichedProjectFolders}
        {visibleSearchResults}
        {filteredTeams}
        {selectedRunId}
        {selectedScheduledTaskId}
        {mascotEnabled}
        {selectedGroupKeys}
        {batchModeActive}
        {dragRunId}
        {dragOverFolderId}
        {dragOverUnfolderedKey}
        {highlightMatch}
        onStartResize={startResize}
        onPluginSectionChange={(sectionId) => {
          pluginActiveSection = sectionId;
          goto(`/plugins?section=${sectionId}`, { replaceState: true, noScroll: true });
        }}
        onPickFolder={pickFolder}
        onNavigateToChatRun={navigateToChatRun}
        onToggleProject={toggleProject}
        onRequestDeleteConversation={requestDeleteConversation}
        onToggleSelectConversation={toggleSelectConversation}
        onEnterBatchMode={enterBatchMode}
        onSessionDragStart={handleSessionDragStart}
        onSessionDragMove={handleSessionDragMove}
        onSessionDragEnd={handleSessionDragEnd}
        onRequestRemoveProject={requestRemoveProject}
        onNewChatInFolder={newChatInFolder}
        onNewChatInSubFolder={newChatInSubFolder}
        onBatchDeleteConfirm={() => (batchDeleteConfirmOpen = true)}
        onClearBatchSelection={clearBatchSelection}
      />
    {/if}
  </aside>

  <ShellMainSurface
    {sidebarResizing}
    {sidebarGhostX}
    bind:sidebarGhostEl
    {dragRunId}
    {sessionDragLabel}
    {sessionDragX}
    {sessionDragY}
    {titlebarBandHeight}
    {windowChromeLeftInset}
    onOpenUpdateCenter={() => (updateCenterOpen = true)}
  >
    {@render children()}
  </ShellMainSurface>
</div>

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
    bootstrapDemand.ensureRunsBootstrap();
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
