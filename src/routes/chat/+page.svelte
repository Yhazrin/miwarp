<script lang="ts">
  import { page } from "$app/stores";
  import { goto, replaceState } from "$app/navigation";
  import { tick, onMount, untrack, getContext } from "svelte";
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
  import { useToolBurstCollapse } from "$lib/chat/use-tool-burst-collapse.svelte";
  import { useTimelineState } from "$lib/chat/use-timeline-state.svelte";
  import { useThinkingTimer } from "$lib/chat/use-thinking-timer.svelte";
  import { useConversationInsight } from "$lib/conversation-insight/use-conversation-insight.svelte";
  import XTerminal from "$lib/components/XTerminal.svelte";
  import SessionStatusBar from "$lib/components/SessionStatusBar.svelte";
  import McpStatusPanel from "$lib/components/McpStatusPanel.svelte";
  import PromptInput from "$lib/components/PromptInput.svelte";

  import ToolActivity from "$lib/components/ToolActivity.svelte";
  import ShortcutHelpPanel from "$lib/components/ShortcutHelpPanel.svelte";
  import type { PromptInputSnapshot } from "$lib/types";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { setLastTarget, setStoredRemoteCwd } from "$lib/utils/remote-cwd";
  import { shouldAutoName } from "$lib/utils/auto-name";
  import {
    normalizeProcessVisibility,
    getCachedProcessVisibility,
  } from "$lib/utils/process-visibility";
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
  import ChatHeroMeta from "$lib/components/ChatHeroMeta.svelte";
  import RewindModal from "$lib/components/RewindModal.svelte";
  import FolderPicker from "$lib/components/FolderPicker.svelte";
  import HtmlReportPreview from "$lib/components/insight/HtmlReportPreview.svelte";
  import { getPresets } from "$lib/services/team-dispatcher";

  // ── Helpers ──

  // ── Layout context ──
  const _toggleLayoutSidebar = getContext<() => void>("toggleSidebar");
  const keybindingStore = getContext<KeybindingStore>("keybindings");

  // ── Store + Middleware ──
  const store = sessionStore;
  const middleware = getEventMiddleware();

  // ── UI-only state (not in store) ──
  let middlewareReady = $state(false);
  let settings = $state<UserSettings | null>(null);
  let xtermRef: XTerminal | undefined = $state();
  let promptRef: PromptInput | undefined = $state();
  let sidebarCollapsed = $state(false);

  /** Use server settings when loaded; until then last-known cache avoids a dev-mode flash for Output users. */
  const processVisibility = $derived(
    settings != null
      ? normalizeProcessVisibility(settings.process_visibility)
      : getCachedProcessVisibility(),
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
  /** Non-reactive flag: suppresses auto-scroll reset during search scroll-to navigation. */
  let _scrollToInFlight = false;
  let showChatScrollHint = $state(false);
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
    getPresets()
      .then((p) => team.setTeamPresets(p))
      .catch(() => {});
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
  let toolPanelActiveTab = $state<ToolActivityPanelTab>("workspace");
  let toolPanelIndicators = $state({ context: false, files: false, tasks: false });
  let requestedPreviewPath = $state<string | null>(null);
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

  // Task notification: auto-show and dismiss after 5s
  $effect(() => {
    const notifications = store.taskNotifications;
    if (notifications.size === 0) return;
    const latest = Array.from(notifications.values()).pop();
    if (!latest) return;
    latestNotification = { task_id: latest.task_id, status: latest.status };
    notificationVisible = true;
    const timer = setTimeout(() => {
      notificationVisible = false;
    }, 5000);
    return () => clearTimeout(timer);
  });

  // ── URL-derived (primitive values only — avoids $effect re-trigger on unrelated URL changes) ──
  let runId = $derived($page.url.searchParams.get("run") ?? "");
  let hasResumeParam = $derived($page.url.searchParams.has("resume"));
  let folderParam = $derived($page.url.searchParams.get("folder"));
  let hostParam = $derived($page.url.searchParams.get("host"));

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
        if (resolvedHost) {
          setStoredRemoteCwd(resolvedHost, folder);
        } else {
          try {
            localStorage.setItem("ocv:project-cwd", folder);
          } catch {
            // localStorage may fail in restricted contexts
          }
        }
        folderCwdOverride = folder;
        store.loadRun("", xtermRef);
      }
      const clean = new URL($page.url);
      clean.searchParams.delete("folder");
      clean.searchParams.delete("host");
      replaceState(clean, {});
      requestAnimationFrame(() => promptRef?.focus());
    });
  });

  // ── Computed (thin wrappers for template convenience) ──
  let sending = $derived(store.phase === "spawning");

  // Watch runId changes → load run + subscribe middleware
  // Gated on middlewareReady to ensure listeners are registered before subscribing
  $effect(() => {
    if (!middlewareReady) return;
    const id = runId;
    const hasResume = hasResumeParam;
    untrack(() => {
      middleware.subscribeCurrent(id, store);

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
        store.loadRun("", xtermRef);
        cancelProgressive(); // empty run — no progressive needed
        return;
      }

      // If store already holds an active session for this run, skip redundant loadRun
      if (store.run?.id === id && store.sessionAlive) {
        dbg("effect", "skip loadRun — session already alive for", id);
        const scrollTo = $page.url.searchParams.get("scrollTo");
        if (scrollTo) {
          const clean = new URL($page.url);
          clean.searchParams.delete("scrollTo");
          replaceState(clean, {});
          tick().then(() => scrollToMessage(scrollTo));
        }
        return;
      }

      loadRunProgressive(id, xtermRef);
    });
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
      const changed = tl !== prevTl || st !== prevSt;
      prevTl = tl;
      prevSt = st;
      if (isChatAutoScroll) {
        requestAnimationFrame(() => {
          if (chatAreaRef) chatAreaRef.scrollTop = chatAreaRef.scrollHeight;
        });
      } else if (changed) {
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
    isChatAutoScroll = !_scrollToInFlight;
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
      if (!chatAreaRef) return;
      requestAnimationFrame(() => {
        scrollChatToBottom();
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
    showToast: showChatToast,
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
    scrollChatToBottom,
    scrollToTool,
    scrollToMessage,
  } = scrollNav;

  const chatActions = createChatActions({
    store,
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
    showToast: showChatToast,
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

  // Auto-name: on first idle, generate title from prompt (one-shot per run)
  $effect(() => {
    const result = shouldAutoName({
      phase: store.phase,
      runId: store.run?.id,
      runName: store.run?.name,
      prompt: store.run?.prompt,
      autoNameDone,
    });
    if (result.fire && result.autoName) {
      autoNameDone = true;
      handleRename(result.autoName);
    }
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

  // ── Chat-level toast (same pattern as PromptInput's showFileToast) ──
  let chatToast = $state<string | null>(null);
  let chatToastTimeout: ReturnType<typeof setTimeout> | null = null;
  function showChatToast(msg: string) {
    chatToast = msg;
    if (chatToastTimeout) clearTimeout(chatToastTimeout);
    chatToastTimeout = setTimeout(() => {
      chatToast = null;
    }, 2500);
  }

  const insight = useConversationInsight({
    getRun: () => store.run,
    getTimeline: () => store.timeline,
    getUsage: () => store.usage,
    getNumTurns: () => store.numTurns || 0,
    showToast: showChatToast,
  });

  const sendMessage = createSendMessage({
    store,
    thinking,
    getRemoteHosts: () => remoteHosts,
    showToast: showChatToast,
    openFolderPicker,
    handleResume,
    loadCliVersionInfo,
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
  });

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
    getSettings: () => settings,
    setSettings: (v) => {
      settings = v;
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
    setShowChatToast: showChatToast,
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

<div class="relative flex h-full overflow-hidden bg-background">
  <!-- Page-level drag overlay (drag-hover or processing spinner) -->
  <ChatDragOverlay {pageDragActive} {dragProcessing} />

  <!-- Main content area -->
  <div class="flex flex-1 flex-col min-w-0 relative">
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
      onProcessVisibilityChange={handleProcessVisibilityChange}
    />

    <!-- MCP panel (floating below status bar) -->
    {#if mcpPanelOpen && store.mcpServers.length > 0}
      <div class="absolute {statusBarExpanded ? 'top-16' : 'top-9'} right-3 z-30">
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

    <!-- Conversation: messages extend under a soft-fade input dock -->
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
        handleChatScroll,
        scrollChatToBottom,
        handleTermResize,
        handleTermReady,
        handleForkCancel,
        handleForkRetry,
        dismissInitHint,
        loadRunProgressive,
        setLastTarget,
      }}
      bind:thinkingExpanded={thinking.thinkingExpanded}
      {showChatScrollHint}
      bind:xtermRef
      bind:chatAreaRef
    >
      {#snippet heroMetaFooter()}
        {@render heroMetaFooterContent()}
      {/snippet}
      {#snippet inputDock()}
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
            handleInputValueChange: team.handleInputValueChange,
            handlePermissionRespond,
            handleElicitationRespond,
            handleBtwSend,
            handleRalphCancel,
            showChatToast,
          }}
          bind:stashedInput
          bind:shortcutHelpOpen
          bind:promptRef
        />
      {/snippet}
    </ChatConversationStage>
  </div>

  <!-- Tool Activity sidebar -->
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
        showChatToast(t("rewind_degradedToFull"));
      } else {
        showChatToast(t("toast_rewindSuccess"));
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

  <!-- Chat toast (fixed bottom-center, auto-dismiss) -->
  {#if chatToast}
    <div
      class="fixed bottom-20 left-1/2 -translate-x-1/2 z-50
      rounded-lg border bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur-sm
      animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      {chatToast}
    </div>
  {/if}
</div>
