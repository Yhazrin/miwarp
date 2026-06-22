<script lang="ts">
  import "../app.css";
  import "$lib/styles/sidebar-animations.css";
  import { escapeHtml } from "$lib/utils/ansi";
  import {
    listRuns,
    listRunsSince,
    getUserSettings,
    USER_SETTINGS_CHANGED_EVENT,
    updateUserSettings,
    listDirectory,
    getGitSummary,
    listPromptFavorites,
    searchPrompts,
    listMemoryFiles,
    softDeleteRuns,
    hardDeleteRuns,
    listAllSessionFolders,
    createSessionFolder,
    renameSessionFolder,
    deleteSessionFolder,
    moveRunToFolder,
    batchMoveToFolder,
    openDirectoryInFinder,
  } from "$lib/api";
  import {
    readRunsListCache,
    writeRunsListCache,
    mergeRunsIntoCache,
    removeRunFromCache,
  } from "$lib/utils/runs-list-cache";
  import {
    normalizeProcessVisibility,
    persistCachedProcessVisibility,
  } from "$lib/utils/process-visibility";
  import ProjectFolderItem from "$lib/components/ProjectFolderItem.svelte";
  import UpdateBanner from "$lib/components/UpdateBanner.svelte";
  import VersionMismatchBanner from "$lib/components/VersionMismatchBanner.svelte";
  import { appUpdateCoordinator } from "$lib/stores/app-update-coordinator.svelte";
  import {
    initBackendCapabilities,
    useIncrementalRunsSync,
  } from "$lib/backend-capabilities.svelte";
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import TopWindowDrag from "$lib/components/TopWindowDrag.svelte";
  import { IS_MAC } from "$lib/utils/platform";
  import {
    LS_PROJECT_CWD,
    LS_SETTINGS_CWD,
    LS_PINNED_CWDS,
    LS_EXPANDED_PROJECTS,
    LS_REMOVED_CWDS,
    LS_SIDEBAR_WIDTH,
  } from "$lib/utils/storage-keys";
  import {
    SPLASH_REMOVE_DELAY_MS,
    RUNS_POLL_INTERVAL_MS,
    DEEP_SEARCH_DEBOUNCE_MS,
  } from "$lib/utils/layout-timings";
  import {
    EVT_RUNS_CHANGED,
    EVT_CWD_CHANGED,
    EVT_PROJECT_CHANGED,
    EVT_FAVORITES_CHANGED,
    EVT_OPEN_PERMISSIONS,
    EVT_SHOW_WIZARD,
    EVT_MEMORY_FILE_SELECTED,
    EVT_MEMORY_FILE_SAVED,
    EVT_MEMORY_SELECT,
    EVT_EXPLORER_FILE,
    EVT_EXPLORER_DIFF,
    EVT_EXPLORER_FILE_SELECTED,
  } from "$lib/utils/bus-events";
  import { clampUiZoom, layoutPx } from "$lib/utils/ui-zoom";
  import { isPerfEnabled } from "$lib/utils/perf";
  import { installWindowHarness } from "$lib/perf/harness";
  import { applyZoom, applyVisualPerformance } from "$lib/services/window-display";
  import { readBundledAppVersion } from "$lib/services/app-version.svelte";
  import { useKeybindingShortcuts } from "$lib/layout/use-keybinding-shortcuts.svelte";
  import {
    createTeamSubscription,
    type TeamSubscription,
  } from "$lib/layout/team-subscription.svelte";
  import { chatViewCache } from "$lib/chat/chat-view-cache.svelte";
  import { readActiveSessionId, writeActiveSessionId } from "$lib/utils/chat-persistence";
  import type {
    TaskRun,
    UserSettings,
    DirEntry,
    GitSummary,
    PromptFavorite,
    PromptSearchResult,
    MemoryFileCandidate,
    SessionFolder,
  } from "$lib/types";
  import { cwdDisplayLabel, truncate, snippetAround, relativeTime } from "$lib/utils/format";
  import { filterVisibleCandidates } from "$lib/utils/memory-helpers";
  import {
    buildEnrichedProjectFolders,
    normalizeSessionFolderList,
    sessionFolderWorkspaceId,
    sessionFoldersForWorkspace,
    getWorkspaceMascotStatus,
    autoExpandForRun,
    expandForProjectChange,
    normalizeCwd,
    type ConversationGroup,
  } from "$lib/utils/sidebar-groups";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { loadRemovedCwds } from "$lib/utils/removed-cwds";
  import {
    findSessionDropTarget,
    setSessionDragActive,
    type SessionDropTarget,
  } from "$lib/utils/session-drag-state";
  import {
    getLastTarget,
    setLastTarget,
    getStoredRemoteCwd,
    setStoredRemoteCwd,
  } from "$lib/utils/remote-cwd";
  import { page } from "$app/stores";
  import { goto, afterNavigate, beforeNavigate } from "$app/navigation";
  import { beginRouteTransition, endRouteTransition } from "$lib/utils/route-transition";
  import { armChatSettingsHop } from "$lib/utils/chat-settings-nav";
  import { onMount, setContext, untrack } from "svelte";
  import { installPreventRootOverscroll } from "$lib/utils/prevent-root-overscroll";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { fpsCounter } from "$lib/utils/perf";
  import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";
  import { loadAgentSettingsCache } from "$lib/stores/agent-settings-cache.svelte";
  import { loadCliInfo } from "$lib/stores/cli-info.svelte";
  import type { PlatformCredential } from "$lib/types";
  import { TeamStore } from "$lib/stores/team-store.svelte";
  import { KeybindingStore } from "$lib/stores/keybindings.svelte";
  import { getTransport } from "$lib/transport";
  import {
    LAYOUT_CHROME_CONTEXT_KEY,
    type LayoutChromeContext,
    SETTINGS_CACHE_CONTEXT_KEY,
    type SettingsCacheContext,
    routeNeedsLayoutContentPanel,
  } from "$lib/layout-chrome-context";
  import { themeStore } from "$lib/stores/theme-store.svelte";
  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
  import ToastHost from "$lib/components/ToastHost.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import OverlayStack from "$lib/components/layout/OverlayStack.svelte";
  import type { Component } from "svelte";
  import type { PluginSection } from "$lib/utils/plugin-sections";
  import {
    t,
    LOCALE_REGISTRY,
    getEntry,
    initLocale,
    switchLocale,
    currentLocale,
  } from "$lib/i18n/index.svelte";

  // Wire reactive locale before any t() usage
  initLocale();

  function toggleLocale() {
    const next = LOCALE_REGISTRY.find((e) => e.code !== currentLocale());
    if (next) switchLocale(next.code);
  }

  function formatAppVersion(version: string | null): string {
    const normalized = version?.trim().replace(/^v/, "");
    return normalized ? `v${normalized}` : "v...";
  }

  let commandPaletteOpen = $state(false);
  let showSetupWizard = $state(false);
  let showAbout = $state(false);
  let showCliBrowser = $state(false);
  let bundledAppVersion = $state<string | null>(null);
  let sidebarVersion = $derived(
    formatAppVersion(
      appUpdateCoordinator.state.offer?.currentVersion ??
        appUpdateCoordinator.state.upToDateVersion ??
        bundledAppVersion,
    ),
  );
  let sidebarUpdateAvailable = $derived(appUpdateCoordinator.hasUpdate);
  let sidebarVersionChecked = $derived(appUpdateCoordinator.state.lastCheckedAt !== null);
  let permissionsModalOpen = $state(false);
  let updateCenterOpen = $state(false);

  // v1.0.9 perf: defer modals / sidebars that are not first-screen. Each slot
  // holds a Svelte Component constructor, populated by `await import()` on
  // first open. Re-opening does not re-import (single-flight) and does not
  // stack any listeners/timers inside the child. See SettingsPanels for the
  // same pattern.
  type DeferredModal = Component<any>;
  type ModalSlot = {
    Component: DeferredModal | null;
    loading: boolean;
    error: string | null;
    ensure: () => Promise<void>;
  };
  function makeModalSlot(
    loader: () => Promise<{ default: DeferredModal }>,
    label: string,
  ): ModalSlot {
    let Component = $state<DeferredModal | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let inFlight: Promise<void> | null = null;
    async function ensure(): Promise<void> {
      if (Component || inFlight) return inFlight ?? Promise.resolve();
      loading = true;
      error = null;
      const p = (async () => {
        try {
          const mod = await loader();
          Component = mod.default;
        } catch (e) {
          dbgWarn("layout", `deferred modal import failed: ${label}`, e);
          error = e instanceof Error ? e.message : String(e);
          Component = null;
        } finally {
          loading = false;
          inFlight = null;
        }
      })();
      inFlight = p;
      return p;
    }
    return {
      get Component() {
        return Component;
      },
      get loading() {
        return loading;
      },
      get error() {
        return error;
      },
      ensure,
    };
  }

  const aboutModal = makeModalSlot(() => import("$lib/components/AboutModal.svelte"), "AboutModal");
  const updateCenter = makeModalSlot(
    () => import("$lib/components/UpdateCenter.svelte"),
    "UpdateCenter",
  );
  const permissionsModal = makeModalSlot(
    () => import("$lib/components/PermissionsModal.svelte"),
    "PermissionsModal",
  );
  const workspaceSettingsModal = makeModalSlot(
    () => import("$lib/components/WorkspaceSettingsModal.svelte"),
    "WorkspaceSettingsModal",
  );
  const sidebarModals = makeModalSlot(
    () => import("$lib/components/sidebar/SidebarModals.svelte"),
    "SidebarModals",
  );
  const memorySidebarGroup = makeModalSlot(
    () => import("$lib/components/MemorySidebarGroup.svelte"),
    "MemorySidebarGroup",
  );

  $effect(() => {
    if (showAbout) void aboutModal.ensure();
  });
  $effect(() => {
    if (updateCenterOpen) void updateCenter.ensure();
  });
  $effect(() => {
    if (permissionsModalOpen) void permissionsModal.ensure();
  });
  $effect(() => {
    if (workspaceSettingsOpen) void workspaceSettingsModal.ensure();
  });
  // SidebarModals + MemorySidebarGroup are kicked off where their state is
  // declared (see lower in this file). The deferred imports themselves are
  // hoisted here so the rest of the file can refer to them by stable name.

  // Team store (shared via context with /teams page)
  const teamStore = new TeamStore();
  setContext("teamStore", teamStore);

  // Keybinding store (shared via context with all pages)
  const keybindingStore = new KeybindingStore();
  setContext("keybindings", keybindingStore);

  let { children } = $props();

  let runs = $state<TaskRun[]>([]);
  let sidebarFavorites = $state<PromptFavorite[]>([]);
  let favoriteRunIds = $derived(new Set(sidebarFavorites.map((f) => f.runId)));
  let settings = $state<UserSettings | null>(null);
  let settingsLoadPromise: Promise<void> | null = null;
  function startSettingsLoad(): Promise<void> {
    if (!settingsLoadPromise) {
      settingsLoadPromise = loadSettings();
    }
    return settingsLoadPromise;
  }
  // v1.0.9 perf: expose layout-loaded settings to child pages (e.g. /settings)
  // so they can skip a redundant getUserSettings() IPC call on mount.
  setContext<SettingsCacheContext>(SETTINGS_CACHE_CONTEXT_KEY, {
    get settings() {
      return settings;
    },
    whenReady: async () => {
      await startSettingsLoad();
      return settings;
    },
  });
  let sidebarOpen = $state(true);
  let projectCwd = $state("");
  let pinnedCwds = $state<string[]>([]);
  let removedCwds = $state<string[]>([]);

  // ── Session folders ──
  let sessionFolders = $state<SessionFolder[]>([]);

  // Sub-folder expand state (folderKey → expanded)
  let expandedSubFolders = $state(new Set<string>());
  // Which project cwd is a "create sub-folder" dialog targeting
  let _folderCreateCwd = $state<string>("");

  function toggleSubFolder(folderKey: string) {
    const next = new Set(expandedSubFolders);
    if (next.has(folderKey)) next.delete(folderKey);
    else next.add(folderKey);
    expandedSubFolders = next;
  }

  // Folder CRUD dialogs
  let folderCreateOpen = $state(false);
  let folderCreateName = $state("");
  let folderRenameOpen = $state(false);
  let folderRenameTarget = $state<SessionFolder | null>(null);
  let folderRenameName = $state("");
  let folderDeleteOpen = $state(false);
  let folderDeleteTarget = $state<SessionFolder | null>(null);

  // Workspace settings modal
  let workspaceSettingsOpen = $state(false);
  let workspaceSettingsCwd = $state("");
  let workspaceSettingsAlias = $state("");

  // Move-to-folder dialog
  let moveToFolderOpen = $state(false);
  let moveToFolderRunIds = $state<string[]>([]);
  let moveToFolderSelectedId = $state<string | null>(null);

  // ── Pointer drag for sessions → folders (avoids Tauri file-drop conflict) ──
  let dragRunId = $state<string | null>(null);
  let dragOverFolderId = $state<string | null>(null);
  let dragOverUnfolderedKey = $state<string | null>(null);
  let sessionDragLabel = $state("");
  let sessionDragX = $state(0);
  let sessionDragY = $state(0);

  function handleSessionDragStart(runId: string, label: string, e: PointerEvent) {
    dragRunId = runId;
    sessionDragLabel = label;
    sessionDragX = e.clientX;
    sessionDragY = e.clientY;
    setSessionDragActive(true);
  }

  function folderKeyForRun(run: TaskRun): string {
    const cwd = normalizeCwd(run.parent_cwd ?? run.cwd);
    return cwd === "" ? "uncategorized" : `cwd:${cwd}`;
  }

  function applySessionDropHighlight(target: SessionDropTarget | null) {
    dragOverFolderId = target?.type === "folder" ? target.folderId : null;
    dragOverUnfolderedKey = target?.type === "unfoldered" ? target.workspaceKey : null;
  }

  function handleSessionDragMove(e: PointerEvent) {
    sessionDragX = e.clientX;
    sessionDragY = e.clientY;
    applySessionDropHighlight(findSessionDropTarget(e.clientX, e.clientY));
  }

  async function handleSessionDragEnd(e: PointerEvent) {
    const runId = dragRunId;
    const dropTarget = findSessionDropTarget(e.clientX, e.clientY);
    dragRunId = null;
    dragOverFolderId = null;
    dragOverUnfolderedKey = null;
    sessionDragLabel = "";
    setSessionDragActive(false);
    if (!runId || !dropTarget) return;

    const run = runs.find((r) => r.id === runId);
    if (!run) return;

    try {
      if (dropTarget.type === "folder") {
        await moveRunToFolder(runId, dropTarget.folderId);
        runs = runs.map((r) => (r.id === runId ? { ...r, folder_id: dropTarget.folderId } : r));
        expandedSubFolders = new Set([...expandedSubFolders, `sf:${dropTarget.folderId}`]);
        dbg("layout", "session pointer-drop moveToFolder success", {
          runId,
          folderId: dropTarget.folderId,
        });
      } else {
        if (folderKeyForRun(run) !== dropTarget.workspaceKey) return;
        await moveRunToFolder(runId, null);
        runs = runs.map((r) => (r.id === runId ? { ...r, folder_id: undefined } : r));
        dbg("layout", "session pointer-drop moveOutOfFolder success", { runId });
      }
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
    } catch (err) {
      dbgWarn("layout", "session pointer-drop moveRunToFolder failed", err);
    }
  }

  async function loadSessionFolders() {
    try {
      const raw = await listAllSessionFolders();
      sessionFolders = normalizeSessionFolderList(raw);
      dbg("layout", "loadSessionFolders", { count: sessionFolders.length });
    } catch (e) {
      dbgWarn("layout", "loadSessionFolders failed", e);
    }
  }

  async function doCreateFolder() {
    const name = folderCreateName.trim();
    if (!name) return;
    folderCreateOpen = false;
    folderCreateName = "";
    try {
      const workspaceId = sessionFolderWorkspaceId(_folderCreateCwd || projectCwd);
      const folder = await createSessionFolder(name, workspaceId);
      _folderCreateCwd = "";
      await loadSessionFolders();
      dbg("layout", "createFolder success", { id: folder.id, name });
    } catch (e) {
      dbgWarn("layout", "createFolder failed", e);
    }
  }

  function requestRenameFolder(folder: SessionFolder) {
    folderRenameTarget = folder;
    folderRenameName = folder.name;
    folderRenameOpen = true;
  }

  async function doRenameFolder() {
    const target = folderRenameTarget;
    const newName = folderRenameName.trim();
    if (!target || !newName) return;
    folderRenameOpen = false;
    folderRenameTarget = null;
    try {
      await renameSessionFolder(target.id, newName);
      sessionFolders = sessionFolders.map((f) =>
        f.id === target.id ? { ...f, name: newName } : f,
      );
      dbg("layout", "renameFolder success", { id: target.id, newName });
    } catch (e) {
      dbgWarn("layout", "renameFolder failed", e);
    }
  }

  function requestDeleteFolder(folder: SessionFolder) {
    folderDeleteTarget = folder;
    folderDeleteOpen = true;
  }

  async function doDeleteFolder(cascade: boolean) {
    const target = folderDeleteTarget;
    folderDeleteOpen = false;
    folderDeleteTarget = null;
    if (!target) return;
    try {
      await deleteSessionFolder(target.id, cascade);
      sessionFolders = sessionFolders.filter((f) => f.id !== target.id);
      if (cascade) {
        // Reload runs to reflect folder_id changes
        await loadRuns();
      }
      dbg("layout", "deleteFolder success", { id: target.id, cascade });
    } catch (e) {
      dbgWarn("layout", "deleteFolder failed", e);
    }
  }

  function requestMoveToFolder(runIds: string[], folderId?: string | null) {
    // If folderId is provided (including null for archive), execute immediately without modal
    if (folderId !== undefined) {
      const doMove = async () => {
        try {
          if (runIds.length === 1) {
            await moveRunToFolder(runIds[0], folderId);
          } else {
            await batchMoveToFolder(runIds, folderId);
          }
          runs = runs.map((r) =>
            runIds.includes(r.id) ? { ...r, folder_id: folderId ?? undefined } : r,
          );
          window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
          dbg("layout", "moveToFolder immediate success", { count: runIds.length, folderId });
        } catch (e) {
          dbgWarn("layout", "moveToFolder immediate failed", e);
        }
      };
      doMove();
      return;
    }
    // Otherwise open modal for user to choose folder
    moveToFolderRunIds = runIds;
    moveToFolderSelectedId = null;
    moveToFolderOpen = true;
  }

  async function doMoveToFolder() {
    const ids = moveToFolderRunIds;
    const folderId = moveToFolderSelectedId;
    moveToFolderOpen = false;
    moveToFolderRunIds = [];
    if (ids.length === 0) return;
    try {
      if (ids.length === 1) {
        await moveRunToFolder(ids[0], folderId);
      } else {
        await batchMoveToFolder(ids, folderId);
      }
      // Optimistic update
      runs = runs.map((r) => (ids.includes(r.id) ? { ...r, folder_id: folderId ?? undefined } : r));
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
      dbg("layout", "moveToFolder success", { count: ids.length, folderId });
    } catch (e) {
      dbgWarn("layout", "moveToFolder failed", e);
    }
  }

  let runSearchQuery = $state("");
  let teamStoreSearchQuery = $state("");
  let filteredTeams = $derived(
    teamStoreSearchQuery.trim()
      ? teamStore.teams.filter(
          (team) =>
            team.name.toLowerCase().includes(teamStoreSearchQuery.toLowerCase()) ||
            team.description?.toLowerCase().includes(teamStoreSearchQuery.toLowerCase()),
        )
      : teamStore.teams,
  );

  // ── Folder tree state ──
  let expandedProjects = $state<Set<string>>(new Set());
  let runsLoadSucceededOnce = $state(false);
  let lastRunsSync: string | null = null; // ISO timestamp for incremental sync

  // ── Deep search (backend full-text) ──
  let searchResults = $state<PromptSearchResult[]>([]);
  let searching = $state(false);
  let searchRequestId = $state(0);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Sidebar resize (ghost-line strategy, same as right panel) ──
  // chat-main reflow during drag is still expensive even with cv-auto: visible tool cards
  // contain markdown / hljs code blocks that re-measure on every width change. Ghost line
  // gives zero-reflow drag preview and commits once on release.
  function screenKey(): string {
    try {
      if (typeof window !== "undefined" && window.screen) {
        return `${window.screen.width}x${window.screen.height}`;
      }
    } catch {
      /* SSR or restricted environment */
    }
    return "default";
  }
  function loadSidebarWidth(): number {
    if (typeof window === "undefined") return 280;
    const key = `ocv:sidebar-width:${screenKey()}`;
    let raw = parseInt(localStorage.getItem(key) ?? "", 10);
    // Lazy migration: read legacy key once
    if (!Number.isFinite(raw)) {
      const legacy = parseInt(localStorage.getItem(LS_SIDEBAR_WIDTH) ?? "", 10);
      if (Number.isFinite(legacy)) {
        raw = legacy;
        localStorage.setItem(key, String(legacy));
      }
    }
    return Number.isFinite(raw) ? Math.min(500, Math.max(180, raw)) : 280;
  }
  let sidebarWidth = $state(loadSidebarWidth());
  let sidebarResizing = $state(false);
  let sidebarGhostX = $state(0);
  let resizeCleanup: (() => void) | null = null;

  /** Ghost line DOM element — bound after sidebarResizing toggles true.
   *  Used only for imperative DOM writes during drag, but declared as $state to satisfy
   *  Svelte 5's bind:this reactivity contract (silences non_reactive_update warning). */
  let sidebarGhostEl: HTMLElement | null = $state(null);

  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let pendingWidth = startWidth;
    sidebarResizing = true;
    sidebarGhostX = e.clientX; // initial position via Svelte (single render)
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture?.(e.pointerId);
    dbg("layout", "sidebar resize start", { startWidth });
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const stopFps = fpsCounter("sidebar-drag");

    function onMove(ev: PointerEvent) {
      pendingWidth = Math.min(500, Math.max(180, startWidth + (ev.clientX - startX)));
      const x = startX + (pendingWidth - startWidth);
      // BYPASS Svelte: write DOM directly. Svelte's reactive batching + WKWebView's pointer
      // capture don't cooperate during drag — updates pile up until pointerup. Direct DOM
      // write is synchronous and the browser repaints on the next frame regardless.
      if (sidebarGhostEl) {
        sidebarGhostEl.style.left = x - 1 + "px";
      }
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
      localStorage.setItem(`ocv:sidebar-width:${screenKey()}`, String(sidebarWidth));
      dbg("layout", "sidebar resize end", { width: sidebarWidth });
      stopFps();
    }
    function onUp() {
      cleanup();
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    resizeCleanup = cleanup;
  }

  // ── File tree state (shown in sidebar when on /explorer) ──
  interface TreeNode {
    name: string;
    fullPath: string;
    is_dir: boolean;
    size: number;
    expanded: boolean;
    loaded: boolean;
    children: TreeNode[];
    depth: number;
  }

  let fileTree = $state<TreeNode[]>([]);
  let treeLoading = $state(false);
  let explorerSelectedFile = $state("");
  let explorerTab = $state<"files" | "git">("files");
  let explorerProjectOpen = $state(false);

  // ── Git state (shown in sidebar Git tab when on /explorer) ──
  let gitSummary = $state<GitSummary | null>(null);
  let gitLoading = $state(false);

  const GIT_STATUS_COLORS: Record<string, string> = {
    M: "text-miwarp-status-info",
    A: "text-miwarp-status-success",
    D: "text-miwarp-status-error",
    R: "text-miwarp-accent-violet",
    "?": "text-muted-foreground",
  };

  function entriesToNodes(entries: DirEntry[], parentPath: string, depth: number): TreeNode[] {
    return entries.map((e) => ({
      name: e.name,
      fullPath: `${parentPath}/${e.name}`,
      is_dir: e.is_dir,
      size: e.size,
      expanded: false,
      loaded: false,
      children: [],
      depth,
    }));
  }

  let _treeSeq = 0;
  async function loadRootTree() {
    if (!projectCwd) {
      fileTree = [];
      return;
    }
    const seq = ++_treeSeq;
    treeLoading = true;
    try {
      const listing = await listDirectory(projectCwd, true);
      if (seq !== _treeSeq) return; // stale response, discard
      fileTree = entriesToNodes(listing.entries, projectCwd, 0);
      dbg("layout", "file tree loaded", { count: fileTree.length });
    } catch (e) {
      if (seq !== _treeSeq) return;
      dbgWarn("layout", "file tree load error", e);
      fileTree = [];
    } finally {
      if (seq === _treeSeq) treeLoading = false;
    }
  }

  async function toggleFolder(node: TreeNode) {
    if (!node.loaded) {
      try {
        const listing = await listDirectory(node.fullPath, true);
        node.children = entriesToNodes(listing.entries, node.fullPath, node.depth + 1);
        node.loaded = true;
        dbg("layout", "folder loaded", { path: node.fullPath, count: node.children.length });
      } catch (e) {
        dbgWarn("layout", "folder load error", e);
        node.children = [];
        node.loaded = true;
      }
    }
    node.expanded = !node.expanded;
  }

  function selectFile(node: TreeNode) {
    explorerSelectedFile = node.fullPath;
    // Notify explorer page via custom event
    window.dispatchEvent(new CustomEvent(EVT_EXPLORER_FILE, { detail: { path: node.fullPath } }));
  }

  let _gitSeq = 0;
  let _gitLoadedCwd = "";
  async function loadGitSummary() {
    if (!projectCwd) {
      gitSummary = null;
      _gitLoadedCwd = "";
      return;
    }
    const requestedCwd = projectCwd;
    const seq = ++_gitSeq;
    gitLoading = true;
    try {
      const result = await getGitSummary(requestedCwd);
      if (seq !== _gitSeq) return; // stale response, discard
      gitSummary = result;
      _gitLoadedCwd = requestedCwd;
      dbg("layout", "git summary loaded", {
        branch: result.branch,
        files: result.total_files,
      });
    } catch (e) {
      if (seq !== _gitSeq) return;
      dbgWarn("layout", "git summary load error", e);
      gitSummary = null;
      _gitLoadedCwd = "";
    } finally {
      if (seq === _gitSeq) gitLoading = false;
    }
  }

  function selectDiffFile(filePath: string) {
    // Notify explorer page to show diff
    window.dispatchEvent(new CustomEvent(EVT_EXPLORER_DIFF, { detail: { path: filePath } }));
  }

  // ── Memory sidebar state (shown when on /memory) ──
  let memoryCandidates = $state<MemoryFileCandidate[]>([]);
  let memorySelectedFile = $state("");
  let memoryLoading = $state(false);
  let memoryScopeExpanded = $state<Record<string, boolean>>({
    global: false,
  });

  let _partitioned = $derived.by(() => {
    const project: typeof memoryCandidates = [];
    const global: typeof memoryCandidates = [];
    const memory: typeof memoryCandidates = [];
    for (const c of memoryCandidates) {
      if (c.scope === "project") project.push(c);
      else if (c.scope === "global") global.push(c);
      else if (c.scope === "memory") memory.push(c);
    }
    return { project, global, memory, folder: [...project, ...memory] };
  });
  let memoryScopeGlobal = $derived(_partitioned.global);
  let memoryScopeFolder = $derived(_partitioned.folder);

  let memoryCandidateSeq = 0;

  async function loadMemoryCandidates(opts?: { soft?: boolean }) {
    const seq = ++memoryCandidateSeq;
    if (!opts?.soft) memoryLoading = true;
    try {
      const result = await listMemoryFiles(projectCwd || undefined);
      if (seq !== memoryCandidateSeq) return; // stale — discard
      memoryCandidates = result;
      dbg("layout", "memory candidates loaded", {
        count: result.length,
        existing: result.filter((f) => f.exists).length,
      });
    } catch (e) {
      if (seq !== memoryCandidateSeq) return;
      if (opts?.soft) {
        dbgWarn("layout", "soft memory refresh failed, keeping old data", e);
      } else {
        dbgWarn("layout", "memory candidates load error", e);
        memoryCandidates = [];
      }
    } finally {
      if (seq === memoryCandidateSeq) memoryLoading = false;
    }
  }

  function selectMemoryFile(file: MemoryFileCandidate) {
    // Don't set highlight immediately — page will confirm dirty state first.
    // If confirmed, page sends ocv:memory-file-selected to ack the switch.
    window.dispatchEvent(
      new CustomEvent(EVT_MEMORY_SELECT, { detail: { path: file.path, exists: file.exists } }),
    );
  }

  function toggleMemoryScope(scope: string) {
    memoryScopeExpanded = { ...memoryScopeExpanded, [scope]: !memoryScopeExpanded[scope] };
  }

  // Load tree when switching to explorer page or changing project
  // Git summary is lazy-loaded when user clicks the Git tab (see below)
  let _prevExplorerCwd: string | undefined;
  $effect(() => {
    const _path = currentPath;
    const _cwd = projectCwd;
    if (_path?.startsWith("/explorer")) {
      if (_cwd) {
        loadRootTree();
        // Invalidate git cache when cwd changes so Git tab reloads on next switch
        if (_prevExplorerCwd !== undefined && _prevExplorerCwd !== _cwd) {
          ++_gitSeq; // cancel in-flight request so it can't backfill _gitLoadedCwd
          gitLoading = false;
          _gitLoadedCwd = "";
        }
        _prevExplorerCwd = _cwd;
      } else {
        // Increment seq to invalidate any in-flight requests
        ++_treeSeq;
        ++_gitSeq;
        // Clear state
        fileTree = [];
        gitSummary = null;
        gitLoading = false;
        treeLoading = false;
        _gitLoadedCwd = "";
        _prevExplorerCwd = _cwd;
      }
    }
  });

  // Lazy-load git summary when user switches to Git tab (only on Explorer page)
  $effect(() => {
    if (
      currentPath?.startsWith("/explorer") &&
      explorerTab === "git" &&
      projectCwd &&
      _gitLoadedCwd !== projectCwd
    ) {
      loadGitSummary();
    }
  });

  // Load memory candidates when switching to memory page or changing project
  let _prevMemoryCwd: string | undefined;
  $effect(() => {
    const _path = currentPath;
    const _cwd = projectCwd;
    if (_path?.startsWith("/memory")) {
      const cwdChanged = _cwd !== _prevMemoryCwd;
      _prevMemoryCwd = _cwd;
      if (cwdChanged) {
        // Only clear project scope, keep Global/Memory to avoid visual jitter
        // Use untrack to read memoryCandidates without adding it as a dependency
        memoryCandidates = untrack(() => memoryCandidates).filter((c) => c.scope !== "project");
      }
      loadMemoryCandidates();
    }
  });

  // Navigation items grouped by function (declared before pageName derivation)
  const navItems = [
    // Core
    { path: "/chat", label: () => t("nav_chat"), icon: "message", group: "core" },
    { path: "/teams", label: () => t("nav_teams"), icon: "users", group: "core" },
    {
      path: "/scheduled-tasks",
      label: () => t("nav_scheduledTasks"),
      icon: "schedule",
      group: "core",
    },
    // Workspace
    { path: "/workspace", label: () => t("nav_workspace"), icon: "layout", group: "workspace" },
    { path: "/explorer", label: () => t("nav_explorer"), icon: "folder", group: "workspace" },
    { path: "/memory", label: () => t("nav_memory"), icon: "book", group: "workspace" },
    { path: "/history", label: () => t("nav_history"), icon: "clock", group: "workspace" },
    // Extensions
    { path: "/plugins", label: () => t("nav_extend"), icon: "zap", group: "extensions" },
    // System
    { path: "/usage", label: () => t("nav_usage"), icon: "chart", group: "system" },
    { path: "/settings", label: () => t("nav_settings"), icon: "settings", group: "system" },
  ];

  // Load initial data
  async function loadRuns() {
    // v1.0.6 1.4: cache-first sidebar (Local-first 0.1).
    // First call seeds from IDB so the sidebar renders instantly.
    if (!runsLoadSucceededOnce) {
      try {
        const cached = await readRunsListCache();
        if (cached.length > 0) {
          runs = cached;
          dbg("layout", "loadRuns: cache-first hit", { count: cached.length });
        }
      } catch (e) {
        dbgWarn("layout", "loadRuns: cache read failed", e);
      }
    }
    try {
      if (lastRunsSync && runsLoadSucceededOnce && useIncrementalRunsSync()) {
        // Incremental: only fetch runs changed since last sync
        const changed = await listRunsSince(lastRunsSync);
        if (changed.length > 0) {
          const map = new Map(runs.map((r) => [r.id, r]));
          for (const r of changed) {
            if (r.deleted_at) {
              map.delete(r.id);
            } else {
              map.set(r.id, r);
            }
          }
          runs = [...map.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
          // Background merge into IDB (no await on critical path).
          void mergeRunsIntoCache(changed.filter((r) => !r.deleted_at));
        }
      } else {
        // Full load on first call or after failure
        const fresh = await listRuns();
        runs = fresh;
        // Write back to IDB (no await on critical path).
        void writeRunsListCache(fresh);
      }
      lastRunsSync = new Date().toISOString();
      runsLoadSucceededOnce = true;
    } catch (e) {
      dbgWarn("layout", "loadRuns failed", e);
    }
  }

  async function loadSidebarFavorites() {
    try {
      sidebarFavorites = await listPromptFavorites();
    } catch {
      // Silently fail
    }
  }

  // ── Deep search ──

  function onDeepQueryInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doDeepSearch(), DEEP_SEARCH_DEBOUNCE_MS);
  }

  async function doDeepSearch() {
    const q = runSearchQuery.trim();
    if (!q) {
      searchResults = [];
      searching = false;
      return;
    }
    searching = true;
    const reqId = ++searchRequestId;
    try {
      const results = await searchPrompts(q);
      if (reqId !== searchRequestId) return;
      searchResults = results;
      dbg("layout", "search results", { count: results.length });
    } catch (e) {
      if (reqId !== searchRequestId) return;
      dbg("layout", "search error", e);
      searchResults = [];
    } finally {
      if (reqId === searchRequestId) searching = false;
    }
  }

  function highlightMatch(text: string, query: string): string {
    if (!query.trim()) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const q = escapeHtml(query.trim());
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return escaped.replace(re, "<mark>$1</mark>");
  }

  async function loadSettings() {
    try {
      settings = await getUserSettings();
      persistCachedProcessVisibility(normalizeProcessVisibility(settings.process_visibility));
      const normalizedWd = normalizeCwd(settings.working_directory);
      if (normalizedWd) {
        localStorage.setItem(LS_SETTINGS_CWD, normalizedWd);
        if (!projectCwd) projectCwd = normalizedWd;
      } else {
        localStorage.removeItem(LS_SETTINGS_CWD);
      }
      // Show setup wizard if onboarding not completed
      if (!settings.onboarding_completed) {
        showSetupWizard = true;
      }
      // One-time migration: if platform_credentials is empty but api_key exists,
      // create an initial credential from current settings
      await migrateCredentialsIfNeeded(settings);
      applyZoom(settings.ui_zoom);
      applyVisualPerformance(settings.visual_performance_mode);
    } catch (e) {
      dbgWarn("layout", "loadAndApplySettings failed", e);
    }
  }

  /** Migrate existing api_key into platform_credentials (one-time). */
  async function migrateCredentialsIfNeeded(s: UserSettings) {
    if (s.platform_credentials && s.platform_credentials.length > 0) return;
    if (!s.anthropic_api_key) return;

    // Detect platform from base_url
    let platformId = "anthropic";
    if (s.anthropic_base_url) {
      const match = PLATFORM_PRESETS.find((p) => p.base_url && s.anthropic_base_url === p.base_url);
      platformId = match?.id ?? "custom-migrated";
    }

    const cred: PlatformCredential = {
      platform_id: platformId,
      api_key: s.anthropic_api_key,
      base_url: s.anthropic_base_url || undefined,
      auth_env_var: s.auth_env_var || undefined,
      ...(platformId === "custom-migrated" ? { name: "Migrated" } : {}),
    };

    try {
      await updateUserSettings({
        platform_credentials: [cred],
        active_platform_id: platformId,
      } as Partial<UserSettings>);
      dbg("layout", "migrated credentials", { platformId });
    } catch (e) {
      dbgWarn("layout", "credential migration failed:", e);
    }
  }

  function handleSetupComplete() {
    showSetupWizard = false;
    loadSettings();
  }

  // Use onMount for initialization (not $effect - avoids accidental reactive tracking)
  onMount(() => {
    // v1.0.9 perf: install the manual benchmark harness under window.__mwPerf
    // only when perf mode is enabled (gated by isPerfEnabled to keep the
    // production bundle at zero cost). The harness is independent of the
    // route — it lives on the layout so all 6 scenarios can be invoked
    // from the devtools console at any point.
    if (isPerfEnabled()) {
      installWindowHarness(bundledAppVersion || "dev");
    }

    // Prevent root overscroll / rubber-band on macOS
    const cleanupOverscroll = installPreventRootOverscroll();

    // Remove splash screen
    const splash = document.getElementById("app-splash");
    if (splash) {
      splash.style.opacity = "0";
      setTimeout(() => splash.remove(), SPLASH_REMOVE_DELAY_MS);
    }

    // Apply performance mode immediately (before settings load) to avoid
    // brief flash of heavy CSS effects on Windows/Linux.
    applyVisualPerformance();

    // Start silent update check on startup
    appUpdateCoordinator.startAutoCheck();

    // Fire all three concurrently — they are independent.
    void initBackendCapabilities().then(() => loadRuns());
    void startSettingsLoad();

    // v1.0.6 / 5.16: restore last active session on cold start.
    // Only redirect if the URL has no explicit `run` param and we're on /chat.
    {
      const url = new URL(window.location.href);
      const hasRunParam = url.searchParams.has("run");
      const isChatRoute = url.pathname === "/chat" || url.pathname === "/";
      if (!hasRunParam && isChatRoute) {
        const lastSession = readActiveSessionId();
        if (lastSession) {
          dbg("layout", "auto-restore last session", { lastSession });
          goto(`/chat?run=${lastSession}`, { replaceState: true });
        }
      }
    }
    void import("$lib/services/sound-feedback-listener")
      .then((m) => m.startSoundFeedbackListener())
      .catch((e) => {
        if (typeof console !== "undefined")
          console.debug("[layout] sound listener init failed:", e);
      });
    const unlockSoundOnce = () => {
      void import("$lib/services/sound-feedback-service").then((m) => m.unlockSoundEngine());
    };
    window.addEventListener("pointerdown", unlockSoundOnce, { once: true, capture: true });
    window.addEventListener("keydown", unlockSoundOnce, { once: true, capture: true });
    loadSidebarFavorites();
    // v1.0.9 perf: session folders + scheduled tasks load via $effect below
    // when needsLayoutContentPanel becomes true (cold /chat) or on first nav
    // from a non-sidebar route (e.g. /settings → /chat).
    loadAgentSettingsCache();
    // v1.0.6 / 3.10 (A3): pre-warm the CLI command cache so the slash menu
    // has a populated list before any session has been started.
    void loadCliInfo();
    themeStore.init();

    // Read the local version only. Update discovery is owned by AppUpdateCoordinator.
    void readBundledAppVersion().then((version) => {
      bundledAppVersion = version;
    });

    // Load saved CWD and pinned folders from localStorage
    const saved = localStorage.getItem(LS_PROJECT_CWD);
    if (saved) projectCwd = normalizeCwd(saved) || "";

    // Load expanded projects from localStorage (defensive parse)
    try {
      const rawExpanded = localStorage.getItem(LS_EXPANDED_PROJECTS);
      if (rawExpanded) {
        const parsed = JSON.parse(rawExpanded);
        if (Array.isArray(parsed) && parsed.every((v: unknown) => typeof v === "string")) {
          expandedProjects = new Set(parsed as string[]);
        }
      }
    } catch {
      /* ignore corrupted data, keep empty Set */
    }
    try {
      const pinned = localStorage.getItem(LS_PINNED_CWDS);
      if (pinned) pinnedCwds = JSON.parse(pinned);
    } catch {
      /* ignore parse errors */
    }
    removedCwds = loadRemovedCwds();

    // Poll for runs (fallback only — primary updates via ocv:runs-changed event)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadRuns();
    }, RUNS_POLL_INTERVAL_MS);

    // Team store: initial load + poll fallback + transport listeners.
    // Hoisted to a single-flight factory so the layout owns one subscription
    // for its full lifetime; dispose() reverses everything (listeners + poll).
    // (Replaces the 80-line inline block that used to live here — see
    // `team-subscription.svelte.ts` for the equivalent behavior, including
    // listen retries with backoff and the post-event resync debounce.)
    teamSubscription = createTeamSubscription(teamStore, () => true);

    // Keybinding store: load overrides + CLI bindings, register app-level callbacks
    keybindingStore.loadOverrides();
    keybindingStore.loadCliBindings();
    const unregisterKeybindings = useKeybindingShortcuts(keybindingStore, {
      toggleSidebar,
      toggleCommandPalette: () => {
        commandPaletteOpen = !commandPaletteOpen;
      },
      newChat,
    });

    // Immediate refresh when chat page signals a status change
    function onRunsChanged() {
      loadRuns();
      loadSessionFolders();
      // Invalidate git cache unconditionally; if currently viewing Git tab on Explorer,
      // reload immediately — otherwise lazy $effect picks it up on next visit.
      ++_gitSeq; // cancel in-flight request so it can't backfill _gitLoadedCwd
      gitLoading = false;
      _gitLoadedCwd = "";
      if (currentPath?.startsWith("/explorer") && explorerTab === "git") {
        loadGitSummary();
      }
    }
    window.addEventListener(EVT_RUNS_CHANGED, onRunsChanged);

    // Refresh sidebar favorites when /runs page changes them
    function onFavoritesChanged() {
      loadSidebarFavorites();
    }
    window.addEventListener(EVT_FAVORITES_CHANGED, onFavoritesChanged);

    // Listen for Settings page requesting wizard re-open
    function onShowWizard() {
      showSetupWizard = true;
    }
    window.addEventListener(EVT_SHOW_WIZARD, onShowWizard);

    // Memory page signals which file it selected (for sidebar highlight sync)
    function onMemoryFileSelected(e: Event) {
      const path = (e as CustomEvent).detail?.path ?? "";
      if (path) memorySelectedFile = path;
    }
    window.addEventListener(EVT_MEMORY_FILE_SELECTED, onMemoryFileSelected);

    // Memory page signals a file was saved (refresh candidates to update exists status)
    function onMemoryFileSaved() {
      if (currentPath?.startsWith("/memory")) loadMemoryCandidates({ soft: true });
    }
    window.addEventListener(EVT_MEMORY_FILE_SAVED, onMemoryFileSaved);

    // Sync projectCwd when chat page picks a folder via dialog
    function handleCwdChanged() {
      const newCwd = normalizeCwd(localStorage.getItem(LS_PROJECT_CWD) ?? "") || "";
      if (newCwd !== projectCwd) {
        projectCwd = newCwd;
      }
    }
    window.addEventListener(EVT_CWD_CHANGED, handleCwdChanged);

    // Open permissions modal from any entry point (Command Palette, PromptInput button)
    function onOpenPermissions() {
      permissionsModalOpen = true;
    }
    window.addEventListener(EVT_OPEN_PERMISSIONS, onOpenPermissions);

    // ── External link interceptor ──
    // Prevent webview from navigating away to external URLs.
    // Opens them in the system browser instead.
    function handleExternalLink(e: MouseEvent) {
      // Only intercept plain left-click (no modifier keys)
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Parse URL — handles protocol-relative (//example.com), case-insensitive schemes
      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return;
      }

      // Only intercept http/https
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      // Skip internal SvelteKit routes (same origin)
      if (url.origin === window.location.origin) return;

      // Prevent webview navigation, don't stopPropagation (let other listeners see it)
      e.preventDefault();

      dbg("layout", "external-link: opening in system browser", { href });
      import("@tauri-apps/plugin-shell")
        .then(({ open }) => open(href))
        .catch((err) => {
          dbgWarn("layout", "external-link: plugin-shell failed, fallback to window.open", err);
          window.open(href, "_blank");
        });
    }
    document.addEventListener("click", handleExternalLink, true);
    dbg("layout", "external-link interceptor mounted");

    // Explorer → layout: sync sidebar highlight when explorer restores cached file
    function onExplorerFileSelected(e: Event) {
      explorerSelectedFile = (e as CustomEvent).detail?.path ?? "";
    }
    window.addEventListener(EVT_EXPLORER_FILE_SELECTED, onExplorerFileSelected);

    // Listen for run status changes (idle↔running) from backend
    const transport = getTransport();
    let destroyed = false;
    let unlistenStatus: (() => void) | undefined;
    transport
      .listen("ocv:status-changed", (payload: unknown) => {
        dbg("layout", "status-changed", payload);
        loadRuns();
      })
      .then((fn) => {
        if (destroyed) {
          fn();
          return;
        }
        unlistenStatus = fn;
      });

    let unlistenCliAutoSync: (() => void) | undefined;
    transport
      .listen("ocv:cli-auto-sync", (payload: unknown) => {
        dbg("layout", "cli-auto-sync", payload);
        loadRuns();
        window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
      })
      .then((fn) => {
        if (destroyed) {
          fn();
          return;
        }
        unlistenCliAutoSync = fn;
      });

    // Visual performance mode hot-update (dispatched from settings page)
    const onPerfModeChanged = (e: Event) => {
      const mode = (e as CustomEvent).detail?.mode;
      if (mode) applyVisualPerformance(mode);
    };
    window.addEventListener("miwarp:visual-performance-changed", onPerfModeChanged);

    const onUserSettingsChanged = (e: Event) => {
      const next = (e as CustomEvent<UserSettings>).detail;
      if (!next) return;
      settings = next;
      persistCachedProcessVisibility(normalizeProcessVisibility(next.process_visibility));
      applyZoom(next.ui_zoom);
      applyVisualPerformance(next.visual_performance_mode);
    };
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, onUserSettingsChanged);

    return () => {
      resizeCleanup?.(); // Clean up resize drag if component unmounts mid-drag
      unlistenStatus?.();
      unlistenCliAutoSync?.();
      clearInterval(interval);
      teamSubscription?.dispose();
      teamSubscription = null;
      if (debounceTimer) clearTimeout(debounceTimer);
      destroyed = true;
      unregisterKeybindings();
      window.removeEventListener(EVT_RUNS_CHANGED, onRunsChanged);
      window.removeEventListener(EVT_FAVORITES_CHANGED, onFavoritesChanged);
      window.removeEventListener(EVT_SHOW_WIZARD, onShowWizard);
      window.removeEventListener(EVT_CWD_CHANGED, handleCwdChanged);
      window.removeEventListener(EVT_MEMORY_FILE_SELECTED, onMemoryFileSelected);
      window.removeEventListener(EVT_MEMORY_FILE_SAVED, onMemoryFileSaved);
      window.removeEventListener(EVT_OPEN_PERMISSIONS, onOpenPermissions);
      document.removeEventListener("click", handleExternalLink, true);
      window.removeEventListener(EVT_EXPLORER_FILE_SELECTED, onExplorerFileSelected);
      window.removeEventListener("miwarp:visual-performance-changed", onPerfModeChanged);
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, onUserSettingsChanged);
      cleanupOverscroll();
      appUpdateCoordinator.destroy();
    };
  });

  // Save CWD to localStorage when changed (clear key for "All Projects")
  // Also pin manually-selected folders so they persist in the project list
  $effect(() => {
    if (typeof window !== "undefined") {
      if (projectCwd) {
        localStorage.setItem(LS_PROJECT_CWD, projectCwd);
        // Pin this cwd so it stays in the dropdown after switching away
        if (projectCwd !== "/" && !pinnedCwds.includes(projectCwd)) {
          pinnedCwds = [...pinnedCwds, projectCwd];
          localStorage.setItem(LS_PINNED_CWDS, JSON.stringify(pinnedCwds));
        }
      } else {
        localStorage.removeItem(LS_PROJECT_CWD);
      }
      // Notify child pages (e.g. Memory) that project cwd changed
      window.dispatchEvent(new CustomEvent(EVT_PROJECT_CHANGED, { detail: { cwd: projectCwd } }));
    }
  });

  afterNavigate(({ to }) => {
    dbg("layout", "navigated to:", to?.url.pathname);
    // Sync plugin section from URL when navigating to /plugins
    if (to?.url.pathname.startsWith("/plugins")) {
      const section = to.url.searchParams.get("section");
      if (section && pluginSections.some((s) => s.id === section)) {
        pluginActiveSection = section;
      }
    }
    // Expand workspace folder when opening a scheduled task hub
    const hubMatch = to?.url.pathname.match(/^\/scheduled-tasks\/([^/]+)/);
    if (hubMatch) {
      const hubTaskId = hubMatch[1];
      const hubFolder = enrichedProjectFolders.find((folder) =>
        folder.scheduledTaskHubs.some((hub) => hub.taskId === hubTaskId),
      );
      if (hubFolder) {
        expandedProjects = new Set([...expandedProjects, hubFolder.folderKey]);
      }
    }
  });

  // Catch unhandled errors that could break the router
  onMount(() => {
    function onError(e: ErrorEvent) {
      dbgWarn("layout", "global error", e.message, e.filename, e.lineno);
    }
    function onRejection(e: PromiseRejectionEvent) {
      dbgWarn("layout", "unhandled rejection", e.reason);
      // Don't call e.preventDefault() — let rejections surface in devtools
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  });

  // Get selected run from URL
  let selectedRunId = $derived.by(() => {
    const url = $page.url;
    return url.searchParams.get("run") ?? "";
  });

  // v1.0.6 / 5.16: persist active session for auto-restore on next launch
  $effect(() => {
    const id = selectedRunId;
    untrack(() => writeActiveSessionId(id));
  });

  // ── Delete conversation confirm flow ──
  let deleteConfirmOpen = $state(false);
  let deleteTarget: ConversationGroup | null = $state(null);

  function requestDeleteConversation(conv: ConversationGroup) {
    deleteTarget = conv;
    deleteConfirmOpen = true;
  }

  async function confirmDeleteConversation() {
    const conv = deleteTarget;
    deleteConfirmOpen = false;
    deleteTarget = null;
    if (!conv) return;
    try {
      const ids = conv.runs.map((r) => r.id);
      await softDeleteRuns(ids);
      dbg("layout", "deleteConversation success", { ids });
      // v1.0.6 1.4: keep IDB in sync with deletion
      for (const id of ids) void removeRunFromCache(id);
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
      if (conv.runs.some((r) => r.id === selectedRunId)) {
        goto("/chat");
      }
    } catch (e) {
      dbgWarn("layout", "deleteConversation failed", e);
    }
  }

  async function confirmHardDeleteConversation() {
    const conv = deleteTarget;
    deleteConfirmOpen = false;
    deleteTarget = null;
    if (!conv) return;
    try {
      const ids = conv.runs.map((r) => r.id);
      await hardDeleteRuns(ids);
      // Remove from local state immediately
      const idSet = new Set(ids);
      runs = runs.filter((r) => !idSet.has(r.id));
      // v1.0.6 1.4: keep IDB in sync with deletion
      for (const id of ids) void removeRunFromCache(id);
      dbg("layout", "hardDeleteConversation success", { ids });
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
      if (ids.some((id) => id === selectedRunId)) {
        goto("/chat");
      }
    } catch (e) {
      dbgWarn("layout", "hardDeleteConversation failed", e);
    }
  }

  function cancelDeleteConversation() {
    deleteConfirmOpen = false;
    deleteTarget = null;
  }

  // ── Batch selection for conversations ──
  let selectedGroupKeys = $state(new Set<string>());
  let lastSelectedKey = $state("");
  let batchModeActive = $derived(selectedGroupKeys.size > 0);

  function enterBatchMode(groupKey: string) {
    selectedGroupKeys = new Set([groupKey]);
    lastSelectedKey = groupKey;
  }

  function toggleSelectConversation(groupKey: string, e: MouseEvent) {
    if (batchModeActive && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const newSet = new Set(selectedGroupKeys);
      if (newSet.has(groupKey)) newSet.delete(groupKey);
      else newSet.add(groupKey);
      selectedGroupKeys = newSet;
      lastSelectedKey = groupKey;
      return;
    }
    if (e.shiftKey && lastSelectedKey) {
      // Range select: find all conversations between lastSelected and current
      // Use enrichedProjectFolders order (matches visual rendering)
      const allKeys: string[] = [];
      for (const folder of enrichedProjectFolders) {
        for (const conv of folder.conversations) allKeys.push(conv.groupKey);
        for (const sf of folder.subFolders ?? []) {
          for (const conv of sf.conversations) allKeys.push(conv.groupKey);
        }
      }
      const fromIdx = allKeys.indexOf(lastSelectedKey);
      const toIdx = allKeys.indexOf(groupKey);
      if (fromIdx >= 0 && toIdx >= 0) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const newSet = new Set(selectedGroupKeys);
        for (let i = start; i <= end; i++) {
          newSet.add(allKeys[i]);
        }
        selectedGroupKeys = newSet;
      }
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle individual
      const newSet = new Set(selectedGroupKeys);
      if (newSet.has(groupKey)) newSet.delete(groupKey);
      else newSet.add(groupKey);
      selectedGroupKeys = newSet;
    } else {
      // Plain click: clear batch and navigate
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

  let batchDeleteConfirmOpen = $state(false);

  function collectSelectedRunIds(): string[] {
    const keys = new Set(selectedGroupKeys);
    const ids: string[] = [];
    for (const folder of enrichedProjectFolders) {
      // Unfoldered sessions
      for (const conv of folder.conversations) {
        if (keys.has(conv.groupKey)) ids.push(...conv.runs.map((r) => r.id));
      }
      // Sub-folder sessions
      for (const sf of folder.subFolders ?? []) {
        for (const conv of sf.conversations) {
          if (keys.has(conv.groupKey)) ids.push(...conv.runs.map((r) => r.id));
        }
      }
    }
    return ids;
  }

  async function batchDelete() {
    const _keys = new Set(selectedGroupKeys);
    batchDeleteConfirmOpen = false;
    clearBatchSelection();
    const ids = collectSelectedRunIds();
    if (ids.length === 0) return;
    try {
      await softDeleteRuns(ids);
      for (const id of ids) void removeRunFromCache(id);
      dbg("layout", "batchDelete success", { count: ids.length });
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
      if (ids.includes(selectedRunId)) goto("/chat");
    } catch (e) {
      dbgWarn("layout", "batchDelete failed", e);
    }
  }

  async function batchHardDelete() {
    const ids = collectSelectedRunIds();
    batchDeleteConfirmOpen = false;
    clearBatchSelection();
    if (ids.length === 0) return;
    try {
      await hardDeleteRuns(ids);
      const idSet = new Set(ids);
      runs = runs.filter((r) => !idSet.has(r.id));
      for (const id of ids) void removeRunFromCache(id);
      dbg("layout", "batchHardDelete success", { count: ids.length });
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
      if (ids.includes(selectedRunId)) goto("/chat");
    } catch (e) {
      dbgWarn("layout", "batchHardDelete failed", e);
    }
  }

  // ── Remove project folder confirm flow ──
  let removeProjectConfirmOpen = $state(false);
  let removeProjectTarget = $state("");

  function persistRemovedCwds() {
    localStorage.setItem(LS_REMOVED_CWDS, JSON.stringify(removedCwds));
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

    // Add to removedCwds
    if (!removedCwds.includes(normalized)) {
      removedCwds = [...removedCwds, normalized];
      persistRemovedCwds();
    }

    // Remove from pinnedCwds (compare normalized)
    const newPinned = pinnedCwds.filter((c) => normalizeCwd(c) !== normalized);
    if (newPinned.length !== pinnedCwds.length) {
      pinnedCwds = newPinned;
      localStorage.setItem(LS_PINNED_CWDS, JSON.stringify(pinnedCwds));
    }

    // If currently viewing this project, switch to All Projects
    if (normalizeCwd(projectCwd) === normalized) {
      projectCwd = "";
    }

    dbg("layout", "removeProject", { cwd: normalized });
  }

  function cancelRemoveProject() {
    removeProjectConfirmOpen = false;
    removeProjectTarget = "";
  }

  // Workspace settings modal
  function _openWorkspaceSettings(cwd: string) {
    const normalized = normalizeCwd(cwd);
    const alias = settings?.workspace_aliases?.[normalized] ?? "";
    workspaceSettingsCwd = cwd;
    workspaceSettingsAlias = alias;
    workspaceSettingsOpen = true;
  }

  // v1.0.9 perf: SidebarModals hosts 7 confirm dialogs. Any of the 7 open
  // flags may open it, so aggregate into one boolean that the loader's
  // $effect can track. MemorySidebarGroup only matters on the memory route.
  let anySidebarModalOpen = $derived(
    deleteConfirmOpen ||
      batchDeleteConfirmOpen ||
      removeProjectConfirmOpen ||
      folderCreateOpen ||
      folderRenameOpen ||
      folderDeleteOpen ||
      moveToFolderOpen,
  );
  $effect(() => {
    if (anySidebarModalOpen) void sidebarModals.ensure();
  });
  $effect(() => {
    if (isMemoryPage) void memorySidebarGroup.ensure();
  });

  async function saveWorkspaceAlias(cwd: string, alias: string) {
    const normalized = normalizeCwd(cwd);
    const current = settings?.workspace_aliases ?? {};
    const updated = { ...current };
    if (alias.trim()) {
      updated[normalized] = alias.trim();
    } else {
      delete updated[normalized];
    }
    try {
      const newSettings = await updateUserSettings({ workspace_aliases: updated });
      settings = newSettings;
      dbg("layout", "workspace alias saved", { cwd: normalized, alias });
    } catch (e) {
      dbgWarn("layout", "save workspace alias failed", e);
    }
  }

  // v1.0.9 perf: skip expensive folder tree computation on pages that don't
  // render the sidebar content panel (settings, usage, release-notes, etc.).
  // On those routes the sidebar only shows the icon rail; building the enriched
  // tree from runs + sessionFolders + favorites + scheduledTasks is wasted work.
  let enrichedProjectFolders = $derived.by(() => {
    if (!needsLayoutContentPanel) return [] as ReturnType<typeof buildEnrichedProjectFolders>;
    return buildEnrichedProjectFolders(
      runs,
      sessionFolders,
      favoriteRunIds,
      pinnedCwds,
      removedCwds,
      scheduledTasksStore.tasks,
      scheduledTasksStore.runs,
    );
  });

  // Selectable folders: real project folders (exclude Uncategorized)
  const selectableFolders = $derived(enrichedProjectFolders.filter((f) => !f.isUncategorized));

  // Project workspaces exposed to the welcome screen picker (and other
  // consumers that need to render a cwd list). Mirrors enrichedProjectFolders
  // in a lightweight shape so chat +page.svelte doesn't have to recompute it.
  $effect(() => {
    if (!needsLayoutContentPanel) return;
    workspacesStore.list = enrichedProjectFolders.map((f) => ({
      cwd: f.cwd,
      label: f.isUncategorized ? t("sidebar_uncategorized") : cwdDisplayLabel(f.cwd),
      isUncategorized: f.isUncategorized,
    }));
  });

  // Removed cwd set for O(1) lookup in search filtering
  let removedCwdSet = $derived(new Set(removedCwds.map(normalizeCwd)));

  // Filter search results to exclude removed project cwds
  let visibleSearchResults = $derived.by(() => {
    if (searchResults.length === 0) return searchResults;
    if (removedCwdSet.size === 0) return searchResults;
    // Build runId→cwd mapping from runs
    const runCwdMap = new Map<string, string>();
    for (const run of runs) {
      runCwdMap.set(run.id, normalizeCwd(run.cwd));
    }
    return searchResults.filter((result) => {
      const cwd = runCwdMap.get(result.runId);
      // Unknown runId (not in runs yet) → show by default (avoid async timing issues)
      if (cwd === undefined) return true;
      // "" = Uncategorized → always show
      if (!cwd) return true;
      return !removedCwdSet.has(cwd);
    });
  });

  // Logical folders for move-to-folder modal (scoped to current workspace)
  const foldersForMoveDialog = $derived(sessionFoldersForWorkspace(sessionFolders, projectCwd));

  // Defensive fallback: reset projectCwd only when it's not pinned and not in the tree
  $effect(() => {
    if (!needsLayoutContentPanel) return;
    if (!projectCwd) return;
    const key = normalizeCwd(projectCwd);
    const validCwds = new Set([
      ...selectableFolders.map((f) => normalizeCwd(f.cwd)),
      ...pinnedCwds.map(normalizeCwd),
    ]);
    if (!validCwds.has(key)) {
      dbg("layout", "projectCwd not in selectable folders, resetting", { projectCwd: key });
      projectCwd = "";
    }
  });

  // Current page detection
  let currentPath = $derived($page.url.pathname);
  let selectedScheduledTaskId = $derived(
    currentPath.startsWith("/scheduled-tasks/") && ($page.params as Record<string, string>).taskId
      ? ($page.params as Record<string, string>).taskId
      : "",
  );
  let isChatPage = $derived(currentPath === "/chat" || currentPath === "/");
  let isPluginsPage = $derived(currentPath.startsWith("/plugins"));
  let isExplorerPage = $derived(currentPath.startsWith("/explorer"));
  let isMemoryPage = $derived(currentPath.startsWith("/memory"));
  let isTeamsPage = $derived(currentPath.startsWith("/teams"));

  // Tracks the active team subscription so onMount can dispose it on unmount.
  // v1.0.9 perf: extracted from a 90-line inline block in onMount into a
  // single-flight factory (see `team-subscription.svelte.ts`). One subscription
  // lives for the lifetime of the layout component; on dispose both
  // transport listeners and the fallback poll are torn down.
  let teamSubscription: TeamSubscription | null = null;

  let isSettingsPage = $derived(currentPath.startsWith("/settings"));
  // Whether the current page uses the layout's content panel (vs managing its own layout)
  let needsLayoutContentPanel = $derived(routeNeedsLayoutContentPanel(currentPath));

  // v1.0.9 perf: deferred sidebar data — load session folders and scheduled
  // tasks when the user first navigates to a sidebar-dependent page. On cold
  // start at /settings this avoids 3 IPC calls that would otherwise run in
  // onMount for data the settings page never renders.
  let _sidebarDataLoaded = false;
  $effect(() => {
    if (!needsLayoutContentPanel || _sidebarDataLoaded) return;
    _sidebarDataLoaded = true;
    loadSessionFolders();
    void scheduledTasksStore.loadTasks();
    void scheduledTasksStore.loadAllRuns();
  });

  // Icon rail visibility (driven by user setting, default true)
  const iconRailEnabled = $derived(settings?.icon_rail_enabled !== false);
  const mascotEnabled = $derived(settings?.mascot_enabled !== false);
  const uiZoom = $derived(clampUiZoom(settings?.ui_zoom));

  /** v1.0.6 follow-up: native window-level glass material for the whole
   *  left sidebar (icon rail + content panel + session list). When false
   *  the sidebar falls back to the legacy opaque `glass-sidebar` look. */
  const nativeWindowGlassEnabled = $derived(settings?.native_window_glass_enabled !== false);

  // Toggle an html-level class so app.css can flip body/html to transparent
  // when the native glass effect is on. The right pane keeps its own
  // `miwarp-main-surface` opaque background.
  $effect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("native-glass-enabled", nativeWindowGlassEnabled);
  });

  /** Left inset for TopWindowDrag — matches titlebar action buttons after traffic lights. */
  const windowChromeLeftInset = $derived.by(() => {
    const z = uiZoom;
    const actionsInset = layoutPx(IS_MAC ? 80 : 12, z);
    const control = layoutPx(IS_MAC ? 12 : 14, z);
    const gap = layoutPx(IS_MAC ? 8 : 6, z);
    if (isChatPage) {
      return Math.round(actionsInset + layoutPx(8, z));
    }
    let actions = 1;
    if (!isSettingsPage) actions += 1;
    if (needsLayoutContentPanel) actions += 2;
    return Math.round(
      actionsInset + actions * control + Math.max(0, actions - 1) * gap + layoutPx(8, z),
    );
  });
  const titlebarBandHeight = $derived(Math.round(layoutPx(32, uiZoom)));
  // Effective sidebar width depends on whether the rail is shown
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

  // Plugin sidebar navigation (shown when on /plugins route)
  const pluginSections: PluginSection[] = [
    { id: "overview", label: () => t("sidebar_overview"), icon: "overview" },
    { id: "skills", label: () => t("sidebar_skills"), icon: "sparkles" },
    { id: "sources", label: () => t("sidebar_skillSources"), icon: "sources" },
    { id: "mcp", label: () => t("sidebar_mcpServers"), icon: "server" },
    { id: "hooks", label: () => t("sidebar_hooks"), icon: "webhook" },
    { id: "plugins", label: () => t("sidebar_plugins"), icon: "package" },
    { id: "agents", label: () => t("sidebar_agents"), icon: "agents" },
  ];

  let pluginActiveSection = $state<string>("overview");
  setContext("pluginSection", {
    get active() {
      return pluginActiveSection;
    },
    set active(v: string) {
      pluginActiveSection = v;
    },
  });

  // Breadcrumb for non-chat pages
  let pageName = $derived.by(() => {
    const nav = navItems.find((n) => currentPath.startsWith(n.path));
    if (nav) return nav.label();
    if (currentPath.startsWith("/release-notes")) return t("release_cliChangelog");
    return t("layout_appName");
  });

  function newChat() {
    // Always land on the welcome screen so the user picks a workspace
    // (and creation mode) before a session starts — never resume the last run.
    goto("/chat?new=1");
  }

  function getNavItemHref(item: { path: string; icon: string }): string {
    // Chat nav item: return to last chat if available
    if (item.icon === "message") {
      return chatViewCache.lastChatHref || "/chat";
    }
    return item.path;
  }

  function newChatInFolder(cwd: string) {
    const normalized = normalizeCwd(cwd);
    if (!normalized) return;
    projectCwd = normalized;
    try {
      localStorage.setItem(LS_PROJECT_CWD, normalized);
    } catch {
      // ignore
    }
    if (!pinnedCwds.includes(normalized)) {
      pinnedCwds = [...pinnedCwds, normalized];
      localStorage.setItem(LS_PINNED_CWDS, JSON.stringify(pinnedCwds));
    }
    window.dispatchEvent(new CustomEvent(EVT_PROJECT_CHANGED, { detail: { cwd: normalized } }));
    chatViewCache.lastRunId = "";
    goto(`/chat?new=1&folder=${encodeURIComponent(normalized)}`);
  }

  /** Sidebar "New Session in folder" — sets the workspace cwd (same as
   *  newChatInFolder) and pins a `sf` (sub-folder) target that the chat
   *  page consumes on the next startSession call. */
  function newChatInSubFolder(parentCwd: string, subFolderId: string) {
    const normalized = normalizeCwd(parentCwd);
    if (!normalized || !subFolderId) return;
    projectCwd = normalized;
    try {
      localStorage.setItem(LS_PROJECT_CWD, normalized);
    } catch {
      // ignore
    }
    if (!pinnedCwds.includes(normalized)) {
      pinnedCwds = [...pinnedCwds, normalized];
      localStorage.setItem(LS_PINNED_CWDS, JSON.stringify(pinnedCwds));
    }
    window.dispatchEvent(new CustomEvent(EVT_PROJECT_CHANGED, { detail: { cwd: normalized } }));
    chatViewCache.lastRunId = "";
    goto(
      `/chat?new=1&folder=${encodeURIComponent(normalized)}&sf=${encodeURIComponent(subFolderId)}`,
    );
  }

  function toggleProject(folderKey: string) {
    const next = new Set(expandedProjects);
    if (next.has(folderKey)) next.delete(folderKey);
    else next.add(folderKey);
    expandedProjects = next;
  }

  // ── Folder picker (sidebar "+ Open folder") ──
  let folderPickerOpen = $state(false);
  let folderPickerInitialHost = $state<string | null>(null);
  let folderPickerInitialPath = $state("");

  async function pickFolder() {
    // Pre-fill from last-target so remote-using users don't lose their target.
    // Validate against current settings — a host removed/renamed since the
    // value was persisted should not silently leak through to the picker.
    const lastTarget = getLastTarget();
    const validatedTarget =
      lastTarget && (settings?.remote_hosts ?? []).some((h) => h.name === lastTarget)
        ? lastTarget
        : null;
    if (lastTarget && !validatedTarget) {
      dbgWarn("layout", "lastTarget references unknown remote — falling back to local", {
        lastTarget,
      });
    }
    folderPickerInitialHost = validatedTarget;
    folderPickerInitialPath = validatedTarget
      ? getStoredRemoteCwd(validatedTarget)
      : projectCwd || settings?.working_directory || "";
    folderPickerOpen = true;
  }

  function onFolderPicked(result: { hostName: string | null; path: string }) {
    const { hostName, path } = result;
    if (!path) return;
    if (hostName) {
      // Remote: persist and navigate to chat with host+folder
      setStoredRemoteCwd(hostName, path);
      setLastTarget(hostName);
      // Clear local projectCwd so the local file tree doesn't try to list a remote path
      projectCwd = "";
      dbg("layout", "pickFolder (remote)", { hostName, path });
      goto(`/chat?host=${encodeURIComponent(hostName)}&folder=${encodeURIComponent(path)}`);
    } else {
      // Local target
      const normalized = normalizeCwd(path) || "";
      if (normalized && removedCwds.includes(normalized)) {
        removedCwds = removedCwds.filter((c) => c !== normalized);
        persistRemovedCwds();
        dbg("layout", "pickFolder: un-removed cwd", { cwd: normalized });
      }
      projectCwd = normalized;
      setLastTarget(null);
    }
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }

  setContext("toggleSidebar", toggleSidebar);

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

  function pathIsChat(pathname: string): boolean {
    return pathname === "/chat" || pathname === "/";
  }

  function pathIsSettings(pathname: string): boolean {
    return pathname.startsWith("/settings");
  }

  beforeNavigate(({ from, to }) => {
    if (!from || !to) return;
    const a = from.url.pathname;
    const b = to.url.pathname;
    if ((pathIsChat(a) && pathIsSettings(b)) || (pathIsSettings(a) && pathIsChat(b))) {
      beginRouteTransition();
      armChatSettingsHop();
    }
  });

  afterNavigate(() => {
    endRouteTransition();
  });

  // Auto-expand folder containing selected run (chats tab only)
  // Track runId + runs.length as change signals. runs.length is the most
  // reliable: it changes on any new run (including resume into existing
  // session where conversationCount stays the same).
  // Don't track expandedProjects itself (otherwise collapsing re-expands).
  let _prevAutoExpandRunId = "";
  let _prevAutoExpandRunsLen = 0;
  $effect(() => {
    if (!isChatPage) return;
    const runId = selectedRunId;
    const runsLen = runs.length;
    const runChanged = runId !== _prevAutoExpandRunId;
    const runsChanged = runsLen !== _prevAutoExpandRunsLen;
    if (!runChanged && !runsChanged) return; // early-return avoids tracking expandedProjects
    _prevAutoExpandRunId = runId;
    _prevAutoExpandRunsLen = runsLen;
    if (!runId) return;
    const next = autoExpandForRun(runId, enrichedProjectFolders, expandedProjects);
    if (next) {
      dbg("layout", "auto-expand for run", { selectedRunId: runId });
      expandedProjects = next;
    }
  });

  // Auto-expand folder matching projectCwd (cross-tab sync)
  let _prevAutoExpandCwd = "";
  $effect(() => {
    const cwd = projectCwd;
    if (cwd === _prevAutoExpandCwd) return;
    _prevAutoExpandCwd = cwd;
    if (!cwd) return;
    const folderKey = `cwd:${cwd}`;
    const next = expandForProjectChange(folderKey, expandedProjects);
    if (next) {
      dbg("layout", "auto-expand for cwd change", { cwd });
      expandedProjects = next;
    }
  });

  // Persist expandedProjects + prune stale keys (only after first successful load)
  $effect(() => {
    if (!needsLayoutContentPanel) return;
    if (!runsLoadSucceededOnce) return;
    const validKeys = new Set(enrichedProjectFolders.map((f) => f.folderKey));
    const pruned = [...expandedProjects].filter((k) => validKeys.has(k));
    if (pruned.length !== expandedProjects.size) {
      expandedProjects = new Set(pruned);
    }
    localStorage.setItem(LS_EXPANDED_PROJECTS, JSON.stringify(pruned));
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && selectedGroupKeys.size > 0) {
      clearBatchSelection();
      return;
    }
    keybindingStore.dispatch(e);
  }
</script>

{#snippet treeNodes(nodes: TreeNode[])}
  {#each nodes as node}
    <button
      type="button"
      class="flex w-full items-center gap-1 py-0.5 text-[13px] transition-colors
        text-sidebar-foreground hover:bg-sidebar-accent/50
        {explorerSelectedFile === node.fullPath ? 'bg-sidebar-accent/70' : ''}"
      style="padding-left: {8 + node.depth * 12}px"
      onclick={() => (node.is_dir ? toggleFolder(node) : selectFile(node))}
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

<!-- eslint-disable-next-line svelte/no-dupe-style-properties — 100vh is a fallback for browsers without dvh support -->
<div class="flex w-screen overflow-hidden" style="height: 100vh; height: 100dvh;">
  <!-- Sidebar: Icon Rail + Content Panel -->
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
      <!-- A. Icon Rail -->
      <div class="sidebar-icon-rail flex w-[44px] flex-col items-center">
        <!-- Rail logo (OC) -->
        <div class="relative w-full shrink-0 h-[var(--miwarp-titlebar-band)]" aria-hidden="true">
          <WindowDragArea class="absolute inset-0" />
        </div>

        <!-- Rail nav icons -->
        <nav class="flex flex-1 flex-col items-center gap-1 py-2 pt-2">
          {#each navItems as item, idx}
            {#if idx > 0 && item.group !== navItems[idx - 1].group}
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
              <!-- Active indicator bar -->
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
              {:else if item.icon === "zap"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg
                >
              {:else if item.icon === "book"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg
                >
              {:else if item.icon === "chart"}
                <svg
                  class="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg
                >
              {:else if item.icon === "clock"}
                <Icon name="clock" class="h-[18px] w-[18px]" />
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
                <Icon name="clock" class="h-[18px] w-[18px]" />
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
              {/if}
              <!-- team count badge removed by user request -->
              <span class="sr-only">{item.label()}</span>
            </a>
          {/each}
        </nav>

        <!-- Rail version + locale + dark mode toggle -->
        <div class="py-2">
          <div class="flex items-center justify-center pb-1">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer
              {sidebarUpdateAvailable
                ? 'text-miwarp-status-warning hover:text-[hsl(var(--miwarp-status-warning)/0.8)] hover:bg-[hsl(var(--miwarp-status-warning)/0.1)]'
                : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-sidebar-accent/50'}"
              onclick={() => (showAbout = true)}
              aria-label={t("settings_checkUpdate")}
              title={sidebarUpdateAvailable
                ? t("sidebar_updateAvailableTitle", { version: sidebarVersion })
                : t("sidebar_updateCurrentTitle", { version: sidebarVersion })}
            >
              {#if !sidebarVersionChecked}
                <!-- Loading spinner -->
                <svg class="h-3.5 w-3.5 animate-spin opacity-50" viewBox="0 0 24 24" fill="none">
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-dasharray="31.4"
                    stroke-dashoffset="10"
                    stroke-linecap="round"
                  />
                </svg>
              {:else if sidebarUpdateAvailable}
                <!-- Update available: arrow-up-circle -->
                <svg
                  class="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="16 12 12 8 8 12" />
                  <line x1="12" y1="16" x2="12" y2="8" />
                </svg>
              {:else}
                <!-- Up to date: check-circle -->
                <svg
                  class="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              {/if}
            </button>
          </div>
          <div class="mx-auto mb-0.5">
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
              onclick={toggleLocale}
              aria-label={t("settings_changeLanguage")}
              title={getEntry(currentLocale())?.nativeName ?? currentLocale()}
            >
              <span class="text-xs font-medium"
                >{getEntry(currentLocale())?.shortLabel ?? currentLocale()}</span
              >
            </button>
          </div>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
            onclick={() => themeStore.cycleTheme()}
            aria-label={t("settings_toggleTheme")}
            title={themeStore.isDark ? t("layout_themeTitle_dark") : t("layout_themeTitle_light")}
          >
            {#if themeStore.isDark}
              <!-- Moon icon (dark mode active) -->
              <svg
                class="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg
              >
            {:else}
              <!-- Sun icon (light mode active) -->
              <svg
                class="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                ><circle cx="12" cy="12" r="4" /><path
                  d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
                /></svg
              >
            {/if}
          </button>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
            onclick={() =>
              themeStore.setColorScheme(themeStore.colorScheme === "warm" ? "neutral" : "warm")}
            aria-label={t("settings_toggleColorScheme")}
            title={themeStore.colorScheme === "warm"
              ? t("layout_schemeTitle_warm")
              : t("layout_schemeTitle_neutral")}
          >
            <!-- Palette icon -->
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

    <!-- B. Content Panel (only rendered for pages that use it) -->
    {#if needsLayoutContentPanel}
      <div class="sidebar-content-panel">
        <div
          class="sidebar-inner flex flex-col h-full relative"
          class:sidebar-inner-collapsed={!sidebarOpen}
        >
          <!-- Titlebar band spacer (window chrome toolbar overlays this row) -->
          <div class="relative shrink-0 h-[var(--miwarp-titlebar-band)]" aria-hidden="true">
            <WindowDragArea class="absolute inset-0" />
          </div>
          {#if isChatPage}
            <div class="no-drag relative z-10 shrink-0 px-3 pb-2.5 pt-1">
              <input
                type="text"
                bind:value={runSearchQuery}
                oninput={onDeepQueryInput}
                placeholder={t("sidebar_searchChats")}
                class="w-full min-w-0 rounded-full border border-sidebar-border bg-sidebar px-3.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50"
              />
            </div>
          {/if}

          {#if isPluginsPage}
            <!-- Plugin section navigation (replaces Chats/Files when on /plugins) -->
            <div class="flex-1 overflow-y-auto py-2">
              {#each pluginSections as section, i}
                {#if i === 1}
                  <div class="mx-3 my-1 border-t border-sidebar-border"></div>
                {/if}
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
            <!-- Explorer tab bar: Files / Git -->
            <div class="flex shrink-0 border-b border-sidebar-border">
              <button
                type="button"
                class="flex-1 py-1.5 text-xs font-medium text-center transition-colors
              {explorerTab === 'files'
                  ? 'text-sidebar-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-sidebar-foreground'}"
                onclick={() => (explorerTab = "files")}>{t("sidebar_files")}</button
              >
              <button
                type="button"
                class="relative flex-1 py-1.5 text-xs font-medium text-center transition-colors
              {explorerTab === 'git'
                  ? 'text-sidebar-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-sidebar-foreground'}"
                onclick={() => (explorerTab = "git")}
                >{t("sidebar_git")}
                {#if gitSummary && gitSummary.total_files > 0}
                  <span
                    class="ml-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[hsl(var(--miwarp-status-info)/0.8)] px-1 text-[10px] font-bold text-primary-foreground"
                    >{gitSummary.total_files}</span
                  >
                {/if}
              </button>
            </div>

            <!-- Compact project picker (below tabs) -->
            <div class="relative shrink-0 border-b border-sidebar-border">
              <button
                type="button"
                class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors hover:bg-sidebar-accent/50"
                onclick={() => (explorerProjectOpen = !explorerProjectOpen)}
              >
                <svg
                  class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path
                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                  /></svg
                >
                <span class="min-w-0 truncate text-sidebar-foreground"
                  >{projectCwd
                    ? cwdDisplayLabel(projectCwd)
                    : t("sidebar_selectProjectBrowse")}</span
                >
                <Icon
                  name="chevron-down"
                  size="xs"
                  class="ml-auto shrink-0 text-muted-foreground/50 transition-transform {explorerProjectOpen
                    ? 'rotate-180'
                    : ''}"
                />
              </button>
              {#if explorerProjectOpen}
                <div class="border-b border-sidebar-border bg-sidebar">
                  {#each selectableFolders as folder (folder.folderKey)}
                    <button
                      type="button"
                      class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors
                      {folder.cwd === projectCwd
                        ? 'bg-sidebar-accent text-sidebar-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
                      onclick={() => {
                        projectCwd = folder.cwd;
                        explorerProjectOpen = false;
                      }}
                    >
                      <svg
                        class="h-3 w-3 shrink-0 text-muted-foreground/70"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><path
                          d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                        /></svg
                      >
                      <span class="min-w-0 truncate">{cwdDisplayLabel(folder.cwd)}</span>
                    </button>
                  {/each}
                  <button
                    type="button"
                    class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                    onclick={() => {
                      pickFolder();
                      explorerProjectOpen = false;
                    }}
                  >
                    <Icon name="plus" size="xs" class="shrink-0" />
                    <span>{t("project_openFolder")}</span>
                  </button>
                </div>
              {/if}
            </div>

            <!-- Explorer tab content -->
            {#if explorerTab === "files"}
              <div class="flex-1 overflow-y-auto px-1 py-1">
                {#if !projectCwd}
                  {@const lastRemote = getLastTarget()}
                  <EmptyState
                    iconName="folder-open"
                    title={lastRemote
                      ? t("layout_remoteFileTreeUnavailable")
                      : t("sidebar_selectProjectBrowse")}
                    class="py-8"
                  />
                {:else if treeLoading}
                  <div class="flex items-center justify-center py-12">
                    <Spinner size="sm" />
                  </div>
                {:else if fileTree.length === 0}
                  <EmptyState
                    iconName="folder-open"
                    title={t("sidebar_emptyDirectory")}
                    class="py-8"
                  />
                {:else}
                  {@render treeNodes(fileTree)}
                {/if}
              </div>
            {:else}
              <!-- Git tab -->
              {#if !projectCwd}
                <div class="flex-1 flex items-center justify-center px-3">
                  <EmptyState
                    iconName="git-merge"
                    title={t("sidebar_selectProjectGit")}
                    class="py-8"
                  />
                </div>
              {:else if gitLoading}
                <div class="flex-1 flex items-center justify-center">
                  <Spinner size="sm" />
                </div>
              {:else if !gitSummary}
                <div class="flex-1 flex items-center justify-center px-3">
                  <EmptyState iconName="git-merge" title={t("sidebar_notGitRepo")} class="py-8" />
                </div>
              {:else}
                <!-- Branch info -->
                <div
                  class="flex items-center gap-1.5 px-3 py-2 border-b border-sidebar-border shrink-0"
                >
                  <svg
                    class="h-3 w-3 shrink-0 text-muted-foreground"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><circle cx="12" cy="12" r="3" /><line x1="3" x2="9" y1="12" y2="12" /><line
                      x1="15"
                      x2="21"
                      y1="12"
                      y2="12"
                    /></svg
                  >
                  <span class="text-[12px] font-medium text-sidebar-foreground min-w-0 truncate"
                    >{gitSummary.branch || t("sidebar_detached")}</span
                  >
                  <button
                    type="button"
                    class="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                    onclick={loadGitSummary}
                    aria-label={t("sidebar_refresh")}
                    title={t("sidebar_refresh")}
                  >
                    <Icon name="refresh-cw" size="xs" />
                  </button>
                </div>
                <!-- Summary -->
                {#if gitSummary.total_files > 0}
                  <div
                    class="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground border-b border-sidebar-border shrink-0"
                  >
                    <span class="tabular-nums"
                      >{gitSummary.total_files !== 1
                        ? t("sidebar_changedFiles", { count: String(gitSummary.total_files) })
                        : t("sidebar_changedFile", { count: String(gitSummary.total_files) })}</span
                    >
                    {#if gitSummary.total_insertions > 0}
                      <span class="text-miwarp-status-success tabular-nums"
                        >+{gitSummary.total_insertions}</span
                      >
                    {/if}
                    {#if gitSummary.total_deletions > 0}
                      <span class="text-miwarp-status-error tabular-nums"
                        >-{gitSummary.total_deletions}</span
                      >
                    {/if}
                  </div>
                  <!-- Changed files list -->
                  <div class="flex-1 overflow-y-auto">
                    {#each gitSummary.files as file}
                      <button
                        type="button"
                        class="flex w-full items-center gap-1.5 px-3 py-1 text-[12px] hover:bg-sidebar-accent/50 transition-colors"
                        onclick={() => selectDiffFile(file.path)}
                      >
                        <span
                          class="w-3 shrink-0 text-center font-mono text-[10px] font-bold {GIT_STATUS_COLORS[
                            file.status
                          ] ?? 'text-muted-foreground'}">{file.status}</span
                        >
                        <span class="flex-1 min-w-0 truncate text-sidebar-foreground text-left"
                          >{file.path}</span
                        >
                        {#if file.insertions > 0}
                          <span class="text-[10px] text-miwarp-status-success"
                            >+{file.insertions}</span
                          >
                        {/if}
                        {#if file.deletions > 0}
                          <span class="text-[10px] text-miwarp-status-error">-{file.deletions}</span
                          >
                        {/if}
                      </button>
                    {/each}
                  </div>
                {:else}
                  <div class="flex-1 flex items-center justify-center px-3">
                    <div class="flex flex-col items-center gap-1.5 text-center">
                      <Icon name="check" size="md" class="text-muted-foreground/30" />
                      <p class="text-xs text-muted-foreground">{t("sidebar_workingTreeClean")}</p>
                    </div>
                  </div>
                {/if}
              {/if}
            {/if}
          {:else if isMemoryPage}
            <!-- Memory file tree -->
            <div class="flex-1 overflow-y-auto py-1">
              <!-- Project folders (accordion: only one expanded at a time) -->
              {#each selectableFolders as folder (folder.folderKey)}
                <ProjectFolderItem
                  {folder}
                  label={cwdDisplayLabel(folder.cwd)}
                  expanded={folder.cwd === projectCwd}
                  showCount={false}
                  onToggle={() => {
                    projectCwd = projectCwd === folder.cwd ? "" : folder.cwd;
                  }}
                >
                  {#if memoryLoading}
                    <div class="flex items-center justify-center py-6">
                      <Spinner size="sm" />
                    </div>
                  {:else if memoryScopeFolder.length > 0}
                    {#each filterVisibleCandidates(memoryScopeFolder, true, memorySelectedFile) as file}
                      <button
                        type="button"
                        class="flex w-full items-center gap-1.5 py-1 pl-4 pr-3 text-xs transition-colors
                        {memorySelectedFile === file.path
                          ? 'bg-sidebar-accent text-sidebar-foreground'
                          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
                        onclick={() => selectMemoryFile(file)}
                        title={file.path}
                      >
                        <svg
                          class="h-3 w-3 shrink-0 {file.scope === 'memory'
                            ? 'text-miwarp-status-warning'
                            : file.exists
                              ? 'text-miwarp-status-info'
                              : 'text-muted-foreground/40'}"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          ><path
                            d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
                          /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg
                        >
                        <span class="min-w-0 truncate">{file.label}</span>
                        {#if !file.exists}
                          <span class="ml-auto text-[10px] text-muted-foreground shrink-0"
                            >{t("memory_new")}</span
                          >
                        {/if}
                      </button>
                    {/each}
                  {:else}
                    <p class="px-2 py-3 text-xs text-muted-foreground">
                      {t("memory_noProjectFiles")}
                    </p>
                  {/if}
                </ProjectFolderItem>
              {/each}
              <!-- Global scope (MemorySidebarGroup) — deferred chunk, only
                   loaded after the first visit to the memory route. -->
              {#if memorySidebarGroup.Component}
                {@const C = memorySidebarGroup.Component}
                <C
                  candidates={memoryScopeGlobal}
                  selectedFile={memorySelectedFile}
                  loading={memoryLoading}
                  bind:expanded={memoryScopeExpanded}
                  onSelectFile={selectMemoryFile}
                />
              {/if}

              <!-- Open folder button -->
              <button
                type="button"
                class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                onclick={pickFolder}
              >
                <Icon name="plus" size="sm" class="shrink-0" />
                <span>+ {t("project_openFolder")}</span>
              </button>
            </div>
          {:else if isTeamsPage}
            <!-- Teams sidebar -->
            <div class="px-2 pt-2 pb-1 shrink-0">
              <input
                type="text"
                bind:value={teamStoreSearchQuery}
                placeholder={t("sidebar_searchTeams")}
                class="w-full rounded-md border border-sidebar-border bg-sidebar px-2 py-1 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50"
              />
            </div>
            <div class="flex-1 overflow-y-auto px-2 py-1">
              {#if teamStore.loading}
                <div class="flex items-center justify-center py-6">
                  <Spinner size="sm" />
                </div>
              {:else if filteredTeams.length === 0}
                <div class="flex flex-col items-center gap-1 px-3 py-6 text-center">
                  <p class="text-xs text-muted-foreground">{t("sidebar_noActiveTeams")}</p>
                  <p class="text-[10px] text-muted-foreground/60">{t("sidebar_startTeamHint")}</p>
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
          {:else if isChatPage}
            {#if runSearchQuery.trim()}
              <!-- Search results -->
              <div class="sidebar-scroll flex-1 overflow-y-auto">
                {#if searching && visibleSearchResults.length === 0}
                  <div class="flex items-center justify-center py-10">
                    <Spinner size="sm" />
                  </div>
                {:else if !searching && visibleSearchResults.length === 0}
                  <div class="flex items-center justify-center px-3 py-10 text-center">
                    <p class="text-xs text-muted-foreground">{t("runs_noMatching")}</p>
                  </div>
                {:else}
                  {#each visibleSearchResults as result}
                    <button
                      type="button"
                      class="w-full text-left flex flex-col gap-0.5 px-3 py-2 hover:bg-sidebar-accent/50 transition-colors text-sidebar-foreground"
                      onclick={() => {
                        runSearchQuery = "";
                        searchResults = [];
                        goto(
                          `/chat?run=${result.runId}&scrollTo=${encodeURIComponent(result.matchedEventId || result.matchedTs)}`,
                        );
                      }}
                    >
                      <p class="text-[12px] min-w-0 line-clamp-2 break-all">
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html highlightMatch(
                          snippetAround(result.matchedText, runSearchQuery, 80),
                          runSearchQuery,
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
              <!-- Unified project + sub-folder tree -->
              <div class="sidebar-scroll flex-1 overflow-y-auto px-2 py-1">
                {#each enrichedProjectFolders as folder (folder.folderKey)}
                  <ProjectFolderItem
                    {folder}
                    label={folder.isUncategorized
                      ? t("sidebar_uncategorized")
                      : cwdDisplayLabel(folder.cwd)}
                    expanded={expandedProjects.has(folder.folderKey)}
                    {selectedRunId}
                    onToggle={() => toggleProject(folder.folderKey)}
                    onSelectConversation={(runId) => goto(`/chat?run=${runId}`)}
                    onDelete={requestDeleteConversation}
                    onMoveToFolder={requestMoveToFolder}
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
                    {expandedSubFolders}
                    onToggleSubFolder={toggleSubFolder}
                    onCreateSubFolder={folder.isUncategorized
                      ? undefined
                      : () => {
                          _folderCreateCwd = folder.cwd;
                          folderCreateOpen = true;
                          folderCreateName = "";
                        }}
                    onRenameSubFolder={(sf) => {
                      const f = sessionFolders.find((x) => x.id === sf.folderId);
                      if (f) requestRenameFolder(f);
                    }}
                    onDeleteSubFolder={(sf) => {
                      const f = sessionFolders.find((x) => x.id === sf.folderId);
                      if (f) requestDeleteFolder(f);
                    }}
                    dragOverSubFolderKey={dragOverFolderId ? `sf:${dragOverFolderId}` : null}
                    dragOverUnfoldered={dragOverUnfolderedKey === folder.folderKey}
                    {dragRunId}
                    onOpenDirectory={folder.isUncategorized
                      ? undefined
                      : () => {
                          openDirectoryInFinder(folder.cwd).catch((e) =>
                            dbgWarn("layout", "openDirectory failed", e),
                          );
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
        <!-- Resize handle -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[hsl(var(--miwarp-accent-primary)/0.3)] active:bg-[hsl(var(--miwarp-accent-primary)/0.5)] transition-colors z-10"
          onpointerdown={startResize}
        ></div>
      </div>
    {/if}
  </aside>

  <!-- Ghost line during sidebar drag (zero-reflow preview) -->
  {#if sidebarResizing}
    <div
      bind:this={sidebarGhostEl}
      class="fixed top-0 bottom-0 z-[9999] pointer-events-none bg-primary"
      style="left: {sidebarGhostX -
        1}px; width: 3px; box-shadow: 0 0 8px hsl(var(--primary) / 0.6);"
    ></div>
  {/if}

  <!-- Session pointer-drag ghost (not OS file drag — avoids Tauri drag-drop) -->
  {#if dragRunId}
    <div
      class="fixed z-[9999] pointer-events-none max-w-[220px] truncate rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-lg"
      style="left: {sessionDragX + 12}px; top: {sessionDragY + 12}px;"
    >
      {sessionDragLabel}
    </div>
  {/if}

  <!-- Main content -->
  <div class="app-main-shell flex flex-col overflow-hidden relative">
    <!--
      macOS drag region for the main pane.
      Uses pointer-events: none + -webkit-app-region: drag so native macOS
      window drag works WITHOUT blocking any button clicks. TopWindowDrag
      (below) is the global safety net; this element adds redundancy in the
      main content area without interfering with interactive elements.
      Linux/Windows: pointer-events:none means the JS drag handler won't
      fire here, but sidebar spacers still provide drag handles on those
      platforms.
    -->
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
    <!-- Page content: overflow-hidden so route pages own scrolling (chat keeps input in normal flow).
         `miwarp-main-surface` keeps the right pane opaque so the native window
         glass on the left doesn't bleed through to the chat. -->
    <main class="miwarp-main-surface flex-1 min-h-0 overflow-hidden flex flex-col">
      <!-- SvelteKit remounts +page.svelte on route change; a {#key} + fade here
           just stacked a 150ms delay on every /settings → /chat return. -->
      <div class="flex-1 min-h-0 flex flex-col">
        {@render children()}
      </div>
    </main>
  </div>
</div>

<!--
  Global top-of-window drag safety net.

  Sits ABOVE everything as a fixed bar, but is click-through (pointer-events:
  none). On macOS the system reads `-webkit-app-region: drag` before pointer
  events fire, so the window drags from anywhere along the top chrome band even when
  there are buttons underneath. On Linux/Windows this is a no-op overlay and
  the legacy <WindowDragArea> spacers continue to do the work.
-->
<TopWindowDrag height={titlebarBandHeight} leftInset={windowChromeLeftInset} />

<OverlayStack
  bind:commandPaletteOpen
  commandPaletteCwd={projectCwd || "/"}
  onOpenFolderBrowser={pickFolder}
  {showSetupWizard}
  onSetupComplete={handleSetupComplete}
  bind:folderPickerOpen
  {folderPickerInitialHost}
  {folderPickerInitialPath}
  {onFolderPicked}
  {showCliBrowser}
  onCliBrowserClose={() => (showCliBrowser = false)}
  onCliBrowserImported={(runId) => {
    showCliBrowser = false;
    loadRuns();
    goto(`/chat?run=${runId}`);
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
    <C bind:open={permissionsModalOpen} cwd={projectCwd} />
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
      onRemove={workspaceSettingsCwd ? () => requestRemoveProject(workspaceSettingsCwd) : undefined}
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
      bind:folderCreateOpen
      bind:folderCreateName
      onCreateFolder={doCreateFolder}
      bind:folderRenameOpen
      bind:folderRenameName
      onRenameFolder={doRenameFolder}
      bind:folderDeleteOpen
      folderDeleteTargetName={folderDeleteTarget?.name ?? ""}
      onDeleteFolderKeep={() => doDeleteFolder(false)}
      onDeleteFolderCascade={() => doDeleteFolder(true)}
      bind:moveToFolderOpen
      moveToFolderCount={moveToFolderRunIds.length}
      bind:moveToFolderSelectedId
      moveToFolderOptions={foldersForMoveDialog}
      onMoveToFolder={doMoveToFolder}
    />
  {/if}
{/if}

<ToastHost />
