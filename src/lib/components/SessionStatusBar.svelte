<script lang="ts">
  import { onDestroy } from "svelte";
  import type { TaskRun, McpServerInfo, CliModelInfo } from "$lib/types";
  import type { TurnUsage } from "$lib/stores/types";
  import { EVT_STATUSBAR_TOGGLE } from "$lib/utils/bus-events";
  import ProcessVisibilityPicker from "$lib/components/ProcessVisibilityPicker.svelte";
  import StatusBarModelMenu from "$lib/components/StatusBarModelMenu.svelte";
  import { getCliModels, loadCliInfo } from "$lib/stores/cli-info.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { fmtNumber } from "$lib/i18n/format";
  import { formatCostDisplay } from "$lib/utils/format";
  import Icon from "$lib/components/Icon.svelte";
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import { shouldShowContextDetails } from "$lib/utils/process-visibility";
  import type { SessionIslandAlignment } from "$lib/utils/session-island-alignment";
  import { agentToRuntimeId, getRuntimeDescriptor } from "$lib/runtime/registry";
  import type { SendCoordinator, SendStatusEvent } from "$lib/chat/send-coordinator";
  import {
    getPermissionStatusPresentation,
    getSendStatusPresentation,
    getToastStatusPresentation,
  } from "$lib/chat/send-status-presentation";
  import type {
    PermissionStatusInput,
    PermissionStatusPresentation,
    ToastStatusPresentation,
  } from "$lib/chat/send-status-presentation";
  import type { Toast } from "$lib/stores/toast-store.svelte";

  let {
    run = null,
    agent = "claude",
    model = "",
    cost: _cost = 0,
    inputTokens: _inputTokens = 0,
    outputTokens: _outputTokens = 0,
    cacheReadTokens: _cacheReadTokens = 0,
    cacheWriteTokens: _cacheWriteTokens = 0,
    running: _running = false,
    /** True while the agent is actively working (spawning/running). Drives morph flash. */
    taskRunning = false,
    /** Blocked on permission / elicitation / inline choice — persistent yellow morph. */
    taskWaiting = false,
    /** Session phase — used to detect manual stop. */
    sessionPhase = "empty",
    parentRunId: _parentRunId,
    onEndSession,
    onModelChange,
    onNavigateParent: _onNavigateParent,
    mcpServers,
    onMcpToggle: _onMcpToggle,
    cliVersion: _cliVersion,
    permissionMode: _permissionMode = "default",
    fastModeState: _fastModeState,
    numTurns: _numTurns,
    durationMs: _durationMs,
    persistedFiles: _persistedFiles,
    onRewind: _onRewind,
    contextUtilization,
    contextWarningLevel,
    contextWindow,
    cwd: _cwd = "",
    lastCompactedAt = 0,
    compactCount: _compactCount = 0,
    microcompactCount: _microcompactCount = 0,
    turnUsages: _turnUsages = [],
    activeTaskCount: _activeTaskCount = 0,
    mode: _mode = "",
    remoteHostName: _remoteHostName,
    onRename,
    platformModels = [],
    authSourceLabel: _authSourceLabel,
    authSourceCategory: _authSourceCategory,
    verbose: _verbose = false,
    apiKeySource: _apiKeySource,
    effort,
    onEffortChange,
    onStatusClick: _onStatusClick,
    onSummarize,
    onShare: _onShare,
    toolPanelActiveTab,
    onToolPanelTabChange,
    toolPanelIndicators,
    fuseToolRailCapsule: _fuseToolRailCapsule = false,
    processVisibility = "expert" as ProcessVisibility,
    onProcessVisibilityChange,
    layoutSidebarOpen = false,
    onToggleLayoutSidebar,
    onOpenSettings,
    onOpenCliImport,
    onNewChat,
    splitModeEnabled = false,
    onToggleSplitMode,
    alignment = "center" as SessionIslandAlignment,
    /** v1.0.9+: unified send status overlay (replaces SendStatusBanner). */
    sendCoordinator = null as SendCoordinator | null,
    onSendRetry = undefined as ((event: SendStatusEvent) => void) | undefined,
    /**
     * v1.1.0: push a permission-mode notification through the unified
     * SessionStatusBar overlay (replaces the standalone `ToastHost`
     * capsule for permission-mode changes). Statuses auto-dismiss after
     * `autoDismissMs` unless `transient: false`. Pass `null` to clear.
     */
    permissionStatus = null as PermissionStatusInput | null,
    onPermissionStatusDismiss = undefined as (() => void) | undefined,
    autoDismissMs = 2400,
    toastNotification = null as Toast | null,
    onToastDismiss = undefined as (() => void) | undefined,
  }: {
    run?: TaskRun | null;
    agent?: string;
    model?: string;
    cost?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    running?: boolean;
    taskRunning?: boolean;
    taskWaiting?: boolean;
    sessionPhase?: string;
    parentRunId?: string;
    onEndSession?: () => void;
    onModelChange?: (model: string) => void;
    onNavigateParent?: () => void;
    mcpServers?: McpServerInfo[];
    onMcpToggle?: () => void;
    cliVersion?: string;
    permissionMode?: string;
    fastModeState?: string;
    numTurns?: number;
    durationMs?: number;
    persistedFiles?: unknown[];
    onRewind?: () => void;
    contextUtilization?: number;
    contextWarningLevel?: string;
    cwd?: string;
    contextWindow?: number;
    lastCompactedAt?: number;
    compactCount?: number;
    microcompactCount?: number;
    turnUsages?: TurnUsage[];
    activeTaskCount?: number;
    mode?: string;
    remoteHostName?: string | null;
    onRename?: (name: string) => void;
    platformModels?: CliModelInfo[];
    authSourceLabel?: string;
    authSourceCategory?: string;
    verbose?: boolean;
    apiKeySource?: string;
    effort?: string;
    onEffortChange?: (effort: string) => void;
    onStatusClick?: () => void;
    onSummarize?: () => void;
    onShare?: () => void;
    toolPanelActiveTab?: ToolActivityPanelTab;
    onToolPanelTabChange?: (tab: ToolActivityPanelTab) => void;
    toolPanelIndicators?: { context: boolean; files: boolean; tasks: boolean };
    /** Widen the top capsule so fused panel tabs align with the unified control row. */
    fuseToolRailCapsule?: boolean;
    processVisibility?: ProcessVisibility;
    onProcessVisibilityChange?: (mode: ProcessVisibility) => void;
    /** Layout left sidebar expanded (for toggle icon direction). */
    layoutSidebarOpen?: boolean;
    onToggleLayoutSidebar?: () => void;
    onOpenSettings?: () => void;
    onOpenCliImport?: () => void;
    onNewChat?: () => void;
    splitModeEnabled?: boolean;
    onToggleSplitMode?: () => void;
    /** Top capsule horizontal anchor within the chat pane. */
    alignment?: SessionIslandAlignment;
    sendCoordinator?: SendCoordinator | null;
    onSendRetry?: (event: SendStatusEvent) => void;
    /** Push permission-mode notifications through the unified overlay. */
    permissionStatus?: PermissionStatusInput | null;
    /** Notify parent so it can clear its source state when the overlay fades. */
    onPermissionStatusDismiss?: () => void;
    /** Auto-dismiss delay for permission statuses; ignored when `transient: false`. */
    autoDismissMs?: number;
    /** Toast notification routed through the unified overlay. */
    toastNotification?: Toast | null;
    onToastDismiss?: () => void;
  } = $props();

  let showChromeActions = $derived(
    !!(
      onToggleLayoutSidebar ||
      onOpenSettings ||
      onOpenCliImport ||
      onNewChat ||
      onToggleSplitMode
    ),
  );

  // v1.0.6 follow-up: hoist context-pill visibility so both tier 1 and
  // tier 2 can read it without duplicating the predicate.
  let showContextPill = $derived(
    shouldShowContextDetails(processVisibility) &&
      contextWindow != null &&
      contextWindow > 0 &&
      contextUtilization != null,
  );
  let tier2HasMeta = $derived(
    !!(run && onRename) || !!agent || !!model || !!onProcessVisibilityChange,
  );

  // ── Send status (unified notification channel; replaces bottom SendStatusBanner) ──
  let sendStatusEvent = $state<SendStatusEvent | null>(null);
  let sendStatusUnsub: (() => void) | null = null;

  $effect(() => {
    const coordinator = sendCoordinator;
    sendStatusUnsub?.();
    sendStatusUnsub = null;
    if (!coordinator) {
      sendStatusEvent = null;
      return;
    }
    sendStatusUnsub = coordinator.subscribe((event) => {
      sendStatusEvent = event;
    });
    return () => {
      sendStatusUnsub?.();
      sendStatusUnsub = null;
    };
  });

  /**
   * v1.1.0: mirror the live coordinator event into a local slot so the
   * overlay can auto-dismiss without leaking coordinator state. New
   * coordinator events (e.g. transport retry → submitting) re-fill the
   * slot and reset the timer, so the user sees transient flashes during
   * reconnects instead of a sticky banner.
   */
  let sendStatusLocal = $state<SendStatusEvent | null>(null);
  let sendDismissTimer: ReturnType<typeof setTimeout> | undefined;

  function sendAutoDismissMs(event: SendStatusEvent): number {
    if (event.state === "failed") return 8000;
    return 2000;
  }

  $effect(() => {
    const incoming = sendStatusEvent;
    if (!incoming) {
      sendStatusLocal = null;
      clearTimeout(sendDismissTimer);
      sendDismissTimer = undefined;
      return;
    }
    const visible = getSendStatusPresentation(incoming);
    if (!visible || !visible.visible) {
      sendStatusLocal = null;
      clearTimeout(sendDismissTimer);
      sendDismissTimer = undefined;
      return;
    }
    if (incoming === sendStatusLocal) {
      // Same object identity → just reset the timer (state may have advanced
      // within the same record, e.g. queued → failed).
      clearTimeout(sendDismissTimer);
    }
    sendStatusLocal = incoming;
    sendDismissTimer = setTimeout(() => {
      sendStatusLocal = null;
      sendDismissTimer = undefined;
    }, sendAutoDismissMs(incoming));
  });

  $effect(() => {
    return () => {
      clearTimeout(sendDismissTimer);
      sendDismissTimer = undefined;
    };
  });

  const sendStatusPresentation = $derived(getSendStatusPresentation(sendStatusLocal));
  const sendOverlayActive = $derived(Boolean(sendStatusPresentation?.visible));

  // ── Permission-mode notification overlay (replaces standalone ToastHost for perm changes) ──
  /**
   * Mirrors the incoming `permissionStatus` prop into local state so the
   * auto-dismiss timer can clear the overlay without round-tripping back
   * through the parent. `version` is bumped whenever a new payload arrives
   * so an in-flight dismiss timer for an older payload is cancelled.
   */
  let permissionStatusLocal = $state<PermissionStatusInput | null>(null);
  let permissionDismissTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const incoming = permissionStatus;
    if (incoming === permissionStatusLocal) return;
    clearTimeout(permissionDismissTimer);
    permissionDismissTimer = undefined;
    permissionStatusLocal = incoming ?? null;
    if (incoming && incoming.transient !== false && autoDismissMs > 0) {
      permissionDismissTimer = setTimeout(() => {
        permissionStatusLocal = null;
        permissionDismissTimer = undefined;
        onPermissionStatusDismiss?.();
      }, autoDismissMs);
    }
  });

  $effect(() => {
    return () => {
      clearTimeout(permissionDismissTimer);
      permissionDismissTimer = undefined;
    };
  });

  const permissionPresentation = $derived<PermissionStatusPresentation | null>(
    getPermissionStatusPresentation(permissionStatusLocal),
  );
  const permissionOverlayActive = $derived(Boolean(permissionPresentation?.visible));

  // ── Toast notification overlay (replaces standalone ToastHost) ──
  let toastLocal = $state<Toast | null>(null);
  let toastDismissTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const incoming = toastNotification;
    if (incoming === toastLocal) return;
    clearTimeout(toastDismissTimer);
    toastDismissTimer = undefined;
    toastLocal = incoming ?? null;
    if (incoming && incoming.duration > 0) {
      toastDismissTimer = setTimeout(() => {
        toastLocal = null;
        toastDismissTimer = undefined;
        onToastDismiss?.();
      }, incoming.duration);
    }
  });

  $effect(() => {
    return () => {
      clearTimeout(toastDismissTimer);
      toastDismissTimer = undefined;
    };
  });

  const toastPresentation = $derived<ToastStatusPresentation | null>(
    getToastStatusPresentation(toastLocal),
  );
  const toastOverlayActive = $derived(Boolean(toastPresentation?.visible));

  // ── Capsule morph: running / done / stopped / cached (flash) + waiting (persistent) ──
  type MorphFlash = "none" | "running" | "done" | "stopped" | "cached";
  type MorphShell = "none" | "running" | "done" | "stopped" | "cached" | "waiting";
  type StatusOverlayMode = "none" | "send" | "permission" | "toast" | "morph";

  let morphFlash = $state<MorphFlash>("none");
  let morphFlashTimer: ReturnType<typeof setTimeout> | undefined;

  let trackedRunId = $state<string | null>(null);
  let prevTaskRunning = $state(false);
  let prevSessionPhase = $state("empty");
  let morphInitialized = $state(false);

  function clearMorphFlash() {
    morphFlash = "none";
    clearTimeout(morphFlashTimer);
  }

  function showMorphFlash(kind: Exclude<MorphFlash, "none">, durationMs: number) {
    clearMorphFlash();
    morphFlash = kind;
    morphFlashTimer = setTimeout(() => {
      morphFlash = "none";
    }, durationMs);
  }

  /** Resolved visual shell: transient flash wins over persistent waiting. */
  let morphShell = $derived.by((): MorphShell => {
    if (morphFlash !== "none") return morphFlash;
    if (taskWaiting) return "waiting";
    return "none";
  });

  /** Send failures / in-flight submits take priority over session morph flashes. */
  let statusOverlayMode = $derived.by((): StatusOverlayMode => {
    if (sendOverlayActive) return "send";
    if (permissionOverlayActive) return "permission";
    if (toastOverlayActive) return "toast";
    if (morphShell !== "none") return "morph";
    return "none";
  });

  let statusOverlayActive = $derived(statusOverlayMode !== "none");

  function islandOverlayShellClass(): string {
    if (statusOverlayMode === "send" && sendStatusPresentation) {
      return sendStatusPresentation.shellClass;
    }
    if (statusOverlayMode === "permission" && permissionPresentation) {
      // Inline add-on class shrinks the width to the content; the base
      // shell class (send-pending / send-warning / send-failed) still owns
      // color, shadow, and rounded geometry.
      return `${permissionPresentation.shellClass} session-island-permission-shell`;
    }
    if (statusOverlayMode === "toast" && toastPresentation) {
      return `${toastPresentation.shellClass} session-island-permission-shell`;
    }
    if (statusOverlayMode === "morph") {
      return morphShellClass(morphShell);
    }
    return "";
  }

  function morphShellClass(shell: MorphShell): string {
    switch (shell) {
      case "running":
        return "session-island-running";
      case "done":
        return "session-island-done";
      case "waiting":
        return "session-island-waiting";
      case "stopped":
        return "session-island-stopped";
      case "cached":
        return "session-island-cached";
      default:
        return "";
    }
  }

  function morphShellLabel(shell: MorphShell): string {
    switch (shell) {
      case "running":
        return "running";
      case "done":
        return "done";
      case "waiting":
        return "waiting";
      case "stopped":
        return "stopped";
      case "cached":
        return "cached";
      default:
        return "";
    }
  }

  $effect(() => {
    const runId = run?.id ?? null;
    const taskActive = taskRunning;
    const phase = sessionPhase;

    if (runId !== trackedRunId) {
      trackedRunId = runId;
      prevTaskRunning = taskActive;
      prevSessionPhase = phase;
      clearMorphFlash();
      morphInitialized = true;
      return;
    }

    if (!morphInitialized) {
      prevTaskRunning = taskActive;
      prevSessionPhase = phase;
      morphInitialized = true;
      return;
    }

    if (phase === "stopped" && prevSessionPhase !== "stopped") {
      showMorphFlash("stopped", 2000);
      prevSessionPhase = phase;
      prevTaskRunning = taskActive;
      return;
    }

    // v1.0.6 1.6: surface "loaded from cache" so the user knows the
    // conversation history is local and the CLI hasn't been spawned yet.
    if (phase === "cached" && prevSessionPhase !== "cached") {
      showMorphFlash("cached", 2200);
      prevSessionPhase = phase;
      prevTaskRunning = taskActive;
      return;
    }

    if (taskActive !== prevTaskRunning) {
      if (taskActive) {
        showMorphFlash("running", 1500);
      } else if (phase !== "stopped" && phase !== "failed") {
        showMorphFlash("done", 2000);
      }
      prevTaskRunning = taskActive;
    }

    prevSessionPhase = phase;
  });

  // ── Compact indicator (context bar only — does NOT expand tier 2) ──
  let compactVisible = $state(false);
  let compactTimer: ReturnType<typeof setTimeout> | undefined;
  let lastCompactStamp = $state(0);
  let compactTrackedRunId = $state<string | null>(null);

  $effect(() => {
    const runId = run?.id ?? null;
    if (runId !== compactTrackedRunId) {
      compactTrackedRunId = runId;
      lastCompactStamp = 0;
      compactVisible = false;
      clearTimeout(compactTimer);
    }
  });

  $effect(() => {
    const stamp = lastCompactedAt;
    const runId = run?.id;

    if (!runId || !stamp || stamp <= 0) {
      return;
    }

    if (stamp === lastCompactStamp) return;

    lastCompactStamp = stamp;
    compactVisible = true;
    clearTimeout(compactTimer);
    compactTimer = setTimeout(() => {
      compactVisible = false;
    }, 8000);
  });

  // ── Title inline editing ──
  let titleEditing = $state(false);
  let titleEditValue = $state("");
  let titleInputEl: HTMLInputElement | undefined = $state();

  function _startTitleEdit() {
    if (!onRename || !run) return;
    titleEditValue = run.name || run.prompt;
    titleEditing = true;
    requestAnimationFrame(() => titleInputEl?.select());
  }

  function _commitTitleEdit() {
    titleEditing = false;
    const trimmed = titleEditValue.trim();
    if (trimmed && run && trimmed !== (run.name || run.prompt)) {
      onRename?.(trimmed);
    }
  }

  function _cancelTitleEdit() {
    titleEditing = false;
  }

  const _formatCost = formatCostDisplay;

  // ── Model / process visibility menus (Bits UI) ──
  let models = $derived(platformModels.length > 0 ? platformModels : getCliModels(agent));
  let modelMenuOpen = $state(false);
  let pvMenuOpen = $state(false);

  function processVisibilityLabel(mode: ProcessVisibility): string {
    return mode === "output" ? t("processVisibility_mode_chat") : t("processVisibility_mode_full");
  }

  // ── Island hover state (tier 2 expansion) ──
  let islandHover = $state(false);
  let hoverLeaveTimer: ReturnType<typeof setTimeout> | undefined;
  let tier2Open = $state(false);
  let tier2OpenTimer: ReturnType<typeof setTimeout> | undefined;

  function onShellPointerEnter() {
    clearTimeout(hoverLeaveTimer);
    islandHover = true;
  }

  function onShellPointerLeave() {
    clearTimeout(hoverLeaveTimer);
    hoverLeaveTimer = setTimeout(() => {
      islandHover = false;
    }, 220);
  }

  /** Bar is "active" while pointer is inside or a shell menu is open. */
  let islandActive = $derived(islandHover || modelMenuOpen || pvMenuOpen || titleEditing);

  /** One class on the shell — context pill width + tier 2 + outer capsule share this. */
  let islandInteractionClass = $derived(
    !statusOverlayActive && islandActive ? "session-island-active" : "",
  );

  let islandCompactClass = $derived(
    !statusOverlayActive && compactVisible ? "session-island-compact-pill" : "",
  );

  let tier2HasContent = $derived(tier2HasMeta);

  /** Tier 2 expands on hover/menus when there is something to show. */
  let islandExpanded = $derived(!statusOverlayActive && islandActive && tier2HasContent);
  let islandTier2Class = $derived(tier2Open ? "session-island-tier2-active" : "");

  $effect(() => {
    clearTimeout(tier2OpenTimer);
    tier2OpenTimer = undefined;

    if (!islandExpanded) {
      tier2Open = false;
      return;
    }

    tier2OpenTimer = setTimeout(() => {
      tier2Open = true;
      tier2OpenTimer = undefined;
    }, 140);

    return () => {
      clearTimeout(tier2OpenTimer);
      tier2OpenTimer = undefined;
    };
  });

  // Dispatch event when island expansion state changes (for tool panel positioning)
  $effect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(EVT_STATUSBAR_TOGGLE, { detail: { expanded: tier2Open } }),
      );
    }
  });

  function handleModelMenuOpenChange(next: boolean) {
    modelMenuOpen = next;
    if (next) pvMenuOpen = false;
  }

  // [R2-C] Probe CLI info only once per agent. The status bar mounts for
  // every chat session, so without this dedupe each new-session mount would
  // re-enter the $effect, re-trigger loadCliInfo, and race the welcome
  // screen's first paint. loadCliInfo already dedupes by agent key
  // internally, but calling it from here on every prop change still costs
  // a tick of reactivity work — and worse, an agent switch (e.g. runtime
  // picker change in the welcome screen) would schedule another probe that
  // the welcome screen had already kicked off. Track the last probed agent
  // locally so we only fire when we actually have a new agent to ask about.
  let _lastProbedAgent: string | null = null;
  $effect(() => {
    const a = agent || "claude";
    if (platformModels.length > 0) return;
    if (_lastProbedAgent === a) return;
    _lastProbedAgent = a;
    void loadCliInfo(false, a);
  });

  function handlePvMenuOpenChange(next: boolean) {
    pvMenuOpen = next;
    if (next) modelMenuOpen = false;
  }

  export function openModelDropdown() {
    pvMenuOpen = false;
    modelMenuOpen = true;
  }

  function tabLabel(tab: ToolActivityPanelTab): string {
    switch (tab) {
      case "workspace":
        return t("sessionControl_panelWorkspace");
      case "tools":
        return t("sessionControl_panelActivity");
      case "context":
        return t("sessionControl_panelUsage");
      case "files":
        return t("sessionControl_panelFiles");
      case "preview":
        return t("sessionControl_panelPreview");
      case "info":
        return t("sessionControl_panelInfo");
      case "tasks":
        return t("sessionControl_panelTasks");
      case "scheduled-tasks":
        return t("sessionControl_panelScheduledTasks");
      default:
        return tab;
    }
  }

  onDestroy(() => {
    clearTimeout(compactTimer);
    clearTimeout(confirmTimer);
    clearTimeout(hoverLeaveTimer);
    clearTimeout(tier2OpenTimer);
    clearMorphFlash();
  });

  // ── End Session confirmation ──
  let _confirmingEnd = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  function _requestEnd() {
    _confirmingEnd = true;
    confirmTimer = setTimeout(() => {
      _confirmingEnd = false;
    }, 3000);
  }

  function _confirmEnd() {
    clearTimeout(confirmTimer);
    _confirmingEnd = false;
    onEndSession?.();
  }

  function _cancelEnd() {
    clearTimeout(confirmTimer);
    _confirmingEnd = false;
  }

  let mcpAggregateStatus = $derived.by(() => {
    if (!mcpServers || mcpServers.length === 0) return "none";
    const hasFailure = mcpServers.some((s) => s.status === "failed" || s.status === "needs-auth");
    const hasPending = mcpServers.some((s) => s.status === "pending");
    const allDisabled = mcpServers.every((s) => s.status === "disabled");
    if (hasFailure) return "error";
    if (hasPending) return "pending";
    if (allDisabled) return "disabled";
    return "ok";
  });

  let _mcpDotClass = $derived(
    mcpAggregateStatus === "error"
      ? "bg-destructive"
      : mcpAggregateStatus === "pending"
        ? "bg-miwarp-status-warning"
        : mcpAggregateStatus === "disabled"
          ? "bg-muted-foreground/30"
          : "bg-miwarp-status-success",
  );

  // Find model info: exact match first, then fuzzy (model ID contains alias)
  let currentModelInfo = $derived.by(() => {
    const exact = models.find((m) => m.value === model);
    if (exact) return exact;
    return models.find((m) => model.includes(m.value) && m.value !== "default");
  });
  // Effort: always collect levels from any model that supports them (for always-visible UI)
  let anyModelEffortLevels = $derived.by(() => {
    const supporting = models.find(
      (m) => m.supportsEffort === true && m.supportedEffortLevels?.length,
    );
    return supporting?.supportedEffortLevels ?? [];
  });
  let effortLevels = $derived(currentModelInfo?.supportedEffortLevels ?? anyModelEffortLevels);
  let effortDisabled = $derived(currentModelInfo?.supportsEffort !== true);

  let runtimeLabel = $derived.by(() => {
    const runtimeId = agentToRuntimeId(agent);
    if (!runtimeId) return agent;
    const descriptor = getRuntimeDescriptor(runtimeId);
    return t(descriptor.nameKey as Parameters<typeof t>[0]);
  });

  // Status bar pill: show the actual model in use; alias (e.g. "Default") as subtitle.
  // Claude CLI catalog puts the resolved model id in `description` for route aliases.
  const CLAUDE_MODEL_ALIASES = new Set(["default", "opus", "haiku"]);
  let modelPill = $derived.by(() => {
    const all = [...(platformModels ?? []), ...getCliModels(agent)];
    const found = all.find((m) => m.value === model);

    if (
      agent === "claude" &&
      found &&
      CLAUDE_MODEL_ALIASES.has(found.value) &&
      found.description &&
      found.description !== found.displayName
    ) {
      return {
        primary: found.description,
        secondary: found.displayName,
      };
    }

    if (found && found.displayName && found.displayName !== model) {
      return { primary: model, secondary: found.displayName };
    }

    return { primary: model, secondary: null as string | null };
  });
</script>

<!--
  Session Island: morphs from capsule to rounded rectangle on interaction.
  Uses .session-island-shell (defined in app.css) for morph animation.
  Retains .session-status-drag for window drag region functionality.
-->
<div
  class="session-status-drag session-island-shell {islandOverlayShellClass()} {islandInteractionClass} {islandTier2Class} {islandCompactClass} {tier2HasContent
    ? 'session-island-has-tier2'
    : ''} {tier2Open ? 'session-island-expanded' : ''} {alignment === 'right'
    ? 'session-island-align-right'
    : ''}"
  data-session-island-alignment={alignment}
  data-tauri-drag-region
  onpointerenter={onShellPointerEnter}
  onpointerleave={onShellPointerLeave}
  role="presentation"
>
  {#if statusOverlayActive}
    <div
      class="absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] px-3 {statusOverlayMode ===
      'send'
        ? 'pointer-events-auto'
        : 'pointer-events-none'}"
      role="status"
      aria-live="polite"
      data-send-state={sendStatusPresentation?.state ?? ""}
      data-send-code={sendStatusPresentation?.errorCode ?? ""}
      data-overlay-mode={statusOverlayMode}
    >
      {#if statusOverlayMode === "send" && sendStatusPresentation}
        {#if sendStatusPresentation.retryable && onSendRetry && sendStatusLocal}
          <div class="flex w-full max-w-full items-center justify-between gap-3">
            <span class="truncate text-sm font-semibold tracking-wide text-miwarp-accent-on-accent">
              {t(sendStatusPresentation.labelKey as Parameters<typeof t>[0])}
            </span>
            <button
              type="button"
              class="shrink-0 rounded-md border border-current/40 px-2 py-0.5 text-xs font-medium text-miwarp-accent-on-accent transition hover:bg-current/10"
              onclick={() => {
                if (sendStatusLocal) onSendRetry(sendStatusLocal);
                sendStatusLocal = null;
                clearTimeout(sendDismissTimer);
                sendDismissTimer = undefined;
              }}
            >
              {t("send_retry")}
            </button>
          </div>
        {:else}
          <span
            class="truncate px-1 text-center text-sm font-semibold tracking-wide text-miwarp-accent-on-accent"
          >
            {t(sendStatusPresentation.labelKey as Parameters<typeof t>[0])}
          </span>
        {/if}
      {:else if statusOverlayMode === "permission" && permissionPresentation}
        <span
          class="truncate px-1 text-center text-sm font-semibold tracking-wide text-miwarp-accent-on-accent"
        >
          {permissionPresentation.text}
        </span>
      {:else if statusOverlayMode === "toast" && toastPresentation}
        <div class="flex w-full max-w-full items-center gap-2 px-1">
          <svg
            class="h-3.5 w-3.5 shrink-0 text-miwarp-accent-on-accent"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.25"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            {#if toastPresentation.tone === "success"}
              <path d="M5 12l4.5 4.5L19 7" />
            {:else if toastPresentation.tone === "error"}
              <path d="M6 6l12 12M18 6L6 18" />
            {:else if toastPresentation.tone === "warning"}
              <path d="M12 8v5m0 3h.01" />
            {:else}
              <path d="M12 8h.01M11 12h1v5h1" />
            {/if}
          </svg>
          <span class="truncate text-sm font-semibold tracking-wide text-miwarp-accent-on-accent">
            {toastPresentation.text}
          </span>
          {#if toastPresentation.action}
            <button
              type="button"
              class="no-drag shrink-0 rounded-md border border-current/40 px-2 py-0.5 text-xs font-medium text-miwarp-accent-on-accent transition hover:bg-current/10"
              onclick={() => {
                toastPresentation.action?.onClick();
                toastLocal = null;
                clearTimeout(toastDismissTimer);
                toastDismissTimer = undefined;
                onToastDismiss?.();
              }}
            >
              {toastPresentation.action.label}
            </button>
          {/if}
          <button
            type="button"
            class="no-drag shrink-0 rounded-md p-0.5 text-miwarp-accent-on-accent/60 transition hover:bg-current/10 hover:text-miwarp-accent-on-accent"
            onclick={() => {
              toastLocal = null;
              clearTimeout(toastDismissTimer);
              toastDismissTimer = undefined;
              onToastDismiss?.();
            }}
            aria-label={t("common_dismiss")}
            title={t("common_dismiss")}
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      {:else if statusOverlayMode === "morph"}
        <span
          class="text-base font-black tracking-widest text-miwarp-accent-on-accent {morphShell ===
          'waiting'
            ? 'animate-slow-pulse'
            : ''}"
          style="font-family: 'FonWorker', sans-serif;"
          aria-hidden="true"
        >
          {morphShellLabel(morphShell)}
        </span>
      {/if}
    </div>
  {/if}

  <!-- Tier 1: icon rail -->
  <div
    class="session-island-tier1-frame relative inline-flex h-9 shrink-0 items-center transition-opacity duration-300 {statusOverlayActive
      ? 'opacity-0'
      : ''}"
  >
    <!-- Left drag spacer (Linux/Windows JS fallback) -->
    <WindowDragArea class="absolute left-0 top-0 bottom-0 w-12" />
    <!-- Right drag spacer (Linux/Windows JS fallback) -->
    <WindowDragArea class="absolute right-0 top-0 bottom-0 w-12" />

    {#if onToolPanelTabChange && toolPanelActiveTab}
      <div
        class="session-island-tier1 {showChromeActions ? 'session-island-tier1-with-chrome' : ''}"
      >
        <!--
          Three-part row: left reveal + centered chrome anchors + right reveal.
          The chrome group is its own centered grid column, so reveal buttons
          never push the base controls sideways during expansion.
            1 home (workspace) · 2 wrench (tools) · 3 chart (context) ·
            4 file (files) · layout/split/settings/plug/plus (chrome) ·
            monitor (preview) · check-square (tasks) · clock (scheduled-tasks) ·
            scroll-text (summarize)
        -->

        <div class="session-island-reveal-group session-island-reveal-group-left">
          <!-- 1: leading reveal — workspace (home) -->
          <button
            type="button"
            role="tab"
            aria-selected={toolPanelActiveTab === "workspace"}
            aria-label={tabLabel("workspace")}
            class="session-island-tab session-island-reveal session-island-reveal-left transition-colors {toolPanelActiveTab ===
            'workspace'
              ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-inset ring-border/45'
              : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
            onclick={() => onToolPanelTabChange("workspace")}
            title={tabLabel("workspace")}
          >
            <Icon name="home" size="md" class="shrink-0 opacity-90" />
          </button>

          <!-- 2: leading reveal — tools (wrench) -->
          <button
            type="button"
            role="tab"
            aria-selected={toolPanelActiveTab === "tools"}
            aria-label={tabLabel("tools")}
            class="session-island-tab session-island-reveal session-island-reveal-left transition-colors {toolPanelActiveTab ===
            'tools'
              ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-inset ring-border/45'
              : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
            onclick={() => onToolPanelTabChange("tools")}
            title={tabLabel("tools")}
          >
            <Icon name="wrench" size="md" class="shrink-0 opacity-90" />
          </button>

          <!-- 3: leading reveal — context (chart) -->
          <button
            type="button"
            role="tab"
            aria-selected={toolPanelActiveTab === "context"}
            aria-label={tabLabel("context")}
            class="session-island-tab session-island-reveal session-island-reveal-left transition-colors {toolPanelActiveTab ===
            'context'
              ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-inset ring-border/45'
              : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
            onclick={() => onToolPanelTabChange("context")}
            title={tabLabel("context")}
          >
            <span class="relative inline-flex shrink-0">
              <Icon name="bar-chart-2" size="md" class="opacity-90" />
              {#if toolPanelIndicators?.context}
                <span
                  class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-miwarp-status-success"
                ></span>
              {/if}
            </span>
          </button>

          <!-- 4: leading reveal — files (file) -->
          <button
            type="button"
            role="tab"
            aria-selected={toolPanelActiveTab === "files"}
            aria-label={tabLabel("files")}
            class="session-island-tab session-island-reveal session-island-reveal-left transition-colors {toolPanelActiveTab ===
            'files'
              ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-inset ring-border/45'
              : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
            onclick={() => onToolPanelTabChange("files")}
            title={tabLabel("files")}
          >
            <span class="relative inline-flex shrink-0">
              <Icon name="file" size="md" class="opacity-90" />
              {#if toolPanelIndicators?.files}
                <span
                  class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-miwarp-status-warning"
                ></span>
              {/if}
            </span>
          </button>
        </div>

        <div class="session-island-chrome-group">
          <!-- Chrome anchor — layout (sidebar toggle) -->
          {#if onToggleLayoutSidebar}
            <button
              type="button"
              class="session-island-tab session-island-chrome-anchor text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
              tabindex={islandActive ? 0 : -1}
              onclick={(e) => {
                e.stopPropagation();
                onToggleLayoutSidebar();
              }}
              title={t("keybind_toggleSidebar")}
              aria-label={t("keybind_toggleSidebar")}
              aria-expanded={layoutSidebarOpen}
            >
              <Icon name="layout" size="md" class="shrink-0 opacity-90" />
            </button>
          {/if}

          {#if onToggleSplitMode}
            <button
              type="button"
              class="session-island-tab session-island-chrome-anchor transition-colors hover:bg-muted/45 hover:text-foreground
                {splitModeEnabled ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}"
              tabindex={islandActive ? 0 : -1}
              onclick={(e) => {
                e.stopPropagation();
                onToggleSplitMode();
              }}
              title={splitModeEnabled ? t("split_mode_exit") : t("split_mode_enter")}
              aria-label={splitModeEnabled ? t("split_mode_exit") : t("split_mode_enter")}
              aria-pressed={splitModeEnabled}
            >
              <Icon name="monitor" size="md" class="shrink-0 opacity-90" />
            </button>
          {/if}

          <!-- Chrome anchor — settings -->
          {#if onOpenSettings}
            <button
              type="button"
              class="session-island-tab session-island-chrome-anchor text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
              tabindex={islandActive ? 0 : -1}
              onclick={(e) => {
                e.stopPropagation();
                onOpenSettings();
              }}
              title={t("nav_settings")}
              aria-label={t("nav_settings")}
            >
              <Icon name="settings" size="md" class="shrink-0 opacity-90" />
            </button>
          {/if}

          <!-- Chrome anchor — plug (CLI import) -->
          {#if onOpenCliImport}
            <button
              type="button"
              class="session-island-tab session-island-chrome-anchor text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
              tabindex={islandActive ? 0 : -1}
              onclick={(e) => {
                e.stopPropagation();
                onOpenCliImport();
              }}
              title={t("cliSync_title")}
              aria-label={t("sidebar_cliBrowser")}
            >
              <Icon name="plug" size="md" class="shrink-0 opacity-90" />
            </button>
          {/if}

          <!-- Chrome anchor — plus (new chat) -->
          {#if onNewChat}
            <button
              type="button"
              class="session-island-tab session-island-chrome-anchor text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
              tabindex={islandActive ? 0 : -1}
              onclick={(e) => {
                e.stopPropagation();
                onNewChat();
              }}
              title={t("layout_newConversation")}
              aria-label={t("sidebar_newChat")}
            >
              <Icon name="plus" size="md" class="shrink-0 opacity-90" />
            </button>
          {/if}
        </div>

        <div class="session-island-reveal-group session-island-reveal-group-right">
          <!-- trailing reveal — preview (monitor) -->
          <button
            type="button"
            role="tab"
            aria-selected={toolPanelActiveTab === "preview"}
            aria-label={tabLabel("preview")}
            class="session-island-tab session-island-reveal session-island-reveal-right transition-colors {toolPanelActiveTab ===
            'preview'
              ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-inset ring-border/45'
              : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
            onclick={() => onToolPanelTabChange("preview")}
            title={tabLabel("preview")}
          >
            <Icon name="monitor" size="md" class="shrink-0 opacity-90" />
          </button>

          <!-- trailing reveal — tasks (check-square) -->
          <button
            type="button"
            role="tab"
            aria-selected={toolPanelActiveTab === "tasks"}
            aria-label={tabLabel("tasks")}
            class="session-island-tab session-island-reveal session-island-reveal-right transition-colors {toolPanelActiveTab ===
            'tasks'
              ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-inset ring-border/45'
              : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
            onclick={() => onToolPanelTabChange("tasks")}
            title={tabLabel("tasks")}
          >
            <span class="relative inline-flex shrink-0">
              <Icon name="check-square" size="md" class="opacity-90" />
              {#if toolPanelIndicators?.tasks}
                <span
                  class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-miwarp-status-info"
                ></span>
              {/if}
            </span>
          </button>

          <!-- trailing reveal — scheduled-tasks (clock) -->
          <button
            type="button"
            role="tab"
            aria-selected={toolPanelActiveTab === "scheduled-tasks"}
            aria-label={tabLabel("scheduled-tasks")}
            class="session-island-tab session-island-reveal session-island-reveal-right transition-colors {toolPanelActiveTab ===
            'scheduled-tasks'
              ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-inset ring-border/45'
              : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
            onclick={() => onToolPanelTabChange("scheduled-tasks")}
            title={tabLabel("scheduled-tasks")}
          >
            <Icon name="clock" size="md" class="shrink-0 opacity-90" />
          </button>

          <!-- trailing reveal — summarize (optional) -->
          {#if onSummarize}
            <button
              type="button"
              class="session-island-tab session-island-reveal session-island-reveal-right text-muted-foreground hover:bg-muted/45 hover:text-foreground transition-colors"
              onclick={onSummarize}
              title={t("statusbar_summarize")}
              aria-label={t("statusbar_summarize")}
            >
              <Icon name="scroll-text" size="md" class="shrink-0 opacity-90" />
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if tier2HasContent}
    <!--
      Tier 2: title, model, process visibility, context pill.
      Height/width collapse is driven by the grid row (`auto 0fr` ↔ `auto 1fr`)
      plus the --session-island-tier2-max-width custom property transition on
      .tier-2-content. We deliberately do NOT set `min-h-0`/`min-w-0` here:
      those would force the row to snap to 0 and let the inner shell lag one
      frame behind the row collapse, producing the "second row disappears
      first, width catches up later" visual. Letting the content keep its
      intrinsic height lets the grid `0fr` track smoothly from 1fr → 0fr.
    -->
    <div
      class="tier-2-content flex shrink-0 items-center justify-between overflow-hidden {tier2Open
        ? 'session-island-tier2-open border-t border-border/20'
        : 'border-0'} {statusOverlayActive ? 'opacity-0 pointer-events-none' : ''}"
    >
      <div class="session-island-tier2">
        {#if run && onRename}
          {#if titleEditing}
            <input
              bind:this={titleInputEl}
              bind:value={titleEditValue}
              class="max-w-[12rem] min-w-0 rounded border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary/50"
              onkeydown={(e) => {
                if (e.key === "Enter") _commitTitleEdit();
                if (e.key === "Escape") _cancelTitleEdit();
              }}
              onblur={_commitTitleEdit}
            />
          {:else}
            <button
              type="button"
              class="max-w-[12rem] truncate rounded px-1 text-[11px] font-medium text-foreground/75 hover:bg-muted/50 hover:text-foreground transition-colors"
              title={run.name || run.prompt}
              onclick={_startTitleEdit}
            >
              {run.name || run.prompt}
            </button>
          {/if}
        {/if}

        {#if runtimeLabel}
          {#if run && onRename}
            <span class="session-island-tier2-divider" aria-hidden="true">|</span>
          {/if}
          <span
            class="max-w-[8rem] truncate rounded px-1 font-medium text-foreground/60"
            title={runtimeLabel}
          >
            {runtimeLabel}
          </span>
        {/if}

        {#if model}
          {#if (run && onRename) || runtimeLabel}
            <span class="session-island-tier2-divider" aria-hidden="true">|</span>
          {/if}
          {#if onModelChange}
            <StatusBarModelMenu
              bind:open={modelMenuOpen}
              {model}
              {models}
              modelLabel={modelPill.primary}
              modelSubLabel={modelPill.secondary ?? ""}
              {effort}
              {effortLevels}
              {effortDisabled}
              {currentModelInfo}
              {onModelChange}
              {onEffortChange}
              onOpenChange={handleModelMenuOpenChange}
            />
          {:else}
            <span class="max-w-[11rem] truncate font-medium text-foreground/85"
              >{modelPill.primary}{#if modelPill.secondary}<span
                  class="ml-1 text-[10px] font-normal text-foreground/50"
                  aria-hidden="true">{modelPill.secondary}</span
                >{/if}</span
            >
          {/if}
        {/if}

        {#if onProcessVisibilityChange}
          {#if (run && onRename) || runtimeLabel || model}
            <span class="session-island-tier2-divider" aria-hidden="true">|</span>
          {/if}
          <ProcessVisibilityPicker
            bind:open={pvMenuOpen}
            {processVisibility}
            label={processVisibilityLabel(processVisibility)}
            onchange={onProcessVisibilityChange}
            onOpenChange={handlePvMenuOpenChange}
          />
        {/if}

        <!-- Context utilization pill (was on tier 1 center; v1.0.6 follow-up moved here) -->
        {#if showContextPill}
          {@const pct = Math.round(contextUtilization! * 100)}
          {@const barColor =
            contextWarningLevel === "critical"
              ? "bg-miwarp-status-warning"
              : contextWarningLevel === "high"
                ? "bg-miwarp-status-warning"
                : contextWarningLevel === "moderate"
                  ? "bg-miwarp-status-warning"
                  : "bg-miwarp-status-success"}
          <span
            class="session-context-pill text-foreground/60 ml-auto"
            title={t("statusbar_contextTitle", {
              pct: String(pct),
              tokens: contextWindow ? fmtNumber(contextWindow) : "",
            })}
          >
            <span
              class="session-context-pill-inner {compactVisible
                ? 'bg-[hsl(var(--miwarp-status-warning)/0.8)] animate-pulse'
                : barColor}"
            >
              {#if compactVisible}
                <span
                  class="text-[10px] font-bold text-miwarp-accent-on-accent animate-pulse whitespace-nowrap px-2"
                  >{t("statusbar_compacted")}</span
                >
              {:else}
                <span class="flex items-center justify-center whitespace-nowrap">
                  <span
                    class="text-[10px] font-bold text-miwarp-accent-on-accent/90 w-8 text-center"
                    >{pct}%</span
                  >
                  <span
                    class="session-context-ctx-label text-[10px] font-bold text-miwarp-accent-on-accent/70"
                    >ctx</span
                  >
                </span>
              {/if}
            </span>
          </span>
        {:else}
          <span class="session-context-pill text-foreground/60 ml-auto">
            <span class="session-context-pill-inner bg-miwarp-accent-primary">
              <span class="text-[10px] font-bold text-miwarp-accent-on-accent/90">miw</span>
            </span>
          </span>
        {/if}
      </div>
    </div>
  {/if}
</div>
