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
  import type { UserSettings, SessionMode, TimelineEntry } from "$lib/types";
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
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import { t } from "$lib/i18n/index.svelte";
  import { showToast as _showToast } from "$lib/stores/toast-store.svelte";
  import { registerSessionIslandNotify } from "$lib/stores/session-island-notify.svelte";
  import { registerToastListener } from "$lib/stores/toast-store.svelte";
  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
  import { createUrlParams } from "./use-url-params.svelte";
  import { createAutoScroll } from "./use-auto-scroll.svelte";
  import { createContinuityCapsule } from "./use-continuity-capsule.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { perfMarkAsync } from "$lib/utils/perf";
  import { setLastTarget } from "$lib/utils/remote-cwd";
  import { shouldTriggerAutoTitle, deriveAutoName } from "$lib/utils/auto-name";
  import { generateRunTitle } from "$lib/api";
  import { normalizeCwd } from "$lib/utils/sidebar-groups";
  import {
    normalizeSessionIslandAlignment,
    SESSION_ISLAND_ALIGNMENT_CHANGED_EVENT,
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
  import { createLiveViewModel } from "$lib/components/chat/live-view-model";
  import type {
    ForkVm,
    LoadingVm,
    SessionVm,
    ThinkingVm,
    TimelineVm,
  } from "$lib/components/chat/conversation-stage-types";
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
  import { createChatState } from "./use-chat-state.svelte";
  import { createScrollState } from "./use-scroll.svelte";
  import { createFolderPicker } from "./use-folder-picker.svelte";
  import {
    chatViewCache,
    saveChatViewState,
    updateLastChatHref,
    getCachedScrollTop,
    getCachedRenderLimit,
  } from "$lib/chat/chat-view-cache.svelte";
  import { snapshotChatBootstrap } from "$lib/chat/chat-bootstrap-cache";
  const _toggleLayoutSidebar = getContext<() => void>("toggleSidebar");
  const layoutChrome = getContext<LayoutChromeContext>(LAYOUT_CHROME_CONTEXT_KEY);
  const keybindingStore = getContext<KeybindingStore>("keybindings");
  const settingsCache = getContext<SettingsCacheContext | undefined>(SETTINGS_CACHE_CONTEXT_KEY);
  const store = sessionStore;
  const middleware = getEventMiddleware();
  const chatState = createChatState();
  const scrollState = createScrollState(
    () => store,
    () => chatAreaRef,
  );
  const fp = createFolderPicker(
    () => store,
    (v: string) => {
      folderCwdOverride = v;
    },
    (opts) => fp.openFolderPicker(opts),
  );
  let middlewareReady = $state(false);
  let xtermRef: XTerminal | undefined = $state();
  let promptRef: PromptInput | undefined = $state();
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
  $effect(() => {
    const s = chatState.settings;
    chatState.syncProcessVisibility(s);
  });

  $effect(() => {
    if (chatState.processVisibility === "output") {
      chatState.sidebarCollapsed = true;
    }
  });
  /** Reactive cwd override for new-chat-in-folder (cleared when a run is loaded) */
  let folderCwdOverride = $state("");
  let chatAreaRef: HTMLDivElement | undefined = $state();
  let lastContinuableRun = $state<import("$lib/types").TaskRun | null>(null);
  let remoteHosts = $state<import("$lib/types").RemoteHost[]>([]);
  let authOverview = $state<import("$lib/types").AuthOverview | null>(null);

  let preloadedSkills = $state<import("$lib/types").StandaloneSkill[]>([]);
  /** Preloaded agent definitions from filesystem. */
  let preloadedAgents = $state<import("$lib/types").AgentDefinitionSummary[]>([]);
  /** Project-level commands from {cwd}/.claude/commands/ + ~/.claude/commands/. */
  let projectCommands = $state<import("$lib/types").CliCommand[]>([]);
  /** Local proxy running statuses for AuthSourceBadge. */
  let localProxyStatuses = $state<Record<string, { running: boolean; needsAuth: boolean }>>({});
  let projectInitStatus = $state<import("$lib/types").ProjectInitStatus | null>(null);
  let notificationVisible = $state(false);
  let latestNotification = $state<{ task_id: string; status: string } | null>(null);
  let rewindModalOpen = $state(false);
  let rewindDirectTarget = $state<RewindCandidate | null>(null);
  let rewindMarkers = $state<RewindMarker[]>([]);
  $effect(() => {
    if (!rewindModalOpen) rewindDirectTarget = null;
  });
  const team = createTeamDispatch({
    store,
    getSendMessage: () => sendMessage,
  });
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
    splitWorkspaceStore.onToast = (key, kind) => {
      _showToast(t(key as never), kind ?? "info");
    };

    setSplitWorkspaceXtermRef(() => xtermRef);
    void reconcileSplitFromUrl(get(page).url.searchParams);

    registerSessionIslandNotify(chatState.pushPermissionStatus);
    registerToastListener((toast) => {
      chatState.toastOverlay = toast;
      chatState.toastOverlayVersion = Date.now();
    });

    const onSessionIslandAlignmentChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ alignment?: unknown }>).detail;
      chatState.sessionIslandAlignmentOverride = normalizeSessionIslandAlignment(detail?.alignment);
    };
    const onUserSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<UserSettings>).detail;
      if (!detail) return;
      chatState.settings = detail;
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
  $effect(() => {
    if (isSplitUrlSyncLocked()) return;
    const params = $page.url.searchParams;
    void reconcileSplitFromUrl(params);
  });
  let prevAutoNameRunId = "";
  let autoNameDone = false;
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== prevAutoNameRunId) {
      prevAutoNameRunId = id;
      autoNameDone = false;
    }
  });
  let prevRewindRunId = "";
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== prevRewindRunId) {
      prevRewindRunId = id;
      rewindMarkers = [];
    }
  });
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
  let btwState = $state<{
    active: boolean;
    btwId: string | null;
    question: string;
    answer: string;
    error: string | null;
    loading: boolean;
  }>({ active: false, btwId: null, question: "", answer: "", error: null, loading: false });

  function openPreviewForPath(path: string) {
    chatState.openPreviewForPath(path, toggleSidebar);
  }
  let _lastPreviewClearRunId = "__unset__";
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== _lastPreviewClearRunId) {
      _lastPreviewClearRunId = id;
      chatState.requestedPreviewPath = null;
    }
  });
  const verbose = createVerboseState();
  const toolResultCache = createToolResultCache(() => store.run?.id);
  $effect(() => {
    const _ = store.run?.id;
    toolResultCache.clearCache();
  });
  let _suppressLoadMoreRearm = false;
  let loadMoreEarlierRef: () => void = () => {};

  let burstCollapse = useToolBurstCollapse(
    () => tl.toolBursts,
    () => store.run?.id,
  );

  const tl = useTimelineState({
    store,
    burstCollapse,
    getProcessVisibility: () => chatState.processVisibility,
    getChatAreaRef: () => chatAreaRef,
    loadMoreEarlier: () => loadMoreEarlierRef(),
  });
  const urlParams = createUrlParams({
    pageUrl: () => $page.url,
    store,
    getRemoteHosts: () => remoteHosts,
    chatViewCache,
    getPromptRef: () => promptRef,
    getSettingsCache: () => settingsCache,
    getXtermRef: () => xtermRef,
    setFolderCwdOverride: (v) => {
      folderCwdOverride = v;
    },
    setSelectedWorkspaceCwd: (v) => {
      selectedWorkspaceCwd = v;
    },
  });
  const capsule = createContinuityCapsule({
    store,
    tl,
    chatState,
    scrollState,
    getPromptRef: () => promptRef,
    getChatAreaRef: () => chatAreaRef,
  });
  const ta = createTimelineAnnotations({
    store,
    getVisibleTimeline: () => tl.visibleTimeline,
    getFilteredTimeline: () => tl.filteredTimeline,
    getUserCountPrefix: () => tl.userCountPrefix,
    getCollapsedIndices: () => burstCollapse.collapsedIndices,
  });
  const sd = createSessionDerived({
    store,
    getSettings: () => chatState.settings,
    getAuthOverview: () => authOverview,
    getVisibleTimeline: () => tl.visibleTimeline,
    getPreloadedSkills: () => preloadedSkills,
    timelineAnnotations: ta,
  });

  let currentEffort = $state("");
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
  $effect(() => {
    const _ = store.run?.id;
    requestAnimationFrame(() => promptRef?.focus());
  });
  $effect(() => {
    const _tick = verbose.verboseRetryTick; // extra dep: drives retry on failure
    verbose.syncVerboseState(store.run?.id);
  });
  const fork = createForkOverlay({
    store,
    t: t as unknown as (key: string) => string,
  });
  const modelGuard = createModelGuard({
    store,
    getSettings: () => chatState.settings,
    getCliCurrentModel,
  });
  const thinking = useThinkingTimer({ store });
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

  let routeRunPending = $derived(
    !!urlParams.runId &&
      tl.loadingRunId === urlParams.runId &&
      store.run?.id !== urlParams.runId &&
      !store.error,
  );

  let routeRunLoadFailed = $derived(
    !!urlParams.runId &&
      store.run?.id !== urlParams.runId &&
      store.phase === "failed" &&
      !!store.error,
  );

  let welcomeVisible = $derived(
    !urlParams.runId &&
      !tl.loadingRunId &&
      store.timeline.length === 0 &&
      !store.streamingText &&
      !store.run &&
      store.phase !== "loading",
  );

  /** Effective cwd for the workspace overview panel. */
  let selectedWorkspaceCwd = $state("");
  let workspaceOverviewCwd = $derived(
    !urlParams.hasNewParam && !store.run && store.timeline.length === 0 && !store.streamingText
      ? selectedWorkspaceCwd || folderCwdOverride || ""
      : "",
  );
  $effect(() => {
    if (store.run && selectedWorkspaceCwd) {
      selectedWorkspaceCwd = "";
    }
  });
  let sending = $derived(store.phase === "spawning");

  /** Last runId observed by the send coordinator reconcile step. */
  let sendCoordinatorLastActiveRunId: string | null = null;

  /** Wrap team dispatcher to also trigger continuity save on keystroke. */
  function handleInputValueChangeWithContinuity(value: string): void {
    try {
      team.handleInputValueChange(value);
    } finally {
      const id = store.run?.id;
      if (id) capsule.controller.scheduleSave(id);
    }
  }
  $effect(() => {
    if (!middlewareReady) return;
    const id = urlParams.runId;
    const hasResume = urlParams.hasResumeParam;
    const isNewChat = urlParams.hasNewParam;
    untrack(() => {
      middleware.subscribeCurrent(id, store);
      const previousRunId = permissionCoordinator.lastActiveRunId;
      if (previousRunId !== id) {
        permissionCoordinator.reconcileActiveRun(id);
        permissionCoordinator.bumpGeneration();
        permissionCoordinator.lastActiveRunId = id;
      }
      const previousSendRunId = sendCoordinatorLastActiveRunId;
      if (previousSendRunId !== id) {
        if (previousSendRunId) {
          send.coordinator.cancelForRun(previousSendRunId, "Run switched");
        }
        send.coordinator.reconcileActiveRun(id);
        sendCoordinatorLastActiveRunId = id;
      }
      if (store.resumeInFlight || chatState.resuming) {
        dbg("effect", "skip loadRun — resume in progress");
        return;
      }
      if (hasResume) return;

      if (!id) {
        // Case 1: explicit new chat (?new=1) → start empty
        if (isNewChat) {
          const prev = store.run?.id;
          if (prev) capsule.controller.flush("manual", prev);
          capsule.controller.switchRun("");
          capsule.restoreAppliedFor = "";
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
          if (cachedTab) chatState.toolPanelActiveTab = cachedTab;
          const cachedCollapsed = chatViewCache.sidebarCollapsed;
          chatState.sidebarCollapsed = cachedCollapsed;
          const cachedPreview = chatViewCache.requestedPreviewPath;
          if (cachedPreview) {
            chatState.requestedPreviewPath = cachedPreview;
            chatState.sidebarRequestedTab = "files";
          }
          const cachedRenderLimit = getCachedRenderLimit(store.run.id);
          if (cachedRenderLimit !== undefined) {
            tl.setRenderLimit(cachedRenderLimit);
          }
          // Restore scroll position
          scrollState.restoringScroll = true;
          scrollState.isChatAutoScroll = false;
          scrollState.readingHistory = true;
          tick().then(() => {
            requestAnimationFrame(() => {
              if (chatAreaRef) {
                const cachedScroll = getCachedScrollTop(store.run!.id);
                chatAreaRef.scrollTop = cachedScroll;
              }
              scrollState.restoringScroll = false;
            });
          });
          // Re-attach the controller to the in-memory run (navigation
          // return path) so subsequent typing saves land in its capsule
          // entry.
          capsule.controller.switchRun(store.run.id);
          return;
        }

        // Case 4: truly empty → new empty run
        capsule.controller.switchRun("");
        capsule.restoreAppliedFor = "";
        store.loadRun("", xtermRef);
        cancelProgressive();
        return;
      }

      // Update lastChatHref when navigating to a run URL
      updateLastChatHref(id, $page.url.href);

      // Flush the previous run before switching so its latest state is
      // captured in the capsule (the conservative "save on leave" path
      // complements the pagehide/beforeNavigate flush).
      const prev = capsule.controller.__getCurrentRunId();
      if (prev && prev !== id) {
        capsule.controller.flush("manual", prev);
        capsule.controller.switchRun(id);
      } else if (!prev) {
        capsule.controller.switchRun(id);
      }
      // Seed the pending restore for the new run id (one-shot). If the
      // user navigates to a different run before consume, the latch
      // clears it via switchRun → noApplyPendingRestore path.
      void capsule.controller.seedAsync(id).then((ready) => {
        if (!ready) {
          // No capsule entry → no restore, just clear the latch so a
          // later reload of the same run can re-seed.
          capsule.restoreAppliedFor = id;
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
  $effect(() => {
    if (!middlewareReady) return;
    const scrollTo = $page.url.searchParams.get("scrollTo");
    if (!scrollTo) return;
    untrack(() => {
      // loadRunProgressive handles scrollTo during run loading — don't double-scroll
      if (scrollState.scrollToInFlight) return;
      if (store.phase === "loading") return;
      if (store.run?.id !== urlParams.runId) return;

      dbg("effect", "same-run scrollTo", { scrollTo, runId: urlParams.runId });
      scrollState.scrollToInFlight = true;
      const clean = new URL($page.url);
      clean.searchParams.delete("scrollTo");
      replaceState(clean, {});
      tick().then(() => {
        scrollToMessage(scrollTo);
        scrollState.scrollToInFlight = false;
      });
    });
  });
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
  function handleTermReady(_cols: number, _rows: number) {
    // Terminal ready — Codex pipe mode is output-only, no setup needed
  }

  function handleTermResize(_cols: number, _rows: number) {
    // Codex pipe mode doesn't need resize — terminal is output-only
  }
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
    showPermissionStatus: chatState.pushPermissionStatus,
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
      chatState.approving = v;
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
    getSettings: () => chatState.settings,
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
    getProcessVisibility: () => chatState.processVisibility,
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
      scrollState.isChatAutoScroll = v;
    },
    getIsChatAutoScroll: () => scrollState.isChatAutoScroll,
    setShowChatScrollHint: (v: boolean) => {
      scrollState.showChatScrollHint = v;
    },
    getScrollToInFlight: () => scrollState.scrollToInFlight,
    setScrollToInFlight: (v: boolean) => {
      scrollState.scrollToInFlight = v;
    },
    getSuppressLoadMoreRearm: () => _suppressLoadMoreRearm,
    setSuppressLoadMoreRearm: (v: boolean) => {
      _suppressLoadMoreRearm = v;
    },
    setReadingHistory: (v: boolean) => {
      scrollState.readingHistory = v;
    },
    setFolderCwdOverride: (v: string) => {
      folderCwdOverride = v;
    },
    reloadProjectData,
    getPageUrl: () => $page.url,
    replaceState,
  });
  loadMoreEarlierRef = scrollNav.loadMoreEarlier;
  capsule.setScrollToMessage(scrollNav.scrollToMessage);

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

  createAutoScroll({
    store,
    getChatAreaRef: () => chatAreaRef,
    scrollState,
    pinChatToBottom,
    followChatBottom,
    scrollChatToBottom,
  });

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
      chatState.requestedPreviewUrl = v;
    },
    setSidebarRequestedTab: (v) => {
      chatState.sidebarRequestedTab = v;
    },
    getSidebarCollapsed: () => chatState.sidebarCollapsed,
    setSidebarCollapsed: (v) => {
      chatState.sidebarCollapsed = v;
    },
    getSettings: () => chatState.settings,
    setSettings: (v) => {
      chatState.settings = v;
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
    getResuming: () => chatState.resuming,
    setResuming: (v: boolean) => {
      chatState.resuming = v;
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
        return chatState.sidebarCollapsed;
      },
      set sidebarCollapsed(v: boolean) {
        chatState.sidebarCollapsed = v;
      },
      get sidebarRequestedTab() {
        return chatState.sidebarRequestedTab;
      },
      set sidebarRequestedTab(v: unknown) {
        chatState.sidebarRequestedTab = v as ToolActivityPanelTab | null;
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
      toolPanelActiveTab: chatState.toolPanelActiveTab,
      sidebarCollapsed: chatState.sidebarCollapsed,
      requestedPreviewPath: chatState.requestedPreviewPath,
      renderLimit: tl.renderLimit,
    });
    // Flush the continuity capsule so the next reload sees the latest
    // draft / anchor / inspector state. Synchronous localStorage write
    // is fine here — the page is about to be torn down.
    capsule.controller.flush("beforeNavigate");
    if (to?.url.pathname.startsWith("/settings") && chatState.settings) {
      snapshotChatBootstrap(chatState.settings, chatState.agentSettings);
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
    openFolderPicker: fp.openFolderPicker,
    handleResume,
    loadCliVersionInfo,
    promptInputRef: () => promptRef,
    getPromptRef: () => promptRef,
    goto,
    setIsChatAutoScroll: (v) => {
      scrollState.isChatAutoScroll = v;
    },
    setShowChatScrollHint: (v) => {
      scrollState.showChatScrollHint = v;
    },
    setTeamDispatchPrompt: (v) => {
      team.setTeamDispatchPrompt(v);
    },
    setTeamDispatchOpen: (v) => {
      team.setTeamDispatchOpen(v);
    },
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
    getFolderCwdOverride: () => folderCwdOverride,
    consumePendingSubFolderId: () => urlParams.consumePendingSubFolderId(),
  });
  const sendMessage = send.sendMessage;

  /**
   */
  function handleSendRetry(_event: { runId: string; clientMessageId: string }): void {
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
    chatState.sidebarCollapsed = !chatState.sidebarCollapsed;
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

  initLifecycleHandlers({
    store,
    middleware,
    keybindingStore,
    getSettingsCache: () => settingsCache,
    getSettings: () => chatState.settings,
    setSettings: (v) => {
      chatState.settings = v;
    },
    setRemoteHosts: (v) => {
      remoteHosts = v;
    },
    setAuthOverview: (v) => {
      authOverview = v;
    },
    checkAllLocalProxies,
    getAgentSettings: () => chatState.agentSettings,
    setAgentSettings: (v) => {
      chatState.agentSettings = v;
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
    getShortcutHelpOpen: () => chatState.shortcutHelpOpen,
    setShortcutHelpOpen: (v) => {
      chatState.shortcutHelpOpen = v;
    },
    getStatusBarRef: () => chatState.statusBarRef,
    getStashedInput: () => chatState.stashedInput,
    setStashedInput: (v) => {
      chatState.stashedInput = v;
    },
    getPromptRef: () => promptRef,
    setStatusBarExpanded: (v) => {
      chatState.statusBarExpanded = v;
    },
    getSidebarCollapsed: () => chatState.sidebarCollapsed,
    setSidebarCollapsed: (v) => {
      chatState.sidebarCollapsed = v;
    },
    setSidebarRequestedTab: (v) => {
      chatState.sidebarRequestedTab = v;
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
    getRunId: () => urlParams.runId,
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

  // These grouped objects cross a component boundary, so every property must
  // remain a live selector. Copying rune values here captures the initial
  // empty timeline and leaves ChatConversationStage blank after loadRun.
  const stageTimelineVm = createLiveViewModel<TimelineVm>({
    visibleTimeline: () => tl.visibleTimeline,
    filteredTimeline: () => tl.filteredTimeline,
    toolNamesInTimeline: () => tl.toolNamesInTimeline,
    toolFilter: () => tl.toolFilter,
    setToolFilter: () => tl.setToolFilter,
    renderLimit: () => tl.renderLimit,
    timelineIdIndex: () => tl.timelineIdIndex,
    lastClearSepId: () => tl.lastClearSepId,
    latestPlanToolId: () => tl.latestPlanToolId,
    batchGroups: () => tl.batchGroups,
    toolBursts: () => tl.toolBursts,
    burstCollapse: () => burstCollapse,
    lastAssistantIdx: () => sd.lastAssistantIdx,
    usageAnnotations: () => ta.usageAnnotations,
    lastTurnUsage: () => ta.lastTurnUsage,
    claudeTurnStarts: () => ta.claudeTurnStarts,
    showPermissionPanel: () => false,
    permissionCoordinator: () => permissionCoordinator,
    fetchToolResult: () => toolResultCache.fetchToolResult,
    topSentinelRef: () => tl.topSentinel,
    setTopSentinel: () => tl.setTopSentinel,
  });
  const stageSessionVm = createLiveViewModel<SessionVm>({
    welcomeVisible: () => welcomeVisible,
    lastContinuableRun: () => lastContinuableRun,
    authOverview: () => authOverview,
    localProxyStatuses: () => localProxyStatuses,
    showInitHint: () => showInitHint,
    cliVersionInfo: () => sd.cliVersionInfo,
    channelLatest: () => sd.channelLatest,
    remoteHosts: () => remoteHosts,
    availableWorkspaces: () => workspacesStore.list,
    selectedCwd: () => folderCwdOverride,
  });
  const stageLoadingVm = createLiveViewModel<LoadingVm>({
    routeRunLoadFailed: () => routeRunLoadFailed,
    routeRunPending: () => routeRunPending,
    runId: () => urlParams.runId,
    notificationVisible: () => notificationVisible,
    latestNotification: () => latestNotification,
    rewindMarkers: () => rewindMarkers,
    activeTeamRuns: () => team.activeTeamRuns,
  });
  const stageThinkingVm = createLiveViewModel<ThinkingVm>({
    thinkingElapsed: () => thinking.thinkingElapsed,
    thinkingVisible: () => thinking.thinkingVisible,
    spinnerVerb: () => thinking.spinnerVerb,
    processingSlashCmd: () => thinking.processingSlashCmd,
    approving: () => chatState.approving,
    sending: () => sending,
  });
  const stageForkVm = createLiveViewModel<ForkVm>({
    forkOverlay: () => fork.forkOverlay,
    forkElapsed: () => fork.forkElapsed,
    resuming: () => chatState.resuming,
  });
  const stageHandlers = {
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
        /* noop */
      }
      window.dispatchEvent(new Event("ocv:cwd-changed"));
    },
    onAddWorkspace: () => {
      void fp.addWorkspaceFromPicker();
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
  };
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
    settings={chatState.settings}
    inputVm={{
      processVisibility: chatState.processVisibility,
      agentSettings: chatState.agentSettings,
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
    bind:stashedInput={chatState.stashedInput}
    bind:shortcutHelpOpen={chatState.shortcutHelpOpen}
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
      bind:this={chatState.statusBarRef}
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
      onMcpToggle={() => (chatState.mcpPanelOpen = !chatState.mcpPanelOpen)}
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
        if (chatState.sidebarCollapsed) chatState.sidebarCollapsed = false;
        chatState.sidebarRequestedTab = "info";
      }}
      onSummarize={store.run ? () => void handleSummarize() : undefined}
      onShare={store.run ? () => void insight.generate() : undefined}
      fuseToolRailCapsule={true}
      toolPanelActiveTab={chatState.toolPanelActiveTab}
      onToolPanelTabChange={(tab) => {
        if (tab === chatState.toolPanelActiveTab && !chatState.sidebarCollapsed) {
          chatState.sidebarCollapsed = true;
        } else {
          chatState.toolPanelActiveTab = tab;
          if (chatState.sidebarCollapsed) chatState.sidebarCollapsed = false;
        }
      }}
      toolPanelIndicators={chatState.toolPanelIndicators}
      processVisibility={chatState.processVisibility}
      alignment={chatState.sessionIslandAlignment}
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
      permissionStatus={chatState.permissionStatusOverlay?.payload ?? null}
      onPermissionStatusDismiss={chatState.clearPermissionStatusOverlay}
      toastNotification={chatState.toastOverlay}
      onToastDismiss={chatState.clearToastOverlay}
    />

    <!-- MCP panel (floating below status bar) -->
    {#if chatState.mcpPanelOpen && store.mcpServers.length > 0}
      <div
        class="absolute right-3 z-30"
        style="top: {chatState.statusBarExpanded
          ? 'var(--session-statusbar-offset-expanded)'
          : 'var(--session-statusbar-offset-rest)'}"
      >
        <McpStatusPanel
          runId={store.run?.id ?? ""}
          mcpServers={store.mcpServers}
          sessionAlive={store.sessionAlive}
          onClose={() => (chatState.mcpPanelOpen = false)}
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
            settings={chatState.settings}
            processVisibility={chatState.processVisibility}
            timelineVm={stageTimelineVm}
            sessionVm={stageSessionVm}
            loadingVm={stageLoadingVm}
            thinkingVm={stageThinkingVm}
            forkVm={stageForkVm}
            handlers={stageHandlers}
            bind:thinkingExpanded={thinking.thinkingExpanded}
            showChatScrollHint={scrollState.showChatScrollHint}
            isChatAutoScroll={scrollState.isChatAutoScroll}
            readingHistory={scrollState.readingHistory}
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
          <WorkspaceOverview cwd={workspaceOverviewCwd} />
        </div>
      {/if}
      <div class="flex flex-1 min-h-0 flex-col" class:hidden={!!workspaceOverviewCwd}>
        <ChatConversationStage
          {store}
          settings={chatState.settings}
          processVisibility={chatState.processVisibility}
          timelineVm={stageTimelineVm}
          sessionVm={stageSessionVm}
          loadingVm={stageLoadingVm}
          thinkingVm={stageThinkingVm}
          forkVm={stageForkVm}
          handlers={stageHandlers}
          bind:thinkingExpanded={thinking.thinkingExpanded}
          showChatScrollHint={scrollState.showChatScrollHint}
          isChatAutoScroll={scrollState.isChatAutoScroll}
          readingHistory={scrollState.readingHistory}
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

    {#if scrollState.showScrollButton}
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
      collapsed={chatState.sidebarCollapsed}
      bind:activeTab={chatState.toolPanelActiveTab}
      bind:panelIndicators={chatState.toolPanelIndicators}
      underUnifiedCapsule={true}
      onToggle={toggleSidebar}
      onScrollToTool={scrollToTool}
      onScrollToTurn={(anchorId) => scrollToMessage(anchorId)}
      bind:requestedTab={chatState.sidebarRequestedTab}
      backgroundTasks={store.taskNotifications}
      activeBackgroundTasks={store.activeBackgroundTasks}
      cwd={store.effectiveCwd}
      runId={store.run?.id ?? ""}
      isRemote={store.isRemote}
      bind:requestedPreviewPath={chatState.requestedPreviewPath}
      bind:requestedPreviewUrl={chatState.requestedPreviewUrl}
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

  <ShortcutHelpPanel bind:open={chatState.shortcutHelpOpen} />

  {#if insight.insightPreviewOpen && insight.insightHtml}
    <HtmlReportPreview
      bind:open={insight.insightPreviewOpen}
      html={insight.insightHtml}
      title={t("insight_preview_title")}
    />
  {/if}

  <FolderPicker
    bind:open={fp.folderPickerOpen}
    initialHost={fp.folderPickerInitialHost}
    initialPath={fp.folderPickerInitialPath}
    hideTargetSelector={fp.folderPickerHideTarget}
    onConfirm={(result) => {
      const fn = fp.folderPickerResolve;
      fp.folderPickerResolve = null;
      fn?.(result);
    }}
    onCancel={() => {
      const fn = fp.folderPickerResolve;
      fp.folderPickerResolve = null;
      fn?.(null);
    }}
  />
</div>
