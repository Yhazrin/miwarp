<script lang="ts">
  import { page } from "$app/stores";
  import { goto, replaceState } from "$app/navigation";
  import { tick, onMount, untrack, getContext } from "svelte";
  import { getTransport } from "$lib/transport";
  import * as api from "$lib/api";
  import {
    sessionStore,
    KeybindingStore,
    getEventMiddleware,
    loadCliInfo,
    getCliCurrentModel,
    getCliModels,
    loadCliVersionInfo,
    getCliVersionInfo_cached,
  } from "$lib/stores";
  import type {
    Attachment,
    UserSettings,
    AgentSettings,
    SessionMode,
    CliModelInfo,
    ScreenshotPayload,
    SessionInfoData,
    TimelineEntry,
  } from "$lib/types";
  import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
  import { useToolBurstCollapse } from "$lib/chat/use-tool-burst-collapse.svelte";
  import {
    computeTimelinePresentation,
    getInitialRenderLimit,
  } from "$lib/chat/selectors/timeline-presentation";
  import { APP_TO_CLI_MODE } from "$lib/chat/utils/permission-modes";
  import { useConversationInsight } from "$lib/conversation-insight/use-conversation-insight.svelte";
  import XTerminal from "$lib/components/XTerminal.svelte";
  import type PromptInput from "$lib/components/PromptInput.svelte";
  import SessionStatusBar from "$lib/components/SessionStatusBar.svelte";
  import McpStatusPanel from "$lib/components/McpStatusPanel.svelte";
  import ToolActivity from "$lib/components/ToolActivity.svelte";
  import ShortcutHelpPanel from "$lib/components/ShortcutHelpPanel.svelte";
  import type { PromptInputSnapshot } from "$lib/types";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import ChatTimelineEntries from "$lib/components/chat/ChatTimelineEntries.svelte";
  import ChatInputDock from "$lib/components/chat/ChatInputDock.svelte";
  import { parseContextMarkdown } from "$lib/utils/context-parser";
  import type { ContextSnapshot } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { APP_LOGO_URL } from "$lib/utils/brand-assets";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { getLastTarget, setLastTarget, setStoredRemoteCwd } from "$lib/utils/remote-cwd";
  import { shouldAutoName } from "$lib/utils/auto-name";
  import { type TurnUsage } from "$lib/stores/types";
  import {
    normalizeProcessVisibility,
    getCachedProcessVisibility,
    persistCachedProcessVisibility,
    timelineHasHiddenRoutineWorkRunning,
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
  import { createScrollNavigation } from "$lib/chat/use-scroll-navigation";
  import { createSendMessage } from "$lib/chat/use-send-message";
  import { useThinkingTimer } from "$lib/chat/use-thinking-timer.svelte";
  import { createTeamDispatch } from "$lib/chat/use-team-dispatch";
  import { createProjectInit } from "$lib/chat/use-project-init";
  import { useModelPlatform } from "$lib/chat/use-model-platform.svelte";
  import { createVerboseSync } from "$lib/chat/use-verbose-sync";
  import { createToolResultCache } from "$lib/chat/use-tool-result-cache";
  import { useTimelineState } from "$lib/chat/use-timeline-state.svelte";
  import ChatConversationStage from "$lib/components/chat/ChatConversationStage.svelte";
  import type { RewindCandidate, RewindMarker } from "$lib/utils/rewind";
  import { truncate } from "$lib/utils/format";
  import { uuid } from "$lib/utils/uuid";
  import ChatForkOverlay from "$lib/components/ChatForkOverlay.svelte";
  import ChatThinkingIndicator from "$lib/components/ChatThinkingIndicator.svelte";
  import ChatThinkingPanel from "$lib/components/ChatThinkingPanel.svelte";
  import ChatStreamingText from "$lib/components/ChatStreamingText.svelte";
  import ChatRewindMarkers from "$lib/components/ChatRewindMarkers.svelte";
  import ChatForkedBanner from "$lib/components/ChatForkedBanner.svelte";
  import ChatNotificationBanner from "$lib/components/ChatNotificationBanner.svelte";
  import ChatErrorCard from "$lib/components/ChatErrorCard.svelte";
  import ChatToolFilterBar from "$lib/components/ChatToolFilterBar.svelte";
  import ChatOutputWorkingHint from "$lib/components/ChatOutputWorkingHint.svelte";
  import ChatDragOverlay from "$lib/components/ChatDragOverlay.svelte";
  import ChatUsageAnnotation from "$lib/components/ChatUsageAnnotation.svelte";
  import ChatWelcomeScreen from "$lib/components/ChatWelcomeScreen.svelte";
  import ChatHeroMeta from "$lib/components/ChatHeroMeta.svelte";
  import ChatInitHint from "$lib/components/ChatInitHint.svelte";
  import ViewModeToggle from "$lib/components/ViewModeToggle.svelte";
  import HookReviewCard from "$lib/components/HookReviewCard.svelte";
  import TeamRunCard from "$lib/components/TeamRunCard.svelte";
  import RewindModal from "$lib/components/RewindModal.svelte";
  import FolderPicker from "$lib/components/FolderPicker.svelte";
  import TeamDispatchConfirm from "$lib/components/TeamDispatchConfirm.svelte";
  import HtmlReportPreview from "$lib/components/insight/HtmlReportPreview.svelte";
  import type { TeamRun, TeamPreset } from "$lib/types";

  // ── Helpers ──

  // ── Layout context ──
  const toggleLayoutSidebar = getContext<() => void>("toggleSidebar");
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
  /** Generation counter for reloadProjectData race guard. */
  let preloadGen = 0;
  /** Local proxy running statuses for AuthSourceBadge. */
  let localProxyStatuses = $state<Record<string, { running: boolean; needsAuth: boolean }>>({});

  // ── Project init detection ──
  let projectInitStatus = $state<import("$lib/types").ProjectInitStatus | null>(null);
  let initCheckSeq = 0;

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

  // ── Team dispatch ──
  let teamDispatchOpen = $state(false);
  let teamDispatchPrompt = $state("");
  let activeTeamRuns = $state<TeamRun[]>([]);
  let teamHintVisible = $state(false);
  let teamPresets = $state<TeamPreset[]>([]);

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

  // ── Verbose state (from composable) ──
  let verboseEnabled = $state(false);
  let verboseRetryTick = $state(0);
  const { syncVerboseState, cleanup: cleanupVerbose } = createVerboseSync({
    getVerboseEnabled: () => verboseEnabled,
    setVerboseEnabled: (v) => {
      verboseEnabled = v;
    },
    getVerboseRetryTick: () => verboseRetryTick,
    setVerboseRetryTick: (v) => {
      verboseRetryTick = v;
    },
  });

  // ── Tool result cache (from composable) ──
  const { fetchToolResult, clearCache: clearToolResultCache } = createToolResultCache({
    getRunId: () => store.run?.id,
  });
  $effect(() => {
    const _ = store.run?.id;
    clearToolResultCache();
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

  let lastAssistantIdx = $derived.by(() => {
    for (let j = visibleTimeline.length - 1; j >= 0; j--) {
      if (visibleTimeline[j].kind === "assistant") return j;
    }
    return -1;
  });

  // ── Input history (most recent first) ──
  let userHistory = $derived.by(() =>
    store.timeline
      .filter((e): e is Extract<TimelineEntry, { kind: "user" }> => e.kind === "user")
      .map((e) => e.content)
      .reverse(),
  );

  // ── Batch groups (consecutive ≥3 Task tools) ──

  let _lastBatchSig = "";
  $effect(() => {
    const size = batchGroups.size;
    const agents = size > 0 ? [...batchGroups.values()].reduce((s, g) => s + g.length, 0) : 0;
    const sig = `${size}:${agents}`;
    if (sig !== _lastBatchSig) {
      _lastBatchSig = sig;
      if (size > 0) dbg("chat", "batchGroups", { groupCount: size, totalAgents: agents });
    }
  });

  // ── Tool burst visual state management ─────────────────────────────────
  // Replaces pure $derived autoCollapse with staged transitions:
  // expanded → settling (400ms) → collapsing (260ms) → collapsed

  let burstCollapse = useToolBurstCollapse(
    () => toolBursts,
    () => store.run?.id,
  );

  // Sync visual states when burst *content* changes — not on every new Map reference.
  let toolBurstSig = $derived.by(() => {
    const parts: string[] = [];
    for (const [idx, burst] of toolBursts) {
      const statuses = burst.tools.map((tool) => tool.status).join(",");
      parts.push(`${idx}:${burst.key}:${burst.stats.running}:${burst.stats.total}:${statuses}`);
    }
    return parts.join("|");
  });

  $effect(() => {
    const _ = toolBurstSig;
    untrack(() => burstCollapse.syncStates());
  });

  // Reset on run switch — only when runId actually changes
  let prevRunId: string | undefined = undefined;
  $effect(() => {
    const runId = store.run?.id;
    if (runId !== prevRunId) {
      prevRunId = runId;
      burstCollapse.reset();
    }
  });

  // Note: we access burstCollapse state directly in the template via reactive getters,
  // not through local let bindings (which would not be reactive).
  // burstCollapse.effectiveCollapsed, .collapsingIndices, .collapsedIndices are all
  // reactive $derived getters — always access through burstCollapse in templates.
  let toggleBurst = burstCollapse.toggleBurst;

  // ── Auto-context tracking ──
  // Map<runId, snapshots> — persists across run switches within the session
  let contextHistoryMap = $state<Map<string, ContextSnapshot[]>>(new Map());
  let contextHistory = $derived(contextHistoryMap.get(store.run?.id ?? "") ?? []);

  // ── Cumulative session token totals (from modelUsage, which is session-cumulative) ──
  // status bar shows session totals; per-turn values are in the turn separator annotations.
  let cumulativeTokens = $derived.by(() => {
    const mu = store.usage.modelUsage;
    if (!mu || Object.keys(mu).length === 0) {
      // No modelUsage yet — fall back to per-turn values (better than zero)
      return {
        input: store.usage.inputTokens,
        output: store.usage.outputTokens,
        cacheRead: store.usage.cacheReadTokens,
        cacheWrite: store.usage.cacheWriteTokens,
      };
    }
    let input = 0,
      output = 0,
      cacheRead = 0,
      cacheWrite = 0;
    for (const entry of Object.values(mu)) {
      input += entry.input_tokens;
      output += entry.output_tokens;
      cacheRead += entry.cache_read_tokens;
      cacheWrite += entry.cache_write_tokens;
    }
    return { input, output, cacheRead, cacheWrite };
  });

  // ── Session info for InfoPanel ──
  let currentSessionInfo: SessionInfoData | null = $derived.by(() => {
    if (!store.run) return null;
    return {
      sessionId: store.run.session_id,
      runId: store.run.id,
      runName: store.run.name,
      cwd: store.sessionCwd || store.run.cwd,
      numTurns: store.numTurns,
      status: store.run.status ?? "pending",
      startedAt: store.run.started_at ?? null,
      endedAt: store.run.ended_at ?? null,
      lastTurnDurationMs: store.durationMs,
      tokensEstimated: !store.usage.modelUsage || Object.keys(store.usage.modelUsage).length === 0,
      model: store.run.model ?? store.model,
      agent: store.run.agent ?? store.agent,
      cliVersion: store.cliVersion,
      permissionMode: store.permissionMode,
      fastModeState: store.fastModeState,
      cost: store.usage.cost,
      inputTokens: cumulativeTokens.input,
      outputTokens: cumulativeTokens.output,
      cacheReadTokens: cumulativeTokens.cacheRead,
      cacheWriteTokens: cumulativeTokens.cacheWrite,
      contextWindow: store.contextWindow,
      contextUtilization: store.contextUtilization,
      compactCount: store.compactCount,
      microcompactCount: store.microcompactCount,
      mcpServers: store.mcpServers,
      remoteHostName: store.remoteHostName,
      platformId: store.platformId,
      cliUsageIncomplete: store.run.cli_usage_incomplete ?? false,
      runSource: store.run.source,
      authSourceLabel: store.authSourceLabel || undefined,
      platformName: platformDisplayName || undefined,
      cliUpdateAvailable:
        store.cliVersion && channelLatest && channelLatest !== store.cliVersion
          ? channelLatest
          : undefined,
    };
  });

  // ── Sidebar data ──

  // ── CLI version info (reactive — ensures heroMetaFooter re-renders after async load) ──
  let cliVersionInfo = $derived(getCliVersionInfo_cached());

  // ── CLI update channel ──
  let channelLatest = $derived.by(() => {
    if (!cliVersionInfo?.installed) return undefined;
    return cliVersionInfo.channel === "stable" ? cliVersionInfo.stable : cliVersionInfo.latest;
  });

  // ── Model platform (from composable) ──
  const modelPlatform = useModelPlatform({
    store,
    getSettings: () => settings,
    getAuthOverview: () => authOverview,
  });
  const {
    currentEffort: effortProxy,
    platformDisplayName,
    platformModels,
    effectiveModels,
    isContaminatedDefaultModel,
    setLastKnownGoodModel,
  } = modelPlatform;

  // Reset filter on run change & auto-focus input
  $effect(() => {
    const _ = store.run?.id;
    toolFilter = null;
    // Auto-focus the prompt input when entering a session
    requestAnimationFrame(() => promptRef?.focus());
  });

  // Sync verbose state from CLI config when run changes (or on retry)
  $effect(() => {
    const _tick = verboseRetryTick; // extra dep: drives retry on failure
    syncVerboseState(store.run?.id);
  });

  // Sentinel above the visible list — when it intersects the chat viewport, grow renderLimit.
  let topSentinel = $state<HTMLDivElement | null>(null);
  let _topObserver: IntersectionObserver | null = null;

  $effect(() => {
    if (!topSentinel || !chatAreaRef) {
      _topObserver?.disconnect();
      _topObserver = null;
      return;
    }
    _topObserver?.disconnect();
    _topObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!loadMoreArmed || loadingMore) return;
        const hidden = filteredTimeline.length - renderLimit;
        if (hidden <= 0) return;
        dbg("chat", "progressive-load-more", { renderLimit, hidden });
        void loadMoreEarlier();
      },
      { root: chatAreaRef, rootMargin: "200px 0px 0px 0px", threshold: 0 },
    );
    _topObserver.observe(topSentinel);
    return () => {
      _topObserver?.disconnect();
      _topObserver = null;
    };
  });

  let inputBlockedByPermission = $derived(store.hasPendingPermission || store.hasElicitation);
  let pendingToolPermissions = $derived(store.pendingToolPermissions);
  let showPermissionPanel = $derived(pendingToolPermissions.length > 0 && store.sessionAlive);

  /** Skill info for SkillSelector: merge preloaded details with session skill names. */
  let skillItems = $derived.by(() => {
    const detailMap = new Map(preloadedSkills.map((s) => [s.name, s]));
    const names = store.availableSkills;
    if (names.length > 0) {
      return names.map((name) => ({
        name,
        description: detailMap.get(name)?.description ?? "",
      }));
    }
    return preloadedSkills.map((s) => ({ name: s.name, description: s.description }));
  });

  // ── Per-turn usage annotations in timeline ──

  let usageByTurn = $derived(new Map(store.turnUsages.map((tu) => [tu.turnIndex, tu])));

  /** Map of visibleTimeline index → TurnUsage to show BEFORE this entry (turn boundary). */
  let usageAnnotations = $derived.by(() => {
    const map = new Map<number, TurnUsage>();
    if (usageByTurn.size === 0) return map;
    const vt = visibleTimeline;
    const hidden = filteredTimeline.length - vt.length;
    let userCount = userCountPrefix[hidden];
    for (let i = 0; i < vt.length; i++) {
      if (vt[i].kind === "user") {
        if (userCount > 0) {
          const tu = usageByTurn.get(userCount);
          if (tu) map.set(i, tu);
        }
        userCount++;
      }
    }
    return map;
  });

  /**
   * Indices where a Claude turn starts (first tool after a user message).
   * Used to render a "Claude" header before tool cards.
   */
  let claudeTurnStarts = $derived.by(() => {
    const starts = new Set<number>();
    const vt = visibleTimeline;
    for (let i = 0; i < vt.length; i++) {
      if (vt[i].kind !== "tool") continue;
      if (burstCollapse.collapsedIndices.has(i)) continue;
      // Look back for the previous visible non-tool entry
      for (let j = i - 1; j >= 0; j--) {
        if (burstCollapse.collapsedIndices.has(j)) continue;
        if (vt[j].kind === "tool") continue;
        if (vt[j].kind === "user") starts.add(i);
        break;
      }
    }
    return starts;
  });

  /** Usage for the last (current/latest) turn — shown after all entries. */
  let lastTurnUsage = $derived.by(() => {
    const userCount = filteredTimeline.filter((e) => e.kind === "user").length;
    if (userCount === 0) return null;
    return usageByTurn.get(userCount) ?? null;
  });

  // ── Fork overlay ──
  let forkOverlay = $state<{
    active: boolean;
    sourceRunId: string;
    startedAt: number;
    error: string | null;
  } | null>(null);
  let forkElapsed = $state(0);

  // ── Thinking timer + panel ──
  const thinkingTimer = useThinkingTimer(store);
  const { thinkingElapsed, thinkingExpanded, spinnerVerb, thinkingVisible } = thinkingTimer;

  /** Slash command processing indicator — shown before thinkingVisible kicks in. */
  let processingSlashCmd = $state<string | null>(null);
  let slashCmdSeenRunning = $state(false);

  $effect(() => {
    if (!processingSlashCmd) return;
    if (store.isRunning) slashCmdSeenRunning = true;
    if (
      store.streamingText ||
      store.thinkingText ||
      store.error ||
      store.phase === "failed" ||
      store.phase === "completed" ||
      store.phase === "stopped" ||
      (slashCmdSeenRunning && store.phase === "idle")
    ) {
      processingSlashCmd = null;
      slashCmdSeenRunning = false;
    }
  });

  // Fork overlay timer: tick elapsed seconds while active
  $effect(() => {
    if (forkOverlay?.active && !forkOverlay.error) {
      const interval = setInterval(() => {
        forkElapsed = Math.floor((Date.now() - forkOverlay!.startedAt) / 1000);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      forkElapsed = 0;
    }
  });

  // Fork overlay phase watcher: show error on failure during step 1 (fork_oneshot).
  // Overlay is dismissed explicitly by handleResume after step 1 succeeds.
  // Guard `!forkOverlay.error`: only set error once to prevent infinite $effect loop —
  // writing `forkOverlay = { ...spread }` creates a new object ref that re-triggers the effect.
  $effect(() => {
    if (!forkOverlay?.active) return;
    const phase = store.phase;
    if ((phase === "failed" || phase === "stopped") && !forkOverlay.error) {
      forkOverlay = { ...forkOverlay, error: store.error || t("chat_forkFailedFallback") };
    }
  });

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
    !!runId && loadingRunId === runId && store.run?.id !== runId && !store.error,
  );

  let routeRunLoadFailed = $derived(
    !!runId && store.run?.id !== runId && store.phase === "failed" && !!store.error,
  );

  let welcomeVisible = $derived(
    !runId &&
      !loadingRunId &&
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

  // ── Lifecycle ──

  // Load settings
  onMount(async () => {
    // Phase 1: load settings (required by everything else)
    try {
      settings = await api.getUserSettings();
      persistCachedProcessVisibility(normalizeProcessVisibility(settings.process_visibility));
      store.authMode = settings.auth_mode ?? "cli";
      remoteHosts = settings.remote_hosts ?? [];
      // Restore last target selection (must validate against current settings — a
      // configured host may have been removed since the value was persisted).
      if (!store.run && remoteHosts.length > 0) {
        const lastTarget = getLastTarget();
        if (lastTarget && remoteHosts.some((h) => h.name === lastTarget)) {
          store.remoteHostName = lastTarget;
        }
      }
      // Initialize per-session platform from global active
      // Only use active_platform_id in App API Key mode; CLI Auth manages its own connection
      if (!store.platformId) {
        store.platformId =
          settings.auth_mode === "api" ? (settings.active_platform_id ?? "anthropic") : "anthropic";
      }
      // Initialize model: for third-party platforms, use credential > preset default model
      // Only for new sessions — if runId is set, loadRun will handle model restoration.
      if (!store.model && !runId && store.phase !== "loading") {
        const initCred = findCredential(
          settings.platform_credentials ?? [],
          store.platformId ?? "",
        );
        const initPreset = PLATFORM_PRESETS.find((p) => p.id === store.platformId);
        const initModels = initCred?.models?.length ? initCred.models : initPreset?.models;
        if (store.platformId !== "anthropic" && initModels?.[0]) {
          store.model = initModels[0];
        } else if (store.platformId === "anthropic" && settings.default_model) {
          // default_model is global — only valid for Anthropic native platform.
          // Third-party platforms without a models list leave model unset.
          store.model = settings.default_model;
        }
      }
      // Load auth overview for AuthSourceBadge (fire-and-forget)
      api
        .getAuthOverview()
        .then((ov) => (authOverview = ov))
        .catch(() => {});
      // Detect local proxy statuses for AuthSourceBadge
      checkAllLocalProxies();
    } catch (e) {
      dbgWarn("chat", "failed to load settings:", e);
    }

    // Phase 2: parallel fetch of independent data
    const [agentResult, runsResult] = await Promise.allSettled([
      api.getAgentSettings("claude"),
      api.listRuns(),
    ]);

    if (agentResult.status === "fulfilled") {
      agentSettings = agentResult.value;
      // Read effort from CLI config (~/.claude/settings.json) — the authoritative source.
      // NOT from agentSettings.effort (that would cause --effort flag at spawn, which
      // locks effort in memory and prevents live switching via settings.json).
      try {
        const cliCfg = await api.getCliConfig();
        const cliEffort = cliCfg.effortLevel;
        modelPlatform.currentEffort = typeof cliEffort === "string" && cliEffort ? cliEffort : "";
      } catch {
        modelPlatform.currentEffort = "";
      }
      // One-time migration: clear stale agentSettings.effort to prevent --effort at spawn
      if (agentSettings?.effort) {
        api.updateAgentSettings("claude", { effort: "" }).catch(() => {});
      }
    } else {
      dbgWarn("chat", "failed to load agent settings:", agentResult.reason);
    }

    if (runsResult.status === "fulfilled") {
      lastContinuableRun =
        runsResult.value.find(
          (r) =>
            r.session_id &&
            (r.status === "completed" || r.status === "stopped" || r.status === "failed"),
        ) ?? null;

      // Auto-load last session if no runId is specified, instead of showing welcome screen
      if (!runId && lastContinuableRun) {
        goto(`/chat?run=${lastContinuableRun.id}&resume=continue`, { replaceState: true });
        return;
      }
    } else {
      dbgWarn("chat", "failed to load runs for continue:", runsResult.reason);
    }

    // Phase 3: permission mode init (depends on settings + agentSettings)
    // Initialize permission mode from saved settings (before session_init arrives)
    // Agent plan_mode=true overrides user permission_mode (legacy compat)
    if (!store.permissionModeSetByUser) {
      if (agentSettings?.plan_mode) {
        store.permissionMode = "plan";
        store.permissionModeSetByUser = true;
      } else if (settings?.permission_mode) {
        const cliName = APP_TO_CLI_MODE[settings.permission_mode] ?? settings.permission_mode;
        store.permissionMode = cliName;
        store.permissionModeSetByUser = true;
      }
    }
    let selfHealDone = false;
    let selfHealInFlight = false;
    loadCliInfo().then(() => {
      // Self-heal: detect and fix contaminated default_model
      if (settings?.default_model && !selfHealDone && !selfHealInFlight) {
        const dm = settings.default_model;
        const contaminated = isContaminatedDefaultModel(dm);
        if (contaminated === true) {
          const healModel = getCliCurrentModel();
          if (healModel) {
            selfHealInFlight = true;
            dbg("chat", "self-heal: default_model contaminated, persisting fix", {
              old: dm,
              new: healModel,
            });
            api
              .updateUserSettings({ default_model: healModel })
              .then(() => {
                settings!.default_model = healModel;
                setLastKnownGoodModel(healModel);
                selfHealDone = true;
                dbg("chat", "self-heal: persist succeeded");
              })
              .catch((e) => {
                dbgWarn("chat", "self-heal persist failed, will retry next loadCliInfo", e);
              })
              .finally(() => {
                selfHealInFlight = false;
              });
          } else {
            dbg("chat", "self-heal: contaminated but CLI model unavailable, deferring", { dm });
          }
        } else if (contaminated === false) {
          selfHealDone = true;
        }
      }

      const cliModel = getCliCurrentModel();
      const isThirdParty = store.platformId && store.platformId !== "anthropic";
      // Update lastKnownGoodAnthropicModel when CLI model is available
      if (cliModel && !isThirdParty) {
        setLastKnownGoodModel(cliModel);
      }
      // Only for genuinely new chats: no run loaded/loading, no URL run param
      if (cliModel && !store.run && !runId && store.phase !== "loading" && !isThirdParty) {
        dbg("chat", "set model from CLI after loadCliInfo", { cliModel, prev: store.model });
        store.model = cliModel;
      }
    });
    loadCliVersionInfo();
    checkProjectInit();
    // Preload project data from filesystem (no session needed)
    if (!runId) {
      const cwd = localStorage.getItem("ocv:project-cwd") || "";
      reloadProjectData(cwd);
    }
  });

  // Listen for project folder changes to re-check project init + reload project data
  onMount(() => {
    const handler = () => {
      checkProjectInit();
      if (!runId && !store.run) {
        const cwd = localStorage.getItem("ocv:project-cwd") || "";
        reloadProjectData(cwd);
      }
    };
    window.addEventListener("ocv:project-changed", handler);
    return () => window.removeEventListener("ocv:project-changed", handler);
  });

  // Warm up file IPC chain: validate_file_path's first invocation walks several
  // canonicalize() calls (data dir, claude dir, agents' working dirs, project cwd).
  // Firing one stat at chat-page mount primes the OS FS cache so the user's first
  // file click doesn't pay the cold-cache cost.
  onMount(() => {
    const cwd = localStorage.getItem("ocv:project-cwd") || "";
    if (!cwd) return;
    const t0 = performance.now();
    api
      .statTextFile(cwd, cwd)
      .then(() => dbg("file-ipc", "warmup done", { ms: +(performance.now() - t0).toFixed(0) }))
      .catch((e) =>
        dbg("file-ipc", "warmup err (still warmed)", {
          ms: +(performance.now() - t0).toFixed(0),
          err: String(e),
        }),
      );
  });

  // Sync run name when sidebar/history renames the current run
  onMount(() => {
    function onRunsChanged() {
      if (!store.run) return;
      const id = store.run.id;
      api
        .getRun(id)
        .then((fresh) => {
          if (fresh && store.run?.id === id && fresh.name !== store.run.name) {
            dbg("chat", "runs-changed: syncing name", { id, name: fresh.name });
            store.run = { ...store.run, name: fresh.name ?? undefined };
            if (fresh.name) autoNameDone = true;
          }
        })
        .catch((e) => {
          dbgWarn("chat", "runs-changed: failed to sync name", e);
        });
    }
    window.addEventListener("ocv:runs-changed", onRunsChanged);
    return () => window.removeEventListener("ocv:runs-changed", onRunsChanged);
  });

  // Start middleware + register handlers
  onMount(() => {
    let destroyed = false;
    (async () => {
      try {
        await middleware.start();
      } catch (e) {
        console.error("[chat] middleware.start() failed:", e);
        store.error = t("chat_eventSystemFailed");
      }
      // Start notification listener (piggybacks on same transport)
      try {
        const { startNotificationListener } = await import("$lib/services/notification-listener");
        await startNotificationListener();
      } catch {
        // Non-critical: notifications are best-effort
      }
      if (!destroyed) middlewareReady = true;
    })();

    // Pipe handler: chat-delta / chat-done (Codex pipe mode)
    middleware.setPipeHandler({
      onDelta(delta) {
        store.handleChatDelta(delta.text, xtermRef);
      },
      onDone(done) {
        store.handleChatDone(done);
      },
    });

    // Run event handler: stderr for Codex pipe mode
    middleware.setRunEventHandler({
      onRunEvent(event) {
        if (
          store.run?.execution_path === "pipe_exec" &&
          store.run &&
          event.run_id === store.run.id &&
          xtermRef
        ) {
          if (event.type === "stderr") {
            xtermRef.writeText(`\x1b[31m${event.text}\x1b[0m\r\n`);
          }
        }
      },
    });

    return () => {
      destroyed = true;
      // Kill fork run process on unmount (but not the source run)
      if (forkOverlay?.active && store.run && store.run.id !== forkOverlay.sourceRunId) {
        api.stopSession(store.run.id).catch(() => {});
      }
      store.unmountGuards();
      middleware.destroy();
    };
  });

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

  // Auto-focus prompt input on mount + listen for status bar toggle + register chat keybindings
  onMount(() => {
    requestAnimationFrame(() => promptRef?.focus());
    function onStatusBarToggle(e: Event) {
      statusBarExpanded = (e as CustomEvent).detail.expanded;
    }
    window.addEventListener("ocv:statusbar-toggle", onStatusBarToggle);

    // Register chat-context keybinding callbacks
    keybindingStore.registerCallback("chat:interrupt", () => {
      if (shortcutHelpOpen) {
        shortcutHelpOpen = false;
        return;
      }
      if (store.isRunning) {
        store.interrupt();
      }
    });
    keybindingStore.registerCallback("chat:sendGlobal", () => {
      if (!store.isRunning) {
        promptRef?.triggerSend();
      }
    });
    keybindingStore.registerCallback("app:shortcutHelp", () => {
      shortcutHelpOpen = !shortcutHelpOpen;
    });
    keybindingStore.registerCallback("app:modelPicker", () => {
      statusBarRef?.openModelDropdown();
    });
    keybindingStore.registerCallback("chat:cyclePermission", () => {
      // Guard: if focus is on a focusable interactive control, don't cycle (preserve Shift+Tab navigation)
      const active = document.activeElement;
      if (active && active !== document.body) {
        const el = active as HTMLElement;
        const isFocusable =
          el.tagName === "BUTTON" ||
          el.tagName === "SELECT" ||
          el.tagName === "A" ||
          (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") ||
          el.closest("[role='menu']") ||
          el.closest("[role='listbox']") ||
          el.closest("[role='dialog']") ||
          (el.hasAttribute("role") &&
            ["button", "link", "menuitem", "option", "tab"].includes(
              el.getAttribute("role") ?? "",
            ));
        if (isFocusable) return;
      }
      const modes = ["default", "acceptEdits", "bypassPermissions", "plan", "auto", "dontAsk"];
      const idx = modes.indexOf(store.permissionMode);
      const next = modes[(idx + 1) % modes.length];
      handlePermissionModeChange(next);
    });
    keybindingStore.registerCallback("chat:stashPrompt", () => {
      if (stashedInput) {
        promptRef?.restoreSnapshot(stashedInput);
        stashedInput = null;
        showChatToast(t("toast_stashRestored"));
      } else {
        const snapshot = promptRef?.getInputSnapshot();
        if (
          snapshot &&
          (snapshot.text.trim() ||
            snapshot.attachments.length ||
            snapshot.pastedBlocks.length ||
            (snapshot.pathRefs?.length ?? 0) > 0)
        ) {
          stashedInput = snapshot;
          promptRef?.clearAll();
          showChatToast(t("toast_stashSaved"));
        }
      }
    });
    keybindingStore.registerCallback("app:toggleFastMode", () => {
      toggleCliConfigBool("fastMode");
    });
    keybindingStore.registerCallback("chat:toggleVerbose", () => {
      toggleCliConfigBool("verbose");
    });
    keybindingStore.registerCallback("chat:toggleTasks", () => {
      if (store.hasBackgroundTasks) {
        if (sidebarCollapsed) sidebarCollapsed = false;
        sidebarRequestedTab = "tasks";
      }
    });
    keybindingStore.registerCallback("chat:undoLastTurn", () => {
      handleRewind();
    });
    keybindingStore.registerCallback("app:summarizeChat", () => void handleSummarize());
    const onSummarizeEvent = () => {
      window.dispatchEvent(new CustomEvent("ocv:summarize-chat-ack"));
      void handleSummarize();
    };
    window.addEventListener("ocv:summarize-chat", onSummarizeEvent);

    // Screenshot event listener (global hotkey → attachment injection)
    const chatTransport = getTransport();
    const screenshotUnlisten = chatTransport.listen<ScreenshotPayload>(
      "screenshot-taken",
      (payload) => {
        dbg("chat", "screenshot-taken", { filename: payload.filename });
        const { contentBase64, mediaType, filename } = payload;
        const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
        const file = new File([bytes], filename, { type: mediaType });
        promptRef?.addFiles([file]);
      },
    );

    // Tauri native drag-drop listeners (dragDropEnabled: true in tauri.conf.json)
    const dragEnterUnlisten = chatTransport.listen<{ paths: string[] }>(
      "tauri://drag-enter",
      () => {
        pageDragActive = true;
      },
    );
    const dragLeaveUnlisten = chatTransport.listen("tauri://drag-leave", () => {
      pageDragActive = false;
    });
    const clearPageDrag = () => {
      pageDragActive = false;
    };
    window.addEventListener("dragend", clearPageDrag);
    window.addEventListener("drop", clearPageDrag);
    const dragDropUnlisten = chatTransport.listen<{ paths: string[] }>(
      "tauri://drag-drop",
      handleTauriDrop,
    );

    return () => {
      window.removeEventListener("ocv:statusbar-toggle", onStatusBarToggle);
      keybindingStore.unregisterCallback("chat:interrupt");
      keybindingStore.unregisterCallback("chat:sendGlobal");
      keybindingStore.unregisterCallback("app:shortcutHelp");
      keybindingStore.unregisterCallback("app:modelPicker");
      keybindingStore.unregisterCallback("chat:cyclePermission");
      keybindingStore.unregisterCallback("chat:stashPrompt");
      keybindingStore.unregisterCallback("app:toggleFastMode");
      keybindingStore.unregisterCallback("chat:toggleVerbose");
      keybindingStore.unregisterCallback("chat:toggleTasks");
      keybindingStore.unregisterCallback("chat:undoLastTurn");
      keybindingStore.unregisterCallback("app:summarizeChat");
      window.removeEventListener("ocv:summarize-chat", onSummarizeEvent);
      screenshotUnlisten.then((fn) => fn());
      dragEnterUnlisten.then((fn) => fn());
      dragLeaveUnlisten.then((fn) => fn());
      dragDropUnlisten.then((fn) => fn());
      window.removeEventListener("dragend", clearPageDrag);
      window.removeEventListener("drop", clearPageDrag);
      // Clean up verbose retry timer
      if (verboseRetryTimer) clearTimeout(verboseRetryTimer);
      // Clean up progressive rendering timer
      cancelProgressive();
    };
  });

  // Listen for auto-context snapshots from Rust backend
  onMount(() => {
    const unlisten = getTransport().listen<{
      runId: string;
      content: string;
      turnIndex: number;
      ts: string;
    }>("context-snapshot", (payload) => {
      const { runId, content, turnIndex, ts } = payload;
      dbg("chat", "context-snapshot-recv", { runId, turnIndex, len: content.length });
      if (runId !== store.run?.id) return;
      const data = parseContextMarkdown(content);
      if (!data) {
        dbgWarn("chat", "context-parse-failed", {
          runId,
          turnIndex,
          head: content.slice(0, 200),
        });
        return;
      }
      // Upsert by turnIndex: same turn overwrites (not appends)
      const prev = contextHistoryMap.get(runId) ?? [];
      const existingIdx = prev.findIndex((s) => s.turnIndex === turnIndex);
      const replaced = existingIdx >= 0;
      const updated = replaced
        ? prev.map((s, i) => (i === existingIdx ? { runId, turnIndex, ts, data } : s))
        : [...prev, { runId, turnIndex, ts, data }];
      contextHistoryMap.set(runId, updated);
      contextHistoryMap = new Map(contextHistoryMap); // trigger reactivity
      dbg("chat", "context-snapshot", { turn: turnIndex, pct: data.percentage, replaced });
    });
    return () => {
      unlisten.then((f) => f());
    };
  });

  // ── BTW event listeners ──
  // NOTE: Don't filter by btw_id — events may arrive before the IPC call returns
  // the btw_id (race condition). Only one BTW is active at a time, so checking
  // btwState.active is sufficient.
  onMount(() => {
    const transport = getTransport();
    const deltaUnlisten = transport.listen<import("$lib/types").BtwDelta>("btw-delta", (ev) => {
      if (btwState.active) {
        dbg("chat", "btw-delta", { len: ev.text.length });
        btwState.answer += ev.text;
      }
    });
    const completeUnlisten = transport.listen<import("$lib/types").BtwComplete>(
      "btw-complete",
      (ev) => {
        if (btwState.active) {
          dbg("chat", "btw-complete", { btwId: ev.btw_id });
          btwState.loading = false;
        }
      },
    );
    const errorUnlisten = transport.listen<import("$lib/types").BtwError>("btw-error", (ev) => {
      if (btwState.active) {
        dbgWarn("chat", "btw-error", { error: ev.error });
        btwState.error = ev.error;
        btwState.loading = false;
      }
    });
    return () => {
      deltaUnlisten.then((f) => f());
      completeUnlisten.then((f) => f());
      errorUnlisten.then((f) => f());
    };
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

  // ── Permission pending auto-scroll (only for inline AskUserQuestion/ExitPlanMode) ──
  let prevPermissionRunId = "";
  let prevHadPermission = false;

  $effect(() => {
    const runId = store.run?.id ?? "";
    const hasInline = store.hasInlinePermission;

    if (runId !== prevPermissionRunId) {
      prevPermissionRunId = runId;
      prevHadPermission = false;
    }

    if (hasInline && !prevHadPermission) {
      if (!chatAreaRef) return;
      requestAnimationFrame(() => {
        scrollChatToBottom();
      });
      dbg("chat", "inline permission pending -> autoscroll", { runId });
    }

    prevHadPermission = hasInline;
  });

  // ── Permission panel visibility log ──
  let _prevPanelCount = 0;
  $effect(() => {
    const count = pendingToolPermissions.length;
    if (count !== _prevPanelCount) {
      if (count > 0)
        dbg("chat", "permissionPanel visible", {
          count,
          ids: pendingToolPermissions.map((p) => p.requestId),
          tools: pendingToolPermissions.map((p) => p.tool.tool_name),
        });
      else if (_prevPanelCount > 0) dbg("chat", "permissionPanel hidden");
      _prevPanelCount = count;
    }
  });

  // ── Project init detection ──
  let showInitHint = $derived(
    projectInitStatus !== null && !projectInitStatus.has_claude_md && !store.run,
  );

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
    handleHookCallbackRespond,
  } = createPermissionHandlers({
    store,
    get timelineIdIndex() {
      return timelineIdIndex;
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
    getCurrentEffort: () => modelPlatform.currentEffort,
    setCurrentEffort: (v: string) => {
      modelPlatform.currentEffort = v;
    },
    setLastKnownGoodModel: (v: string) => {
      setLastKnownGoodModel(v);
    },
    setAuthOverview: (v) => {
      authOverview = v;
    },
    setLocalProxyStatuses: (v) => {
      localProxyStatuses = v;
    },
    getCliCurrentModel,
  });

  const projectInit = createProjectInit({
    store,
    getPreloadGen: () => preloadGen,
    setPreloadGen: (v) => {
      preloadGen = v;
    },
    setPreloadedSkills: (v) => {
      preloadedSkills = v;
    },
    setPreloadedAgents: (v) => {
      preloadedAgents = v;
    },
    setProjectCommands: (v) => {
      projectCommands = v;
    },
    setProjectInitStatus: (v) => {
      projectInitStatus = v;
    },
    getProjectInitStatus: () => projectInitStatus,
    getInitCheckSeq: () => initCheckSeq,
    setInitCheckSeq: (v) => {
      initCheckSeq = v;
    },
  });
  const { reloadProjectData, checkProjectInit, dismissInitHint } = projectInit;

  const scrollNav = createScrollNavigation({
    store,
    tick,
    getChatAreaRef: () => chatAreaRef,
    getFilteredTimeline: () => filteredTimeline,
    getVisibleTimeline: () => visibleTimeline,
    getToolBursts: () => toolBursts,
    burstCollapse,
    getProcessVisibility: () => processVisibility,
    getRenderLimit: () => renderLimit,
    setRenderLimit: (v: number) => {
      renderLimit = v;
    },
    getToolFilter: () => toolFilter,
    setToolFilter: (v: string | null) => {
      toolFilter = v;
    },
    getLoadingRunId: () => loadingRunId,
    setLoadingRunId: (v: string | null) => {
      loadingRunId = v;
    },
    getLoadingMore: () => loadingMore,
    setLoadingMore: (v: boolean) => {
      loadingMore = v;
    },
    getLoadMoreArmed: () => loadMoreArmed,
    setLoadMoreArmed: (v: boolean) => {
      loadMoreArmed = v;
    },
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

  const {
    cancelProgressive,
    loadMoreEarlier,
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
      verboseEnabled = v;
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
    getForkOverlay: () => forkOverlay,
    setForkOverlay: (v) => {
      forkOverlay = v;
    },
    setLastContinuableRun: (v) => {
      lastContinuableRun = v;
    },
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
  });

  const { handleResume, handleForkCancel, handleForkRetry } = forkLifecycle;

  const { sendMessage } = createSendMessage({
    store,
    t: t as unknown as (key: string) => string,
    showToast: showChatToast,
    goto,
    handleResume,
    openFolderPicker,
    getRemoteHosts: () => remoteHosts,
    setRemoteHostName: (v) => {
      store.remoteHostName = v;
    },
    setLastTarget,
    getPromptRef: () => promptRef,
    setProcessingSlashCmd: (v) => {
      processingSlashCmd = v;
    },
    setSlashCmdSeenRunning: (v) => {
      slashCmdSeenRunning = v;
    },
    setTeamDispatchPrompt: (v) => {
      teamDispatchPrompt = v;
    },
    setTeamDispatchOpen: (v) => {
      teamDispatchOpen = v;
    },
    setIsChatAutoScroll: (v) => {
      isChatAutoScroll = v;
    },
    setShowChatScrollHint: (v) => {
      showChatScrollHint = v;
    },
    loadCliVersionInfo,
  });

  const teamDispatch = createTeamDispatch({
    store,
    setTeamDispatchOpen: (v) => {
      teamDispatchOpen = v;
    },
    setTeamDispatchPrompt: (v) => {
      teamDispatchPrompt = v;
    },
    getActiveTeamRuns: () => activeTeamRuns,
    setActiveTeamRuns: (v) => {
      activeTeamRuns = v;
    },
    setTeamHintVisible: (v) => {
      teamHintVisible = v;
    },
    setTeamPresets: (v) => {
      teamPresets = v;
    },
    sendMessage,
  });
  const {
    handleInputValueChange,
    loadTeamPresets,
    handleTeamDispatch,
    handleUseSingleClaude,
    handleCancelTeamDispatch,
  } = teamDispatch;

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
        sidebarRequestedTab = v as any;
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

  // Chat keybinding callbacks — registered/unregistered via keybindingStore in onMount below

  // ── Page-level drag-drop (Tauri native events) ──
  let pageDragActive = $state(false);
  let dragProcessingCount = $state(0);
  let dragProcessing = $derived(dragProcessingCount > 0);

  async function handleTauriDrop(payload: { paths: string[] }) {
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
</script>

{#snippet heroMetaFooter()}
  <div class="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/40">
    <ChatHeroMeta
      {cliVersionInfo}
      {channelLatest}
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
      run={store.run}
      agent={store.run?.agent ?? store.agent}
      model={store.model}
      cost={store.usage.cost}
      inputTokens={cumulativeTokens.input}
      outputTokens={cumulativeTokens.output}
      cacheReadTokens={cumulativeTokens.cacheRead}
      cacheWriteTokens={cumulativeTokens.cacheWrite}
      parentRunId={store.run?.parent_run_id}
      onEndSession={handleStop}
      onModelChange={handleModelChange}
      effort={store.features.effortSelector ? currentEffort : undefined}
      onEffortChange={store.features.effortSelector ? handleEffortChange : undefined}
      onNavigateParent={store.run?.parent_run_id
        ? () => goto(`/chat?run=${store.run!.parent_run_id}`)
        : undefined}
      cwd={store.effectiveCwd}
      onToggleSidebar={toggleLayoutSidebar}
      mcpServers={store.mcpServers}
      onMcpToggle={() => (mcpPanelOpen = !mcpPanelOpen)}
      cliVersion={store.cliVersion}
      permissionMode={store.permissionMode}
      {platformModels}
      fastModeState={store.fastModeState}
      verbose={verboseEnabled}
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
    <div class="chat-conversation-stage relative flex flex-1 min-h-0 overflow-hidden">
      <div class="absolute inset-0 min-h-0">
        {#if store.useStreamSession}
          <!-- API mode: chat messages -->
          <div
            class="chat-messages-scroll h-full overflow-y-auto relative z-0"
            style="overflow-anchor:auto"
            bind:this={chatAreaRef}
            onscroll={handleChatScroll}
          >
            {#if welcomeVisible}
              <!-- Welcome state -->
              <ChatWelcomeScreen
                {lastContinuableRun}
                onContinueSession={(id) => goto(`/chat?run=${id}&resume=continue`)}
                onQuickAnalyze={() => sendMessage(t("chat_quickAnalyzePrompt"), [])}
                onQuickFix={() => fillPrompt(t("chat_quickFixPrompt"))}
                onQuickDaily={() => sendMessage(t("chat_quickDailyPrompt"), [])}
                onGotoSchedule={() => goto("/scheduled-tasks")}
                {authOverview}
                authSourceLabel={store.authSourceLabel}
                authSourceCategory={store.authSourceCategory}
                apiKeySource={store.apiKeySource}
                authMode={store.authMode}
                platformCredentials={settings?.platform_credentials ?? []}
                platformId={store.platformId ?? "anthropic"}
                onAuthModeChange={handleAuthModeChange}
                onPlatformChange={handlePlatformChange}
                {localProxyStatuses}
              >
                {#snippet initHint()}
                  <ChatInitHint
                    visible={showInitHint}
                    onRunInit={() => sendMessage("/init", [])}
                    onDismiss={dismissInitHint}
                  />
                {/snippet}
                {#snippet heroMeta()}
                  <ChatHeroMeta
                    {cliVersionInfo}
                    {channelLatest}
                    {remoteHosts}
                    currentRemoteHostName={store.remoteHostName}
                    onTargetChange={(hostName) => {
                      store.remoteHostName = hostName;
                      setLastTarget(hostName);
                    }}
                    onNavigate={goto}
                  />
                {/snippet}
              </ChatWelcomeScreen>
            {:else if routeRunLoadFailed}
              <div class="flex h-full flex-col items-center justify-center gap-3 px-4">
                <p class="text-sm text-destructive">{t("chat_sessionLoadFailed")}</p>
                <p class="text-xs text-muted-foreground max-w-md text-center break-words">
                  {store.error}
                </p>
                <button
                  class="rounded-lg border border-border bg-muted px-4 py-2 text-sm hover:bg-accent transition-colors"
                  onclick={() => loadRunProgressive(runId, xtermRef)}
                >
                  {t("common_retry")}
                </button>
              </div>
            {:else if routeRunPending || (store.phase === "loading" && store.timeline.length === 0 && !!runId)}
              <div class="flex h-full flex-col items-center justify-center gap-3">
                <div
                  class="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin"
                ></div>
                <p class="text-xs text-muted-foreground">{t("chat_loadingSession")}</p>
              </div>
            {:else}
              <!-- Timeline: chat messages + inline tool cards -->
              <div data-conversation-root>
                {#if store.run?.parent_run_id}
                  <ChatForkedBanner
                    onViewParent={() => goto(`/chat?run=${store.run!.parent_run_id}`)}
                  />
                {/if}
                {#if notificationVisible && latestNotification}
                  <ChatNotificationBanner
                    taskId={latestNotification.task_id}
                    status={latestNotification.status}
                  />
                {/if}
                {#if toolNamesInTimeline.length >= 2 && processVisibility !== "output"}
                  <ChatToolFilterBar
                    toolNames={toolNamesInTimeline}
                    activeFilter={toolFilter}
                    onFilterChange={(f) => (toolFilter = f)}
                  />
                {/if}
                {#if processVisibility !== "output"}
                  <!-- View mode toggle (Normal / Verbose / Summary) -->
                  <div class="chat-content-width pb-1" data-export-exclude>
                    <ViewModeToggle />
                  </div>
                {/if}
                {#if filteredTimeline.length - renderLimit > 0}
                  <div bind:this={topSentinel} aria-hidden="true" class="h-px w-full"></div>
                {/if}
                <ChatTimelineEntries
                  {visibleTimeline}
                  {store}
                  {burstCollapse}
                  {toolBursts}
                  {lastClearSepId}
                  {timelineIdIndex}
                  {batchGroups}
                  {processVisibility}
                  {usageAnnotations}
                  {settings}
                  {lastAssistantIdx}
                  {claudeTurnStarts}
                  {latestPlanToolId}
                  {showPermissionPanel}
                  {fetchToolResult}
                  {handleRewindToMessage}
                  {handleToolAnswer}
                  {handleToolApprove}
                  {handlePermissionRespond}
                  {handleExitPlanClearContext}
                  {getPlanContentForExitPlan}
                  {openPreviewForPath}
                  toggleBurst={burstCollapse.toggleBurst}
                  onDispatchToTeam={(content) => {
                    teamDispatchPrompt = content;
                    teamDispatchOpen = true;
                  }}
                />

                <!-- Output mode: single friendly placeholder while routine tools run (no per-tool cards). -->
                {#if processVisibility === "output" && store.isRunning && timelineHasHiddenRoutineWorkRunning(store.timeline)}
                  <ChatOutputWorkingHint />
                {/if}

                <!-- Rewind markers (independent array, not in store.timeline) -->
                <ChatRewindMarkers markers={rewindMarkers} />

                <!-- Last turn usage annotation (after all entries) -->
                {#if lastTurnUsage && !store.isRunning && settings?.show_token_usage_report !== false}
                  <ChatUsageAnnotation usage={lastTurnUsage} />
                {/if}

                <!-- Active team runs -->
                {#each activeTeamRuns as teamRun (teamRun.id)}
                  <div class="w-full py-2">
                    <div class="chat-content-width pl-7">
                      <TeamRunCard {teamRun} />
                    </div>
                  </div>
                {/each}

                <!-- Pending hook callbacks (runtime UI — excluded from export) -->
                {#each store.hookEvents.filter((h) => h.status === "hook_pending") as hookEvent (hookEvent.request_id)}
                  <div class="chat-content-width pl-7" data-export-exclude>
                    <HookReviewCard {hookEvent} onRespond={handleHookCallbackRespond} />
                  </div>
                {/each}

                <!-- Thinking panel (extended thinking) -->
                {#if store.thinkingText}
                  <ChatThinkingPanel
                    thinkingText={store.thinkingText}
                    expanded={thinkingExpanded}
                    onToggleExpand={() => (thinkingExpanded = !thinkingExpanded)}
                  />
                {/if}

                <!-- Streaming text -->
                {#if store.streamingText}
                  <ChatStreamingText
                    text={store.streamingText}
                    agent={store.agent}
                    platformId={store.platformId ?? undefined}
                    model={store.run?.model ?? store.model}
                  />
                {/if}

                <!-- Slash command processing indicator (before thinking kicks in) -->
                {#if processingSlashCmd && !thinkingVisible && !store.streamingText && !store.thinkingText}
                  <div class="w-full animate-fade-in" data-export-exclude>
                    <div class="chat-content-width py-2">
                      <div class="flex items-center gap-2 text-sm text-muted-foreground">
                        <div
                          class="h-3.5 w-3.5 rounded-full border-2 border-border border-t-muted-foreground animate-spin"
                        ></div>
                        <span>{t("chat_processingCommand", { command: processingSlashCmd })}</span>
                      </div>
                    </div>
                  </div>
                {/if}

                <!-- Thinking indicator (debounced 300ms to avoid flash on fast CLI commands) -->
                {#if thinkingVisible && !store.thinkingText}
                  <ChatThinkingIndicator
                    elapsed={thinkingElapsed}
                    activeToolName={store.activeToolName}
                    thinkingDurationSec={store.thinkingEndMs ? store.thinkingDurationSec : null}
                    {approving}
                    {sending}
                    {spinnerVerb}
                  />
                {/if}
              </div>
            {/if}
          </div>
          {#if showChatScrollHint}
            <button
              class="absolute bottom-[calc(var(--chat-input-dock-offset,13rem)+0.75rem)] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 animate-fade-in"
              onclick={scrollChatToBottom}
            >
              {t("chat_newMessages")}
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          {/if}
        {:else if store.run && store.run.status !== "pending"}
          <!-- CLI mode: terminal -->
          <XTerminal
            bind:this={xtermRef}
            onResize={handleTermResize}
            onReady={handleTermReady}
            class="h-full"
          />
        {:else}
          <!-- CLI mode: welcome state -->
          <div class="flex h-full items-center justify-center">
            <div class="text-center max-w-md animate-slide-up">
              <img src={APP_LOGO_URL} alt="MiWarp" class="mx-auto mb-4 h-10 w-10 rounded-xl" />
              <h2 class="text-lg font-semibold text-primary mb-2">{t("layout_appName")}</h2>
              <p class="text-sm text-muted-foreground mb-4">
                {store.run ? t("chat_typeToStartSession") : t("chat_startSessionHint")}
              </p>
              <ChatInitHint
                visible={showInitHint}
                onRunInit={() => sendMessage("/init", [])}
                onDismiss={dismissInitHint}
              />
              {@render heroMetaFooter()}
            </div>
          </div>
        {/if}

        <!-- Fork overlay -->
        {#if forkOverlay}
          <ChatForkOverlay
            error={forkOverlay.error}
            elapsed={forkElapsed}
            {resuming}
            onCancel={handleForkCancel}
            onRetry={handleForkRetry}
          />
        {/if}

        <!-- Classified error card -->
        {#if store.error && !forkOverlay}
          <ChatErrorCard
            error={store.error}
            resultSubtype={store.run?.result_subtype}
            sessionId={store.run?.session_id}
            phase={store.phase}
            onDismiss={() => (store.error = "")}
            onRetry={() => handleResume("continue")}
            onFork={() => handleResume("fork")}
            onGotoSettings={goto}
          />
        {/if}
      </div>

      <div class="chat-scroll-fade" aria-hidden="true"></div>

      <ChatInputDock
        {store}
        {showPermissionPanel}
        {pendingToolPermissions}
        {handlePermissionRespond}
        {handleElicitationRespond}
        {btwState}
        {handleBtwSend}
        setBtwState={(v) => {
          btwState = v;
        }}
        {hasCreatedFiles}
        {createdFiles}
        {insight}
        {inputBlockedByPermission}
        {agentSettings}
        {effectiveModels}
        {skillItems}
        {preloadedAgents}
        {stashedInput}
        {userHistory}
        {processVisibility}
        {authOverview}
        {localProxyStatuses}
        {folderCwdOverride}
        {teamHintVisible}
        {projectCommands}
        {settings}
        showAuthBadge={!welcomeVisible}
        {sendMessage}
        {handleModelChange}
        {handlePermissionModeChange}
        {handleFastModeSwitch}
        {handleVirtualCommand}
        {handleAuthModeChange}
        {handlePlatformChange}
        {handleInputValueChange}
        {handleRalphCancel}
        onShortcutHelp={() => (shortcutHelpOpen = !shortcutHelpOpen)}
        onRestoreStash={() => {
          if (stashedInput) {
            promptRef?.restoreSnapshot(stashedInput);
            stashedInput = null;
            showChatToast(t("toast_stashRestored"));
          }
        }}
        onInterrupt={() => store.interrupt()}
        onAgentChange={undefined}
        bind:promptRef
      />
    </div>
  </div>

  <!-- Tool Activity sidebar -->
  <ToolActivity
    timeline={store.timeline}
    tools={store.tools}
    turnUsages={store.turnUsages}
    {contextHistory}
    persistedFiles={store.persistedFiles}
    sessionInfo={currentSessionInfo}
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

  <TeamDispatchConfirm
    bind:open={teamDispatchOpen}
    prompt={teamDispatchPrompt}
    cwd={store.effectiveCwd || ""}
    onDispatch={handleTeamDispatch}
    onUseSingleClaude={handleUseSingleClaude}
    onCancel={handleCancelTeamDispatch}
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
