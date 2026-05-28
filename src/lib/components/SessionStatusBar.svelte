<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { scale } from "svelte/transition";
  import type { TaskRun, McpServerInfo, CliModelInfo } from "$lib/types";
  import type { TurnUsage } from "$lib/stores/types";
  import { dbg } from "$lib/utils/debug";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { getCliModels } from "$lib/stores/cli-info.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { fmtNumber } from "$lib/i18n/format";
  import { formatCostDisplay } from "$lib/utils/format";
  import Icon from "$lib/components/Icon.svelte";
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import {
    PROCESS_VISIBILITY_LEVELS,
    shouldShowContextDetails,
  } from "$lib/utils/process-visibility";

  let {
    run = null,
    agent = "claude",
    model = "",
    cost: _cost = 0,
    inputTokens: _inputTokens = 0,
    outputTokens: _outputTokens = 0,
    cacheReadTokens: _cacheReadTokens = 0,
    cacheWriteTokens: _cacheWriteTokens = 0,
    running = false,
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
    permissionMode,
    fastModeState: _fastModeState,
    numTurns: _numTurns,
    durationMs: _durationMs,
    persistedFiles: _persistedFiles,
    onRewind: _onRewind,
    contextUtilization,
    contextWarningLevel,
    contextWindow,
    cwd = "",
    lastCompactedAt = 0,
    compactCount: _compactCount = 0,
    microcompactCount: _microcompactCount = 0,
    turnUsages: _turnUsages = [],
    activeTaskCount = 0,
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
    onStatusClick,
    onSummarize,
    onShare: _onShare,
    toolPanelActiveTab,
    onToolPanelTabChange,
    toolPanelIndicators,
    fuseToolRailCapsule: _fuseToolRailCapsule = false,
    processVisibility = "developer" as ProcessVisibility,
    onProcessVisibilityChange,
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
  } = $props();

  $effect(() => {
    dbg("status", "state", {
      agent,
      model,
      running,
      taskRunning,
      taskWaiting,
      sessionPhase,
      runId: run?.id,
      morphFlash,
      morphShell,
    });
  });

  // ── Capsule morph: running / done / stopped (flash) + waiting (persistent) ──
  type MorphFlash = "none" | "running" | "done" | "stopped";
  type MorphShell = "none" | "running" | "done" | "stopped" | "waiting";

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

  let morphHidesContent = $derived(morphShell !== "none");

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

    if (taskActive !== prevTaskRunning) {
      if (taskActive) {
        showMorphFlash("running", 1500);
      } else if (phase !== "stopped" && phase !== "failed") {
        showMorphFlash("done", 2000);
      }
      prevTaskRunning = taskActive;
    }

    prevSessionPhase = phase;
    return () => clearTimeout(morphFlashTimer);
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
    return () => clearTimeout(compactTimer);
  });

  let _cwdShort = $derived.by(() => {
    const val = cwd || run?.cwd || "";
    if (!val || val === "/") return "";
    const home = val
      .replace(/^\/Users\/[^/]+/, "~")
      .replace(/^\/home\/[^/]+/, "~")
      .replace(/^[A-Za-z]:[/\\](?:Users|users)[/\\][^/\\]+/, "~");
    return home.length > 30 ? "..." + home.slice(-27) : home;
  });

  let _sessionIdShort = $derived(run?.session_id ? run.session_id.slice(0, 8) : "");
  let _sidCopied = $state(false);

  async function _copySessionId() {
    if (!run?.session_id) return;
    try {
      await navigator.clipboard.writeText(run.session_id);
      _sidCopied = true;
      setTimeout(() => (_sidCopied = false), 1500);
    } catch {
      /* ignore */
    }
  }

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

  let _permissionBadge = $derived.by(() => {
    if (!permissionMode || permissionMode === "default") return null;
    const map: Record<string, { label: string; cls: string }> = {
      acceptEdits: {
        label: "accept-edits",
        cls: "bg-miwarp-status-info/15 text-miwarp-status-info",
      },
      bypassPermissions: {
        label: t("sessionStatus_bypass"),
        cls: "bg-miwarp-status-warning/15 text-miwarp-status-warning",
      },
      plan: { label: t("sessionStatus_plan"), cls: "bg-[hsl(var(--miwarp-accent-violet)/0.15)] text-miwarp-accent-violet" },
      auto: { label: t("sessionStatus_auto"), cls: "bg-[hsl(var(--miwarp-status-info)/0.15)] text-miwarp-status-info" },
      dontAsk: { label: "no-ask", cls: "bg-[hsl(var(--miwarp-status-error)/0.15)] text-miwarp-status-error" },
    };
    return (
      map[permissionMode] ?? { label: permissionMode, cls: "bg-foreground/10 text-foreground/60" }
    );
  });

  // ── Model selector dropdown ──
  // Use platform-specific models when a third-party provider is active
  let models = $derived(platformModels.length > 0 ? platformModels : getCliModels());
  let dropdownOpen = $state(false);
  let focusedModelIdx = $state(-1);
  let modelBtnEl: HTMLButtonElement | undefined = $state();
  let dropdownEl: HTMLDivElement | undefined = $state();
  let dropdownStyle = $state("");
  let modelFilter = $state("");
  let modelFilterEl: HTMLInputElement | undefined = $state();
  const showModelFilter = $derived(models.length >= 10);
  const filteredModels = $derived.by(() => {
    if (!modelFilter) return models;
    const q = modelFilter.toLowerCase();
    return models.filter(
      (m) =>
        m.value.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q)),
    );
  });

  let pvMenuOpen = $state(false);
  let pvMenuBtnEl: HTMLButtonElement | undefined = $state();
  let pvMenuEl: HTMLDivElement | undefined = $state();
  let pvMenuStyle = $state("");

  const POPOVER_Z = 45;
  const VIEWPORT_PAD = 8;
  const POPOVER_GAP = 6;
  const PV_MENU_WIDTH = 200;

  function clampPopoverLeft(left: number, width: number): number {
    return Math.max(VIEWPORT_PAD, Math.min(left, window.innerWidth - width - VIEWPORT_PAD));
  }

  function buildPopoverStyle(anchor: HTMLElement, width: number, flipThreshold = 200): string {
    const rect = anchor.getBoundingClientRect();
    const left = clampPopoverLeft(rect.left, width);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openAbove = spaceBelow < flipThreshold && spaceAbove > spaceBelow;
    const base = `position:fixed;left:${left}px;width:${width}px;z-index:${POPOVER_Z};`;
    if (openAbove) {
      return `${base}bottom:${window.innerHeight - rect.top + POPOVER_GAP}px;`;
    }
    return `${base}top:${rect.bottom + POPOVER_GAP}px;`;
  }

  function processVisibilityLabel(mode: ProcessVisibility): string {
    switch (mode) {
      case "output":
        return t("processVisibility_mode_output");
      case "guided":
        return t("processVisibility_mode_guided");
      case "expert":
        return t("processVisibility_mode_expert");
      default:
        return t("processVisibility_mode_developer");
    }
  }

  // ── Island hover state (tier 2 expansion) ──
  let islandHover = $state(false);
  let hoverLeaveTimer: ReturnType<typeof setTimeout> | undefined;

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
  let islandActive = $derived(islandHover || dropdownOpen || pvMenuOpen || titleEditing);

  /** One class on the shell — context pill width + tier 2 + outer capsule share this. */
  let islandInteractionClass = $derived(
    morphShell === "none" && islandActive ? "session-island-active" : "",
  );

  let islandCompactClass = $derived(
    morphShell === "none" && compactVisible ? "session-island-compact-pill" : "",
  );

  let statusDotKind = $derived(taskWaiting ? "pending" : taskRunning ? "running" : "idle");

  /** Tier 2 expands on hover/menus — never during morph overlay. */
  let islandExpanded = $derived(morphShell === "none" && islandActive);

  // Dispatch event when island expansion state changes (for tool panel positioning)
  $effect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ocv:statusbar-toggle", { detail: { expanded: islandExpanded } }),
      );
    }
  });

  function processVisibilityShort(mode: ProcessVisibility): string {
    switch (mode) {
      case "output":
        return t("processVisibility_short_output");
      case "guided":
        return t("processVisibility_short_guided");
      case "expert":
        return t("processVisibility_short_expert");
      default:
        return t("processVisibility_short_developer");
    }
  }

  function selectProcessVisibility(mode: ProcessVisibility) {
    pvMenuOpen = false;
    if (mode !== processVisibility) onProcessVisibilityChange?.(mode);
  }

  function positionPvMenu() {
    if (!pvMenuBtnEl) return;
    pvMenuStyle = buildPopoverStyle(pvMenuBtnEl, PV_MENU_WIDTH, 160);
  }

  function togglePvMenu() {
    pvMenuOpen = !pvMenuOpen;
    if (pvMenuOpen) {
      dropdownOpen = false;
      positionPvMenu();
    }
  }

  function positionDropdown() {
    if (!modelBtnEl) return;
    const rect = modelBtnEl.getBoundingClientRect();
    const maxW = Math.min(400, window.innerWidth - VIEWPORT_PAD * 2);
    const width = Math.max(rect.width, 280, Math.min(maxW, 360));
    dropdownStyle = buildPopoverStyle(modelBtnEl, width, 240);
  }

  function toggleModelDropdown() {
    dropdownOpen = !dropdownOpen;
    if (dropdownOpen) {
      pvMenuOpen = false;
      modelFilter = "";
      positionDropdown();
      focusedModelIdx = filteredModels.findIndex((m) => m.value === model);
      if (focusedModelIdx < 0) focusedModelIdx = 0;
      requestAnimationFrame(() => {
        if (showModelFilter && modelFilterEl) modelFilterEl.focus();
        else dropdownEl?.focus();
      });
    }
  }

  export function openModelDropdown() {
    pvMenuOpen = false;
    dropdownOpen = true;
    modelFilter = "";
    positionDropdown();
    focusedModelIdx = filteredModels.findIndex((m) => m.value === model);
    if (focusedModelIdx < 0) focusedModelIdx = 0;
    requestAnimationFrame(() => {
      if (showModelFilter && modelFilterEl) modelFilterEl.focus();
      else dropdownEl?.focus();
    });
  }

  function selectModel(val: string) {
    dropdownOpen = false;
    onModelChange?.(val);
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

  function handleModelFilterKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusedModelIdx = Math.min(focusedModelIdx + 1, filteredModels.length - 1);
      dropdownEl?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusedModelIdx = Math.max(focusedModelIdx - 1, 0);
      dropdownEl?.focus();
    } else if (e.key === "Enter" && filteredModels.length > 0) {
      e.preventDefault();
      const idx = focusedModelIdx >= 0 ? focusedModelIdx : 0;
      selectModel(filteredModels[idx].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (modelFilter) modelFilter = "";
      else dropdownOpen = false;
    }
    if (e.key !== "Tab") e.stopPropagation();
  }

  function handleDropdownKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusedModelIdx = Math.min(focusedModelIdx + 1, filteredModels.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusedModelIdx = Math.max(focusedModelIdx - 1, 0);
    } else if (
      e.key === "Enter" &&
      focusedModelIdx >= 0 &&
      focusedModelIdx < filteredModels.length
    ) {
      e.preventDefault();
      dbg("statusbar", "model selected via keyboard", {
        model: filteredModels[focusedModelIdx].value,
      });
      selectModel(filteredModels[focusedModelIdx].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      dropdownOpen = false;
    } else if (showModelFilter && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      modelFilterEl?.focus();
    }
    if (e.key !== "Tab") e.stopPropagation();
  }

  onMount(() => {
    function onDocClick(e: MouseEvent) {
      if (
        dropdownOpen &&
        modelBtnEl &&
        !modelBtnEl.contains(e.target as Node) &&
        dropdownEl &&
        !dropdownEl.contains(e.target as Node)
      ) {
        dropdownOpen = false;
      }
      if (
        pvMenuOpen &&
        pvMenuBtnEl &&
        !pvMenuBtnEl.contains(e.target as Node) &&
        pvMenuEl &&
        !pvMenuEl.contains(e.target as Node)
      ) {
        pvMenuOpen = false;
      }
    }
    function onDocKeydown(e: KeyboardEvent) {
      if (dropdownOpen && e.key === "Escape") {
        dropdownOpen = false;
        e.preventDefault();
        e.stopPropagation(); // Prevent bubble to window → keybindingStore.dispatch → chat:interrupt
      }
      if (pvMenuOpen && e.key === "Escape") {
        pvMenuOpen = false;
        e.preventDefault();
        e.stopPropagation();
      }
    }
    function onViewportChange() {
      if (dropdownOpen) positionDropdown();
      if (pvMenuOpen) positionPvMenu();
    }
    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onDocKeydown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick, true);
      document.removeEventListener("keydown", onDocKeydown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  });

  onDestroy(() => {
    clearTimeout(compactTimer);
    clearTimeout(confirmTimer);
    clearTimeout(hoverLeaveTimer);
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

  let modelLabel = $derived.by(() => {
    // Check platform models first, then CLI models
    const all = [...(platformModels ?? []), ...getCliModels()];
    const found = all.find((m) => m.value === model);
    if (found) return found.displayName;
    const fuzzy = all.find((m) => model.includes(m.value) && m.value !== "default");
    if (fuzzy) return fuzzy.displayName;
    return model;
  });
</script>

<!--
  Session Island: morphs from capsule to rounded rectangle on interaction.
  Uses .session-island-shell (defined in app.css) for morph animation.
  Retains .session-status-drag for window drag region functionality.
-->
<div
  class="session-status-drag session-island-shell {morphShellClass(
    morphShell,
  )} {islandInteractionClass} {islandCompactClass} {islandExpanded
    ? 'session-island-expanded'
    : ''}"
  data-tauri-drag-region
  onpointerenter={onShellPointerEnter}
  onpointerleave={onShellPointerLeave}
  role="presentation"
>
  {#if morphHidesContent}
    <div
      class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-[inherit]"
      aria-hidden="true"
    >
      <span
        class="text-base font-black tracking-widest text-miwarp-accent-on-accent {morphShell === 'waiting'
          ? 'animate-slow-pulse'
          : ''}"
        style="font-family: 'FonWorker', sans-serif;"
      >
        {morphShellLabel(morphShell)}
      </span>
    </div>
  {/if}

  <!-- Tier 1: icon rail -->
  <div
    class="session-island-tier1-frame relative inline-flex h-9 w-full items-center transition-opacity duration-300 {morphHidesContent
      ? 'opacity-0'
      : ''}"
  >
    <!-- Left drag spacer (Linux/Windows JS fallback) -->
    <WindowDragArea class="absolute left-0 top-0 bottom-0 w-12" />
    <!-- Right drag spacer (Linux/Windows JS fallback) -->
    <WindowDragArea class="absolute right-0 top-0 bottom-0 w-12" />

    {#if onToolPanelTabChange && toolPanelActiveTab}
      {@const leftTabs: ToolActivityPanelTab[] = ["workspace", "tools", "files"]}
      {@const rightTabs: ToolActivityPanelTab[] = ["preview", "scheduled-tasks"]}
      {@const showContextPill =
        shouldShowContextDetails(processVisibility) &&
        contextWindow != null &&
        contextWindow > 0 &&
        contextUtilization != null}
      <div
        class="session-island-tier1 {showContextPill
          ? 'session-island-tier1-has-context'
          : 'session-island-tier1-no-context'}"
      >
        <div class="session-island-tab-group">
          {#each leftTabs as tab (tab)}
            <button
              type="button"
              role="tab"
              aria-selected={toolPanelActiveTab === tab}
              aria-label={tabLabel(tab)}
              class="session-island-tab transition-colors {toolPanelActiveTab === tab
                ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-border/45'
                : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
              onclick={() => onToolPanelTabChange(tab)}
              title={tabLabel(tab)}
            >
              {#if tab === "workspace"}
                <Icon name="home" size="md" class="shrink-0 opacity-90" />
              {:else if tab === "tools"}
                <Icon name="wrench" size="md" class="shrink-0 opacity-90" />
              {:else if tab === "files"}
                <span class="relative inline-flex shrink-0">
                  <Icon name="file" size="sm" class="opacity-90" />
                  {#if toolPanelIndicators?.files}
                    <span
                      class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-miwarp-status-warning"
                    ></span>
                  {/if}
                </span>
              {/if}
            </button>
          {/each}
        </div>

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
            class="session-context-pill text-foreground/60"
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
                <span class="text-[10px] font-bold text-miwarp-accent-on-accent animate-pulse whitespace-nowrap px-2"
                  >{t("statusbar_compacted")}</span
                >
              {:else}
                <span class="flex items-center justify-center whitespace-nowrap">
                  <span class="text-[10px] font-bold text-miwarp-accent-on-accent/90 w-8 text-center">{pct}%</span>
                  <span class="session-context-ctx-label text-[10px] font-bold text-miwarp-accent-on-accent/70"
                    >ctx</span
                  >
                </span>
              {/if}
            </span>
          </span>
        {:else}
          <span class="session-context-pill text-foreground/60">
            <span class="session-context-pill-inner bg-miwarp-accent-primary">
              <span class="text-[10px] font-bold text-miwarp-accent-on-accent/90">miw</span>
            </span>
          </span>
        {/if}

        <div class="session-island-tab-group">
          {#each rightTabs as tab (tab)}
            <button
              type="button"
              role="tab"
              aria-selected={toolPanelActiveTab === tab}
              aria-label={tabLabel(tab)}
              class="session-island-tab transition-colors {toolPanelActiveTab === tab
                ? 'bg-muted/70 text-foreground shadow-sm ring-1 ring-border/45'
                : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}"
              onclick={() => onToolPanelTabChange(tab)}
              title={tabLabel(tab)}
            >
              {#if tab === "preview"}
                <svg
                  class="h-4 w-4 shrink-0 opacity-90"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                </svg>
              {:else if tab === "scheduled-tasks"}
                <Icon name="clock" size="md" class="shrink-0 opacity-90" />
              {/if}
            </button>
          {/each}

          {#if onSummarize}
            <button
              type="button"
              class="session-island-tab text-muted-foreground hover:bg-muted/45 hover:text-foreground transition-colors"
              onclick={onSummarize}
              title={t("statusbar_summarize")}
              aria-label={t("statusbar_summarize")}
            >
              <svg
                class="h-4 w-4 shrink-0 opacity-90"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" x2="8" y1="13" y2="13" />
                <line x1="16" x2="8" y1="17" y2="17" />
                <line x1="10" x2="8" y1="9" y2="9" />
              </svg>
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Tier 2: status + model + session id -->
  <div
    class="tier-2-content flex h-8 shrink-0 items-center justify-start overflow-hidden border-t border-border/20 transition-opacity duration-300 {islandExpanded
      ? 'session-island-tier2-open border-border/20'
      : 'session-island-tier2-closed border-transparent'} {morphHidesContent ? 'opacity-0' : ''}"
  >
    <div class="session-island-tier2">
      {#if onStatusClick}
        <button type="button"
          class="inline-flex items-center gap-1 shrink-0 rounded px-1 hover:bg-muted/50 transition-colors"
          onclick={onStatusClick}
          title={t("toolActivity_tabInfo")}
          aria-label={t("toolActivity_tabInfo")}
        >
          <span
            class="inline-block h-2 w-2 rounded-full {statusDotKind === 'running' ||
            statusDotKind === 'pending'
              ? 'animate-slow-pulse'
              : ''}"
            style="background-color: var(--miwarp-status-{statusDotKind});"
          ></span>
        </button>
      {:else}
        <span
          class="inline-block h-2 w-2 rounded-full shrink-0 {statusDotKind === 'running' ||
          statusDotKind === 'pending'
            ? 'animate-slow-pulse'
            : ''}"
          style="background-color: var(--miwarp-status-{statusDotKind});"
        ></span>
      {/if}

      {#if activeTaskCount && activeTaskCount > 0}
        <span
          class="flex items-center gap-1 text-miwarp-status-info"
          title={t("bgTask_activeTitle", { count: String(activeTaskCount) })}
        >
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-miwarp-status-info animate-pulse"></span>
          <span>{t("bgTask_active", { count: String(activeTaskCount) })}</span>
        </span>
        <span class="session-island-tier2-divider" aria-hidden="true">|</span>
      {:else}
        <span class="text-[10px] text-muted-foreground/50">{t("statusbar_noIdleTasks")}</span>
        <span class="session-island-tier2-divider" aria-hidden="true">|</span>
      {/if}

      {#if model}
        {#if onModelChange}
          <button type="button"
            bind:this={modelBtnEl}
            class="inline-flex max-w-[9rem] items-center gap-1 truncate rounded-md border border-transparent px-1.5 py-0.5 font-medium text-foreground/85 hover:border-border/50 hover:bg-muted/50 hover:text-foreground transition-colors {dropdownOpen
              ? 'border-border/60 bg-muted/60 text-foreground'
              : ''}"
            onclick={(e) => {
              e.stopPropagation();
              toggleModelDropdown();
            }}
            aria-expanded={dropdownOpen}
            aria-haspopup="listbox"
            aria-label={modelLabel}
          >
            <span class="truncate">{modelLabel}</span>
            {#if !effortDisabled && effort}
              <span class="text-[10px] font-normal text-foreground/55">{effort}</span>
            {/if}
            <Icon name="chevron-down" size="xs" class="shrink-0 text-foreground/40 transition-transform duration-200 {dropdownOpen ? 'rotate-180' : ''}" />
          </button>
        {:else}
          <span class="truncate font-medium text-foreground/85">{model}</span>
        {/if}
      {/if}

      {#if onProcessVisibilityChange}
        <span class="session-island-tier2-divider" aria-hidden="true">|</span>
        <button type="button"
          bind:this={pvMenuBtnEl}
          class="inline-flex w-fit items-center gap-1 truncate rounded-md border border-transparent px-2 py-1 text-foreground/65 hover:border-border/50 hover:bg-muted/50 hover:text-foreground transition-colors {pvMenuOpen
            ? 'border-border/60 bg-muted/60 text-foreground'
            : ''}"
          onclick={(e) => {
            e.stopPropagation();
            togglePvMenu();
          }}
          aria-expanded={pvMenuOpen}
          aria-haspopup="listbox"
          aria-label={t("settings_processVisibility")}
          title={t("settings_processVisibility")}
        >
          <span class="truncate font-medium">{processVisibilityShort(processVisibility)}</span>
        </button>
      {/if}
    </div>
  </div>
</div>

{#if pvMenuOpen}
  <div
    bind:this={pvMenuEl}
    role="listbox"
    class="statusbar-popover animate-fade-in overflow-hidden p-1"
    style={pvMenuStyle}
  >
    {#each PROCESS_VISIBILITY_LEVELS as mode (mode)}
      <button
        type="button"
        role="option"
        aria-selected={processVisibility === mode}
        class="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-xs transition-colors {processVisibility ===
        mode
          ? 'bg-primary/12 text-primary font-medium'
          : 'text-foreground/75 hover:bg-muted/50 hover:text-foreground'}"
        onclick={() => selectProcessVisibility(mode)}
      >
        {#if processVisibility === mode}
          <Icon name="check" size="sm" class="shrink-0 text-primary" />
        {:else}
          <span class="h-3.5 w-3.5 shrink-0"></span>
        {/if}
        <span class="flex-1">{processVisibilityLabel(mode)}</span>
      </button>
    {/each}
  </div>
{/if}

{#if dropdownOpen}
  <div
    transition:scale={{ start: 0.95, duration: 100 }}
    bind:this={dropdownEl}
    tabindex="-1"
    role="listbox"
    class="statusbar-popover flex max-h-[min(420px,70vh)] flex-col overflow-hidden outline-none"
    style={dropdownStyle}
    onkeydown={handleDropdownKeydown}
  >
    {#if showModelFilter}
      <div class="shrink-0 border-b border-border/25 px-2.5 py-2">
        <input
          bind:this={modelFilterEl}
          bind:value={modelFilter}
          placeholder={t("modelFilter_placeholder")}
          class="w-full rounded-[10px] border border-border/35 bg-muted/25 px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/45 focus:bg-muted/35"
          onkeydown={handleModelFilterKeydown}
        />
      </div>
    {/if}
    <div class="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-width:thin]">
      {#if filteredModels.length === 0}
        <EmptyState icon="🔍" title={t("modelFilter_noResults")} class="py-4" />
      {/if}
      {#each filteredModels as m, i}
        <button
          type="button"
          role="option"
          aria-selected={model === m.value}
          class="flex w-full items-start gap-2 rounded-[10px] px-2 py-2 text-left transition-colors {model ===
          m.value
            ? 'bg-primary/12'
            : 'hover:bg-muted/45'} {i === focusedModelIdx ? 'ring-1 ring-primary/25' : ''}"
          onclick={() => selectModel(m.value)}
        >
          {#if model === m.value}
            <Icon name="check" size="sm" class="mt-0.5 shrink-0 text-primary" />
          {:else}
            <span class="mt-0.5 h-3.5 w-3.5 shrink-0"></span>
          {/if}
          <span class="min-w-0 flex-1">
            <span
              class="block truncate text-xs font-medium {model === m.value
                ? 'text-primary'
                : 'text-foreground'}">{m.displayName}</span
            >
            {#if m.description}
              <span class="mt-0.5 block truncate text-[10px] leading-snug text-muted-foreground/65"
                >{m.description}</span
              >
            {/if}
          </span>
        </button>
      {/each}
    </div>
    {#if effortLevels.length > 0 && onEffortChange}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="shrink-0 border-t border-border/25"
        onkeydown={(e) => {
          if (["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.stopPropagation();
          }
        }}
      >
        <div class="px-3 py-2.5">
          <div
            class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70"
          >
            {t("effort_label")}{#if effortDisabled}<span
                class="ml-1 font-normal normal-case opacity-50"
                >— {currentModelInfo?.displayName ?? model}</span
              >{/if}
          </div>
          <div class="flex gap-1">
            {#each effortLevels as level}
              <button
                type="button"
                class="flex-1 rounded-[10px] px-2 py-1.5 text-xs transition-colors
                  {effortDisabled
                  ? 'cursor-not-allowed bg-muted/25 text-muted-foreground/40'
                  : effort === level
                    ? 'bg-primary font-medium text-primary-foreground shadow-sm'
                    : 'bg-muted/35 text-muted-foreground hover:bg-muted/55 hover:text-foreground'}"
                disabled={effortDisabled}
                onclick={() => onEffortChange(level)}>{level}</button
              >
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
