<script lang="ts">
  import { page } from "$app/stores";
  import { get } from "svelte/store";
  import { goto, replaceState, beforeNavigate } from "$app/navigation";
  import { tick, onMount, untrack, getContext } from "svelte";
  import {
    LAYOUT_CHROME_CONTEXT_KEY,
    SETTINGS_CACHE_CONTEXT_KEY,
    type LayoutChromeContext,
    type SettingsCacheContext,
  } from "$lib/layout-chrome-context";
  import { fly } from "svelte/transition";
  import * as api from "$lib/api";
  import {
    sessionStore,
    KeybindingStore,
    getEventMiddleware,
    loadCliInfo,
    getCliCurrentModel,
    loadCliVersionInfo,
  } from "$lib/stores";
  import type { UserSettings, AgentSettings, SessionMode, TimelineEntry } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";
  import { useToolBurstCollapse } from "$lib/chat/use-tool-burst-collapse.svelte";
  import { useTimelineState } from "$lib/chat/use-timeline-state.svelte";
  import { useThinkingTimer } from "$lib/chat/use-thinking-timer.svelte";
  import {
    getLatestTaskNotification,
    shouldShowTopTaskNotificationBanner,
  } from "$lib/chat/task-notification-banner";
  import { useConversationInsight } from "$lib/conversation-insight/use-conversation-insight.svelte";
  import XTerminal from "$lib/components/XTerminal.svelte";
  import SessionStatusBar from "$lib/components/SessionStatusBar.svelte";
  import McpStatusPanel from "$lib/components/McpStatusPanel.svelte";
  import PromptInput from "$lib/components/PromptInput.svelte";
  import { setChatInputHandle } from "$lib/chat/chat-input-registry";
  import { setChatTimelineResetHandle } from "$lib/chat/chat-timeline-reset-registry";

  import ToolActivity from "$lib/components/ToolActivity.svelte";
  import ShortcutHelpPanel from "$lib/components/ShortcutHelpPanel.svelte";
  import type { PromptInputSnapshot } from "$lib/types";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import { t } from "$lib/i18n/index.svelte";
  import { showToast as _showToast } from "$lib/stores/toast-store.svelte";
  import { registerSessionIslandNotify } from "$lib/stores/session-island-notify.svelte";
  import { registerToastListener } from "$lib/stores/toast-store.svelte";
  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
  import { getTransport } from "$lib/transport";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { perfMarkAsync } from "$lib/utils/perf";
  import { setLastTarget, setStoredRemoteCwd } from "$lib/utils/remote-cwd";
  import { shouldTriggerAutoTitle, deriveAutoName } from "$lib/utils/auto-name";
  import { generateRunTitle } from "$lib/api";
  import { normalizeCwd } from "$lib/utils/sidebar-groups";
  import {
    normalizeProcessVisibility,
    getCachedProcessVisibility,
    type ProcessVisibility,
  } from "$lib/utils/process-visibility";
  import {
    normalizeSessionIslandAlignment,
    SESSION_ISLAND_ALIGNMENT_CHANGED_EVENT,
    type SessionIslandAlignment,
  } from "$lib/utils/session-island-alignment";
  import {
    handleVirtualCommand as execVirtualCommand,
    type VirtualCommandContext,
  } from "$lib/chat/use-virtual-commands";
  import { handleTauriDrop as execTauriDrop } from "$lib/chat/handle-tauri-drop";
  import { createPermissionModeHandler } from "$lib/chat/use-permission-mode";
  import { createPermissionHandlers } from "$lib/chat/use-permission-handlers";
  import { createPlatformHandlers } from "$lib/chat/use-platform-handlers";
  import { createChatActions } from "$lib/chat/use-chat-actions";
  import { createForkLifecycle } from "$lib/chat/use-fork-lifecycle";
  import { initLifecycleHandlers } from "$lib/chat/use-lifecycle-handlers";
  import { createScrollNavigation } from "$lib/chat/use-scroll-navigation";
  import { createSendMessage } from "$lib/chat/use-send-message";
  import { createProjectData } from "$lib/chat/use-project-data";
  import { createSessionDerived } from "$lib/chat/use-session-derived.svelte";
  import { createTimelineAnnotations } from "$lib/chat/use-timeline-annotations.svelte";
  import { createTeamDispatch } from "$lib/chat/use-team-dispatch.svelte";
  import { createVerboseState } from "$lib/chat/use-verbose-state.svelte";
  import { createToolResultCache } from "$lib/chat/use-tool-result-cache";
  import { createForkOverlay } from "$lib/chat/use-fork-overlay.svelte";
  import { createModelGuard } from "$lib/chat/use-model-guard.svelte";
  import type { RewindCandidate, RewindMarker } from "$lib/utils/rewind";
  import { truncate } from "$lib/utils/format";
  import { uuid } from "$lib/utils/uuid";
  import ChatDragOverlay from "$lib/components/ChatDragOverlay.svelte";
  import ChatConversationStage from "$lib/components/chat/ChatConversationStage.svelte";
  import ChatInputDock from "$lib/components/chat/ChatInputDock.svelte";
  import WorkspaceOverview from "$lib/components/chat/WorkspaceOverview.svelte";
  import ChatHeroMeta from "$lib/components/ChatHeroMeta.svelte";
  import SplitWorkspace from "$lib/components/split/SplitWorkspace.svelte";
  import SplitSidebarPlaceholder from "$lib/components/split/SplitSidebarPlaceholder.svelte";
  import SplitDropOverlay from "$lib/components/split/SplitDropOverlay.svelte";
  import { splitWorkspaceStore } from "$lib/split";
  import {
    setSplitWorkspaceXtermRef,
    reconcileSplitFromUrl,
    activateSplitPane,
    toggleSplitWorkspace,
    exitSplitWorkspace,
    isSplitUrlSyncLocked,
  } from "$lib/split/split-workspace-lifecycle";
  import { SESSION_DROP_SPLIT_ATTR } from "$lib/utils/session-drag-state";
  import RewindModal from "$lib/components/RewindModal.svelte";
  import FolderPicker from "$lib/components/FolderPicker.svelte";
  import HtmlReportPreview from "$lib/components/insight/HtmlReportPreview.svelte";
  import { getPresets } from "$lib/services/team-dispatcher";
  import {
    chatViewCache,
    saveChatViewState,
    updateLastChatHref,
    getCachedScrollTop,
    getCachedRenderLimit,
  } from "$lib/chat/chat-view-cache.svelte";
  import { snapshotChatBootstrap } from "$lib/chat/chat-bootstrap-cache";
  import {
    ContinuityCapsuleController,
    type ContinuitySaveInput,
    type PendingRestore,
  } from "$lib/chat/continuity-capsule-controller";
  import {
    sanitizeDraft as sanitizeDraftForCapsule,
    type ContinuityAnchor,
    type ContinuityDraft,
  } from "$lib/chat/continuity-capsule";

  // ── Helpers ──

  // ── Layout context ──
  const _toggleLayoutSidebar = getContext<() => void>("toggleSidebar");
  const layoutChrome = getContext<LayoutChromeContext>(LAYOUT_CHROME_CONTEXT_KEY);
  const keybindingStore = getContext<KeybindingStore>("keybindings");
  // v1.0.10 perf: layout already loaded UserSettings in its own onMount; reuse it
  // to skip the ~10-30ms duplicate getUserSettings() IPC at chat-mount time.
  const settingsCache = getContext<SettingsCacheContext | undefined>(SETTINGS_CACHE_CONTEXT_KEY);

  // ── Store + Middleware ──
  const store = sessionStore;
  const middleware = getEventMiddleware();

  // ── UI-only state (not in store) ──
  let middlewareReady = $state(false);
  let settings = $state<UserSettings | null>(null);
  let xtermRef: XTerminal | undefined = $state();
  let promptRef: PromptInput | undefined = $state();
  let sidebarCollapsed = $state(chatViewCache.sidebarCollapsed);

  // Publish the prompt input handle so deep descendants (MermaidInteractive's
  // popover, future slash-menu extras, etc.) can route actions through the
  // live input without prop-drilling. Cleared on unmount via the cleanup.
  $effect(() => {
    const handle = promptRef
      ? {
          setValue: (text: string) => promptRef?.setValue(text),
          focus: () => promptRef?.focus(),
        }
      : undefined;
    setChatInputHandle(handle);
    return () => setChatInputHandle(undefined);
  });

  // Publish a timeline-shrink handle so the layout's newChat click can
  // collapse the visible render window before navigating to /chat?new=1.
  // Without this, runs with >500 messages stall the click while Svelte
  // tears down the existing timeline DOM mid-navigation.
  $effect(() => {
    const handle = {
      shrinkVisibleRender(cap = 24) {
        if (store.timeline.length > cap) {
          tl.setRenderLimit(cap);
        }
      },
    };
    setChatTimelineResetHandle(handle);
    return () => setChatTimelineResetHandle(undefined);
  });

  /** Use server settings when loaded; until then last-known cache avoids a dev-mode flash for Output users.
   *  Modeled as $state + $effect (rather than $derived) so the dependency on
   *  `settings.process_visibility` is established unconditionally — the
   *  ternary `$derived` would skip that branch on first evaluation when
   *  `settings` is still null, leaving the picker stuck on its initial value
   *  after the user switches modes. */
  let processVisibility = $state<ProcessVisibility>(getCachedProcessVisibility());
  $effect(() => {
    const s = settings;
    processVisibility =
      s != null ? normalizeProcessVisibility(s.process_visibility) : getCachedProcessVisibility();
  });

  let sessionIslandAlignmentOverride = $state<SessionIslandAlignment | null>(null);

  const sessionIslandAlignment = $derived(
    sessionIslandAlignmentOverride ??
      (settings != null
        ? normalizeSessionIslandAlignment(settings.session_island_alignment)
        : "center"),
  );

  $effect(() => {
    if (processVisibility === "output") {
      sidebarCollapsed = true;
    }
  });
  /** Reactive cwd override for new-chat-in-folder (cleared when a run is loaded) */
  let folderCwdOverride = $state("");
  let chatAreaRef: HTMLDivElement | undefined = $state();
  let isChatAutoScroll = $state(true);
  /** Latched when user leaves bottom — keeps full layout + overflow-anchor while reading history. */
  let readingHistory = $state(false);
  /** Non-reactive flag: suppresses auto-scroll reset during search scroll-to navigation. */
  let _scrollToInFlight = false;
  /** Non-reactive flag: suppresses auto-scroll during scroll restoration from cache. */
  let restoringScroll = false;
  let showChatScrollHint = $state(false);
  let showScrollButton = $derived(!isChatAutoScroll && store.timeline.length > 0);
  let agentSettings = $state<AgentSettings | null>(null);
  let resuming = $state(false);
  /** Suppress "Session ended" flash during tool approval restart cycle. */
  let approving = $state(false);
  // (pendingResumeText removed — auto-resume uses atomic resume+send via initialMessage)
  /** Most recent run with a session_id — for "Continue last session" on welcome screen. */
  let lastContinuableRun = $state<import("$lib/types").TaskRun | null>(null);
  /** Available remote hosts from settings. */
  let remoteHosts = $state<import("$lib/types").RemoteHost[]>([]);
  /** Auth overview for AuthSourceBadge. */
  let authOverview = $state<import("$lib/types").AuthOverview | null>(null);

  /** Folder picker state — resolves a Promise on confirm/cancel. */
  let folderPickerOpen = $state(false);
  let folderPickerInitialHost = $state<string | null>(null);
  let folderPickerInitialPath = $state("");
  let folderPickerHideTarget = $state(false);
  let folderPickerResolve: ((v: { hostName: string | null; path: string } | null) => void) | null =
    null;
  function openFolderPicker(opts: {
    initialHost?: string | null;
    initialPath?: string;
    hideTargetSelector?: boolean;
  }): Promise<{ hostName: string | null; path: string } | null> {
    folderPickerInitialHost = opts.initialHost ?? null;
    folderPickerInitialPath = opts.initialPath ?? "";
    folderPickerHideTarget = opts.hideTargetSelector ?? false;
    folderPickerOpen = true;
    return new Promise((resolve) => {
      folderPickerResolve = resolve;
    });
  }
  /** Open the system folder picker (Tauri native on desktop, FolderPicker modal
   *  on web) and register the chosen path as a new sidebar workspace. Reuses
   *  the same pipeline as `newChatInFolder` in the layout: writing
   *  ocv:project-cwd + dispatching ocv:cwd-changed triggers the layout's
   *  $effect that pins the cwd into pinnedCwds, refreshes enrichedProjectFolders,
   *  and — via the workspacesStore mirror we just added — also makes the new
   *  workspace appear in the welcome picker and select it as the active cwd. */
  async function addWorkspaceFromPicker() {
    let cwd: string | null = null;
    if (getTransport().isDesktop()) {
      const result = await getTransport().openDialog({
        directory: true,
        multiple: false,
        title: t("chat_addWorkspaceTitle"),
      });
      cwd = typeof result === "string" ? result : null;
    } else {
      const picked = await openFolderPicker({ initialHost: null });
      cwd = picked?.path ?? null;
    }
    if (!cwd) return;
    const normalized = normalizeCwd(cwd);
    if (!normalized) return;
    try {
      localStorage.setItem("ocv:project-cwd", normalized);
    } catch {
      // localStorage may fail in restricted contexts
    }
    window.dispatchEvent(new Event("ocv:cwd-changed"));
    folderCwdOverride = normalized;
    store.sessionCwd = normalized;
  }
  /** Preloaded skill details from filesystem (has descriptions). */
  let preloadedSkills = $state<import("$lib/types").StandaloneSkill[]>([]);
  /** Preloaded agent definitions from filesystem. */
  let preloadedAgents = $state<import("$lib/types").AgentDefinitionSummary[]>([]);
  /** Project-level commands from {cwd}/.claude/commands/ + ~/.claude/commands/. */
  let projectCommands = $state<import("$lib/types").CliCommand[]>([]);
  /** Local proxy running statuses for AuthSourceBadge. */
  let localProxyStatuses = $state<Record<string, { running: boolean; needsAuth: boolean }>>({});

  // ── Project init detection ──
  let projectInitStatus = $state<import("$lib/types").ProjectInitStatus | null>(null);

  // ── Task notification banner ──
  let notificationVisible = $state(false);
  let latestNotification = $state<{ task_id: string; status: string } | null>(null);

  // ── Rewind modal ──
  let rewindModalOpen = $state(false);
  let rewindDirectTarget = $state<RewindCandidate | null>(null);
  let rewindMarkers = $state<RewindMarker[]>([]);

  // Clear direct target on modal close
  $effect(() => {
    if (!rewindModalOpen) rewindDirectTarget = null;
  });

  // ── Team dispatch (composable) ──
  const team = createTeamDispatch({
    store,
    getSendMessage: () => sendMessage,
  });

  // Load presets on mount
  onMount(() => {
    // Register workspace selection callback so sidebar folder expansion
    // triggers the workspace overview in the chat page.
    layoutChrome.onSelectWorkspaceChange?.((cwd: string) => {
      // When a workspace folder is expanded in the sidebar, clear the
      // current session so the workspace overview can display. Navigate
      // to a clean /chat URL with the folder param.
      chatViewCache.lastRunId = "";
      store.loadRun("", xtermRef);
      void goto(`/chat?folder=${encodeURIComponent(cwd)}`);
    });

    getPresets()
      .then((p) => team.setTeamPresets(p))
      .catch((e) => dbgWarn("chat", "getPresets failed:", e));

    // Wire split workspace toast sink — chat page is the only place that
    // owns the i18n + showToast pipeline, so the store just gets the key.
    splitWorkspaceStore.onToast = (key, kind) => {
      _showToast(t(key as never), kind ?? "info");
    };

    setSplitWorkspaceXtermRef(() => xtermRef);
    void reconcileSplitFromUrl(get(page).url.searchParams);

    registerSessionIslandNotify(pushPermissionStatus);

    // Route toast notifications through SessionStatusBar overlay.
    registerToastListener((toast) => {
      toastOverlay = toast;
      toastOverlayVersion = Date.now();
    });

    const onSessionIslandAlignmentChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ alignment?: unknown }>).detail;
      sessionIslandAlignmentOverride = normalizeSessionIslandAlignment(detail?.alignment);
    };
    const onUserSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<UserSettings>).detail;
      if (!detail) return;
      settings = detail;
      sessionIslandAlignmentOverride = null;
    };
    window.addEventListener(
      SESSION_ISLAND_ALIGNMENT_CHANGED_EVENT,
      onSessionIslandAlignmentChanged,
    );
    window.addEventListener(api.USER_SETTINGS_CHANGED_EVENT, onUserSettingsChanged);
    return () => {
      layoutChrome.onSelectWorkspaceChange?.(null);
      setSplitWorkspaceXtermRef(null);
      registerSessionIslandNotify(null);
      registerToastListener(null);
      window.removeEventListener(
        SESSION_ISLAND_ALIGNMENT_CHANGED_EVENT,
        onSessionIslandAlignmentChanged,
      );
      window.removeEventListener(api.USER_SETTINGS_CHANGED_EVENT, onUserSettingsChanged);
    };
  });

  // ── Split workspace integration ──────────────────────────────────────────
  $effect(() => {
    if (isSplitUrlSyncLocked()) return;
    const params = $page.url.searchParams;
    void reconcileSplitFromUrl(params);
  });

  // Auto-name one-shot latch: reset only on actual run ID change
  let prevAutoNameRunId = "";
  let autoNameDone = false;
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== prevAutoNameRunId) {
      prevAutoNameRunId = id;
      autoNameDone = false;
    }
  });

  // Clear markers on run switch (explicit prev-value check)
  let prevRewindRunId = "";
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== prevRewindRunId) {
      prevRewindRunId = id;
      rewindMarkers = [];
    }
  });

  // Lazy: only compute when rewind modal is open (avoids 3 array allocations per timeline change)
  let rewindCandidates = $derived(
    rewindModalOpen
      ? store.timeline
          .map((e, i) => ({ entry: e, idx: i }))
          .filter(
            (
              x,
            ): x is {
              entry: Extract<TimelineEntry, { kind: "user" }> & { cliUuid: string };
              idx: number;
            } => x.entry.kind === "user" && !!x.entry.cliUuid,
          )
          .reverse()
          .map(
            ({ entry, idx }): RewindCandidate => ({
              cliUuid: entry.cliUuid,
              content: entry.content,
              ts: entry.ts,
              timelineIndex: idx,
            }),
          )
      : [],
  );

  // ── BTW side question ──
  let btwState = $state<{
    active: boolean;
    btwId: string | null;
    question: string;
    answer: string;
    error: string | null;
    loading: boolean;
  }>({ active: false, btwId: null, question: "", answer: "", error: null, loading: false });

  // ── Shortcut help panel ──
  let shortcutHelpOpen = $state(false);
  let statusBarRef: SessionStatusBar | undefined = $state();
  let stashedInput: PromptInputSnapshot | null = $state(null);
  let sidebarRequestedTab = $state<ToolActivityPanelTab | null>(null);
  /**
   * Permission-mode notifications are surfaced through the unified
   * SessionStatusBar overlay (same channel as send-status), not via the
   * standalone ToastHost capsule. Bumping the `version` key on each push
   * guarantees the overlay swaps to the new payload even when the text
   * is identical to a previous one.
   */
  let permissionStatusOverlay = $state<{
    payload: import("$lib/chat/send-status-presentation").PermissionStatusInput;
    version: number;
  } | null>(null);
  function pushPermissionStatus(
    payload: import("$lib/chat/send-status-presentation").PermissionStatusInput,
  ): void {
    // Leave `transient` unset so SessionStatusBar's auto-dismiss timer
    // (default 2400ms) clears the overlay and calls back to wipe our
    // local mirror — no sticky banner.
    permissionStatusOverlay = { payload, version: Date.now() };
  }
  function clearPermissionStatusOverlay(): void {
    permissionStatusOverlay = null;
  }

  /**
   * Toast notifications are routed through the unified SessionStatusBar
   * overlay (replaces the standalone ToastHost capsule). The toast store
   * listener pushes toasts here; SessionStatusBar auto-dismisses them.
   */
  let toastOverlay = $state<import("$lib/stores/toast-store.svelte").Toast | null>(null);
  let toastOverlayVersion = $state(0);
  function clearToastOverlay(): void {
    toastOverlay = null;
  }

  let toolPanelActiveTab = $state<ToolActivityPanelTab>(chatViewCache.toolPanelActiveTab);
  let toolPanelIndicators = $state({ context: false, files: false, tasks: false });
  let requestedPreviewPath = $state<string | null>(chatViewCache.requestedPreviewPath);
  let requestedPreviewUrl = $state<string | null>(null);

  function openPreviewForPath(path: string) {
    if (!path) return;
    requestedPreviewPath = path;
    sidebarRequestedTab = "files";
    if (sidebarCollapsed) sidebarCollapsed = false;
  }

  // Clear preview when run changes (defense-in-depth; ToolActivity also clears via its runId effect)
  let _lastPreviewClearRunId = "__unset__";
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== _lastPreviewClearRunId) {
      _lastPreviewClearRunId = id;
      requestedPreviewPath = null;
    }
  });

  // ── Verbose state (composable) ──
  const verbose = createVerboseState();

  // ── Tool result lazy-load cache (composable) ──
  const toolResultCache = createToolResultCache(() => store.run?.id);
  // Clear cache on run switch
  $effect(() => {
    const _ = store.run?.id;
    toolResultCache.clearCache();
  });

  // ── Timeline rendering (composable) ──
  let _suppressLoadMoreRearm = false;
  let loadMoreEarlierRef: () => void = () => {};

  let burstCollapse = useToolBurstCollapse(
    () => tl.toolBursts,
    () => store.run?.id,
  );

  const tl = useTimelineState({
    store,
    burstCollapse,
    getProcessVisibility: () => processVisibility,
    getChatAreaRef: () => chatAreaRef,
    loadMoreEarlier: () => loadMoreEarlierRef(),
  });

  // ── Timeline annotations (composable) ──
  const ta = createTimelineAnnotations({
    store,
    getVisibleTimeline: () => tl.visibleTimeline,
    getFilteredTimeline: () => tl.filteredTimeline,
    getUserCountPrefix: () => tl.userCountPrefix,
    getCollapsedIndices: () => burstCollapse.collapsedIndices,
  });

  // ── Session-derived state (composable) ──
  const sd = createSessionDerived({
    store,
    getSettings: () => settings,
    getAuthOverview: () => authOverview,
    getVisibleTimeline: () => tl.visibleTimeline,
    getPreloadedSkills: () => preloadedSkills,
    timelineAnnotations: ta,
  });

  // ── MCP panel ──
  let mcpPanelOpen = $state(false);

  // ── CLI session browser ──

  // Track status bar expansion for MCP panel offset
  let statusBarExpanded = $state(
    typeof window !== "undefined"
      ? localStorage.getItem("ocv:statusbar-expanded") !== "false"
      : true,
  );

  let currentEffort = $state("");

  // Effort guard: auto-clear effort when model doesn't support it;
  // also auto-populate default effort ("high") when empty and model supports it.
  $effect(() => {
    if (store.agent !== "claude") return;

    const pid = store.platformId;
    // Third-party platform: don't touch effort
    if (pid && pid !== "anthropic") return;

    const modelInfo = sd.effectiveModels.find((m) => m.value === store.model);
    if (!modelInfo) return; // models not loaded yet

    if (currentEffort && modelInfo.supportsEffort === false) {
      // Model doesn't support effort → clear
      dbg("chat", "effort-guard: clearing for unsupported model", { model: store.model });
      currentEffort = "";
      api.updateCliConfig({ effortLevel: null }).catch((e) => {
        dbgWarn("chat", "effort-guard: CLI config clear failed", e);
      });
    } else if (!currentEffort && modelInfo.supportsEffort === true) {
      // No effort set but model supports it → default to "high" (CLI default)
      dbg("chat", "effort-guard: defaulting to high", { model: store.model });
      currentEffort = "high";
      api.updateCliConfig({ effortLevel: "high" }).catch((e) => {
        dbgWarn("chat", "effort-guard: CLI config default failed", e);
      });
    }
  });

  // Auto-focus input on run change
  $effect(() => {
    const _ = store.run?.id;
    requestAnimationFrame(() => promptRef?.focus());
  });

  // Sync verbose state from CLI config when run changes (or on retry)
  $effect(() => {
    const _tick = verbose.verboseRetryTick; // extra dep: drives retry on failure
    verbose.syncVerboseState(store.run?.id);
  });

  // (usage annotations derived values moved to createSessionDerived)

  // ── Fork overlay (composable) ──
  const fork = createForkOverlay({
    store,
    t: t as unknown as (key: string) => string,
  });

  // ── Model guard (composable) ──
  const modelGuard = createModelGuard({
    store,
    getSettings: () => settings,
    getCliCurrentModel,
  });

  // ── Thinking timer + slash command processing (composable) ──
  const thinking = useThinkingTimer({ store });

  // Task notification top banner: active tasks only; always re-arm dismiss timer on map updates
  $effect(() => {
    const notifications = store.taskNotifications;
    if (notifications.size === 0) {
      notificationVisible = false;
      latestNotification = null;
      return;
    }
    const latest = getLatestTaskNotification(notifications);
    if (!latest || !shouldShowTopTaskNotificationBanner(latest)) {
      notificationVisible = false;
      latestNotification = null;
      return;
    }
    latestNotification = { task_id: latest.task_id, status: latest.status };
    notificationVisible = true;
    const timer = setTimeout(() => {
      notificationVisible = false;
    }, 5000);
    return () => clearTimeout(timer);
  });

  // ── URL-derived (primitive values only — avoids $effect re-trigger on unrelated URL changes) ──
  let runId = $derived($page.url.searchParams.get("run") ?? "");
  let hasNewParam = $derived($page.url.searchParams.has("new"));
  let hasResumeParam = $derived($page.url.searchParams.has("resume"));
  let folderParam = $derived($page.url.searchParams.get("folder"));
  let hostParam = $derived($page.url.searchParams.get("host"));
  // Pending logical-folder target from `?sf=<folderId>` (sidebar "new session in
  // folder" entry point). Cleared once consumed so subsequent sessions in the
  // same chat tab default to the workspace root.
  let pendingSubFolderId = $state<string>("");
  $effect(() => {
    const sf = $page.url.searchParams.get("sf");
    if (sf) pendingSubFolderId = sf;
  });

  let routeRunPending = $derived(
    !!runId && tl.loadingRunId === runId && store.run?.id !== runId && !store.error,
  );

  let routeRunLoadFailed = $derived(
    !!runId && store.run?.id !== runId && store.phase === "failed" && !!store.error,
  );

  let welcomeVisible = $derived(
    !runId &&
      !tl.loadingRunId &&
      store.timeline.length === 0 &&
      !store.streamingText &&
      !store.run &&
      store.phase !== "loading",
  );

  /** Effective cwd for the workspace overview panel: shows when a workspace
   *  folder has been selected via sidebar expansion or URL folder param, and
   *  no session is actively loaded (regardless of welcomeVisible, which can
   *  be false due to cached runId redirects before the store populates). */
  let selectedWorkspaceCwd = $state("");
  let workspaceOverviewCwd = $derived(
    !store.run && store.timeline.length === 0 && !store.streamingText
      ? (selectedWorkspaceCwd || folderCwdOverride || "")
      : "",
  );

  // Clear sidebar-selected workspace when a session becomes active so the
  // overview doesn't reappear on navigation back to the welcome screen.
  $effect(() => {
    if (store.run && selectedWorkspaceCwd) {
      selectedWorkspaceCwd = "";
    }
  });

  // Consume ?folder= and/or ?host= params: switch target/folder, then clean URL.
  $effect(() => {
    const folder = folderParam;
    const host = hostParam;
    if (!folder && !host) return;
    untrack(() => {
      dbg("chat", "url params", { folder, host });
      // Validate non-empty host against currently loaded settings. If `remoteHosts`
      // hasn't loaded yet (this effect can fire before onMount finishes settings
      // fetch), fall back to optimistic acceptance — the backend surfaces a
      // "Remote host '...' not found" error if the name is genuinely bogus.
      let resolvedHost: string | null = null;
      if (host !== null) {
        if (host === "") {
          resolvedHost = null; // explicit clear
        } else if (remoteHosts.length === 0 || remoteHosts.some((h) => h.name === host)) {
          resolvedHost = host;
        } else {
          dbgWarn("chat", "URL ?host= references unknown remote — ignoring", { host });
          resolvedHost = null;
        }
        store.remoteHostName = resolvedHost;
        setLastTarget(resolvedHost);
      }
      if (folder) {
        const normalizedFolder = normalizeCwd(folder);
        if (resolvedHost) {
          setStoredRemoteCwd(resolvedHost, normalizedFolder);
        } else if (normalizedFolder) {
          try {
            localStorage.setItem("ocv:project-cwd", normalizedFolder);
          } catch {
            // localStorage may fail in restricted contexts
          }
          window.dispatchEvent(new Event("ocv:cwd-changed"));
        }
        folderCwdOverride = normalizedFolder;
        selectedWorkspaceCwd = normalizedFolder;
        store.sessionCwd = normalizedFolder;
        chatViewCache.lastRunId = "";
        store.loadRun("", xtermRef);
      }
      const clean = new URL($page.url);
      clean.searchParams.delete("folder");
      clean.searchParams.delete("host");
      clean.searchParams.delete("sf");
      replaceState(clean, {});
      requestAnimationFrame(() => promptRef?.focus());
    });
  });

  // ── Computed (thin wrappers for template convenience) ──
  let sending = $derived(store.phase === "spawning");

  // ── Continuity Capsule (v1.0.9 "Trustworthy Reload & Session Continuity") ──
  // Local-first, versioned, capacity-bounded supplement to chat-view-cache
  // that captures per-run state the existing cache does not: unsent drafts,
  // the cwd at save time, the first visible timeline anchor + offset (for
  // stable scroll restoration across reloads), the tool filter, the
  // process visibility, and a per-run Inspector (ToolActivity sidebar)
  // snapshot. Hard rules: never persist tokens / API keys / env values;
  // never persist raw attachment bytes; LRU + 14-day TTL on read; schema
  // versioned; corruption-safe degrade.

  /** Anchor: the first visible timeline row at the time of the last save.
   *  Updated via a rAF-coalesced effect so the DOM read happens off the
   *  hot reactive path. */
  let currentAnchor: ContinuityAnchor | null = $state(null);

  /** Track which run the controller has already applied a restore for.
   *  Latched so repeated effect runs (e.g. during streaming) don't
   *  re-apply the same restore. */
  let _restoreAppliedFor = "";

  /** Last runId observed by the send coordinator reconcile step.
   *  Mirrors `permissionCoordinator.lastActiveRunId` so we don't
   *  reconcile twice on the same navigation. */
  let sendCoordinatorLastActiveRunId: string | null = null;

  function buildDraftFromPrompt(): ContinuityDraft | null {
    const prompt = promptRef;
    if (!prompt || typeof prompt.getInputSnapshot !== "function") return null;
    let snap: PromptInputSnapshot | null = null;
    try {
      snap = prompt.getInputSnapshot() as PromptInputSnapshot;
    } catch (e) {
      dbgWarn("chat", "continuity.snapshot.failed", { error: String(e) });
      return null;
    }
    return sanitizeDraftForCapsule(snap);
  }

  function captureContinuityInput(): ContinuitySaveInput | null {
    const runId = store.run?.id;
    if (!runId) return null;
    return {
      runId,
      cwd: store.effectiveCwd ?? "",
      draft: buildDraftFromPrompt(),
      toolFilter: tl.toolFilter,
      processVisibility,
      anchor: currentAnchor,
      inspector: {
        toolPanelActiveTab,
        requestedPreviewPath: requestedPreviewPath ?? null,
        sidebarCollapsed,
      },
    };
  }

  const continuityController = new ContinuityCapsuleController({
    capture: captureContinuityInput,
    debounceMs: 500,
    onLog: (event, detail) => dbg("continuity", event, detail),
  });

  // Attach on mount; dispose on unmount. The cleanup function is the
  // Svelte 5 idiom for tying resource teardown to the component lifetime.
  $effect(() => {
    continuityController.attach();
    return () => {
      continuityController.flush("dispose");
      continuityController.dispose();
    };
  });

  /** Track the first visible row in the chat area so the controller can
   *  persist a stable anchor (entryId + offset) for scroll restoration.
   *  Coalesced via rAF to avoid DOM thrash on every render. */
  $effect(() => {
    // Touch the dependencies that should trigger a re-read.
    const _timeline = store.timeline;
    const _area = chatAreaRef;
    if (!_area) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      const area = chatAreaRef;
      if (!area) return;
      const rootTop = area.getBoundingClientRect().top + 1;
      const el = area.querySelector<HTMLElement>("[data-entry-id]");
      if (!el) {
        currentAnchor = null;
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= rootTop) {
        currentAnchor = null;
        return;
      }
      const entryId = el.getAttribute("data-entry-id") ?? "";
      if (!entryId) {
        currentAnchor = null;
        return;
      }
      currentAnchor = { entryId, offsetPx: Math.max(0, Math.round(rect.top - rootTop)) };
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  });

  /** Watch high-level save-relevant state and trigger a debounced save.
   *  The prompt text itself is captured at flush time via the controller
   *  (it reads the latest `promptRef.getInputSnapshot()`); we don't
   *  subscribe to the input's per-keystroke $state here. The pagehide
   *  / beforeNavigate / dispose paths guarantee a final flush. */
  $effect(() => {
    const id = store.run?.id;
    if (!id) return;
    // Touch the rest of the state to create $effect dependencies.
    void store.effectiveCwd;
    void tl.toolFilter;
    void tl.renderLimit;
    void toolPanelActiveTab;
    void sidebarCollapsed;
    void requestedPreviewPath;
    void processVisibility;
    void currentAnchor;
    continuityController.scheduleSave(id);
  });

  /** Wrap the team dispatcher's value-change handler so user keystrokes
   *  also trigger a debounced continuity save. The team handler itself
   *  stays untouched; the wrapper keeps the two side-effects orthogonal. */
  function handleInputValueChangeWithContinuity(value: string): void {
    try {
      team.handleInputValueChange(value);
    } finally {
      const id = store.run?.id;
      if (id) continuityController.scheduleSave(id);
    }
  }

  function applyContinuityRestore(runId: string, restore: PendingRestore): void {
    dbg("continuity", "restore.apply", { runId, savedAt: restore.savedAt });
    // Draft first — restores both the visible input and the attachment
    // queue. Empty / null draft is fine (no input state change).
    if (restore.draft) {
      const prompt = promptRef;
      if (prompt?.restoreSnapshot) {
        const snap: PromptInputSnapshot = {
          text: restore.draft.text,
          attachments: restore.draft.attachments,
          pastedBlocks: restore.draft.pastedBlocks,
          pathRefs: restore.draft.pathRefs,
        };
        try {
          prompt.restoreSnapshot(snap);
        } catch (e) {
          dbgWarn("chat", "continuity.restore.draft.failed", { error: String(e) });
        }
      }
    }
    // Tool filter — set after draft so it wins ties.
    if (restore.toolFilter) {
      tl.setToolFilter(restore.toolFilter);
    } else {
      tl.setToolFilter(null);
    }
    // Inspector (right-side panel) — direct assignments; the cache
    // single-source-of-truth pattern still works because these are
    // local $state.
    toolPanelActiveTab = restore.inspector.toolPanelActiveTab;
    requestedPreviewPath = restore.inspector.requestedPreviewPath;
    sidebarCollapsed = restore.inspector.sidebarCollapsed;
    // Anchor: wait for the timeline to populate, then expand renderLimit
    // and scroll. `scrollToMessage` already calls `expandRenderLimitTo`
    // internally; we just need to wait for store.timeline to contain the
    // anchor entry.
    if (restore.anchor) {
      const anchor = restore.anchor;
      // Find the matching entry id in the loaded timeline. If not found
      // after a short grace window, fall back to bottom (no dead loop).
      let attempts = 0;
      const tryRestoreAnchor = () => {
        attempts++;
        const match = store.timeline.find((e) => e.id === anchor.entryId);
        if (match) {
          isChatAutoScroll = false;
          readingHistory = true;
          scrollToMessage(anchor.entryId).catch((e) => {
            dbgWarn("chat", "continuity.anchor.scroll.failed", { error: String(e) });
          });
        } else if (attempts < 6) {
          // Timeline may still be replaying events. Try a few more times
          // before giving up.
          setTimeout(tryRestoreAnchor, 80);
        } else {
          dbg("continuity", "restore.anchor.missing", { entryId: anchor.entryId });
          // Anchor not found — fall back to bottom.
          requestAnimationFrame(() => {
            if (chatAreaRef) chatAreaRef.scrollTop = chatAreaRef.scrollHeight;
            isChatAutoScroll = true;
            readingHistory = false;
          });
        }
      };
      tryRestoreAnchor();
    }
  }

  // Watch runId changes → load run + subscribe middleware
  // Gated on middlewareReady to ensure listeners are registered before subscribing
  $effect(() => {
    if (!middlewareReady) return;
    const id = runId;
    const hasResume = hasResumeParam;
    const isNewChat = hasNewParam;
    untrack(() => {
      middleware.subscribeCurrent(id, store);

      // ── Permission coordinator reconcile ──
      // The active run is the source of truth for permission request
      // identity. When the user switches runs we cancel any in-flight
      // permission responses whose captured runId no longer matches.
      // Bump generation so late responses can be detected as stale.
      const previousRunId = permissionCoordinator.lastActiveRunId;
      if (previousRunId !== id) {
        permissionCoordinator.reconcileActiveRun(id);
        permissionCoordinator.bumpGeneration();
        permissionCoordinator.lastActiveRunId = id;
      }

      // ── Send coordinator reconcile ──
      // Mirror the permission coordinator pattern: when the user switches
      // runs, any in-flight submit that captured a stale runId must be
      // cancelled (rejection surfaces a `stale_identity` failure so the
      // draft can be restored). Without this, the previous run's pending
      // transport promise could resolve against the new run's UI and
      // race the next submit. See `SendCoordinator.cancelForRun` and
      // `SendCoordinator.reconcileActiveRun`.
      const previousSendRunId = sendCoordinatorLastActiveRunId;
      if (previousSendRunId !== id) {
        if (previousSendRunId) {
          send.coordinator.cancelForRun(previousSendRunId, "Run switched");
        }
        send.coordinator.reconcileActiveRun(id);
        sendCoordinatorLastActiveRunId = id;
      }

      // Strongest guard: resume operation in progress — don't interfere.
      // Check both store guard (set inside resumeSession) and local flag
      // (set at handleResume entry, before store guard is acquired).
      if (store.resumeInFlight || resuming) {
        dbg("effect", "skip loadRun — resume in progress");
        return;
      }
      // Resume $effect will handle this case
      if (hasResume) return;

      if (!id) {
        // Case 1: explicit new chat (?new=1) → start empty
        if (isNewChat) {
          // Flush + drop the previous run's pending debounce; the previous
          // run's capsule entry is intentionally preserved so a reload of
          // the old run still restores its draft.
          const prev = store.run?.id;
          if (prev) continuityController.flush("manual", prev);
          continuityController.switchRun("");
          _restoreAppliedFor = "";
          chatViewCache.lastRunId = "";
          store.loadRun("", xtermRef);
          cancelProgressive();
          return;
        }

        // Case 2: no run in URL but cached run exists → redirect to it
        const cachedRunId = chatViewCache.lastRunId;
        if (cachedRunId) {
          replaceState(`/chat?run=${cachedRunId}`, {});
          return;
        }

        // Case 3: store already has a run with timeline → preserve it (navigation return)
        if (store.run?.id && store.timeline.length > 0) {
          dbg("effect", "restoring chat state from store", { runId: store.run.id });
          // Restore UI state from cache
          const cachedTab = chatViewCache.toolPanelActiveTab;
          if (cachedTab) toolPanelActiveTab = cachedTab;
          const cachedCollapsed = chatViewCache.sidebarCollapsed;
          sidebarCollapsed = cachedCollapsed;
          const cachedPreview = chatViewCache.requestedPreviewPath;
          if (cachedPreview) {
            requestedPreviewPath = cachedPreview;
            sidebarRequestedTab = "files";
          }
          const cachedRenderLimit = getCachedRenderLimit(store.run.id);
          if (cachedRenderLimit !== undefined) {
            tl.setRenderLimit(cachedRenderLimit);
          }
          // Restore scroll position
          restoringScroll = true;
          isChatAutoScroll = false;
          readingHistory = true;
          tick().then(() => {
            requestAnimationFrame(() => {
              if (chatAreaRef) {
                const cachedScroll = getCachedScrollTop(store.run!.id);
                chatAreaRef.scrollTop = cachedScroll;
              }
              restoringScroll = false;
            });
          });
          // Re-attach the controller to the in-memory run (navigation
          // return path) so subsequent typing saves land in its capsule
          // entry.
          continuityController.switchRun(store.run.id);
          return;
        }

        // Case 4: truly empty → new empty run
        continuityController.switchRun("");
        _restoreAppliedFor = "";
        store.loadRun("", xtermRef);
        cancelProgressive();
        return;
      }

      // Update lastChatHref when navigating to a run URL
      updateLastChatHref(id, $page.url.href);

      // Flush the previous run before switching so its latest state is
      // captured in the capsule (the conservative "save on leave" path
      // complements the pagehide/beforeNavigate flush).
      const prev = continuityController.__getCurrentRunId();
      if (prev && prev !== id) {
        continuityController.flush("manual", prev);
        continuityController.switchRun(id);
      } else if (!prev) {
        continuityController.switchRun(id);
      }
      // Seed the pending restore for the new run id (one-shot). If the
      // user navigates to a different run before consume, the latch
      // clears it via switchRun → noApplyPendingRestore path.
      void continuityController.seedAsync(id).then((ready) => {
        if (!ready) {
          // No capsule entry → no restore, just clear the latch so a
          // later reload of the same run can re-seed.
          _restoreAppliedFor = id;
        }
      });

      // If store already holds an active session for this run, skip redundant loadRun
      if (store.run?.id === id && (store.sessionAlive || store.resumeInFlight)) {
        dbg("effect", "skip loadRun — session already alive or resume in flight for", id);
        const scrollTo = $page.url.searchParams.get("scrollTo");
        if (scrollTo) {
          const clean = new URL($page.url);
          clean.searchParams.delete("scrollTo");
          replaceState(clean, {});
          tick().then(() => scrollToMessage(scrollTo));
        }
        return;
      }

      void perfMarkAsync("session.switchToInteractive", () => loadRunProgressive(id, xtermRef), {
        runKind: id ? "switch" : "new",
      });
    });
  });

  /** Apply a pending continuity restore once the run is loaded and the
   *  timeline contains the anchor entry. The effect re-runs whenever
   *  store.run.id or the timeline length changes; the `_restoreAppliedFor`
   *  latch ensures we apply the restore exactly once per run id. */
  $effect(() => {
    const id = store.run?.id;
    if (!id) return;
    if (_restoreAppliedFor === id) return;
    if (tl.loadingRunId) return; // still loading
    if (store.phase === "loading") return;
    if (store.timeline.length === 0) return;
    const restore = continuityController.consumePendingRestore();
    _restoreAppliedFor = id;
    if (restore && restore.runId === id) {
      applyContinuityRestore(id, restore);
    }
  });

  // Handle scrollTo for already-loaded runs (e.g., clicking a second search result
  // in the same run). The runId effect above won't re-fire when only scrollTo changes.
  $effect(() => {
    if (!middlewareReady) return;
    const scrollTo = $page.url.searchParams.get("scrollTo");
    if (!scrollTo) return;
    untrack(() => {
      // loadRunProgressive handles scrollTo during run loading — don't double-scroll
      if (_scrollToInFlight) return;
      if (store.phase === "loading") return;
      if (store.run?.id !== runId) return;

      dbg("effect", "same-run scrollTo", { scrollTo, runId });
      _scrollToInFlight = true;
      const clean = new URL($page.url);
      clean.searchParams.delete("scrollTo");
      replaceState(clean, {});
      tick().then(() => {
        scrollToMessage(scrollTo);
        _scrollToInFlight = false;
      });
    });
  });

  // Consume ?resume= URL param for session resume via sidebar button
  $effect(() => {
    const url = $page.url;
    const paramRunId = url.searchParams.get("run");
    const resumeMode = url.searchParams.get("resume") as SessionMode | null;

    if (paramRunId && resumeMode) {
      // Clean URL immediately to prevent re-trigger on refresh
      const clean = new URL(url);
      clean.searchParams.delete("resume");
      replaceState(clean, {});

      untrack(() => {
        handleResume(resumeMode, paramRunId);
      });
    }
  });

  // Auto-scroll chat (only when user is near bottom)
  let prevTl = 0;
  let prevSt = 0;

  $effect(() => {
    if (store.useStreamSession && chatAreaRef) {
      const tl = store.timeline.length;
      const st = store.streamingText.length;
      const _rid = store.run?.id;
      const tlChanged = tl !== prevTl;
      const stChanged = st !== prevSt;
      prevTl = tl;
      prevSt = st;
      if (!tlChanged && !stChanged) return;

      if (isChatAutoScroll && !readingHistory) {
        if (tlChanged) {
          requestAnimationFrame(() => {
            if (chatAreaRef && isChatAutoScroll && !readingHistory) {
              pinChatToBottom();
            }
          });
        } else if (stChanged) {
          followChatBottom();
        }
      } else {
        showChatScrollHint = true;
      }
    }
  });

  // Reset scroll state on run change
  $effect(() => {
    void store.run?.id;
    // _scrollToInFlight is non-reactive (plain let): reading it doesn't create a dependency.
    // When a search scroll-to navigation is in progress, suppress auto-scroll so
    // scrollToMessage isn't overridden by the auto-scroll $effect.
    // restoringScroll is also non-reactive — don't override it during cache restoration.
    if (!restoringScroll) {
      isChatAutoScroll = !_scrollToInFlight;
      readingHistory = false;
    }
    showChatScrollHint = false;
    prevTl = 0;
    prevSt = 0;
  });

  // ── Terminal helpers ──

  function handleTermReady(_cols: number, _rows: number) {
    // Terminal ready — Codex pipe mode is output-only, no setup needed
  }

  function handleTermResize(_cols: number, _rows: number) {
    // Codex pipe mode doesn't need resize — terminal is output-only
  }

  // ── Permission pending auto-scroll (inline cards in timeline) ──
  let prevPermissionRunId = "";
  let prevHadPermission = false;

  $effect(() => {
    const runId = store.run?.id ?? "";
    const needsApproval = store.hasPendingPermission;

    if (runId !== prevPermissionRunId) {
      prevPermissionRunId = runId;
      prevHadPermission = false;
    }

    if (needsApproval && !prevHadPermission) {
      if (!chatAreaRef || readingHistory) return;
      requestAnimationFrame(() => {
        if (!readingHistory) scrollChatToBottom();
      });
      dbg("chat", "permission pending -> autoscroll to inline card", { runId });
    }

    prevHadPermission = needsApproval;
  });

  // ── Pending tool permission log ──
  let _prevPanelCount = 0;
  $effect(() => {
    const count = sd.pendingToolPermissions.length;
    if (count !== _prevPanelCount) {
      if (count > 0)
        dbg("chat", "inline tool permissions pending", {
          count,
          ids: sd.pendingToolPermissions.map((p) => p.requestId),
          tools: sd.pendingToolPermissions.map((p) => p.tool.tool_name),
        });
      else if (_prevPanelCount > 0) dbg("chat", "inline tool permissions cleared");
      _prevPanelCount = count;
    }
  });

  // ── Send message ──

  // ── Project init detection ──
  let showInitHint = $derived(
    projectInitStatus !== null && !projectInitStatus.has_claude_md && !store.run,
  );

  const { reloadProjectData, checkProjectInit, dismissInitHint } = createProjectData({
    store,
    setPreloadedSkills: (v) => {
      preloadedSkills = v;
    },
    setPreloadedAgents: (v) => {
      preloadedAgents = v;
    },
    setProjectCommands: (v) => {
      projectCommands = v;
    },
    getProjectInitStatus: () => projectInitStatus,
    setProjectInitStatus: (v) => {
      projectInitStatus = v;
    },
  });

  // ── Permission mode name translation ──

  function getPermModeLabel(mode: string): string {
    const map: Record<string, () => string> = {
      default: () => t("prompt_permAskShort"),
      acceptEdits: () => t("prompt_permAutoReadShort"),
      bypassPermissions: () => t("prompt_permAutoAllShort"),
      plan: () => t("prompt_permPlanShort"),
      auto: () => t("prompt_permAutoShort"),
      dontAsk: () => t("prompt_permDontAskShort"),
    };
    return map[mode]?.() ?? mode;
  }

  const handlePermissionModeChange = createPermissionModeHandler({
    store,
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
    showPermissionStatus: pushPermissionStatus,
    getPermModeLabel,
  });

  const {
    handleToolApprove,
    handlePermissionRespond,
    handleElicitationRespond,
    getPlanContentForExitPlan,
    handleExitPlanClearContext,
    handleExitPlanBypass,
    handleHookCallbackRespond,
    permissionCoordinator,
  } = createPermissionHandlers({
    store,
    get timelineIdIndex() {
      return tl.timelineIdIndex;
    },
    setApproving: (v: boolean) => {
      approving = v;
    },
    goto,
    tick,
  });

  const {
    handleModelChange,
    handleEffortChange,
    handleAuthModeChange,
    checkAllLocalProxies,
    handlePlatformChange,
  } = createPlatformHandlers({
    store,
    getSettings: () => settings,
    getCurrentEffort: () => currentEffort,
    setCurrentEffort: (v: string) => {
      currentEffort = v;
    },
    setLastKnownGoodModel: modelGuard.setLastKnownGoodModel,
    setAuthOverview: (v) => {
      authOverview = v;
    },
    setLocalProxyStatuses: (v) => {
      localProxyStatuses = v;
    },
    getCliCurrentModel,
  });

  const scrollNav = createScrollNavigation({
    store,
    tick,
    getChatAreaRef: () => chatAreaRef,
    getFilteredTimeline: () => tl.filteredTimeline,
    getVisibleTimeline: () => tl.visibleTimeline,
    getToolBursts: () => tl.toolBursts,
    burstCollapse,
    getProcessVisibility: () => processVisibility,
    getRenderLimit: () => tl.renderLimit,
    setRenderLimit: tl.setRenderLimit,
    getToolFilter: () => tl.toolFilter,
    setToolFilter: tl.setToolFilter,
    getLoadingRunId: () => tl.loadingRunId,
    setLoadingRunId: tl.setLoadingRunId,
    getLoadingMore: () => tl.loadingMore,
    setLoadingMore: tl.setLoadingMore,
    getLoadMoreArmed: () => tl.loadMoreArmed,
    setLoadMoreArmed: tl.setLoadMoreArmed,
    setIsChatAutoScroll: (v: boolean) => {
      isChatAutoScroll = v;
    },
    getIsChatAutoScroll: () => isChatAutoScroll,
    setShowChatScrollHint: (v: boolean) => {
      showChatScrollHint = v;
    },
    getScrollToInFlight: () => _scrollToInFlight,
    setScrollToInFlight: (v: boolean) => {
      _scrollToInFlight = v;
    },
    getSuppressLoadMoreRearm: () => _suppressLoadMoreRearm,
    setSuppressLoadMoreRearm: (v: boolean) => {
      _suppressLoadMoreRearm = v;
    },
    setReadingHistory: (v: boolean) => {
      readingHistory = v;
    },
    setFolderCwdOverride: (v: string) => {
      folderCwdOverride = v;
    },
    reloadProjectData,
    getPageUrl: () => $page.url,
    replaceState,
  });

  // Wire deferred callback for circular dependency (useTimelineState → scrollNav)
  loadMoreEarlierRef = scrollNav.loadMoreEarlier;

  const {
    cancelProgressive,
    loadMoreEarlier: _loadMoreEarlier,
    loadRunProgressive,
    handleChatScroll,
    handleChatWheel,
    pinChatToBottom,
    followChatBottom,
    scrollChatToBottom,
    scrollToTool,
    scrollToMessage,
  } = scrollNav;

  const chatActions = createChatActions({
    store,
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
    showToast: _showToast,
    setBtwState: (v) => {
      btwState = v;
    },
    setVerboseEnabled: (v) => {
      verbose.verboseEnabled = v;
    },
    setRequestedPreviewUrl: (v) => {
      requestedPreviewUrl = v;
    },
    setSidebarRequestedTab: (v) => {
      sidebarRequestedTab = v;
    },
    getSidebarCollapsed: () => sidebarCollapsed,
    setSidebarCollapsed: (v) => {
      sidebarCollapsed = v;
    },
    getSettings: () => settings,
    setSettings: (v) => {
      settings = v;
      sessionIslandAlignmentOverride = null;
    },
    getPromptRef: () => promptRef,
  });

  const {
    appendCommandOutput,
    handleSummarize,
    handleRename,
    handleFastModeSwitch,
    handleBtwSend,
    openPreviewInSidebar,
    handleRalphCancel,
    handleStop,
    fillPrompt,
    toggleCliConfigBool,
    handleProcessVisibilityChange,
  } = chatActions;

  const forkLifecycle = createForkLifecycle({
    store,
    middleware,
    goto,
    loadRunProgressive,
    getResuming: () => resuming,
    setResuming: (v: boolean) => {
      resuming = v;
    },
    getForkOverlay: () => fork.forkOverlay,
    setForkOverlay: (v) => {
      fork.setForkOverlay(v);
    },
    setLastContinuableRun: (v) => {
      lastContinuableRun = v;
    },
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
  });

  const { handleResume, handleForkCancel, handleForkRetry } = forkLifecycle;

  // Auto-name: after first idle, ask Claude once for a concise title (fallback: prompt excerpt)
  $effect(() => {
    const shouldStart = shouldTriggerAutoTitle({
      phase: store.phase,
      runId: store.run?.id,
      runName: store.run?.name,
      prompt: store.run?.prompt,
      autoNameDone,
    });
    if (!shouldStart) return;

    const runId = store.run?.id;
    const prompt = store.run?.prompt?.trim() ?? "";
    if (!runId || !prompt) return;

    autoNameDone = true;
    void generateRunTitle(runId)
      .then((title) => {
        const resolved = title.trim() || deriveAutoName(prompt);
        if (resolved) handleRename(resolved);
      })
      .catch(() => {
        const fallback = deriveAutoName(prompt);
        if (fallback) handleRename(fallback);
      });
  });

  async function handleVirtualCommand(action: string, args: string) {
    const ctx: VirtualCommandContext = {
      store,
      appendCommandOutput,
      sendMessage,
      handleRename,
      handlePermissionModeChange,
      handleFastModeSwitch,
      handleRalphCancel,
      handleRewind,
      openPreviewInSidebar,
      toggleSidebar,
      get sidebarCollapsed() {
        return sidebarCollapsed;
      },
      set sidebarCollapsed(v: boolean) {
        sidebarCollapsed = v;
      },
      get sidebarRequestedTab() {
        return sidebarRequestedTab;
      },
      set sidebarRequestedTab(v: unknown) {
        sidebarRequestedTab = v as ToolActivityPanelTab | null;
      },
      goto,
      projectCommands,
      t: t as unknown as VirtualCommandContext["t"],
    };
    await execVirtualCommand(ctx, action, args);
  }

  beforeNavigate(({ to }) => {
    saveChatViewState({
      runId: store.run?.id ?? "",
      scrollTop: chatAreaRef?.scrollTop ?? 0,
      toolPanelActiveTab,
      sidebarCollapsed,
      requestedPreviewPath,
      renderLimit: tl.renderLimit,
    });
    // Flush the continuity capsule so the next reload sees the latest
    // draft / anchor / inspector state. Synchronous localStorage write
    // is fine here — the page is about to be torn down.
    continuityController.flush("beforeNavigate");
    if (to?.url.pathname.startsWith("/settings") && settings) {
      snapshotChatBootstrap(settings, agentSettings);
    }
    // Leaving chat entirely: exit split mode so the next entry sees a clean
    // store. When staying inside chat (e.g. switching run within the same
    // route), the split workspace's own $effect handles the toggle.
    if (!to || !to.url.pathname.startsWith("/chat")) {
      void exitSplitWorkspace({ restoreRun: false });
    }
  });

  const insight = useConversationInsight({
    getRun: () => store.run,
    getTimeline: () => store.timeline,
    getUsage: () => store.usage,
    getNumTurns: () => store.numTurns || 0,
    showToast: _showToast,
  });

  const send = createSendMessage({
    store,
    thinking,
    getRemoteHosts: () => remoteHosts,
    showToast: _showToast,
    openFolderPicker,
    handleResume,
    loadCliVersionInfo,
    promptInputRef: () => promptRef,
    getPromptRef: () => promptRef,
    goto,
    setIsChatAutoScroll: (v) => {
      isChatAutoScroll = v;
    },
    setShowChatScrollHint: (v) => {
      showChatScrollHint = v;
    },
    setTeamDispatchPrompt: (v) => {
      team.setTeamDispatchPrompt(v);
    },
    setTeamDispatchOpen: (v) => {
      team.setTeamDispatchOpen(v);
    },
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
    getFolderCwdOverride: () => folderCwdOverride,
    /** Consume the pending logical-folder id (?sf=) once, then clear so the
     *  next session in the same chat tab falls back to the workspace root. */
    consumePendingSubFolderId: () => {
      const v = pendingSubFolderId;
      pendingSubFolderId = "";
      return v;
    },
  });

  // Backward-compatible alias — many internal call sites still reference
  // `sendMessage` directly. The new handle returns a richer object; we
  // expose `.sendMessage` so legacy code keeps compiling.
  const sendMessage = send.sendMessage;

  /**
   * v1.0.9: re-submit a failed send with a fresh client message id. The
   * captured draft snapshot is passed in via the status event; we resolve
   * the current prompt text and let the regular send path take over.
   */
  function handleSendRetry(event: { runId: string; clientMessageId: string }): void {
    const prompt = promptRef;
    if (!prompt?.getInputSnapshot) return;
    const draft = prompt.getInputSnapshot() as { text: string; attachments?: unknown[] };
    const text = (draft.text ?? "").trim();
    if (!text) return;
    const attachments = (draft.attachments ?? []).filter(
      (a): a is import("$lib/types").Attachment =>
        typeof a === "object" && a !== null && "contentBase64" in a,
    );
    void sendMessage(text, attachments).catch((e) => {
      dbgWarn("chat", "send.retry.failed", { error: String(e) });
    });
  }

  // Chat keybinding callbacks — registered/unregistered via keybindingStore in onMount below

  // ── Page-level drag-drop (Tauri native events) ──
  let pageDragActive = $state(false);
  let dragProcessingCount = $state(0);
  let dragProcessing = $derived(dragProcessingCount > 0);

  async function _handleTauriDrop(payload: { paths: string[] }) {
    const input = promptRef; // cache ref — promptRef may become undefined after awaits
    if (!input) return;
    await execTauriDrop(
      {
        promptRef: input,
        t: t as unknown as (key: string, params?: Record<string, string>) => string,
        onDragEnd: () => (pageDragActive = false),
        onProcessingStart: () => dragProcessingCount++,
        onProcessingEnd: () => dragProcessingCount--,
      },
      payload,
    );
  }

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
  }

  async function handleToolAnswer(toolUseId: string, answer: string) {
    await store.answerToolQuestion(toolUseId, answer);
  }

  function handleRewind() {
    if (!store.run || !store.sessionAlive || store.isRunning) return;
    rewindModalOpen = true;
  }

  function handleRewindToMessage(entry: { cliUuid: string; content: string; ts: string }) {
    if (!store.run || !store.sessionAlive || store.isRunning) return;
    rewindDirectTarget = {
      cliUuid: entry.cliUuid,
      content: entry.content,
      ts: entry.ts,
      timelineIndex: store.timeline.findIndex(
        (e) => e.kind === "user" && e.cliUuid === entry.cliUuid,
      ),
    };
    rewindModalOpen = true;
  }

  // ── Initialize lifecycle handlers (replaces 8 onMount blocks) ──
  initLifecycleHandlers({
    store,
    middleware,
    keybindingStore,
    // v1.0.10 perf: forward the layout-cached settings handle so init()
    // can skip the cold getUserSettings() IPC when layout already loaded.
    getSettingsCache: () => settingsCache,
    getSettings: () => settings,
    setSettings: (v) => {
      settings = v;
      sessionIslandAlignmentOverride = null;
    },
    setRemoteHosts: (v) => {
      remoteHosts = v;
    },
    setAuthOverview: (v) => {
      authOverview = v;
    },
    checkAllLocalProxies,
    getAgentSettings: () => agentSettings,
    setAgentSettings: (v) => {
      agentSettings = v;
    },
    setCurrentEffort: (v) => {
      currentEffort = v;
    },
    handlePermissionModeChange,
    getPermModeLabel,
    loadCliInfo,
    getCliCurrentModel,
    loadCliVersionInfo,
    isContaminatedDefaultModel: modelGuard.isContaminatedDefaultModel,
    setLastKnownGoodModel: modelGuard.setLastKnownGoodModel,
    checkProjectInit,
    reloadProjectData,
    getShortcutHelpOpen: () => shortcutHelpOpen,
    setShortcutHelpOpen: (v) => {
      shortcutHelpOpen = v;
    },
    getStatusBarRef: () => statusBarRef,
    getStashedInput: () => stashedInput,
    setStashedInput: (v) => {
      stashedInput = v;
    },
    getPromptRef: () => promptRef,
    setStatusBarExpanded: (v) => {
      statusBarExpanded = v;
    },
    getSidebarCollapsed: () => sidebarCollapsed,
    setSidebarCollapsed: (v) => {
      sidebarCollapsed = v;
    },
    setSidebarRequestedTab: (v) => {
      sidebarRequestedTab = v;
    },
    setShowChatToast: _showToast,
    setPageDragActive: (v) => {
      pageDragActive = v;
    },
    setDragProcessingCount: (fn) => {
      dragProcessingCount = fn(dragProcessingCount);
    },
    getXtermRef: () => xtermRef,
    getBtwState: () => btwState,
    setBtwState: (v) => {
      btwState = v;
    },
    contextHistoryMap: sd.contextHistoryMap,
    triggerContextHistoryReactivity: () => {
      sd.setContextHistoryMap(new Map(sd.contextHistoryMap));
    },
    getRunId: () => runId,
    setLastContinuableRun: (v) => {
      lastContinuableRun = v;
    },
    setMiddlewareReady: (v) => {
      middlewareReady = v;
    },
    setAutoNameDone: (v) => {
      autoNameDone = v;
    },
    getForkOverlay: () => fork.forkOverlay,
    cleanupVerbose: () => verbose.cleanupVerbose(),
    cancelProgressive,
    handleSummarize,
    handleRewind,
    toggleCliConfigBool,
    goto,
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
  });
</script>

{#snippet heroMetaFooterContent()}
  <div class="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/40">
    <ChatHeroMeta
      cliVersionInfo={sd.cliVersionInfo}
      channelLatest={sd.channelLatest}
      {remoteHosts}
      currentRemoteHostName={store.remoteHostName}
      onTargetChange={(hostName) => {
        store.remoteHostName = hostName;
        setLastTarget(hostName);
      }}
      onNavigate={goto}
    />
  </div>
{/snippet}

<!-- v1.0.10: chat input dock lives OUTSIDE ChatConversationStage so it stays
     mounted when the conversation body (welcome ↔ timeline) swaps. The
     dock is absolutely positioned and overlays the bottom of the chat pane;
     CSS variables on the `.chat-pane` ancestor sync dock height to the
     timeline's bottom padding without forcing a remount. -->
{#snippet chatInputDock()}
  <ChatInputDock
    {store}
    {settings}
    inputVm={{
      processVisibility,
      agentSettings,
      effectiveModels: sd.effectiveModels,
      folderCwdOverride,
      welcomeVisible,
      skillItems: sd.skillItems,
      preloadedAgents,
      teamHintVisible: team.teamHintVisible,
      userHistory: sd.userHistory,
      projectCommands,
      authOverview,
      localProxyStatuses,
    }}
    permissionVm={{
      pendingToolPermissions: sd.pendingToolPermissions,
      inputBlockedByPermission: sd.inputBlockedByPermission,
    }}
    sidePanelsVm={{
      btwState,
      insight,
      hasCreatedFiles: tl.hasCreatedFiles,
      createdFiles: tl.createdFiles,
      setBtwState: (v) => {
        btwState = v;
      },
    }}
    handlers={{
      sendMessage,
      handleModelChange,
      handlePermissionModeChange,
      handleVirtualCommand,
      handleFastModeSwitch,
      handlePlatformChange,
      handleAuthModeChange,
      handleInputValueChange: handleInputValueChangeWithContinuity,
      handlePermissionRespond,
      handleElicitationRespond,
      handleBtwSend,
      handleRalphCancel,
      showChatToast: _showToast,
    }}
    sendBusy={send.inFlight}
    bind:stashedInput
    bind:shortcutHelpOpen
    bind:promptRef
  />
{/snippet}

<div class="relative flex h-full overflow-hidden bg-background">
  <!-- Page-level drag overlay (drag-hover or processing spinner) -->
  <ChatDragOverlay {pageDragActive} {dragProcessing} />

  <!-- Split-pane drop target — always mounted so a first-time card drop
       can enter split mode on the fly. The component is fixed-position
       and only renders a visual hint while a split drag is in flight. -->
  <SplitDropOverlay />

  <!-- Main content area -->
  <div
    class="chat-pane flex flex-1 flex-col min-w-0 relative"
    {...{ [SESSION_DROP_SPLIT_ATTR]: "true" }}
  >
    <!-- Status bar -->
    <SessionStatusBar
      bind:this={statusBarRef}
      running={store.sessionAlive}
      taskRunning={store.isRunning}
      taskWaiting={store.taskWaiting}
      sessionPhase={store.phase}
      run={store.run}
      agent={store.run?.agent ?? store.agent}
      model={store.model}
      cost={store.usage.cost}
      inputTokens={sd.cumulativeTokens.input}
      outputTokens={sd.cumulativeTokens.output}
      cacheReadTokens={sd.cumulativeTokens.cacheRead}
      cacheWriteTokens={sd.cumulativeTokens.cacheWrite}
      parentRunId={store.run?.parent_run_id}
      onEndSession={handleStop}
      onModelChange={handleModelChange}
      effort={store.features.effortSelector ? currentEffort : undefined}
      onEffortChange={store.features.effortSelector ? handleEffortChange : undefined}
      onNavigateParent={store.run?.parent_run_id
        ? () => goto(`/chat?run=${store.run!.parent_run_id}`)
        : undefined}
      cwd={store.effectiveCwd}
      mcpServers={store.mcpServers}
      onMcpToggle={() => (mcpPanelOpen = !mcpPanelOpen)}
      cliVersion={store.cliVersion}
      permissionMode={store.permissionMode}
      platformModels={sd.platformModels}
      fastModeState={store.fastModeState}
      verbose={verbose.verboseEnabled}
      numTurns={store.numTurns}
      durationMs={store.durationMs}
      persistedFiles={store.persistedFiles}
      onRewind={store.sessionAlive && !store.isRunning ? handleRewind : undefined}
      contextUtilization={store.contextUtilization}
      contextWarningLevel={store.contextWarningLevel}
      contextWindow={store.contextWindow}
      lastCompactedAt={store.lastCompactedAt}
      compactCount={store.compactCount}
      microcompactCount={store.microcompactCount}
      turnUsages={store.turnUsages}
      activeTaskCount={store.activeBackgroundTasks.length}
      mode={store.run ? (store.useStreamSession ? "Stream" : "CLI") : ""}
      remoteHostName={store.remoteHostName}
      onRename={store.run ? handleRename : undefined}
      authSourceLabel={store.authSourceLabel}
      authSourceCategory={store.authSourceCategory}
      apiKeySource={store.apiKeySource}
      onStatusClick={() => {
        if (sidebarCollapsed) sidebarCollapsed = false;
        sidebarRequestedTab = "info";
      }}
      onSummarize={store.run ? () => void handleSummarize() : undefined}
      onShare={store.run ? () => void insight.generate() : undefined}
      fuseToolRailCapsule={true}
      {toolPanelActiveTab}
      onToolPanelTabChange={(tab) => {
        if (tab === toolPanelActiveTab && !sidebarCollapsed) {
          sidebarCollapsed = true;
        } else {
          toolPanelActiveTab = tab;
          if (sidebarCollapsed) sidebarCollapsed = false;
        }
      }}
      {toolPanelIndicators}
      {processVisibility}
      alignment={sessionIslandAlignment}
      onProcessVisibilityChange={handleProcessVisibilityChange}
      layoutSidebarOpen={layoutChrome.state.sidebarOpen}
      onToggleLayoutSidebar={layoutChrome.toggleSidebar}
      onOpenSettings={layoutChrome.openSettings}
      onOpenCliImport={layoutChrome.openCliBrowser}
      onNewChat={layoutChrome.newChat}
      splitModeEnabled={splitWorkspaceStore.enabled}
      onToggleSplitMode={() => void toggleSplitWorkspace()}
      sendCoordinator={send.coordinator}
      onSendRetry={(event) => handleSendRetry(event)}
      permissionStatus={permissionStatusOverlay?.payload ?? null}
      onPermissionStatusDismiss={clearPermissionStatusOverlay}
      toastNotification={toastOverlay}
      onToastDismiss={clearToastOverlay}
    />

    <!-- MCP panel (floating below status bar) -->
    {#if mcpPanelOpen && store.mcpServers.length > 0}
      <div
        class="absolute right-3 z-30"
        style="top: {statusBarExpanded
          ? 'var(--session-statusbar-offset-expanded)'
          : 'var(--session-statusbar-offset-rest)'}"
      >
        <McpStatusPanel
          runId={store.run?.id ?? ""}
          mcpServers={store.mcpServers}
          sessionAlive={store.sessionAlive}
          onClose={() => (mcpPanelOpen = false)}
          onServersUpdate={(servers) => {
            store.updateMcpServers(servers);
          }}
        />
      </div>
    {/if}

    <!-- Conversation: messages extend under a soft-fade input dock.
         When split mode is enabled, this whole block lives inside a
         SplitWorkspace active-pane snippet so the active pane uses the
         exact same chat surface as the non-split path. The input dock
         is rendered as a sibling (via activePaneInput on split mode,
         direct child otherwise) so the dock stays mounted when the
         conversation body swaps. -->
    {#if splitWorkspaceStore.enabled}
      <SplitWorkspace
        onActivate={(id) => void activateSplitPane(id)}
        activeRunData={{
          name: store.run?.name ?? "",
          status: store.run?.status ?? "pending",
        }}
      >
        {#snippet activePaneBody()}
          <ChatConversationStage
            {store}
            {settings}
            {processVisibility}
            timelineVm={{
              visibleTimeline: tl.visibleTimeline,
              filteredTimeline: tl.filteredTimeline,
              toolNamesInTimeline: tl.toolNamesInTimeline,
              toolFilter: tl.toolFilter,
              setToolFilter: tl.setToolFilter,
              renderLimit: tl.renderLimit,
              timelineIdIndex: tl.timelineIdIndex,
              lastClearSepId: tl.lastClearSepId,
              latestPlanToolId: tl.latestPlanToolId,
              batchGroups: tl.batchGroups,
              toolBursts: tl.toolBursts,
              burstCollapse,
              lastAssistantIdx: sd.lastAssistantIdx,
              usageAnnotations: ta.usageAnnotations,
              lastTurnUsage: ta.lastTurnUsage,
              claudeTurnStarts: ta.claudeTurnStarts,
              showPermissionPanel: false,
              fetchToolResult: toolResultCache.fetchToolResult,
              topSentinelRef: tl.topSentinel,
              setTopSentinel: tl.setTopSentinel,
            }}
            sessionVm={{
              welcomeVisible,
              lastContinuableRun,
              authOverview,
              localProxyStatuses,
              showInitHint,
              cliVersionInfo: sd.cliVersionInfo,
              channelLatest: sd.channelLatest,
              remoteHosts,
              availableWorkspaces: workspacesStore.list,
              selectedCwd: folderCwdOverride,
            }}
            loadingVm={{
              routeRunLoadFailed,
              routeRunPending,
              runId,
              notificationVisible,
              latestNotification,
              rewindMarkers,
              activeTeamRuns: team.activeTeamRuns,
            }}
            thinkingVm={{
              thinkingElapsed: thinking.thinkingElapsed,
              thinkingVisible: thinking.thinkingVisible,
              spinnerVerb: thinking.spinnerVerb,
              processingSlashCmd: thinking.processingSlashCmd,
              approving,
              sending,
            }}
            forkVm={{
              forkOverlay: fork.forkOverlay,
              forkElapsed: fork.forkElapsed,
              resuming,
            }}
            handlers={{
              goto,
              sendMessage,
              fillPrompt,
              handleAuthModeChange,
              handlePlatformChange,
              handleRewindToMessage,
              handleToolAnswer,
              handleToolApprove,
              handlePermissionRespond,
              handleExitPlanClearContext,
              handleExitPlanBypass,
              getPlanContentForExitPlan,
              openPreviewForPath,
              handleHookCallbackRespond,
              handleElicitationRespond,
              onCwdChange: (cwd: string) => {
                const normalized = normalizeCwd(cwd);
                if (!normalized) return;
                folderCwdOverride = normalized;
                store.sessionCwd = normalized;
                try {
                  localStorage.setItem("ocv:project-cwd", normalized);
                } catch {
                  // localStorage may fail in restricted contexts
                }
                window.dispatchEvent(new Event("ocv:cwd-changed"));
              },
              onAddWorkspace: () => {
                void addWorkspaceFromPicker();
              },
              handleChatScroll,
              handleChatWheel,
              scrollChatToBottom,
              handleTermResize,
              handleTermReady,
              handleForkCancel,
              handleForkRetry,
              dismissInitHint,
              dismissTaskNotificationBanner: () => {
                notificationVisible = false;
              },
              loadRunProgressive,
              setLastTarget,
            }}
            bind:thinkingExpanded={thinking.thinkingExpanded}
            {showChatScrollHint}
            {isChatAutoScroll}
            {readingHistory}
            bind:xtermRef
            bind:chatAreaRef
          >
            {#snippet heroMetaFooter()}
              {@render heroMetaFooterContent()}
            {/snippet}
          </ChatConversationStage>
        {/snippet}
        {#snippet activePaneInput()}
          {@render chatInputDock()}
        {/snippet}
      </SplitWorkspace>
    {:else}
      <!-- Workspace overview: replaces welcome screen when a project folder is selected but no session is active -->
      {#if workspaceOverviewCwd}
        <div class="flex flex-1 min-h-0 flex-col overflow-y-auto">
          <WorkspaceOverview cwd={workspaceOverviewCwd} onAddWorkspace={addWorkspaceFromPicker} />
        </div>
      {/if}
      <div class="flex flex-1 min-h-0 flex-col" class:hidden={!!workspaceOverviewCwd}>
      <ChatConversationStage
        {store}
        {settings}
        {processVisibility}
        timelineVm={{
          visibleTimeline: tl.visibleTimeline,
          filteredTimeline: tl.filteredTimeline,
          toolNamesInTimeline: tl.toolNamesInTimeline,
          toolFilter: tl.toolFilter,
          setToolFilter: tl.setToolFilter,
          renderLimit: tl.renderLimit,
          timelineIdIndex: tl.timelineIdIndex,
          lastClearSepId: tl.lastClearSepId,
          latestPlanToolId: tl.latestPlanToolId,
          batchGroups: tl.batchGroups,
          toolBursts: tl.toolBursts,
          burstCollapse,
          lastAssistantIdx: sd.lastAssistantIdx,
          usageAnnotations: ta.usageAnnotations,
          lastTurnUsage: ta.lastTurnUsage,
          claudeTurnStarts: ta.claudeTurnStarts,
          showPermissionPanel: false,
          permissionCoordinator,
          fetchToolResult: toolResultCache.fetchToolResult,
          topSentinelRef: tl.topSentinel,
          setTopSentinel: tl.setTopSentinel,
        }}
        sessionVm={{
          welcomeVisible,
          lastContinuableRun,
          authOverview,
          localProxyStatuses,
          showInitHint,
          cliVersionInfo: sd.cliVersionInfo,
          channelLatest: sd.channelLatest,
          remoteHosts,
          availableWorkspaces: workspacesStore.list,
          selectedCwd: folderCwdOverride,
        }}
        loadingVm={{
          routeRunLoadFailed,
          routeRunPending,
          runId,
          notificationVisible,
          latestNotification,
          rewindMarkers,
          activeTeamRuns: team.activeTeamRuns,
        }}
        thinkingVm={{
          thinkingElapsed: thinking.thinkingElapsed,
          thinkingVisible: thinking.thinkingVisible,
          spinnerVerb: thinking.spinnerVerb,
          processingSlashCmd: thinking.processingSlashCmd,
          approving,
          sending,
        }}
        forkVm={{
          forkOverlay: fork.forkOverlay,
          forkElapsed: fork.forkElapsed,
          resuming,
        }}
        handlers={{
          goto,
          sendMessage,
          fillPrompt,
          handleAuthModeChange,
          handlePlatformChange,
          handleRewindToMessage,
          handleToolAnswer,
          handleToolApprove,
          handlePermissionRespond,
          handleExitPlanClearContext,
          handleExitPlanBypass,
          getPlanContentForExitPlan,
          openPreviewForPath,
          handleHookCallbackRespond,
          handleElicitationRespond,
          onCwdChange: (cwd: string) => {
            const normalized = normalizeCwd(cwd);
            if (!normalized) return;
            folderCwdOverride = normalized;
            store.sessionCwd = normalized;
            try {
              localStorage.setItem("ocv:project-cwd", normalized);
            } catch {
              // localStorage may fail in restricted contexts
            }
            window.dispatchEvent(new Event("ocv:cwd-changed"));
          },
          onAddWorkspace: () => {
            void addWorkspaceFromPicker();
          },
          handleChatScroll,
          handleChatWheel,
          scrollChatToBottom,
          handleTermResize,
          handleTermReady,
          handleForkCancel,
          handleForkRetry,
          dismissInitHint,
          dismissTaskNotificationBanner: () => {
            notificationVisible = false;
          },
          loadRunProgressive,
          setLastTarget,
        }}
        bind:thinkingExpanded={thinking.thinkingExpanded}
        {showChatScrollHint}
        {isChatAutoScroll}
        {readingHistory}
        bind:xtermRef
        bind:chatAreaRef
      >
        {#snippet heroMetaFooter()}
          {@render heroMetaFooterContent()}
        {/snippet}
      </ChatConversationStage>
      {@render chatInputDock()}
      </div>
    {/if}

    {#if showScrollButton}
      <button
        type="button"
        transition:fly={{ y: 10, duration: 200 }}
        class="absolute bottom-20 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
        aria-label={t("chat_scrollToBottom")}
        onclick={scrollChatToBottom}
      >
        <Icon name="chevron-down" size="md" />
      </button>
    {/if}
  </div>

  <!-- Tool Activity sidebar — suspended while split mode is active. PR-5
       adds the deeper fetch-side guards in WorkspaceContextPanel /
       GitWorktreePanel / memoryStore; this mount swap stops rendering
       the heavy panels entirely so the side effects never run. -->
  {#if splitWorkspaceStore.rightSidebarSuspended}
    <SplitSidebarPlaceholder />
  {:else}
    <ToolActivity
      timeline={store.timeline}
      tools={store.tools}
      turnUsages={store.turnUsages}
      usageByTurn={sd.usageByTurn}
      contextHistory={sd.contextHistory}
      persistedFiles={store.persistedFiles}
      sessionInfo={sd.currentSessionInfo}
      collapsed={sidebarCollapsed}
      bind:activeTab={toolPanelActiveTab}
      bind:panelIndicators={toolPanelIndicators}
      underUnifiedCapsule={true}
      onToggle={toggleSidebar}
      onScrollToTool={scrollToTool}
      onScrollToTurn={(anchorId) => scrollToMessage(anchorId)}
      bind:requestedTab={sidebarRequestedTab}
      backgroundTasks={store.taskNotifications}
      activeBackgroundTasks={store.activeBackgroundTasks}
      cwd={store.effectiveCwd}
      runId={store.run?.id ?? ""}
      isRemote={store.isRemote}
      bind:requestedPreviewPath
      bind:requestedPreviewUrl
    />
  {/if}

  <RewindModal
    bind:open={rewindModalOpen}
    runId={store.run?.id ?? ""}
    candidates={rewindCandidates}
    initialCandidate={rewindDirectTarget}
    onSuccess={(info) => {
      // Run-id debounce: discard if run changed while modal was open
      if (info.runId !== store.run?.id) return;
      rewindMarkers = [
        ...rewindMarkers,
        {
          id: uuid(),
          ts: new Date().toISOString(),
          targetContent: truncate(info.targetContent, 80),
          filesReverted: info.filesReverted,
        },
      ];
      if (info.degraded) {
        _showToast(t("rewind_degradedToFull"));
      } else {
        _showToast(t("toast_rewindSuccess"));
      }
      tick().then(() => {
        document
          .getElementById("rewind-marker-latest")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }}
  />

  <ShortcutHelpPanel bind:open={shortcutHelpOpen} />

  {#if insight.insightPreviewOpen && insight.insightHtml}
    <HtmlReportPreview
      bind:open={insight.insightPreviewOpen}
      html={insight.insightHtml}
      title={t("insight_preview_title")}
    />
  {/if}

  <FolderPicker
    bind:open={folderPickerOpen}
    initialHost={folderPickerInitialHost}
    initialPath={folderPickerInitialPath}
    hideTargetSelector={folderPickerHideTarget}
    onConfirm={(result) => {
      const fn = folderPickerResolve;
      folderPickerResolve = null;
      fn?.(result);
    }}
    onCancel={() => {
      const fn = folderPickerResolve;
      folderPickerResolve = null;
      fn?.(null);
    }}
  />
</div>
