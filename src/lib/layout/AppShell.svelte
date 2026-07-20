<!--
  AppShell — the root layout's outer shell. Renders the sidebar (icon
  rail + content panel) and the main pane, plus the overlay / modals /
  toast chrome that live at the root level.
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
  import { EVT_PROJECT_CHANGED } from "$lib/utils/bus-events";
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
  import OverlayStack from "$lib/components/layout/OverlayStack.svelte";
  import AppUpdateNotice from "$lib/components/AppUpdateNotice.svelte";
  import type { Component } from "svelte";

  // ── Drag & batch state ──
  let dragRunId = $state<string | null>(null);
  let dragOverFolderId = $state<string | null>(null);
  let dragOverUnfolderedKey = $state<string | null>(null);
  let sessionDragLabel = $state("");
  let sessionDragX = $state(0);
  let sessionDragY = $state(0);
  let selectedGroupKeys = $state(new Set<string>());
  let lastSelectedKey = $state("");
  let batchModeActive = $derived(selectedGroupKeys.size > 0);
  let deleteConfirmOpen = $state(false);
  let deleteTarget = $state<import("$lib/utils/sidebar-groups").ConversationGroup | null>(null);
  let batchDeleteConfirmOpen = $state(false);
  let removeProjectConfirmOpen = $state(false);
  let removeProjectTarget = $state("");

  import {
    executeFolderDrop,
    collectSelectedRunIds,
    batchSoftDelete,
    batchHardDeleteAction,
  } from "$lib/layout/app-shell-handlers.svelte";

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
  }
  async function handleSessionDragEnd(e: PointerEvent) {
    const rid = dragRunId;
    dragRunId = null;
    dragOverFolderId = null;
    dragOverUnfolderedKey = null;
    sessionDragLabel = "";
    if (!rid) return;
    const {
      setSessionDragOverSplit,
      setSessionDragActive,
      findSessionDropTarget,
      findSessionSplitDropTarget,
    } = await import("$lib/utils/session-drag-state");
    setSessionDragOverSplit(false);
    setSessionDragActive(false);
    const overSplit =
      pathIsChat(get(page).url.pathname) && findSessionSplitDropTarget(e.clientX, e.clientY);
    const dropTarget = overSplit ? null : findSessionDropTarget(e.clientX, e.clientY);
    if (overSplit) {
      await (await import("$lib/split/split-workspace-lifecycle")).addSplitPane(rid);
      return;
    }
    if (!dropTarget) return;
    await executeFolderDrop(rid, dropTarget, rss, sfs);
  }
  function requestDeleteConversation(conv: import("$lib/utils/sidebar-groups").ConversationGroup) {
    deleteTarget = conv;
    deleteConfirmOpen = true;
  }
  async function confirmDeleteConversation() {
    const c = deleteTarget;
    deleteConfirmOpen = false;
    deleteTarget = null;
    if (c) {
      await rss.softDelete(c.runs.map((r) => r.id));
      if (c.runs.some((r) => r.id === selectedRunId)) goto("/chat");
    }
  }
  async function confirmHardDeleteConversation() {
    const c = deleteTarget;
    deleteConfirmOpen = false;
    deleteTarget = null;
    if (c) {
      await rss.hardDelete(c.runs.map((r) => r.id));
      if (c.runs.some((r) => r.id === selectedRunId)) goto("/chat");
    }
  }
  function cancelDeleteConversation() {
    deleteConfirmOpen = false;
    deleteTarget = null;
  }
  function enterBatchMode(gk: string) {
    selectedGroupKeys = new Set([gk]);
    lastSelectedKey = gk;
  }
  function toggleSelectConversation(gk: string, e: MouseEvent) {
    const allKeys: string[] = [];
    for (const f of enrichedProjectFolders) {
      for (const c of f.conversations) allKeys.push(c.groupKey);
      for (const sf of f.subFolders ?? [])
        for (const c of sf.conversations) allKeys.push(c.groupKey);
    }
    if (selectedGroupKeys.size > 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const ns = new Set(selectedGroupKeys);
      if (ns.has(gk)) ns.delete(gk);
      else ns.add(gk);
      selectedGroupKeys = ns;
      lastSelectedKey = gk;
      return;
    }
    if (e.shiftKey && lastSelectedKey) {
      const fi = allKeys.indexOf(lastSelectedKey),
        ti = allKeys.indexOf(gk);
      if (fi >= 0 && ti >= 0) {
        const ns = new Set(selectedGroupKeys);
        for (let i = Math.min(fi, ti); i <= Math.max(fi, ti); i++) ns.add(allKeys[i]);
        selectedGroupKeys = ns;
      }
    } else if (e.metaKey || e.ctrlKey) {
      const ns = new Set(selectedGroupKeys);
      if (ns.has(gk)) ns.delete(gk);
      else ns.add(gk);
      selectedGroupKeys = ns;
    } else {
      selectedGroupKeys = new Set();
      lastSelectedKey = gk;
      return;
    }
    lastSelectedKey = gk;
  }
  function clearBatchSelection() {
    selectedGroupKeys = new Set();
    lastSelectedKey = "";
  }
  async function batchDelete() {
    const ids = collectSelectedRunIds(selectedGroupKeys, enrichedProjectFolders);
    batchDeleteConfirmOpen = false;
    clearBatchSelection();
    await batchSoftDelete(rss, ids, selectedRunId);
  }
  async function batchHardDelete() {
    const ids = collectSelectedRunIds(selectedGroupKeys, enrichedProjectFolders);
    batchDeleteConfirmOpen = false;
    clearBatchSelection();
    await batchHardDeleteAction(rss, ids, selectedRunId);
  }
  function requestRemoveProject(cwd: string) {
    removeProjectTarget = normalizeCwd(cwd);
    removeProjectConfirmOpen = true;
  }
  function confirmRemoveProject() {
    const n = removeProjectTarget;
    removeProjectConfirmOpen = false;
    removeProjectTarget = "";
    if (n) pss.removeProject(n);
  }
  function cancelRemoveProject() {
    removeProjectConfirmOpen = false;
    removeProjectTarget = "";
  }

  // ── Plugin section type ──
  // ── Props ──
  let { children } = $props();

  // ── State ──
  let commandPaletteOpen = $state(false);
  let showSetupWizard = $state(false);
  let showAbout = $state(false);
  let selectWorkspaceCallback: ((cwd: string) => void) | null = $state(null);
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
  // Spinner = "checking right now". Dev mode short-circuits auto-check
  // (see +layout.svelte), so lastCheckedAt may stay null forever — using
  // that as the spinner gate left it spinning indefinitely. Tie the
  // spinner to the in-flight phases only.
  const sidebarVersionChecking = $derived(appUpdateCoordinator.isBusy);

  // Sidebar collapse + width
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

  // ── Deferred (lazy) modal slots ──
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

  $effect(() => {
    if (showAbout) void aboutModal.ensure();
    if (permissionsModalOpen) void permissionsModal.ensure();
    if (workspaceSettingsOpen) void workspaceSettingsModal.ensure();
    if (anySidebarModalOpen) void sidebarModals.ensure();
  });

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

  // ── Page-derived booleans ──
  let currentPath = $derived($page.url.pathname);
  let pageInfo = $derived(describeCurrentPage(currentPath));
  let {
    isChatPage,
    isPluginsPage,
    isExplorerPage,
    isTeamsPage,
    isScheduledTasksPage,
    isSettingsPage,
    needsLayoutContentPanel,
    selectedScheduledTaskId,
  } = $derived(pageInfo);
  let _pageName = $derived(resolvePageName(currentPath));
  let selectedRunId = $derived($page.url.searchParams.get("run") ?? "");

  const attentionQueueBadgeCount = $derived(
    attentionQueueStore.openItems.length + attentionQueueStore.acknowledgedItems.length,
  );

  // ── Stores exposed via context ──
  const teamStore = getContext<TeamStore>("teamStore");
  const keybindingStore = getContext<KeybindingStore>("keybindings");
  const settingsCache = getContext<SettingsCacheContext | undefined>(SETTINGS_CACHE_CONTEXT_KEY);
  const bootstrapDemand = getContext<BootstrapDemandController>(BOOTSTRAP_DEMAND_CONTEXT_KEY);

  $effect(() => {
    bootstrapDemand.ensureForRoute(currentPath);
  });

  // ── Settings-driven UI flags ──
  const settings = $derived(settingsCache?.settings ?? null);
  const iconRailEnabled = $derived(settings?.icon_rail_enabled !== false);
  const mascotEnabled = $derived(settings?.mascot_enabled !== false);
  const uiZoom = $derived(clampUiZoom(settings?.ui_zoom));
  const nativeWindowGlassEnabled = $derived(settings?.native_window_glass_enabled !== false);

  function navigateToChatRun(
    targetRunId: string,
    opts?: { scrollTo?: string; replaceState?: boolean },
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
    requestAnimationFrame(() => goto("/chat?new=1"));
  }

  function getNavItemHref(item: { path: string; icon: string }): string {
    return item.icon === "message" ? chatViewCache.lastChatHref || "/chat" : item.path;
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

  // layout chrome context
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
    selectWorkspace: (cwd: string) => {
      selectWorkspaceCallback?.(cwd);
    },
    onSelectWorkspaceChange: (cb) => {
      selectWorkspaceCallback = cb;
    },
  });

  function highlightMatch(text: string, query: string): string {
    if (!query.trim()) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const q = escapeHtml(query.trim());
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return escaped.replace(re, "<mark>$1</mark>");
  }

  // ── Sidebar enrich + selection ──
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

  // ── Filtered search results ──
  const removedCwdSet = $derived(new Set(pss.removedCwds.map(normalizeCwd)));
  const visibleSearchResults = $derived.by(() => {
    if (rss.searchResults.length === 0 || removedCwdSet.size === 0) return rss.searchResults;
    const runCwdMap = new Map<string, string>();
    for (const run of rss.runs) runCwdMap.set(run.id, normalizeCwd(run.cwd));
    return rss.searchResults.filter((r) => {
      const cwd = runCwdMap.get(r.runId);
      return cwd === undefined || !cwd || !removedCwdSet.has(cwd);
    });
  });

  const filteredTeams = $derived(tss.filteredTeams(teamStore));

  // ── Sidebar resize (ghost-line) ──
  function screenKey(): string {
    try {
      if (typeof window !== "undefined" && window.screen)
        return `${window.screen.width}x${window.screen.height}`;
    } catch {
      /* SSR */
    }
    return "default";
  }

  let _resizeCleanup: (() => void) | null = null;
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX,
      startWidth = sidebarWidth;
    let pendingWidth = startWidth;
    sidebarResizing = true;
    sidebarGhostX = e.clientX;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture?.(e.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    function onMove(ev: PointerEvent) {
      pendingWidth = Math.min(500, Math.max(180, startWidth + (ev.clientX - startX)));
      if (sidebarGhostEl)
        sidebarGhostEl.style.left = `${startX + (pendingWidth - startWidth) - 1}px`;
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
      _resizeCleanup = null;
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
    _resizeCleanup = cleanup;
  }

  // ── Workspace alias ──
  async function saveWorkspaceAlias(cwd: string, alias: string): Promise<void> {
    const normalized = normalizeCwd(cwd);
    const current = settings?.workspace_aliases ?? {};
    const updated: Record<string, string> = { ...current };
    if (alias.trim()) updated[normalized] = alias.trim();
    else delete updated[normalized];
    try {
      const { updateUserSettings } = await import("$lib/api");
      await updateUserSettings({ workspace_aliases: updated });
      dbg("layout", "workspace alias saved", { cwd: normalized, alias });
    } catch (e) {
      dbgWarn("layout", "save workspace alias failed", e);
    }
  }

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

  function handleSetupComplete(): void {
    showSetupWizard = false;
  }
  function toggleProject(folderKey: string) {
    pss.toggleProject(folderKey);
  }
  function pickFolder() {
    folderPickerInitialHost = null;
    folderPickerInitialPath = pss.projectCwd;
    folderPickerOpen = true;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && selectedGroupKeys.size > 0) {
      clearBatchSelection();
      return;
    }
    keybindingStore.dispatch(e);
  }

  // ── Derived: titlebar / sidebar geometry ──
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

  // Cross-tab auto-expand (run → folder / cwd → folder)
  let _prevAutoExpandRunId = "";
  let _prevAutoExpandRunsLen = 0;
  $effect(() => {
    if (!isChatPage) return;
    const runId = selectedRunId;
    const runsLen = rss.runs.length;
    if (runId === _prevAutoExpandRunId && runsLen === _prevAutoExpandRunsLen) return;
    _prevAutoExpandRunId = runId;
    _prevAutoExpandRunsLen = runsLen;
    if (!runId) return;
    const next = autoExpandForRun(runId, enrichedProjectFolders, pss.expandedProjects);
    if (next) pss.replaceExpanded(next);
    const sfKey = subFolderKeyForRun(runId, enrichedProjectFolders);
    if (sfKey) sfs.ensureSubFolderExpanded(sfKey.startsWith("sf:") ? sfKey.slice(3) : sfKey);
  });

  let _prevAutoExpandCwd = "";
  $effect(() => {
    const cwd = pss.projectCwd;
    if (cwd === _prevAutoExpandCwd) return;
    _prevAutoExpandCwd = cwd;
    if (!cwd) return;
    const next = expandForProjectChange(`cwd:${cwd}`, pss.expandedProjects);
    if (next) pss.replaceExpanded(next);
  });

  $effect(() => {
    if (!needsLayoutContentPanel || !rss.runsLoadSucceededOnce) return;
    pss.persistAndPruneExpanded(new Set(enrichedProjectFolders.map((f) => f.folderKey)));
  });

  $effect(() => {
    untrack(() => writeActiveSessionId(selectedRunId));
  });

  $effect(() => {
    if (!needsLayoutContentPanel) return;
    workspacesStore.list = enrichedProjectFolders.map((f) => ({
      cwd: f.cwd,
      label: f.isUncategorized ? t("sidebar_uncategorized") : cwdDisplayLabel(f.cwd),
      isUncategorized: f.isUncategorized,
    }));
  });

  $effect(() => {
    if (!needsLayoutContentPanel || !pss.projectCwd) return;
    const key = normalizeCwd(pss.projectCwd);
    const validCwds = new Set([
      ...selectableFolders.map((f) => normalizeCwd(f.cwd)),
      ...pss.pinnedCwds.map(normalizeCwd),
    ]);
    if (!validCwds.has(key)) pss.setProjectCwd("");
  });

  // Explorer tree
  let _prevExplorerCwd: string | undefined;
  $effect(() => {
    if (!isExplorerPage) return;
    const _cwd = pss.projectCwd;
    if (_cwd) {
      void ets.loadRootTree(_cwd);
      _prevExplorerCwd = _cwd;
      return;
    }
    if (!rss.runsLoadSucceededOnce) return;
    if (rss.runs.length > 0) {
      const fallback = ets.pickRecentRunsFallback(rss.runs);
      if (fallback) {
        pss.setProjectCwd(fallback);
        _prevExplorerCwd = fallback;
        return;
      }
    }
    ets.fileTree = [];
    ets.treeLoading = false;
    ets.treeError = null;
    _prevExplorerCwd = _cwd;
  });

  $effect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("native-glass-enabled", nativeWindowGlassEnabled);
  });

  afterNavigate(({ to }) => {
    if (to?.url.pathname.startsWith("/plugins")) {
      const section = to.url.searchParams.get("section");
      if (section && pluginSections.some((s) => s.id === section)) pluginActiveSection = section;
    }
    const hubMatch = to?.url.pathname.match(/^\/scheduled-tasks\/([^/]+)/);
    if (hubMatch) {
      const hubFolder = enrichedProjectFolders.find((f) =>
        f.scheduledTaskHubs.some((h) => h.taskId === hubMatch[1]),
      );
      if (hubFolder) pss.toggleProject(hubFolder.folderKey);
    }
  });

  beforeNavigate(({ from, to }) => {
    if (!from || !to) return;
    const fromPath = from.url.pathname;
    const toPath = to.url.pathname;
    if (pathIsChatOrSettingsTransition(fromPath, toPath)) {
      beginRouteTransition();
      armChatSettingsHop();
      return;
    }
    if (routeNeedsLayoutContentPanel(fromPath) !== routeNeedsLayoutContentPanel(toPath))
      beginRouteTransition();
  });
  afterNavigate(() => endRouteTransition());

  // Chrome CustomEvents bridge
  $effect(() => {
    if (typeof window === "undefined") return;
    const handlers: [string, (e: Event) => void][] = [
      ["miwarp:layout-toggle-sidebar", () => (sidebarOpen = !sidebarOpen)],
      ["miwarp:layout-toggle-command-palette", () => (commandPaletteOpen = !commandPaletteOpen)],
      ["miwarp:layout-new-chat", () => newChat()],
      ["miwarp:layout-show-wizard", () => (showSetupWizard = true)],
      ["miwarp:layout-open-permissions", () => (permissionsModalOpen = true)],
      [
        "miwarp:layout-explorer-file-selected",
        (e) => {
          ets.explorerSelectedFile = (e as CustomEvent).detail?.path ?? "";
        },
      ],
      [
        "miwarp:layout-app-version",
        (e) => {
          bundledAppVersion = (e as CustomEvent).detail ?? null;
        },
      ],
    ];
    for (const [evt, fn] of handlers) window.addEventListener(evt, fn);
    return () => {
      for (const [evt, fn] of handlers) window.removeEventListener(evt, fn);
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
        {sidebarVersionChecking}
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
        onToggleSelectConversation={(groupKey, e) => toggleSelectConversation(groupKey, e)}
        onEnterBatchMode={enterBatchMode}
        onSessionDragStart={handleSessionDragStart}
        onSessionDragMove={handleSessionDragMove}
        onSessionDragEnd={(e) => handleSessionDragEnd(e)}
        onRequestRemoveProject={(cwd) => requestRemoveProject(cwd)}
        onNewChatInFolder={newChatInFolder}
        onNewChatInSubFolder={newChatInSubFolder}
        onSelectWorkspace={(cwd) => selectWorkspaceCallback?.(cwd)}
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
  >
    {@render children()}
  </ShellMainSurface>
</div>

<AppUpdateNotice />

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
      onDeleteSoft={() => confirmDeleteConversation()}
      onDeleteHard={() => confirmHardDeleteConversation()}
      onDeleteCancel={cancelDeleteConversation}
      bind:batchDeleteConfirmOpen
      onBatchDeleteSoft={() => batchDelete()}
      onBatchDeleteHard={() => batchHardDelete()}
      bind:removeProjectConfirmOpen
      onRemoveProjectConfirm={() => confirmRemoveProject()}
      onRemoveProjectCancel={cancelRemoveProject}
      {foldersForMoveDialog}
      onMoveToFolder={doMoveToFolder}
    />
  {/if}
{/if}
