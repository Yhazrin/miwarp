<script lang="ts">
  import { onDestroy } from "svelte";
  import type { TaskRun, McpServerInfo, CliModelInfo } from "$lib/types";
  import type { TurnUsage } from "$lib/stores/types";
  import { EVT_STATUSBAR_TOGGLE } from "$lib/utils/bus-events";
  import { dbg } from "$lib/utils/debug";
  import ProcessVisibilityPicker from "$lib/components/ProcessVisibilityPicker.svelte";
  import StatusBarModelMenu from "$lib/components/StatusBarModelMenu.svelte";
  import { getCliModels } from "$lib/stores/cli-info.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { fmtNumber } from "$lib/i18n/format";
  import { formatCostDisplay } from "$lib/utils/format";
  import Icon from "$lib/components/Icon.svelte";
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import { shouldShowContextDetails } from "$lib/utils/process-visibility";

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
    permissionMode = "default",
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
    processVisibility = "developer" as ProcessVisibility,
    onProcessVisibilityChange,
    layoutSidebarOpen = false,
    onToggleLayoutSidebar,
    onOpenSettings,
    onOpenCliImport,
    onNewChat,
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
  } = $props();

  let showChromeActions = $derived(
    !!(onToggleLayoutSidebar || onOpenSettings || onOpenCliImport || onNewChat),
  );

  // v1.0.6 follow-up: hoist context-pill visibility so both tier 1 and
  // tier 2 can read it without duplicating the predicate.
  let showContextPill = $derived(
    shouldShowContextDetails(processVisibility) &&
      contextWindow != null &&
      contextWindow > 0 &&
      contextUtilization != null,
  );
  let tier2HasMeta = $derived(!!(run && onRename) || !!model || !!onProcessVisibilityChange);

  // ── Capsule morph: running / done / stopped / cached (flash) + waiting (persistent) ──
  type MorphFlash = "none" | "running" | "done" | "stopped" | "cached";
  type MorphShell = "none" | "running" | "done" | "stopped" | "cached" | "waiting";

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
  let models = $derived(platformModels.length > 0 ? platformModels : getCliModels());
  let modelMenuOpen = $state(false);
  let pvMenuOpen = $state(false);

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
  let islandActive = $derived(islandHover || modelMenuOpen || pvMenuOpen || titleEditing);

  /** One class on the shell — context pill width + tier 2 + outer capsule share this. */
  let islandInteractionClass = $derived(
    morphShell === "none" && islandActive ? "session-island-active" : "",
  );

  let islandCompactClass = $derived(
    morphShell === "none" && compactVisible ? "session-island-compact-pill" : "",
  );

  let tier2HasContent = $derived(tier2HasMeta);

  /** Tier 2 expands on hover/menus when there is something to show. */
  let islandExpanded = $derived(morphShell === "none" && islandActive && tier2HasContent);

  // Dispatch event when island expansion state changes (for tool panel positioning)
  $effect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(EVT_STATUSBAR_TOGGLE, { detail: { expanded: islandExpanded } }),
      );
    }
  });

  function handleModelMenuOpenChange(next: boolean) {
    modelMenuOpen = next;
    if (next) pvMenuOpen = false;
  }

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
  )} {islandInteractionClass} {islandCompactClass} {tier2HasContent
    ? 'session-island-has-tier2'
    : ''} {islandExpanded ? 'session-island-expanded' : ''}"
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
        class="text-base font-black tracking-widest text-miwarp-accent-on-accent {morphShell ===
        'waiting'
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
    class="session-island-tier1-frame relative inline-flex h-9 w-max max-w-full shrink-0 items-center transition-opacity duration-300 {morphHidesContent
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
          10-position row, 3 leading reveal + 4 chrome anchors (always centered
          when collapsed) + 3 trailing reveal. The 6 reveal tabs collapse to 0
          width in the collapsed state so the 4 chrome anchors remain
          visually clustered in the center, both collapsed and expanded.
            1 home (workspace) · 2 wrench (tools) · 3 file (files) ·
            4 layout (chrome) · 5 settings (chrome) ·
            6 plug (chrome) · 7 plus (chrome) ·
            8 monitor (preview) · 9 clock (scheduled-tasks) · 10 summarize
        -->

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

        <!-- 3: leading reveal — files (file) -->
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

        <!-- 4: chrome anchor — layout (sidebar toggle) -->
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

        <!-- 5: chrome anchor — settings -->
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

        <!-- 6: chrome anchor — plug (CLI import) -->
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

        <!-- 7: chrome anchor — plus (new chat) -->
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

        <!-- 8: trailing reveal — preview (monitor) -->
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

        <!-- 9: trailing reveal — scheduled-tasks (clock) -->
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

        <!-- 10: trailing reveal — summarize (optional) -->
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
    {/if}
  </div>

  {#if tier2HasContent}
    <!-- Tier 2: title, model, process visibility, context pill (right) (omitted from layout when collapsed) -->
    <div
      class="tier-2-content flex min-h-0 min-w-0 shrink-0 items-center justify-between overflow-hidden {islandActive
        ? 'session-island-tier2-open border-t border-border/20'
        : 'border-0'} {morphHidesContent ? 'opacity-0 pointer-events-none' : ''}"
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

        {#if model}
          {#if run && onRename}
            <span class="session-island-tier2-divider" aria-hidden="true">|</span>
          {/if}
          {#if onModelChange}
            <StatusBarModelMenu
              bind:open={modelMenuOpen}
              {model}
              {models}
              {modelLabel}
              {effort}
              {effortLevels}
              {effortDisabled}
              {currentModelInfo}
              {onModelChange}
              {onEffortChange}
              onOpenChange={handleModelMenuOpenChange}
            />
          {:else}
            <span class="max-w-[11rem] truncate font-medium text-foreground/85">{model}</span>
          {/if}
        {/if}

        {#if onProcessVisibilityChange}
          {#if (run && onRename) || model}
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
