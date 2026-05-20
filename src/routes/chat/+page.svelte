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
    SessionInfoData,
    TimelineEntry,
  } from "$lib/types";
  import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
  import { useToolBurstCollapse } from "$lib/chat/use-tool-burst-collapse.svelte";
  import {
    computeTimelinePresentation,
    getInitialRenderLimit,
  } from "$lib/chat/selectors/timeline-presentation";
  import { useConversationInsight } from "$lib/conversation-insight/use-conversation-insight.svelte";
  import XTerminal from "$lib/components/XTerminal.svelte";
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
  import type { ContextSnapshot } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { APP_LOGO_URL } from "$lib/utils/brand-assets";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import {
    getLastTarget,
    setLastTarget,
    getStoredRemoteCwd,
    setStoredRemoteCwd,
  } from "$lib/utils/remote-cwd";
  import { shouldAutoName } from "$lib/utils/auto-name";
  import { randomSpinnerVerb } from "$lib/utils/spinner-verbs";
  import { type TurnUsage } from "$lib/stores/types";
  import {
    normalizeProcessVisibility,
    getCachedProcessVisibility,
  } from "$lib/utils/process-visibility";
  import { mergeProjectCommands } from "$lib/utils/slash-commands";
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
  import type { RewindCandidate, RewindMarker } from "$lib/utils/rewind";
  import { truncate } from "$lib/utils/format";
  import { uuid } from "$lib/utils/uuid";
  import ChatBtwDrawer from "$lib/components/ChatBtwDrawer.svelte";
  import ChatDragOverlay from "$lib/components/ChatDragOverlay.svelte";
  import ChatTimelineEntries from "$lib/components/chat/ChatTimelineEntries.svelte";
  import ChatRalphLoopBar from "$lib/components/ChatRalphLoopBar.svelte";
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
  let toolFilter = $state<string | null>(null);
  let renderLimit = $state(getInitialRenderLimit(getCachedProcessVisibility(), []));
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

  function cleanupVerbose() {
    if (verboseRetryTimer) clearTimeout(verboseRetryTimer);
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
    getCurrentEffort: () => currentEffort,
    setCurrentEffort: (v: string) => {
      currentEffort = v;
    },
    setLastKnownGoodModel: (v: string) => {
      lastKnownGoodAnthropicModel = v;
    },
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

  // ── Initialize lifecycle handlers (replaces 8 onMount blocks) ──
  initLifecycleHandlers({
    store,
    middleware,
    keybindingStore,
    getSettings: () => settings,
    setSettings: (v) => { settings = v; },
    setRemoteHosts: (v) => { remoteHosts = v; },
    setAuthOverview: (v) => { authOverview = v; },
    checkAllLocalProxies,
    getAgentSettings: () => agentSettings,
    setAgentSettings: (v) => { agentSettings = v; },
    setCurrentEffort: (v) => { currentEffort = v; },
    handlePermissionModeChange,
    getPermModeLabel,
    loadCliInfo,
    getCliCurrentModel,
    loadCliVersionInfo,
    isContaminatedDefaultModel,
    setLastKnownGoodModel: (v) => { lastKnownGoodAnthropicModel = v; },
    checkProjectInit,
    reloadProjectData,
    getShortcutHelpOpen: () => shortcutHelpOpen,
    setShortcutHelpOpen: (v) => { shortcutHelpOpen = v; },
    getStatusBarRef: () => statusBarRef,
    getStashedInput: () => stashedInput,
    setStashedInput: (v) => { stashedInput = v; },
    getPromptRef: () => promptRef,
    setStatusBarExpanded: (v) => { statusBarExpanded = v; },
    getSidebarCollapsed: () => sidebarCollapsed,
    setSidebarCollapsed: (v) => { sidebarCollapsed = v; },
    setSidebarRequestedTab: (v) => { sidebarRequestedTab = v; },
    setShowChatToast: showChatToast,
    setPageDragActive: (v) => { pageDragActive = v; },
    setDragProcessingCount: (fn) => { dragProcessingCount = fn(dragProcessingCount); },
    getXtermRef: () => xtermRef,
    getBtwState: () => btwState,
    setBtwState: (v) => { btwState = v; },
    contextHistoryMap,
    triggerContextHistoryReactivity: () => { contextHistoryMap = new Map(contextHistoryMap); },
    getRunId: () => runId,
    setLastContinuableRun: (v) => { lastContinuableRun = v; },
    setMiddlewareReady: (v) => { middlewareReady = v; },
    setAutoNameDone: (v) => { autoNameDone = v; },
    getForkOverlay: () => forkOverlay,
    cleanupVerbose: () => { if (verboseRetryTimer) clearTimeout(verboseRetryTimer); },
    cancelProgressive,
    handleSummarize,
    handleRewind,
    toggleCliConfigBool,
    goto,
    t: t as unknown as (key: string, params?: Record<string, string>) => string,
  });
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
    <ChatConversationStage
      {store}
      {settings}
      {processVisibility}
      {visibleTimeline}
      {filteredTimeline}
      {toolNamesInTimeline}
      {toolFilter}
      setToolFilter={(v) => { toolFilter = v; }}
      {renderLimit}
      {timelineIdIndex}
      {lastClearSepId}
      {latestPlanToolId}
      {batchGroups}
      {toolBursts}
      {burstCollapse}
      {lastAssistantIdx}
      {usageAnnotations}
      {lastTurnUsage}
      {claudeTurnStarts}
      {showPermissionPanel}
      {fetchToolResult}
      topSentinelRef={topSentinel}
      setTopSentinel={(el) => { topSentinel = el; }}
      {welcomeVisible}
      {lastContinuableRun}
      {authOverview}
      {localProxyStatuses}
      {showInitHint}
      {cliVersionInfo}
      {channelLatest}
      {remoteHosts}
      {routeRunLoadFailed}
      {routeRunPending}
      {runId}
      {notificationVisible}
      {latestNotification}
      {rewindMarkers}
      {activeTeamRuns}
      bind:thinkingExpanded
      {thinkingElapsed}
      {thinkingVisible}
      {spinnerVerb}
      {processingSlashCmd}
      {approving}
      {sending}
      {forkOverlay}
      {forkElapsed}
      {resuming}
      {showChatScrollHint}
      {goto}
      {sendMessage}
      {fillPrompt}
      {handleAuthModeChange}
      {handlePlatformChange}
      {handleRewindToMessage}
      {handleToolAnswer}
      {handleToolApprove}
      {handlePermissionRespond}
      {handleExitPlanClearContext}
      {getPlanContentForExitPlan}
      {openPreviewForPath}
      {handleHookCallbackRespond}
      {handleChatScroll}
      {scrollChatToBottom}
      {handleTermResize}
      {handleTermReady}
      {handleForkCancel}
      {handleForkRetry}
      {dismissInitHint}
      {loadRunProgressive}
      setLastTarget={setLastTarget}
      bind:teamDispatchPrompt
      bind:teamDispatchOpen
      bind:xtermRef
      bind:chatAreaRef
    >
      {#snippet heroMetaFooter()}
        {@render heroMetaFooter()}
      {/snippet}
      {#snippet inputDock()}
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
      {/snippet}
    </ChatConversationStage>

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
