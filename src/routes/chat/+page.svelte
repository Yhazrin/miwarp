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
    getCliCommands,
    getCliModels,
    canResumeNow,
    TERMINAL_PHASES,
    getResumeWarning,
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
  import { isPlanFilePath, planFileName, extractPlanContent } from "$lib/utils/tool-rendering";
  import { useToolBurstCollapse } from "$lib/chat/use-tool-burst-collapse.svelte";
  import {
    computeTimelinePresentation,
    getInitialRenderLimit,
  } from "$lib/chat/selectors/timeline-presentation";
  import { CLI_TO_APP_MODE, APP_TO_CLI_MODE } from "$lib/chat/utils/permission-modes";
  import { buildSummaryHtml } from "$lib/chat/utils/summary-html";
  import { useConversationInsight } from "$lib/conversation-insight/use-conversation-insight.svelte";
  import XTerminal from "$lib/components/XTerminal.svelte";
  import ChatMessage from "$lib/components/ChatMessage.svelte";
  import InlineToolCard from "$lib/components/InlineToolCard.svelte";
  import BatchProgressBar from "$lib/components/BatchProgressBar.svelte";
  import ToolBurstHeader from "$lib/components/ToolBurstHeader.svelte";
  import SessionStatusBar from "$lib/components/SessionStatusBar.svelte";
  import McpStatusPanel from "$lib/components/McpStatusPanel.svelte";
  import PromptInput from "$lib/components/PromptInput.svelte";
  import CreatedFiles from "$lib/components/CreatedFiles.svelte";
  import PermissionPanel from "$lib/components/PermissionPanel.svelte";
  import ElicitationDialog from "$lib/components/ElicitationDialog.svelte";

  import ToolActivity from "$lib/components/ToolActivity.svelte";
  import ShortcutHelpPanel from "$lib/components/ShortcutHelpPanel.svelte";
  import type { PromptInputSnapshot } from "$lib/types";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import HookReviewCard from "$lib/components/HookReviewCard.svelte";
  import ViewModeToggle from "$lib/components/ViewModeToggle.svelte";
  import GuidedToolTimelineRow from "$lib/components/GuidedToolTimelineRow.svelte";
  import ContextUsageGrid from "$lib/components/ContextUsageGrid.svelte";
  import CostSummaryView from "$lib/components/CostSummaryView.svelte";
  import { parseContextMarkdown } from "$lib/utils/context-parser";
  import type { ContextSnapshot } from "$lib/types";
  import ReleaseNotesCard from "$lib/components/ReleaseNotesCard.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { APP_LOGO_URL } from "$lib/utils/brand-assets";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { yieldToMain } from "$lib/utils/yield";
  import {
    getLastTarget,
    setLastTarget,
    getStoredRemoteCwd,
    setStoredRemoteCwd,
  } from "$lib/utils/remote-cwd";
  import { shouldAutoName } from "$lib/utils/auto-name";
  import { resolvePermissionOptimistic } from "$lib/utils/resolve-permission";
  import { ansiToHtml, hasAnsiCodes } from "$lib/utils/ansi";
  import { randomSpinnerVerb } from "$lib/utils/spinner-verbs";
  import { type TurnUsage } from "$lib/stores/types";
  import {
    normalizeProcessVisibility,
    getCachedProcessVisibility,
    persistCachedProcessVisibility,
    shouldShowTimelineCommandOutput,
    isTimelineSeparatorContent,
    shouldShowContextDetails,
    shouldMountFullToolCardInOutputMode,
    shouldMountFullToolCardInGuidedMode,
    timelineHasHiddenRoutineWorkRunning,
    type ProcessVisibility,
  } from "$lib/utils/process-visibility";
  import { mergeProjectCommands } from "$lib/utils/slash-commands";
  import {
    handleVirtualCommand as execVirtualCommand,
    type VirtualCommandContext,
  } from "$lib/chat/use-virtual-commands";
  import type { RewindCandidate, RewindMarker } from "$lib/utils/rewind";
  import { truncate } from "$lib/utils/format";
  import { mapSettled } from "$lib/utils/async-utils";
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
  import ChatBtwDrawer from "$lib/components/ChatBtwDrawer.svelte";
  import ChatDragOverlay from "$lib/components/ChatDragOverlay.svelte";
  import ChatUsageAnnotation from "$lib/components/ChatUsageAnnotation.svelte";
  import ChatRalphLoopBar from "$lib/components/ChatRalphLoopBar.svelte";
  import ChatWelcomeScreen from "$lib/components/ChatWelcomeScreen.svelte";
  import ChatHeroMeta from "$lib/components/ChatHeroMeta.svelte";
  import ChatInitHint from "$lib/components/ChatInitHint.svelte";
  import RewindModal from "$lib/components/RewindModal.svelte";
  import FolderPicker from "$lib/components/FolderPicker.svelte";
  import TeamDispatchConfirm from "$lib/components/TeamDispatchConfirm.svelte";
  import TeamRunCard from "$lib/components/TeamRunCard.svelte";
  import ConversationInsightCard from "$lib/components/insight/ConversationInsightCard.svelte";
  import HtmlReportPreview from "$lib/components/insight/HtmlReportPreview.svelte";
  import {
    detectTeamTrigger,
    stripTeamTag,
    dispatchTeamRun,
    executeTeamRun,
    getPresets,
    shouldShowTeamHint,
  } from "$lib/services/team-dispatcher";
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

  // ── Model contamination helpers ──

  /** Cache of last confirmed-clean Anthropic model, used as final fallback. */
  let lastKnownGoodAnthropicModel: string | undefined;

  /** Detect if default_model was contaminated by a third-party platform model.
   *  Returns:
   *  - true  = confirmed contaminated (in third-party models, not in CLI models)
   *  - false = confirmed clean (in CLI known models)
   *  - null  = unknown (CLI not loaded, or model not found in any list)
   */
  function isContaminatedDefaultModel(dm: string): boolean | null {
    const cliModels = getCliModels();
    if (!cliModels.length) return null; // CLI models not loaded yet
    if (cliModels.some((m) => m.value === dm)) return false; // in CLI model list = clean

    const inThirdParty =
      PLATFORM_PRESETS.some(
        (p) => p.id !== "anthropic" && p.id !== "custom" && p.models?.includes(dm),
      ) ||
      (settings?.platform_credentials ?? []).some(
        (c) => c.platform_id !== "anthropic" && c.models?.includes(dm),
      );
    return inThirdParty ? true : null; // not in CLI + not in third-party = unknown
  }

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

  function handleInputValueChange(value: string) {
    teamHintVisible = shouldShowTeamHint(value);
  }
  let teamPresets = $state<TeamPreset[]>([]);

  // Load presets on mount
  onMount(() => {
    getPresets()
      .then((p) => (teamPresets = p))
      .catch(() => {});
  });

  async function handleTeamDispatch(presetId: string) {
    const prompt = teamDispatchPrompt;
    teamDispatchOpen = false;
    if (!prompt) return;

    const preset = teamPresets.find((p) => p.id === presetId);
    if (!preset) return;

    const cwd = store.effectiveCwd || "";

    // Create TeamRun record
    const teamRun = await dispatchTeamRun({
      prompt,
      presetId,
      cwd,
    });

    // Add to active list so TeamRunCard renders in chat
    activeTeamRuns = [...activeTeamRuns, teamRun];

    // Execute in background — uses existing startRun infrastructure
    executeTeamRun(
      teamRun,
      preset,
      (prompt: string, runCwd: string, agent: string) => api.startRun(prompt, runCwd, agent),
      (updated: TeamRun) => {
        activeTeamRuns = activeTeamRuns.map((r) => (r.id === updated.id ? updated : r));
      },
    ).catch((err) => {
      console.error("Team run failed:", err);
    });
  }

  function handleUseSingleClaude() {
    const stripped = stripTeamTag(teamDispatchPrompt);
    teamDispatchOpen = false;
    if (stripped) {
      sendMessage(stripped, []);
    }
  }

  function handleCancelTeamDispatch() {
    teamDispatchOpen = false;
    teamDispatchPrompt = "";
  }

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

  // ── Verbose state (chat page level) ──
  let verboseEnabled = $state(false);
  let verboseSeq = 0;
  let lastSyncedRunId = "__unset__"; // sentinel ≠ "__no_run__", ensures first-screen trigger
  let verboseRetryTick = $state(0);
  let verboseRetryCount = 0;
  let verboseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const VERBOSE_MAX_RETRIES = 3;

  // ── Tool result lazy-load cache (Phase 2) ──
  let toolResultCache = new Map<string, Record<string, unknown>>();
  let toolResultInflight = new Map<string, Promise<Record<string, unknown> | null>>();
  // Clear cache on run switch
  $effect(() => {
    const _ = store.run?.id;
    toolResultCache = new Map();
    toolResultInflight = new Map();
  });

  async function fetchToolResult(
    runId: string,
    toolUseId: string,
  ): Promise<Record<string, unknown> | null> {
    const key = `${runId}:${toolUseId}`;
    const cached = toolResultCache.get(key);
    if (cached) return cached;
    let pending = toolResultInflight.get(key);
    if (!pending) {
      pending = api.getToolResult(runId, toolUseId);
      toolResultInflight.set(key, pending);
    }
    try {
      const result = await pending;
      // Run-gen check: don't write stale results into a different run's cache
      if (result && store.run?.id === runId) {
        toolResultCache.set(key, result);
      }
      return result;
    } finally {
      toolResultInflight.delete(key);
    }
  }

  // ── Timeline rendering ──
  // Progressive render: start with the most recent N entries, grow on upward scroll.
  const RENDER_GROWTH_STEP = 100;
  let toolFilter = $state<string | null>(null);
  let renderLimit = $state(getInitialRenderLimit(getCachedProcessVisibility(), []));
  let progressiveGen = 0;
  let loadingRunId = $state<string | null>(null);
  let loadingMore = $state(false);
  let loadMoreArmed = $state(true);
  let _suppressLoadMoreRearm = false;

  let timelinePresentation = $derived.by(() =>
    computeTimelinePresentation(
      store.timeline,
      toolFilter,
      renderLimit,
      store.tools.filter((e) => e.tool_name).length,
    ),
  );

  let filteredTimeline = $derived(timelinePresentation.filteredTimeline);
  let visibleTimeline = $derived(timelinePresentation.visibleTimeline);
  let toolNamesInTimeline = $derived(timelinePresentation.toolNames);
  let timelineIdIndex = $derived(timelinePresentation.timelineIdIndex);
  let lastClearSepId = $derived(timelinePresentation.lastClearSepId);
  let latestPlanToolId = $derived(timelinePresentation.latestPlanToolId);
  let createdFiles = $derived(timelinePresentation.createdFiles);
  let hasCreatedFiles = $derived(createdFiles.length > 0);
  let batchGroups = $derived(timelinePresentation.batchGroups);
  let toolBursts = $derived(timelinePresentation.toolBursts);
  let userCountPrefix = $derived(timelinePresentation.userCountPrefix);

  async function syncVerboseState(runId: string | undefined) {
    const key = runId ?? "__no_run__";
    if (key === lastSyncedRunId) return; // same run — skip
    const seq = ++verboseSeq;
    // New run resets retry counter
    verboseRetryCount = 0;
    try {
      const cfg = await api.getCliConfig();
      if (seq !== verboseSeq) return; // stale response
      lastSyncedRunId = key; // mark synced on success only
      verboseEnabled = cfg.verbose === true;
      dbg("chat", "verbose state synced", { verbose: verboseEnabled, runId, seq });
    } catch {
      // Don't mark synced — retry via tick++ after 3s (up to max)
      if (seq === verboseSeq && verboseRetryCount < VERBOSE_MAX_RETRIES) {
        verboseRetryCount++;
        verboseRetryTimer = setTimeout(() => {
          verboseRetryTimer = null;
          verboseRetryTick++;
        }, 3000);
      }
    }
  }

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

  // ── Platform display name ──
  let platformDisplayName = $derived.by(() => {
    const pid = store.platformId;
    if (!pid) return undefined;
    const preset = PLATFORM_PRESETS.find((p) => p.id === pid);
    return preset?.name ?? authOverview?.app_platform_name ?? pid;
  });

  // ── Provider-aware model list ──
  // When a third-party platform is active and has a models list, use that instead of CLI models.
  // Priority: credential.models (user-configured) > preset.models (static defaults)
  let platformModels = $derived.by((): CliModelInfo[] => {
    const pid = store.platformId;
    if (!pid || pid === "anthropic") return [];
    const cred = findCredential(settings?.platform_credentials ?? [], pid);
    const preset = PLATFORM_PRESETS.find((p) => p.id === pid);
    const models = cred?.models?.length ? cred.models : preset?.models;
    if (!models?.length) return [];
    return models.map((m, i) => ({
      value: m,
      displayName: m,
      description: i === 0 ? "Default" : "",
    }));
  });

  let effectiveModels = $derived(platformModels.length > 0 ? platformModels : getCliModels());
  let currentEffort = $state("");

  // Effort guard: auto-clear effort when model doesn't support it;
  // also auto-populate default effort ("high") when empty and model supports it.
  $effect(() => {
    if (store.agent !== "claude") return;

    const pid = store.platformId;
    // Third-party platform: don't touch effort
    if (pid && pid !== "anthropic") return;

    const modelInfo = effectiveModels.find((m) => m.value === store.model);
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

  // ── Progressive timeline rendering ── helpers

  /** Invalidate any in-flight async load so its post-await side effects bail out. */
  function cancelProgressive() {
    progressiveGen++;
    loadingRunId = null;
    _scrollToInFlight = false;
  }

  /** Bump the load generation and return it — caller compares against `progressiveGen`. */
  function nextProgressiveGen(): number {
    return ++progressiveGen;
  }

  /**
   * Expand `renderLimit` enough that `targetIndex` (in `filteredTimeline`) is mounted,
   * with `margin` extra entries above for context. No-op if already covered.
   */
  function expandRenderLimitTo(targetIndex: number, margin = 50) {
    const ft = filteredTimeline;
    if (targetIndex < 0 || targetIndex >= ft.length) return;
    if (renderLimit === Infinity) return;
    const needed = ft.length - targetIndex + margin;
    if (renderLimit < needed) renderLimit = Math.min(needed, ft.length);
  }

  /**
   * If `visibleIdx` (visibleTimeline-local) sits inside a collapsed tool burst,
   * force-expand that burst via `manualOverrides` so the entry's DOM mounts.
   * Caller must pass an index in the visibleTimeline namespace, not filteredTimeline.
   */
  async function ensureBurstExpandedFor(visibleIdx: number) {
    if (!burstCollapse.collapsedIndices.has(visibleIdx)) return;
    for (const [, burst] of toolBursts) {
      if (visibleIdx >= burst.startIndex && visibleIdx <= burst.endIndex) {
        burstCollapse.toggleBurst(burst.key);
        await tick();
        return;
      }
    }
  }

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

  /**
   * Grow `renderLimit` by `RENDER_GROWTH_STEP` and preserve the user's scroll position.
   * Browser-native scroll anchoring is unreliable on WKWebView with content-visibility,
   * so we measure the first rendered entry's offset before/after and adjust scrollTop
   * by the delta.
   */
  async function loadMoreEarlier() {
    if (loadingMore || !loadMoreArmed) return;
    loadingMore = true;
    loadMoreArmed = false; // re-armed by handleChatScroll on next user scroll
    try {
      const anchor = chatAreaRef?.querySelector<HTMLElement>("[data-entry-id]") ?? null;
      const anchorId = anchor?.dataset.entryId ?? null;
      const beforeTop = anchor?.getBoundingClientRect().top ?? 0;
      const beforeScroll = chatAreaRef?.scrollTop ?? 0;

      renderLimit = Math.min(renderLimit + RENDER_GROWTH_STEP, filteredTimeline.length);
      await tick();
      await yieldToMain();

      if (anchorId && chatAreaRef) {
        let after: HTMLElement | null = null;
        try {
          after = chatAreaRef.querySelector<HTMLElement>(
            `[data-entry-id="${CSS.escape(anchorId)}"]`,
          );
        } catch {
          after =
            Array.from(chatAreaRef.querySelectorAll<HTMLElement>("[data-entry-id]")).find(
              (el) => el.dataset.entryId === anchorId,
            ) ?? null;
        }
        if (after) {
          const afterTop = after.getBoundingClientRect().top;
          // Suppress re-arm so the programmatic scrollTop write doesn't immediately
          // rearm the observer — the sentinel may still be in view post-prepend.
          _suppressLoadMoreRearm = true;
          chatAreaRef.scrollTop = beforeScroll + (afterTop - beforeTop);
          // Clear suppression after the scroll event has dispatched + been handled.
          // yieldToMain has a 50ms timeout fallback so a backgrounded WebView with
          // throttled rAF can't strand the suppression flag.
          await yieldToMain();
          _suppressLoadMoreRearm = false;
        }
      }
    } finally {
      loadingMore = false;
    }
  }

  /**
   * Load a run and render its timeline progressively.
   * Starts with the most recent render limit entries; the top sentinel
   * grows `renderLimit` as the user scrolls up.
   */
  async function loadRunProgressive(
    id: string,
    xtermRef?: { clear(): void; writeText(s: string): void },
  ) {
    toolFilter = null;
    renderLimit = getInitialRenderLimit(processVisibility, store.timeline);
    loadingMore = false;
    loadMoreArmed = true;
    const gen = nextProgressiveGen();
    loadingRunId = id;

    const scrollTo = $page.url.searchParams.get("scrollTo");
    if (scrollTo) _scrollToInFlight = true;

    try {
      await store.loadRun(id, xtermRef);
      if (gen !== progressiveGen) return;
      if (id) folderCwdOverride = "";

      renderLimit = getInitialRenderLimit(processVisibility, store.timeline);

      if (id && store.effectiveCwd) {
        reloadProjectData(store.effectiveCwd);
      }
      if (gen !== progressiveGen) return;

      if (store.mcpServers.length > 0) {
        try {
          const disabledNames = await api.getDisabledMcpServers();
          if (gen !== progressiveGen) return;
          if (disabledNames.length > 0) {
            const disabledSet = new Set(disabledNames);
            const patched = store.mcpServers.map((s) =>
              disabledSet.has(s.name) && s.status !== "disabled" ? { ...s, status: "disabled" } : s,
            );
            if (patched.some((s, i) => s !== store.mcpServers[i])) {
              store.updateMcpServers(patched);
              dbg("chat", "patched MCP disabled state", { disabledNames });
            }
          }
        } catch {
          // non-critical
        }
      }

      if (gen !== progressiveGen) return;
      dbg("chat", "loadRun complete", {
        timeline: filteredTimeline.length,
        renderLimit,
        gen,
      });

      if (scrollTo) {
        await tick();
        if (gen !== progressiveGen) return;
        scrollToMessage(scrollTo);
        const clean = new URL($page.url);
        clean.searchParams.delete("scrollTo");
        replaceState(clean, {});
      } else {
        await tick();
        if (gen !== progressiveGen) return;
        requestAnimationFrame(() => {
          if (gen !== progressiveGen || !chatAreaRef) return;
          chatAreaRef.scrollTop = chatAreaRef.scrollHeight;
        });
      }
    } finally {
      if (gen === progressiveGen) {
        loadingRunId = null;
        if (scrollTo) _scrollToInFlight = false;
      } else if (scrollTo) {
        _scrollToInFlight = false;
      }
    }
  }

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
  let thinkingElapsed = $state(0);
  let thinkingExpanded = $state(false);
  let spinnerVerb = $state(randomSpinnerVerb());
  /** Plain flag (not $state) — avoids $effect dependency cycle with thinkingElapsed. */
  let thinkingVerbPicked = false;
  /** Debounced visibility — prevents spinner flash on fast CLI commands (/context, /cost). */
  let thinkingVisible = $state(false);

  /** Next thinking stream starts collapsed; also fold when a turn ends and text clears. */
  $effect(() => {
    if (!store.thinkingText) {
      thinkingExpanded = false;
    }
  });

  /** Slash command processing indicator — shown before thinkingVisible kicks in. */
  let processingSlashCmd = $state<string | null>(null);
  let slashCmdSeenRunning = $state(false);

  $effect(() => {
    if (!processingSlashCmd) return;
    // Track: phase was "running" at some point since flag was set
    if (store.isRunning) slashCmdSeenRunning = true;
    // Clear when content arrives, error set, or turn completed (idle after running)
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

  $effect(() => {
    if (store.isThinking) {
      // Use store.thinkingStartMs as the authoritative start time.
      // During replay it holds the original event timestamp, so the timer
      // survives session switches without resetting to 0.
      const base = store.thinkingStartMs || Date.now();
      if (!thinkingVerbPicked) {
        spinnerVerb = randomSpinnerVerb();
        thinkingVerbPicked = true;
      }
      // Debounce: only show spinner after 300ms to avoid flash on fast commands
      const showTimer = setTimeout(() => {
        thinkingVisible = true;
      }, 300);
      // Immediately compute elapsed (don't wait 1s for first update)
      thinkingElapsed = Math.max(0, Math.floor((Date.now() - base) / 1000));
      const interval = setInterval(() => {
        thinkingElapsed = Math.max(0, Math.floor((Date.now() - base) / 1000));
      }, 1000);
      return () => {
        clearTimeout(showTimer);
        clearInterval(interval);
      };
    } else {
      thinkingElapsed = 0;
      thinkingVisible = false;
      thinkingVerbPicked = false;
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
        currentEffort = typeof cliEffort === "string" && cliEffort ? cliEffort : "";
      } catch {
        currentEffort = "";
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
                lastKnownGoodAnthropicModel = healModel;
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
        lastKnownGoodAnthropicModel = cliModel;
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

  // Restore model when store.model is empty (e.g. after reset/loadRun):
  // For third-party platforms, use the platform's default model.
  // For Anthropic, prefer CC's current active model, fall back to our saved default_model
  // (only if confirmed clean via three-state contamination check).
  $effect(() => {
    if (!store.model) {
      // Don't overwrite model during loadRun async gap — loadRun will set it
      if (store.phase === "loading") return;

      const isThirdParty = store.platformId && store.platformId !== "anthropic";
      if (isThirdParty) {
        const restoreCred = findCredential(
          settings?.platform_credentials ?? [],
          store.platformId ?? "",
        );
        const restorePreset = PLATFORM_PRESETS.find((p) => p.id === store.platformId);
        const restoreModels = restoreCred?.models?.length
          ? restoreCred.models
          : restorePreset?.models;
        if (restoreModels?.[0]) {
          dbg("chat", "restore model from credential/preset", {
            platform: store.platformId,
            model: restoreModels[0],
          });
          store.model = restoreModels[0];
          return;
        }
      }
      // Only fall back to default_model for Anthropic platform — otherwise
      // default_model may belong to a different platform (cross-pollution).
      const cliModel = getCliCurrentModel();
      const isAnthropicPlatform = !store.platformId || store.platformId === "anthropic";
      const rawFallback = isAnthropicPlatform ? settings?.default_model : undefined;
      const contaminated = rawFallback ? isContaminatedDefaultModel(rawFallback) : null;
      // Only use default_model when confirmed clean (false). true/null → skip.
      const fallback = contaminated === false ? rawFallback : undefined;
      // Last resort: cached last-known-good Anthropic model (only for Anthropic platform)
      const model =
        cliModel || fallback || (isAnthropicPlatform ? lastKnownGoodAnthropicModel : undefined);
      if (model) {
        // Update cache when we have a trusted source
        if (isAnthropicPlatform && (cliModel || contaminated === false)) {
          lastKnownGoodAnthropicModel = model;
        }
        dbg("chat", "restore model", {
          cliModel,
          rawFallback,
          contaminated,
          lastKnownGood: lastKnownGoodAnthropicModel,
          using: model,
        });
        store.model = model;
      }
    }
  });

  // ── Terminal helpers ──

  function handleTermReady(_cols: number, _rows: number) {
    // Terminal ready — Codex pipe mode is output-only, no setup needed
  }

  function handleTermResize(_cols: number, _rows: number) {
    // Codex pipe mode doesn't need resize — terminal is output-only
  }

  // ── Chat scroll ──

  /** Threshold (px) for "near bottom" detection. Shared concept with TerminalPane. */
  const SCROLL_BOTTOM_THRESHOLD = 40;

  function handleChatScroll() {
    if (!chatAreaRef) return;
    const dist = chatAreaRef.scrollHeight - chatAreaRef.scrollTop - chatAreaRef.clientHeight;
    isChatAutoScroll = dist < SCROLL_BOTTOM_THRESHOLD;
    if (isChatAutoScroll) showChatScrollHint = false;
    // Re-arm progressive load-more after a user-initiated scroll. The IntersectionObserver
    // fires once per arm; this prevents short timelines from runaway-expanding while the
    // sentinel remains in view after a prepend. Programmatic scrollTop adjustments
    // (loadMoreEarlier's anchor compensation) raise `_suppressLoadMoreRearm` so the
    // anchor-correction scroll doesn't immediately re-arm the observer.
    if (!loadMoreArmed && !_suppressLoadMoreRearm) loadMoreArmed = true;
  }

  function scrollChatToBottom() {
    if (chatAreaRef) {
      chatAreaRef.scrollTop = chatAreaRef.scrollHeight;
      showChatScrollHint = false;
      isChatAutoScroll = true;
    }
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

  // ── Send message ──

  async function sendMessage(text: string, attachments: Attachment[]) {
    if (!text.trim()) return;

    store.error = "";
    // Follow to new reply when sending a message
    isChatAutoScroll = true;
    showChatScrollHint = false;

    // Detect slash command (same check as store timeout skip)
    const isSlash = store.isKnownSlashCommand(text);
    const slashCmd = isSlash ? (text.match(/^\/\S+/)?.[0] ?? null) : null;

    // ── @team / /team detection: intercept before creating a run ──
    if (!store.run && !slashCmd) {
      const teamResult = detectTeamTrigger(text);
      if (teamResult) {
        teamDispatchPrompt = teamResult.prompt;
        teamDispatchOpen = true;
        return;
      }
    }

    try {
      if (!store.run) {
        // First message: create run.
        //
        // Validate the remote target up-front. The host could have been
        // removed/renamed since the chat tab was opened (or since
        // `ocv:last-target` was persisted). Without this check, every
        // downstream path — `getStoredRemoteCwd`, the folder picker (which
        // silently falls back to local UI when its `loadRemoteHosts` clears
        // the unknown host), and `startSession` — would still run with the
        // stale `store.remoteHostName`, and the backend `start_run` would
        // fail with an opaque "Remote host '...' not found".
        if (
          store.remoteHostName &&
          remoteHosts.length > 0 &&
          !remoteHosts.some((h) => h.name === store.remoteHostName)
        ) {
          dbgWarn("chat", "remote host no longer in settings — clearing target", {
            host: store.remoteHostName,
          });
          showChatToast(t("toast_remoteHostMissing"));
          store.remoteHostName = null;
          setLastTarget(null);
          return;
        }
        const isRemote = !!store.remoteHostName;
        let cwd = "";
        if (typeof window !== "undefined") {
          if (isRemote) {
            cwd = getStoredRemoteCwd(store.remoteHostName!);
          } else {
            cwd =
              localStorage.getItem("ocv:project-cwd") ||
              localStorage.getItem("ocv:settings-cwd") ||
              "";
          }
        }

        if (!cwd || cwd === "/") {
          const transport = getTransport();
          if (isRemote) {
            // Remote: open FolderPicker for the selected host
            const result = await openFolderPicker({
              initialHost: store.remoteHostName,
              hideTargetSelector: true,
            });
            if (!result || !result.path) return; // cancelled
            cwd = result.path;
            if (result.hostName) setStoredRemoteCwd(result.hostName, cwd);
          } else if (transport.isDesktop()) {
            // Desktop local: native folder picker (fast path)
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selected = await open({
              directory: true,
              title: t("layout_selectProjectFolder"),
            });
            if (!selected) return; // user cancelled → don't send
            cwd = selected as string;
            localStorage.setItem("ocv:project-cwd", cwd);
            window.dispatchEvent(new Event("ocv:cwd-changed"));
          } else {
            // Browser local: open FolderPicker (allows manual path or switching to remote)
            const result = await openFolderPicker({ initialHost: null });
            if (!result || !result.path) return;
            cwd = result.path;
            if (result.hostName) {
              store.remoteHostName = result.hostName;
              setLastTarget(result.hostName);
              setStoredRemoteCwd(result.hostName, cwd);
            } else {
              localStorage.setItem("ocv:project-cwd", cwd);
              window.dispatchEvent(new Event("ocv:cwd-changed"));
            }
          }
        }

        // Set indicator AFTER all early-return points
        if (slashCmd) {
          processingSlashCmd = slashCmd;
          slashCmdSeenRunning = false;
        }

        const runId = await store.startSession(text, cwd, attachments);
        goto(`/chat?run=${runId}`, { replaceState: true });
        window.dispatchEvent(new Event("ocv:runs-changed"));
        // Re-detect CLI version on new session (picks up external updates)
        loadCliVersionInfo();
      } else if (store.useStreamSession && !store.sessionAlive && store.run.session_id) {
        // Stopped stream session: atomic resume + send (message written to CLI stdin at spawn)
        dbg("chat", "auto-resume on send", {
          runId: store.run.id,
          sessionId: store.run.session_id,
        });
        if (slashCmd) {
          processingSlashCmd = slashCmd;
          slashCmdSeenRunning = false;
        }
        await handleResume("resume", undefined, text, attachments);
      } else {
        // Subsequent message
        if (slashCmd) {
          processingSlashCmd = slashCmd;
          slashCmdSeenRunning = false;
        }
        await store.sendMessage(text, attachments);
        requestAnimationFrame(() => promptRef?.focus());
      }
    } catch (e) {
      store.error = String(e);
      processingSlashCmd = null;
    }
  }

  function fillPrompt(text: string) {
    promptRef?.setValue(text);
  }

  // ── Project init detection ──
  let showInitHint = $derived(
    projectInitStatus !== null && !projectInitStatus.has_claude_md && !store.run,
  );

  /** Reload project-level data (skills, agents, commands) with race guard. */
  function reloadProjectData(cwd: string) {
    const gen = ++preloadGen;
    preloadedSkills = [];
    preloadedAgents = [];
    projectCommands = [];
    if (!cwd) return;
    api
      .listStandaloneSkills(cwd)
      .then((skills) => {
        if (gen !== preloadGen) return;
        preloadedSkills = skills;
        if (skills.length > 0 && store.availableSkills.length === 0) {
          store.availableSkills = skills.map((s) => s.name);
        }
        dbg("chat", "preloaded skills", { count: skills.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload skills", e));
    api
      .listAgents(cwd)
      .then((agents) => {
        if (gen !== preloadGen) return;
        preloadedAgents = agents;
        dbg("chat", "preloaded agents", { count: agents.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload agents", e));
    api
      .listProjectCommands(cwd)
      .then((cmds) => {
        if (gen !== preloadGen) return;
        projectCommands = cmds;
        dbg("chat", "preloaded project commands", { count: cmds.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload project commands", e));
  }

  async function checkProjectInit() {
    const cwd = localStorage.getItem("ocv:project-cwd") || "";
    if (!cwd || cwd === "/") {
      projectInitStatus = null;
      dbg("chat", "checkProjectInit: skip (no cwd)");
      return;
    }
    const seq = ++initCheckSeq;
    try {
      const status = await api.checkProjectInit(cwd);
      dbg("chat", "checkProjectInit result", {
        cwd,
        status,
        seq,
        currentSeq: initCheckSeq,
        hasRun: !!store.run,
        isApiMode: store.isApiMode,
      });
      if (seq !== initCheckSeq) return;
      const dismissKey = `ocv:init-dismissed:${status.cwd}`;
      const dismissed = localStorage.getItem(dismissKey);
      if (dismissed) {
        projectInitStatus = null;
        dbg("chat", "checkProjectInit: dismissed", dismissKey);
        return;
      }
      projectInitStatus = status;
    } catch (e) {
      dbgWarn("chat", "checkProjectInit failed", e);
      if (seq === initCheckSeq) projectInitStatus = null;
    }
  }

  function dismissInitHint() {
    if (projectInitStatus?.cwd) {
      localStorage.setItem(`ocv:init-dismissed:${projectInitStatus.cwd}`, "1");
    }
    projectInitStatus = null;
    dbg("chat", "init hint dismissed");
  }

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

  let permissionModeChangeSeq = 0;
  let pendingPersist: Promise<void> = Promise.resolve();

  async function handlePermissionModeChange(
    newMode: string,
    opts?: { toast?: boolean },
  ): Promise<boolean> {
    const seq = ++permissionModeChangeSeq;
    const oldMode = store.permissionMode;
    const oldFlag = store.permissionModeSetByUser;
    const oldPersistFailed = store.permissionModePersistFailed;
    const hadActiveSession = store.sessionAlive; // capture at entry, before awaits
    dbg("chat", "permission mode change", { from: oldMode, to: newMode, seq, hadActiveSession });

    // Optimistic UI + protect from session_init during awaits
    store.permissionMode = newMode;
    store.permissionModeSetByUser = true;
    store.permissionModePersistFailed = false;

    if (hadActiveSession && store.run) {
      // Active session: hot-switch via control protocol (CLI expects CLI names)
      try {
        await api.setPermissionMode(store.run.id, newMode);
        dbg("chat", "permission mode changed via control protocol", { newMode });
      } catch (e) {
        if (seq !== permissionModeChangeSeq) return false;
        // Restore mode, flag, AND persistFailed
        store.permissionMode = oldMode;
        store.permissionModeSetByUser = oldFlag;
        store.permissionModePersistFailed = oldPersistFailed;
        dbgWarn("chat", "permission mode change failed:", e);
        store.error = t("chat_permModeFailed", { mode: newMode, error: String(e) });
        if (opts?.toast !== false) {
          showChatToast(t("toast_permissionFailed"));
        }
        return false;
      }
    }

    if (seq !== permissionModeChangeSeq) return false;

    if (opts?.toast !== false) {
      showChatToast(t("toast_permissionMode", { mode: getPermModeLabel(newMode) }));
    }

    // Persist — serialized to prevent concurrent writes overwriting each other.
    // persistFailed flag signals whether the no-active-session branch reverted.
    let persistFailed = false;
    const appName = CLI_TO_APP_MODE[newMode] ?? newMode;

    pendingPersist = pendingPersist
      .then(async () => {
        if (seq !== permissionModeChangeSeq) return;
        try {
          await api.updateUserSettings({ permission_mode: appName });
          dbg("chat", "permission mode persisted", { appName });
        } catch (e) {
          if (seq !== permissionModeChangeSeq) return;
          dbgWarn("chat", "permission mode persist failed:", e);
          if (hadActiveSession) {
            // CLI was already switched via control protocol → current session correct.
            // Mark persist-failed so _clearContentState() resets flag on next run,
            // allowing new session's session_init to re-sync from CLI's startup mode.
            store.permissionModePersistFailed = true;
            if (opts?.toast !== false) showChatToast(t("toast_permissionPersistFailed"));
          } else {
            // No active session → persist was ONLY path for mode to take effect.
            // Revert everything.
            persistFailed = true;
            store.permissionMode = oldMode;
            store.permissionModeSetByUser = oldFlag;
            store.permissionModePersistFailed = oldPersistFailed;
            dbgWarn("chat", "no active session — reverting UI to match persisted settings");
            if (opts?.toast !== false) showChatToast(t("toast_permissionChangeFailed"));
          }
        }
      })
      .catch(() => {}); // ensure chain never breaks

    await pendingPersist;

    if (persistFailed) return false;

    // Sync legacy plan_mode (fire-and-forget)
    if (seq === permissionModeChangeSeq) {
      api.updateAgentSettings("claude", { plan_mode: newMode === "plan" }).catch((e) => {
        dbgWarn("chat", "plan_mode sync failed:", e);
      });
    }

    return seq === permissionModeChangeSeq;
  }

  // ── Summarize & Export ──

  async function handleSummarize() {
    if (!store.run) {
      dbgWarn("chat", "handleSummarize: no run");
      showChatToast(t("export_noConversation"));
      return;
    }
    dbg("chat", "handleSummarize: start");

    try {
      // Show loading toast
      showChatToast(t("summarize_generating"));

      // Call backend to generate summary using Claude
      const summaryResult = await api.summarizeConversation(store.run.id);
      const { summary, markdown } = summaryResult;

      // Build a beautiful HTML poster with the summary
      const title = store.run.name ?? store.run.prompt?.slice(0, 80) ?? "Conversation Summary";
      const html = buildSummaryHtml(title, {
        summary,
        markdown,
        model: store.model,
        cwd: store.effectiveCwd,
        startedAt: store.run.started_at,
        turnCount: store.numTurns || 0,
      });

      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `summary-${Date.now()}.html`,
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!path) {
        dbg("chat", "handleSummarize: user cancelled");
        return;
      }

      await api.writeHtmlExport(path, html);
      dbg("chat", "handleSummarize: done", { path });
      showChatToast(t("summarize_success"));
    } catch (e) {
      dbgWarn("chat", "handleSummarize failed", e);
      showChatToast(t("summarize_failed"));
    }
  }

  async function handleModelChange(newModel: string) {
    dbg("chat", "model change", { from: store.model, to: newModel });
    store.model = newModel;

    const isThirdParty = store.platformId && store.platformId !== "anthropic";

    // Hot-switch model if session is alive (only for Anthropic — third-party models
    // are set via ANTHROPIC_MODEL env var at spawn time, not via control protocol)
    if (!isThirdParty && store.sessionAlive && store.run) {
      try {
        await api.sendSessionControl(store.run.id, "set_model", { model: newModel });
        dbg("chat", "model hot-switched via control protocol");
      } catch (e) {
        dbgWarn("chat", "model hot-switch failed, will use new model on next session", e);
      }
    }

    // Persist model to run meta (per-run model memory)
    if (store.run) {
      api.updateRunModel(store.run.id, newModel).catch((e) => {
        dbgWarn("chat", "failed to persist run model", e);
      });
    }

    // Only persist default_model for Anthropic — third-party models managed per-credential
    if (!isThirdParty) {
      lastKnownGoodAnthropicModel = newModel;
      try {
        await api.updateUserSettings({ default_model: newModel });
      } catch (e) {
        dbgWarn("chat", "failed to persist model change", e);
      }
    }
  }

  async function handleEffortChange(newEffort: string) {
    dbg("chat", "effort change", { from: currentEffort, to: newEffort });
    currentEffort = newEffort;
    // Write to CLI config (~/.claude/settings.json) — the CLI reads effortLevel
    // per-request, so changes take effect immediately within a running session.
    // Deliberately NOT writing to agentSettings.effort — that would cause --effort
    // to be passed at spawn, which locks the CLI's in-memory effort and prevents
    // settings.json changes from being picked up during the session.
    api.updateCliConfig({ effortLevel: newEffort || null }).catch((e) => {
      dbgWarn("chat", "failed to persist effort to CLI config", e);
    });
  }

  async function handleAuthModeChange(mode: string) {
    dbg("chat", "auth mode change", { from: store.authMode, to: mode });
    store.authMode = mode;
    try {
      await api.updateUserSettings({ auth_mode: mode } as Partial<UserSettings>);
      // Refresh auth overview after mode change
      authOverview = await api.getAuthOverview();
    } catch (e) {
      dbgWarn("chat", "failed to persist auth mode change", e);
    }
  }

  async function checkAllLocalProxies() {
    const localPresets = PLATFORM_PRESETS.filter((p) => p.category === "local");
    const results = await Promise.allSettled(
      localPresets.map((p) => {
        const cred = findCredential(settings?.platform_credentials ?? [], p.id);
        const url = cred?.base_url || p.base_url;
        return api.detectLocalProxy(p.id, url);
      }),
    );
    const statuses: Record<string, { running: boolean; needsAuth: boolean }> = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        statuses[localPresets[i].id] = { running: r.value.running, needsAuth: r.value.needsAuth };
      } else {
        statuses[localPresets[i].id] = { running: false, needsAuth: false };
      }
    });
    localProxyStatuses = statuses;
    dbg("chat", "checkAllLocalProxies", statuses);
  }

  async function handlePlatformChange(platformId: string) {
    dbg("chat", "platform change", { from: store.platformId, to: platformId });
    store.platformId = platformId;

    // Auto-switch model to provider's default when switching to a third-party platform
    // Priority: credential.models (user-configured) > preset.models (static defaults)
    const cred = findCredential(settings?.platform_credentials ?? [], platformId);
    const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
    const models = cred?.models?.length ? cred.models : preset?.models;
    if (models?.length) {
      const defaultModel = models[0];
      dbg("chat", "auto-switch model for platform", { platformId, model: defaultModel });
      store.model = defaultModel;
    } else if (platformId === "anthropic") {
      // Switching back to Anthropic: always overwrite — don't keep third-party model;
      // don't fallback to settings.default_model which might be contaminated.
      const cliModel = getCliCurrentModel();
      store.model = cliModel || "";
      dbg("chat", "restore model on switch to anthropic", { cliModel, using: store.model });
    } else {
      // Custom/unknown platform without preset models: clear model
      // (let CLI use whatever default it has, or the user can set manually)
      store.model = "";
    }

    // Only persist default_model when switching to Anthropic with a validated CLI model.
    // Don't persist empty or potentially-stale model values.
    const persistUpdate: Partial<UserSettings> = { active_platform_id: platformId };
    if (platformId === "anthropic") {
      const validated = getCliCurrentModel();
      if (validated) persistUpdate.default_model = validated;
    }
    try {
      await api.updateUserSettings(persistUpdate);
    } catch (e) {
      dbgWarn("chat", "failed to persist platform change", e);
    }
    // Refresh local proxy statuses after platform switch
    checkAllLocalProxies();
  }

  function appendCommandOutput(text: string) {
    const cmdId = uuid();
    store.timeline = [
      ...store.timeline,
      {
        kind: "command_output",
        id: cmdId,
        anchorId: cmdId,
        content: text,
        ts: new Date().toISOString(),
      },
    ];
  }

  async function handleRename(name: string) {
    if (!store.run) return;
    try {
      await api.renameRun(store.run.id, name);
      store.run = { ...store.run, name };
      window.dispatchEvent(new Event("ocv:runs-changed"));
      dbg("chat", "renamed run", { id: store.run.id, name });
    } catch (e) {
      dbgWarn("chat", "rename failed", e);
    }
  }

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

  async function handleFastModeSwitch(mode: "on" | "off") {
    const enabling = mode === "on";
    const current = store.fastModeState === "on";
    if (enabling === current) {
      appendCommandOutput(t(enabling ? "fast_alreadyOn" : "fast_alreadyOff"));
      return;
    }
    try {
      await api.updateCliConfig({ fastMode: enabling });
      store.fastModeState = enabling ? "on" : "";
      dbg("chat", "fastMode set", { mode });
      showChatToast(t(enabling ? "toast_fastModeOn" : "toast_fastModeOff"));
      appendCommandOutput(t(enabling ? "fast_enabled" : "fast_disabled"));
    } catch (e) {
      dbgWarn("chat", "fastMode set failed:", e);
    }
  }

  async function handleBtwSend(question: string) {
    if (!store.run?.id) return;
    dbg("chat", "btwSend", { runId: store.run.id, question: question.slice(0, 50) });
    btwState = { active: true, btwId: null, question, answer: "", error: null, loading: true };
    try {
      const btwId = await api.sideQuestion(store.run.id, question);
      btwState.btwId = btwId;
    } catch (e) {
      btwState.error = String(e);
      btwState.loading = false;
    }
  }

  // ── Preview helpers ──

  function openPreviewInSidebar(url?: string) {
    const targetUrl = url?.trim() || localStorage.getItem("ocv:preview-url") || "";
    if (!targetUrl) {
      appendCommandOutput(t("preview_usage"));
      return;
    }
    requestedPreviewUrl = targetUrl;
    sidebarRequestedTab = "preview";
    if (sidebarCollapsed) sidebarCollapsed = false;
    appendCommandOutput(t("preview_opened"));
  }

  async function handleRalphCancel() {
    if (!store.run?.id) return;
    try {
      const result = await api.cancelRalphLoop(store.run.id);
      if (result.immediate) {
        appendCommandOutput(`Loop cancelled (iteration ${result.iteration})`);
      } else {
        appendCommandOutput(
          `Loop will stop after current iteration (iteration ${result.iteration})`,
        );
      }
    } catch (err) {
      appendCommandOutput(
        `Failed to cancel loop: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

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

  async function handleStop() {
    await store.stop();
    window.dispatchEvent(new Event("ocv:runs-changed"));
  }

  async function handleResume(
    mode: SessionMode,
    overrideRunId?: string,
    initialMessage?: string,
    initialAttachments?: Attachment[],
  ) {
    const targetRunId = overrideRunId ?? store.run?.id;
    if (!targetRunId || resuming) return;
    resuming = true;

    // Per-session platform: resume automatically uses run's saved platform_id
    // via backend resolve_auth_env_for_platform() — no mismatch dialog needed.

    // Fork: activate overlay immediately for progress feedback
    if (mode === "fork") {
      forkOverlay = { active: true, sourceRunId: targetRunId, startedAt: Date.now(), error: null };
    }

    try {
      // Fork: don't subscribe to source — backend emits RunState(stopped)
      // for the source which would interfere with the fork state machine.
      if (mode !== "fork") {
        middleware.subscribeCurrent(targetRunId, store);
      }
      const resultId = await store.resumeSession(
        targetRunId,
        mode,
        initialMessage,
        initialAttachments,
      );
      if (resultId) {
        middleware.subscribeCurrent(resultId, store);
        if (mode === "fork") {
          // Check if user cancelled during fork_oneshot
          if (!forkOverlay) {
            dbg("chat", "fork: cancelled during fork_oneshot, skipping step 2");
          } else {
            // Step 1 complete — dismiss overlay, use normal session startup UI for step 2
            forkOverlay = null;
            goto(`/chat?run=${resultId}`, { replaceState: true });
            // Step 2: establish stream-json connection (shows "Starting session..." spinner)
            try {
              await store.connectSession(resultId);
            } catch (e) {
              store.error = String(e);
            }
          }
        } else {
          goto(`/chat?run=${resultId}`, { replaceState: true });
        }
      } else if (mode === "fork") {
        // Fork failed — don't clear overlay or navigate away.
        // The phase watcher $effect will show the error in the overlay.
        // User can Retry or Cancel from there.
        dbg("chat", "fork failed, keeping overlay for retry/cancel");
      } else {
        // Non-fork resume failed — stay on the target run's view instead of
        // navigating to blank new-session page (the run's history is still useful).
        lastContinuableRun = null;
        goto(`/chat?run=${targetRunId}`, { replaceState: true });
      }
      window.dispatchEvent(new Event("ocv:runs-changed"));
    } catch (e) {
      // Fork sync failure → show error in overlay instead of error bar
      if (mode === "fork" && forkOverlay) {
        forkOverlay = { ...forkOverlay, error: String(e) };
      }
    } finally {
      resuming = false;
    }
  }

  /** Stop the fork run's process (if it exists and isn't the source run). */
  async function stopForkProcess(sourceRunId: string) {
    if (store.run && store.run.id !== sourceRunId) {
      try {
        await api.stopSession(store.run.id);
      } catch {
        /* best-effort */
      }
    }
  }

  async function handleForkCancel() {
    if (!forkOverlay) return;
    const sourceRunId = forkOverlay.sourceRunId;
    await stopForkProcess(sourceRunId);
    forkOverlay = null;
    store.error = "";
    goto(`/chat?run=${sourceRunId}`, { replaceState: true });
    // Explicit reload — URL may not change if we're returning to the same run
    await loadRunProgressive(sourceRunId);
    window.dispatchEvent(new Event("ocv:runs-changed"));
  }

  async function handleForkRetry() {
    if (!forkOverlay || resuming) return;
    const sourceRunId = forkOverlay.sourceRunId;
    await stopForkProcess(sourceRunId);
    forkOverlay = { active: true, sourceRunId, startedAt: Date.now(), error: null };
    store.error = "";
    await handleResume("fork", sourceRunId);
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

  async function toggleCliConfigBool(key: string) {
    try {
      const config = await api.getCliConfig();
      const current = config[key] === true;
      await api.updateCliConfig({ [key]: !current });
      dbg("chat", `toggled ${key}`, { from: current, to: !current });
      // Immediately mirror UI state
      if (key === "fastMode") {
        store.fastModeState = !current ? "on" : "";
        dbg("chat", "fastMode UI mirrored", { state: store.fastModeState });
      } else if (key === "verbose") {
        verboseEnabled = !current;
        dbg("chat", "verbose UI mirrored", { verbose: verboseEnabled });
      }
      const label =
        key === "fastMode"
          ? !current
            ? "toast_fastModeOn"
            : "toast_fastModeOff"
          : !current
            ? "toast_verboseOn"
            : "toast_verboseOff";
      showChatToast(t(label as Parameters<typeof t>[0]));
    } catch (e) {
      dbgWarn("chat", `toggle ${key} failed:`, e);
    }
  }

  // Chat keybinding callbacks — registered/unregistered via keybindingStore in onMount below

  // ── Page-level drag-drop (Tauri native events) ──
  let pageDragActive = $state(false);
  let dragProcessingCount = $state(0);
  let dragProcessing = $derived(dragProcessingCount > 0);

  /** Concurrency-limited parallel map returning PromiseSettledResult for each item. */
  async function handleTauriDrop(payload: { paths: string[] }) {
    pageDragActive = false;
    const paths = payload.paths;
    const input = promptRef; // cache ref — promptRef may become undefined after awaits
    if (!paths?.length || !input) return;

    dragProcessingCount++;
    dbg("chat", "tauri-drop", { count: paths.length });

    try {
      // Phase 1: parallel classify (concurrency=5 to avoid IPC flood on large batches)
      const classified = await mapSettled(
        paths,
        async (p) => {
          const name = p.split(/[/\\]/).pop() || "file";
          const isDir = await api.checkIsDirectory(p);
          return { p, name, isDir };
        },
        5,
      );

      const dirRefs: Array<{ path: string; name: string; isDir: true }> = [];
      const fileEntries: Array<{ p: string; name: string }> = [];

      for (let i = 0; i < classified.length; i++) {
        const result = classified[i];
        const p = paths[i];
        const name = p.split(/[/\\]/).pop() || "file";
        if (result.status === "fulfilled") {
          if (result.value.isDir) {
            dirRefs.push({ path: p, name, isDir: true });
            dbg("chat", "tauri-drop: dir", { name });
          } else {
            fileEntries.push({ p, name });
          }
        } else {
          // checkIsDirectory IPC failed — conservatively treat as file
          fileEntries.push({ p, name });
          dbgWarn("chat", "tauri-drop: classify failed, treating as file", {
            name,
            error: result.reason,
          });
        }
      }

      // Phase 2: parallel file read (concurrency=2 to limit memory)
      const fileResults = await mapSettled(
        fileEntries,
        async ({ p, name }) => {
          const [base64, mime] = await api.readFileBase64(p);
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          return { file: new File([bytes], name, { type: mime }), name, mime, size: bytes.length };
        },
        2,
      );

      const filesToProcess: File[] = [];
      const fileRefs: Array<{ path: string; name: string; isDir: false }> = [];

      for (let i = 0; i < fileResults.length; i++) {
        const result = fileResults[i];
        const { p, name } = fileEntries[i];
        if (result.status === "fulfilled") {
          filesToProcess.push(result.value.file);
          dbg("chat", "tauri-drop: file", {
            name: result.value.name,
            mime: result.value.mime,
            size: result.value.size,
          });
        } else {
          fileRefs.push({ path: p, name, isDir: false });
          dbgWarn("chat", "tauri-drop: fallback to path ref", { name, error: result.reason });
        }
      }

      // Guard: if page navigated away during processing, promptRef is stale
      if (promptRef !== input) {
        dbgWarn("chat", "tauri-drop: promptRef stale after processing, discarding");
        return;
      }

      // Add path refs (dirs + failed files)
      const allPathRefs = [...dirRefs, ...fileRefs];
      if (allPathRefs.length > 0) {
        input.addPathRefs(allPathRefs);
      }

      // Normal files → existing addFiles pipeline (await so spinner covers processFiles)
      if (filesToProcess.length > 0) {
        await input.addFiles(filesToProcess);
      }

      // Single summary toast
      if (allPathRefs.length > 0) {
        const parts: string[] = [];
        if (dirRefs.length > 0) {
          parts.push(t("drag_foldersInserted", { count: String(dirRefs.length) }));
        }
        if (fileRefs.length > 0) {
          parts.push(t("drag_filesAsPathRef", { count: String(fileRefs.length) }));
        }
        input.showToast(parts.join(t("common_listSeparator")));
      }
    } finally {
      dragProcessingCount--;
    }
  }

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
  }

  async function handleProcessVisibilityChange(mode: ProcessVisibility) {
    const prev = settings;
    persistCachedProcessVisibility(mode);
    if (settings) settings = { ...settings, process_visibility: mode };
    try {
      settings = await api.updateUserSettings({ process_visibility: mode });
      persistCachedProcessVisibility(normalizeProcessVisibility(settings.process_visibility));
    } catch {
      settings = prev;
      if (prev) {
        persistCachedProcessVisibility(normalizeProcessVisibility(prev.process_visibility));
      }
    }
  }

  async function scrollToTool(toolUseId: string) {
    // Clear filter first — target may be filtered out, and burst/visible indices
    // depend on the unfiltered timeline.
    if (toolFilter) {
      toolFilter = null;
      await tick();
    }
    // Locate target in the data layer (DOM may not be mounted yet under progressive render).
    const ft = filteredTimeline;
    const ftIdx = ft.findIndex((e) => e.kind === "tool" && e.tool.tool_use_id === toolUseId);
    if (ftIdx < 0) return;
    expandRenderLimitTo(ftIdx);
    await tick();
    // Re-map to visibleTimeline-local index for burst expansion.
    const visibleIdx = visibleTimeline.findIndex(
      (e) => e.kind === "tool" && e.tool.tool_use_id === toolUseId,
    );
    if (visibleIdx >= 0) await ensureBurstExpandedFor(visibleIdx);
    const el = document.getElementById("tool-" + toolUseId);
    if (el) {
      // Temporarily disable content-visibility so the browser knows real heights and
      // scrollIntoView lands at the correct offset (mirrors scrollToMessage).
      const container = chatAreaRef;
      const cvEls = container
        ? Array.from(container.querySelectorAll<HTMLElement>(".cv-auto"))
        : [];
      for (const c of cvEls) c.style.contentVisibility = "visible";
      el.getBoundingClientRect();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      requestAnimationFrame(() => {
        for (const c of cvEls) c.style.contentVisibility = "";
      });
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 2000);
    }
  }

  async function scrollToMessage(ts: string) {
    dbg("chat", "scrollToMessage", { ts });
    if (toolFilter) {
      toolFilter = null;
      await tick();
    }
    // Resolve target from data — `ts` may be ts, anchorId, cliUuid, or id.
    const match = store.timeline.find(
      (e) =>
        e.ts === ts || e.anchorId === ts || (e.kind === "user" && e.cliUuid === ts) || e.id === ts,
    );
    if (!match) return;
    const ft = filteredTimeline;
    const ftIdx = ft.findIndex((e) => e.id === match.id);
    if (ftIdx < 0) return;
    expandRenderLimitTo(ftIdx);
    await tick();
    const visibleIdx = visibleTimeline.findIndex((e) => e.id === match.id);
    if (visibleIdx >= 0) await ensureBurstExpandedFor(visibleIdx);
    // DOM id uses anchorId (see `id="msg-{entry.anchorId}"` in the each block).
    const el = document.getElementById("msg-" + match.anchorId);
    if (el) {
      // Temporarily disable content-visibility on ALL entries so the browser
      // knows real heights and scrollIntoView lands at the correct offset.
      const container = chatAreaRef;
      const cvEls = container
        ? Array.from(container.querySelectorAll<HTMLElement>(".cv-auto"))
        : [];
      for (const c of cvEls) c.style.contentVisibility = "visible";

      el.getBoundingClientRect(); // force reflow
      el.scrollIntoView({ behavior: "instant", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");

      // Restore content-visibility after scroll settles
      requestAnimationFrame(() => {
        for (const c of cvEls) c.style.contentVisibility = "";
      });
      setTimeout(() => {
        el!.classList.remove("ring-2", "ring-primary/50");
      }, 2000);
    } else {
      dbg("chat", "scrollToMessage: element not found", { anchor: ts });
    }
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

  async function handleToolApprove(toolName: string) {
    if (!store.run) return;
    approving = true;
    dbg("chat", "approving tool", { runId: store.run.id, toolName });
    try {
      await api.approveSessionTool(store.run.id, toolName);
    } catch (e) {
      dbgWarn("chat", "approve failed:", e);
      store.error = String(e);
    } finally {
      // approving resets when new RunState events arrive (spawning/running)
      setTimeout(() => {
        approving = false;
      }, 3000);
    }
  }

  async function handlePermissionRespond(
    requestId: string,
    behavior: "allow" | "deny",
    updatedPermissions?: import("$lib/types").PermissionSuggestion[],
    updatedInput?: Record<string, unknown>,
    denyMessage?: string,
    interrupt?: boolean,
  ) {
    if (!store.run || !store.sessionAlive) return;
    const runId = store.run.id; // snapshot — store.run may change after await
    dbg("chat", "inline permission respond", {
      runId,
      requestId,
      behavior,
      updatedPermissions,
      updatedInput,
      denyMessage,
      interrupt,
    });
    try {
      // Set pending mode override BEFORE responding (so reducer picks it up)
      if (behavior === "allow" && updatedPermissions) {
        const modePerm = updatedPermissions.find((p) => p.type === "setMode");
        if (modePerm && modePerm.mode) {
          store.pendingPermissionModeOverride = modePerm.mode;
          dbg("chat", "set pendingPermissionModeOverride", { mode: modePerm.mode });
        }
      }

      await api.respondPermission(
        runId,
        requestId,
        behavior,
        updatedPermissions,
        updatedInput,
        denyMessage,
        interrupt,
      );
      // Optimistic resolve + clear attention flag
      resolvePermissionOptimistic(store, runId, requestId, behavior);
    } catch (e) {
      dbgWarn("chat", "permission respond failed:", e);
      // If the CLI rejected the response (e.g. session already idle after interrupt),
      // still resolve the card locally so buttons are removed.
      if (behavior === "deny") {
        resolvePermissionOptimistic(store, runId, requestId, "deny");
      }
      // allow failure: don't change status — submitting timeout auto-resets (§5)
      store.error = String(e);
      throw e; // Let component-side wrapper catch and unlock buttons
    }
  }

  async function handleElicitationRespond(
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ) {
    if (!store.run || !store.sessionAlive) return;
    const runId = store.run.id;
    dbg("chat", "elicitation respond", { runId, requestId, action });
    try {
      await api.respondElicitation(runId, requestId, action, content);
      // Cleanup after successful response — not optimistic, avoids card loss on failure
      const { resolveElicitationOptimistic } = await import("$lib/utils/resolve-elicitation");
      resolveElicitationOptimistic(store, runId, requestId);
    } catch (e) {
      dbgWarn("chat", "elicitation respond failed:", e);
      store.error = String(e);
    }
  }

  function getPlanContentForExitPlan(
    entryId: string,
  ): { content: string; fileName: string } | null {
    const idx = timelineIdIndex.get(entryId);
    if (idx == null) {
      dbgWarn("chat", "ExitPlanMode entry not found in timeline index", { id: entryId });
      return null;
    }
    const result = extractPlanContent(store.timeline, idx);
    if (result) return result;
    // Fallback: use tool_use_result.plan (--permission-mode=plan auto-approves
    // ExitPlanMode without Write, plan content is in the result directly)
    const entry = store.timeline[idx];
    if (entry?.kind === "tool" && entry.tool.status === "success") {
      const toolResult = entry.tool.tool_use_result as
        | { plan?: string; filePath?: string }
        | undefined;
      if (toolResult?.plan && typeof toolResult.plan === "string") {
        const fp = String(toolResult.filePath ?? "");
        const name = isPlanFilePath(fp) ? (planFileName(fp) ?? "plan") : "plan";
        return { content: toolResult.plan, fileName: name };
      }
    }
    return null;
  }

  /** Get the latest plan content for an approved ExitPlanMode card.
   *  Applies subsequent Edits to the approved plan content. */
  async function handleExitPlanClearContext() {
    if (!store.run) return;
    const runId = store.run.id;
    const cwd = localStorage.getItem("ocv:project-cwd") || "";
    dbg("chat", "ExitPlanMode: clear context + auto-accept");

    // Find the ExitPlanMode tool's permission request ID from timeline
    const exitPlanEntry = store.timeline.find(
      (e) =>
        e.kind === "tool" &&
        e.tool.tool_name === "ExitPlanMode" &&
        e.tool.status === "permission_prompt" &&
        e.tool.permission_request_id,
    );
    if (!exitPlanEntry || exitPlanEntry.kind !== "tool") return;
    const requestId = exitPlanEntry.tool.permission_request_id!;

    try {
      // 1. Set flags BEFORE responding
      store.pendingPermissionModeOverride = "acceptEdits";
      store.pendingClearContextPlan = "__pending__"; // marker: waiting for tool_end

      // 2. Allow ExitPlanMode (with setMode) — satisfies the control_response requirement
      await api.respondPermission(
        runId,
        requestId,
        "allow",
        [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
        exitPlanEntry.tool.input,
      );
      resolvePermissionOptimistic(store, runId, requestId, "allow");

      // 3. Wait for tool_end to deliver plan content (via pendingClearContextPlan)
      //    Poll briefly — tool_end should arrive within a few hundred ms
      let planContent: string | null = null;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (store.pendingClearContextPlan && store.pendingClearContextPlan !== "__pending__") {
          planContent = store.pendingClearContextPlan;
          break;
        }
      }
      store.pendingClearContextPlan = null;

      if (!planContent) {
        dbgWarn("chat", "ExitPlanMode: timed out waiting for plan content");
        // Fallback: continue in current session (ExitPlanMode already allowed)
        return;
      }

      // 4. Interrupt + stop current session
      await api.interruptSession(runId).catch(() => {});
      await api.stopSession(runId);
      dbg("chat", "ExitPlanMode: session stopped");

      // 5. Navigate to fresh chat URL, then start a new session inline.
      //    Using sessionStorage + onMount doesn't work: /chat?run=X → /chat
      //    is the same route component and onMount won't re-fire.
      //    permissionModeOverride threads through api.startSession → backend
      //    adapter_settings, so the CLI spawns with --permission-mode acceptEdits
      //    and the first "Implement..." turn runs in auto-accept (not plan).
      const planPrompt = `Implement the following plan:\n\n${planContent}`;
      await goto("/chat", { replaceState: true });
      await tick(); // let runId effect run loadRun("") → store.reset()
      const newRunId = await store.startSession(planPrompt, cwd, [], "acceptEdits");
      await goto(`/chat?run=${newRunId}`, { replaceState: true });
      dbg("chat", "ExitPlanMode: new session started", { newRunId });
    } catch (e) {
      dbgWarn("chat", "ExitPlanMode clear context failed:", e);
      store.pendingClearContextPlan = null;
      store.error = String(e);
      throw e; // Let component-side wrapper catch and unlock buttons
    }
  }

  async function handleHookCallbackRespond(requestId: string, decision: "allow" | "deny") {
    if (!store.run) return;
    dbg("chat", "hook callback respond", { runId: store.run.id, requestId, decision });
    try {
      await api.respondHookCallback(store.run.id, requestId, decision);
      // Update hook event status in store
      store.hookEvents = store.hookEvents.map((h) =>
        h.request_id === requestId
          ? { ...h, status: decision === "allow" ? ("allowed" as const) : ("denied" as const) }
          : h,
      );
    } catch (e) {
      dbgWarn("chat", "hook callback respond failed:", e);
      store.error = String(e);
    }
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
                {#each visibleTimeline as entry, i (entry.id)}
                  {#if !(burstCollapse.collapsedIndices.has(i) && !toolBursts.has(i))}
                    <div
                      id="msg-{entry.anchorId}"
                      data-entry-id={entry.id}
                      class:cv-auto={true}
                      class="group/msg"
                      class:opacity-40={lastClearSepId !== null &&
                        (timelineIdIndex.get(entry.id) ?? 0) <
                          (timelineIdIndex.get(lastClearSepId) ?? 0)}
                    >
                      {#if batchGroups.has(i) && processVisibility !== "output"}
                        {@const batch = batchGroups.get(i)}
                        {#if batch}
                          <div class="w-full py-1">
                            <div class="chat-content-width pl-7">
                              <BatchProgressBar tools={batch} />
                            </div>
                          </div>
                        {/if}
                      {/if}
                      {#if toolBursts.has(i) && processVisibility !== "output"}
                        {@const burst = toolBursts.get(i)}
                        {#if burst}
                          <div class="w-full py-1">
                            <div class="chat-content-width pl-7">
                              <ToolBurstHeader
                                {burst}
                                collapsed={burstCollapse.effectiveCollapsed.has(burst.key)}
                                onToggle={() => toggleBurst(burst.key)}
                              />
                            </div>
                          </div>
                        {/if}
                      {/if}
                      {#if usageAnnotations.has(i)}
                        {@const tu = usageAnnotations.get(i)}
                        {#if tu && settings?.show_token_usage_report !== false && shouldShowContextDetails(processVisibility)}
                          <ChatUsageAnnotation usage={tu} />
                        {/if}
                      {/if}
                      {#if entry.kind === "user"}
                        <ChatMessage
                          message={{
                            id: entry.id,
                            role: "user",
                            content: entry.content,
                            timestamp: entry.ts,
                          }}
                          attachments={entry.attachments}
                          onRewind={entry.cliUuid && store.sessionAlive && !store.isRunning
                            ? () =>
                                handleRewindToMessage({
                                  cliUuid: entry.cliUuid!,
                                  content: entry.content,
                                  ts: entry.ts,
                                })
                            : undefined}
                          onDispatchToTeam={() => {
                            teamDispatchPrompt = entry.content;
                            teamDispatchOpen = true;
                          }}
                        />
                      {:else if entry.kind === "assistant"}
                        <ChatMessage
                          message={{
                            id: entry.id,
                            role: "assistant",
                            content: entry.content,
                            timestamp: entry.ts,
                          }}
                          thinkingText={entry.thinkingText}
                          agent={store.agent}
                          platformId={store.platformId ?? undefined}
                          model={store.run?.model ?? store.model}
                          animated={i === lastAssistantIdx && store.isRunning}
                          {processVisibility}
                          debugRunId={store.run?.id}
                          debugSessionId={store.run?.session_id ?? undefined}
                        />
                      {:else if entry.kind === "tool"}
                        {#if claudeTurnStarts.has(i)}
                          <div class="pt-3"></div>
                        {/if}
                        {#if !burstCollapse.collapsedIndices.has(i)}
                          {#if processVisibility === "output" && !shouldMountFullToolCardInOutputMode(entry.tool)}
                            <div
                              id="tool-{entry.tool.tool_use_id}"
                              class="pointer-events-none h-0 w-full scroll-mt-24 overflow-hidden"
                              aria-hidden="true"
                            ></div>
                          {:else if processVisibility === "guided" && !shouldMountFullToolCardInGuidedMode(entry.tool)}
                            <div class="w-full py-1" id="tool-{entry.tool.tool_use_id}">
                              <div class="chat-content-width">
                                <GuidedToolTimelineRow tool={entry.tool} />
                              </div>
                            </div>
                          {:else}
                            <div
                              class="w-full py-1"
                              id="tool-{entry.tool.tool_use_id}"
                              class:collapsing-burst-tool={burstCollapse.collapsingIndices.has(i)}
                            >
                              <div class="chat-content-width">
                                <InlineToolCard
                                  tool={entry.tool}
                                  subTimeline={entry.subTimeline}
                                  runId={store.run?.id ?? ""}
                                  {fetchToolResult}
                                  {processVisibility}
                                  onAnswer={entry.tool.tool_name === "AskUserQuestion" &&
                                  (entry.tool.status === "running" ||
                                    entry.tool.status === "ask_pending")
                                    ? (answer) => handleToolAnswer(entry.tool.tool_use_id, answer)
                                    : undefined}
                                  onApprove={handleToolApprove}
                                  onPermissionRespond={handlePermissionRespond}
                                  onExitPlanClearContext={handleExitPlanClearContext}
                                  taskNotifications={store.taskNotifications}
                                  planContent={entry.tool.tool_name === "ExitPlanMode" &&
                                  (entry.tool.status === "permission_prompt" ||
                                    entry.tool.status === "success")
                                    ? getPlanContentForExitPlan(entry.id)
                                    : undefined}
                                  latestPlanTool={entry.kind === "tool" &&
                                    entry.tool.tool_use_id === latestPlanToolId}
                                  showPermissionInPanel={showPermissionPanel}
                                  permissionMode={store.permissionMode}
                                  onPreviewFile={openPreviewForPath}
                                />
                              </div>
                            </div>
                          {/if}
                        {/if}
                      {:else if entry.kind === "command_output" || entry.kind === "separator"}
                        {#if isTimelineSeparatorContent(entry.content)}
                          <div class="w-full py-3">
                            <div class="chat-content-width">
                              <div class="flex items-center gap-3">
                                <div class="h-px flex-1 bg-amber-500/20"></div>
                                <span
                                  class="text-xs text-amber-500/70 font-medium whitespace-nowrap"
                                >
                                  {t("chat_contextCleared")}
                                </span>
                                <div class="h-px flex-1 bg-amber-500/20"></div>
                              </div>
                            </div>
                          </div>
                        {:else if shouldShowTimelineCommandOutput(processVisibility, entry.content)}
                          <div class="w-full py-2">
                            <div class="chat-content-width pl-7">
                              <div
                                class="command-output rounded-lg border border-border/40 bg-[#1a1b26] px-4 py-3 text-sm overflow-x-auto"
                              >
                                {#if entry.content.includes("## Context Usage")}
                                  <ContextUsageGrid text={entry.content} />
                                {:else if entry.content.includes("Total cost:") && entry.content.includes("Total duration")}
                                  <CostSummaryView text={entry.content} />
                                {:else if entry.content
                                  .trimStart()
                                  .startsWith("Version ") && entry.content.includes("•")}
                                  <ReleaseNotesCard text={entry.content} />
                                {:else if hasAnsiCodes(entry.content)}
                                  <pre
                                    class="whitespace-pre font-mono text-xs leading-relaxed text-[#c0caf5] m-0">{@html ansiToHtml(
                                      entry.content,
                                    )}</pre>
                                {:else}
                                  <MarkdownContent text={entry.content} />
                                {/if}
                              </div>
                            </div>
                          </div>
                        {/if}
                      {/if}
                    </div>
                  {/if}
                {/each}

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

      <div
        class="chat-input-dock pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col"
      >
        <!-- Resume warning (if applicable) -->
        {#if canResumeNow(store.run, store.phase, agentSettings?.no_session_persistence ?? false) && getResumeWarning(store.run)}
          <div
            class="pointer-events-auto mx-3 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400"
          >
            {getResumeWarning(store.run)}
          </div>
        {/if}

        <!-- Floating permission panel (above input bar) -->
        {#if showPermissionPanel}
          <div class="pointer-events-auto px-2 pb-2">
            <PermissionPanel
              pendingTools={pendingToolPermissions}
              onPermissionRespond={handlePermissionRespond}
            />
          </div>
        {/if}

        <!-- MCP Elicitation dialog (above input bar) -->
        {#if store.hasElicitation && store.sessionAlive}
          <div class="pointer-events-auto px-2 pb-2">
            <ElicitationDialog
              elicitations={store.pendingElicitations}
              onRespond={handleElicitationRespond}
            />
          </div>
        {/if}

        <!-- BTW side question drawer -->
        {#if btwState.active}
          <ChatBtwDrawer
            question={btwState.question}
            answer={btwState.answer}
            error={btwState.error}
            loading={btwState.loading}
            onClose={() => (btwState = { ...btwState, active: false })}
          />
        {/if}

        <!-- Created Files Panel -->
        {#if store.phase === "completed" && hasCreatedFiles}
          <div class="chat-content-width pb-2">
            <CreatedFiles files={createdFiles} onOpenFile={(path) => dbg("open", path)} />
          </div>
        {/if}

        <!-- Insight / HTML Report Card -->
        {#if insight.insightCardOpen}
          <div class="chat-content-width pb-2">
            <ConversationInsightCard
              status={insight.insightState.status}
              report={insight.insightState.report}
              error={insight.insightState.error}
              onPreview={() => {
                insight.insightPreviewOpen = true;
              }}
              onCopy={() => void insight.copyHtml()}
              onExport={() => void insight.exportHtml()}
              onRegenerate={() => void insight.regenerate()}
            />
          </div>
        {/if}

        <!-- Input bar -->
        <!-- Ralph Loop status bar -->
        {#if store.ralphLoop?.active}
          <ChatRalphLoopBar
            iteration={store.ralphLoop.iteration}
            maxIterations={store.ralphLoop.maxIterations}
            completionPromise={store.ralphLoop.completionPromise}
            onCancel={handleRalphCancel}
          />
        {/if}

        {#if store.sessionAlive || !store.run || store.phase === "empty" || store.phase === "ready" || TERMINAL_PHASES.includes(store.phase)}
          <div
            class="pointer-events-auto relative z-10 px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-1"
          >
            <div class="pointer-events-auto">
              <PromptInput
                bind:this={promptRef}
                agent={store.agent}
                running={store.isActivelyRunning}
                disabled={inputBlockedByPermission}
                pendingPermission={store.hasInlinePermission}
                hasRun={!!store.run}
                sessionAlive={store.sessionAlive}
                canResume={!store.sessionAlive &&
                  canResumeNow(
                    store.run,
                    store.phase,
                    agentSettings?.no_session_persistence ?? false,
                  )}
                useStreamSession={store.useStreamSession}
                isRemote={store.isRemote}
                cliCommands={store.sessionInitReceived && store.sessionCommands.length > 0
                  ? store.sessionCommands
                  : mergeProjectCommands(getCliCommands(), projectCommands)}
                models={effectiveModels}
                currentModel={store.model}
                permissionMode={store.permissionMode}
                cwd={store.effectiveCwd ||
                  folderCwdOverride ||
                  localStorage.getItem("ocv:project-cwd") ||
                  ""}
                authMode={store.authMode}
                platformId={store.platformId ?? "anthropic"}
                platformCredentials={settings?.platform_credentials ?? []}
                onSend={sendMessage}
                onBtwSend={handleBtwSend}
                onAgentChange={undefined}
                onInterrupt={() => store.interrupt()}
                onModelSwitch={handleModelChange}
                onPermissionModeChange={store.features.permissionModeSwitch
                  ? handlePermissionModeChange
                  : undefined}
                onVirtualCommand={handleVirtualCommand}
                fastModeState={store.fastModeState}
                onFastModeSwitch={handleFastModeSwitch}
                onPlatformChange={handlePlatformChange}
                {authOverview}
                authSourceLabel={store.authSourceLabel}
                authSourceCategory={store.authSourceCategory}
                apiKeySource={store.apiKeySource}
                onAuthModeChange={handleAuthModeChange}
                {localProxyStatuses}
                showAuthBadge={!welcomeVisible}
                onShortcutHelp={() => (shortcutHelpOpen = !shortcutHelpOpen)}
                availableSkills={store.availableSkills}
                {skillItems}
                agents={preloadedAgents.map((a) => ({ name: a.name, description: a.description }))}
                hasStash={!!stashedInput}
                {userHistory}
                runId={store.run?.id ?? ""}
                onRestoreStash={() => {
                  if (stashedInput) {
                    promptRef?.restoreSnapshot(stashedInput);
                    stashedInput = null;
                    showChatToast(t("toast_stashRestored"));
                    dbg("chat", "stash restored via badge click");
                  }
                }}
                onValueChange={handleInputValueChange}
                contextWindow={store.contextWindow}
                {processVisibility}
              />
              {#if teamHintVisible}
                <div
                  class="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-150"
                >
                  <svg
                    class="h-3.5 w-3.5 shrink-0 text-primary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span>{t("teamRun_teamHint")}</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
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
