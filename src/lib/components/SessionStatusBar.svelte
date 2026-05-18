<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { TaskRun, McpServerInfo, CliModelInfo } from "$lib/types";
  import type { TurnUsage } from "$lib/stores/types";
  import { dbg } from "$lib/utils/debug";
  import { getCliModels } from "$lib/stores/cli-info.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { fmtNumber } from "$lib/i18n/format";
  import { truncate, formatTokenCount, formatDuration, formatCostDisplay } from "$lib/utils/format";
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import SessionPanelTabs from "$lib/components/chat/SessionPanelTabs.svelte";
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
    cost = 0,
    inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
    running = false,
    parentRunId,
    onEndSession,
    onModelChange,
    onNavigateParent,
    onToggleSidebar,
    mcpServers,
    onMcpToggle,
    cliVersion,
    permissionMode,
    fastModeState,
    numTurns,
    durationMs,
    persistedFiles,
    onRewind,
    contextUtilization,
    contextWarningLevel,
    contextWindow,
    cwd = "",
    lastCompactedAt = 0,
    compactCount = 0,
    microcompactCount = 0,
    turnUsages = [],
    activeTaskCount = 0,
    mode = "",
    remoteHostName,
    onRename,
    platformModels = [],
    authSourceLabel,
    authSourceCategory,
    verbose = false,
    apiKeySource,
    effort,
    onEffortChange,
    onStatusClick,
    onSummarize,
    toolPanelActiveTab,
    onToolPanelTabChange,
    toolPanelIndicators,
    fuseToolRailCapsule = false,
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
    parentRunId?: string;
    onEndSession?: () => void;
    onModelChange?: (model: string) => void;
    onNavigateParent?: () => void;
    onToggleSidebar?: () => void;
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
    toolPanelActiveTab?: ToolActivityPanelTab;
    onToolPanelTabChange?: (tab: ToolActivityPanelTab) => void;
    toolPanelIndicators?: { context: boolean; files: boolean; tasks: boolean };
    /** Widen the top capsule so fused panel tabs align with the unified control row. */
    fuseToolRailCapsule?: boolean;
    processVisibility?: ProcessVisibility;
    onProcessVisibilityChange?: (mode: ProcessVisibility) => void;
  } = $props();

  $effect(() => {
    dbg("status", "state", { agent, model, running, runId: run?.id });
  });

  // ── Compact indicator (fades after 8s) ──
  let compactVisible = $state(false);
  let compactTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (lastCompactedAt && lastCompactedAt > 0) {
      compactVisible = true;
      clearTimeout(compactTimer);
      compactTimer = setTimeout(() => {
        compactVisible = false;
      }, 8000);
    }
  });

  let cwdShort = $derived.by(() => {
    const val = cwd || run?.cwd || "";
    if (!val || val === "/") return "";
    const home = val
      .replace(/^\/Users\/[^/]+/, "~")
      .replace(/^\/home\/[^/]+/, "~")
      .replace(/^[A-Za-z]:[/\\](?:Users|users)[/\\][^/\\]+/, "~");
    return home.length > 30 ? "..." + home.slice(-27) : home;
  });

  let sessionIdShort = $derived(run?.session_id ? run.session_id.slice(0, 8) : "");
  let sidCopied = $state(false);

  async function copySessionId() {
    if (!run?.session_id) return;
    try {
      await navigator.clipboard.writeText(run.session_id);
      sidCopied = true;
      setTimeout(() => (sidCopied = false), 1500);
    } catch {
      /* ignore */
    }
  }

  // ── Title inline editing ──
  let titleEditing = $state(false);
  let titleEditValue = $state("");
  let titleInputEl: HTMLInputElement | undefined = $state();

  function startTitleEdit() {
    if (!onRename || !run) return;
    titleEditValue = run.name || run.prompt;
    titleEditing = true;
    requestAnimationFrame(() => titleInputEl?.select());
  }

  function commitTitleEdit() {
    titleEditing = false;
    const trimmed = titleEditValue.trim();
    if (trimmed && run && trimmed !== (run.name || run.prompt)) {
      onRename?.(trimmed);
    }
  }

  function cancelTitleEdit() {
    titleEditing = false;
  }

  const formatCost = formatCostDisplay;

  let permissionBadge = $derived.by(() => {
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
      plan: { label: t("sessionStatus_plan"), cls: "bg-purple-500/15 text-purple-400" },
      auto: { label: t("sessionStatus_auto"), cls: "bg-teal-500/15 text-teal-400" },
      dontAsk: { label: "no-ask", cls: "bg-red-500/15 text-miwarp-status-error" },
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
  const PV_MENU_WIDTH = 184;

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

  // ── Island hover state ──
  let islandHover = $state(false);

  let islandExpanded = $derived(islandHover || dropdownOpen || pvMenuOpen || titleEditing);

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
  });

  // ── End Session confirmation ──
  let confirmingEnd = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  function requestEnd() {
    confirmingEnd = true;
    confirmTimer = setTimeout(() => {
      confirmingEnd = false;
    }, 3000);
  }

  function confirmEnd() {
    clearTimeout(confirmTimer);
    confirmingEnd = false;
    onEndSession?.();
  }

  function cancelEnd() {
    clearTimeout(confirmTimer);
    confirmingEnd = false;
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

  let mcpDotClass = $derived(
    mcpAggregateStatus === "error"
      ? "bg-destructive"
      : mcpAggregateStatus === "pending"
        ? "bg-amber-500"
        : mcpAggregateStatus === "disabled"
          ? "bg-muted-foreground/30"
          : "bg-emerald-500",
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
  class="session-status-drag session-island-shell flex flex-col {fuseToolRailCapsule
    ? 'mx-2 sm:mx-3'
    : 'mx-4'} {islandExpanded ? 'session-island-expanded' : ''}"
  data-tauri-drag-region
  onmouseenter={() => (islandHover = true)}
  onmouseleave={() => (islandHover = false)}
>
  <!-- Left drag spacer (Linux/Windows JS fallback) -->
  <WindowDragArea class="absolute left-0 top-0 bottom-0 w-24" />
  <!-- Right drag spacer (Linux/Windows JS fallback) -->
  <WindowDragArea class="absolute right-0 top-0 bottom-0 w-24" />
  <!-- Tier 1: Always visible (h-9) -->
  <div class="relative z-10 flex h-9 min-w-0 items-center gap-1.5 px-3">
    <!-- Left: core info -->
    <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
      {#if onToggleSidebar}
        <button
          class="rounded p-1 -ml-1 mr-0.5 hover:bg-muted/60 transition-colors"
          onclick={onToggleSidebar}
          title={t("statusbar_toggleSidebar")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></svg
          >
        </button>
      {/if}

      <!-- Pulse indicator + agent name (clickable for status) -->
      {#if onStatusClick}
        <button
          class="inline-flex items-center gap-1.5 shrink-0 rounded px-1 -mx-1 hover:bg-muted/50 transition-colors"
          onclick={onStatusClick}
          title={t("toolActivity_tabInfo")}
        >
          <span
            class="inline-block h-2 w-2 rounded-full {running ? 'animate-slow-pulse' : ''}"
            style="background-color: var(--miwarp-status-{running ? 'running' : 'idle'});"
          ></span>
          <span class="text-xs text-foreground font-medium">{agent}</span>
        </button>
      {:else}
        <span
          class="inline-block h-2 w-2 rounded-full {running ? 'animate-pulse' : ''}"
          style="background-color: var(--miwarp-status-{running ? 'running' : 'idle'});"
        ></span>
      {/if}

      {#if mode}
        <span
          class="shrink-0 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded {mode ===
          'API'
            ? 'bg-violet-500/10 text-violet-400'
            : mode === 'Stream'
              ? 'bg-miwarp-status-info/10 text-miwarp-status-info'
              : 'bg-emerald-500/10 text-emerald-400'}"
        >
          {mode}
        </span>
      {/if}

      {#if onProcessVisibilityChange}
        <span class="text-foreground/30 hidden sm:inline">&middot;</span>
        <div class="relative shrink-0">
          <button
            bind:this={pvMenuBtnEl}
            class="flex max-w-[7.5rem] sm:max-w-none items-center gap-0.5 rounded border border-transparent px-1 py-0.5 -my-0.5 text-[10px] text-foreground/65 hover:text-foreground hover:bg-muted/60 hover:border-border/60 transition-colors {pvMenuOpen
              ? 'bg-muted/60 border-border/60 text-foreground'
              : ''}"
            onclick={(e) => {
              e.stopPropagation();
              togglePvMenu();
            }}
            aria-expanded={pvMenuOpen}
            aria-haspopup="listbox"
            title={t("settings_processVisibility")}
          >
            <span class="sm:hidden font-medium">{processVisibilityShort(processVisibility)}</span>
            <span class="hidden sm:inline truncate font-medium"
              >{processVisibilityLabel(processVisibility)}</span
            >
            <svg
              class="h-2.5 w-2.5 shrink-0 text-foreground/35 transition-transform duration-200 {pvMenuOpen
                ? 'rotate-180'
                : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
            >
          </button>
        </div>
      {/if}

      {#if model}
        <span class="text-foreground/30">&middot;</span>
        {#if onModelChange}
          <button
            bind:this={modelBtnEl}
            class="flex items-center gap-1 shrink-0 rounded border border-transparent px-1.5 py-0.5 -my-0.5 text-xs text-foreground/80 hover:text-foreground hover:bg-muted/60 hover:border-border transition-colors {dropdownOpen
              ? 'bg-muted/60 border-border/60 text-foreground'
              : ''}"
            onclick={(e) => {
              e.stopPropagation();
              toggleModelDropdown();
            }}
            aria-expanded={dropdownOpen}
            aria-haspopup="listbox"
          >
            {modelLabel}
            {#if !effortDisabled && effort}
              <span class="text-[10px] text-foreground/60">{effort}</span>
            {/if}
            <svg
              class="h-3 w-3 text-foreground/40 transition-transform duration-200 {dropdownOpen
                ? 'rotate-180'
                : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
            >
          </button>
        {:else}
          <span class="truncate text-xs text-foreground/80">{model}</span>
        {/if}
      {/if}

      <!-- Context bar (Tier 1 — developer / expert) -->
      {#if shouldShowContextDetails(processVisibility) && contextWindow && contextWindow > 0 && contextUtilization != null}
        {@const pct = Math.round(contextUtilization * 100)}
        {@const barColor =
          contextWarningLevel === "critical"
            ? "bg-orange-500"
            : contextWarningLevel === "high"
              ? "bg-orange-500"
              : contextWarningLevel === "moderate"
                ? "bg-amber-500"
                : "bg-emerald-500"}
        {@const textColor =
          contextWarningLevel === "critical"
            ? "text-miwarp-status-warning"
            : contextWarningLevel === "high"
              ? "text-miwarp-status-warning"
              : contextWarningLevel === "moderate"
                ? "text-miwarp-status-warning"
                : "text-foreground/60"}
        <span class="text-foreground/30">&middot;</span>
        <span
          class="flex items-center gap-1.5 shrink-0 {textColor}"
          title={t("statusbar_contextTitle", {
            pct: String(pct),
            tokens: contextWindow ? fmtNumber(contextWindow) : "",
          })}
        >
          <span class="inline-flex h-1.5 w-12 rounded-full bg-foreground/10 overflow-hidden">
            <span
              class="h-full rounded-full transition-all duration-700 ease-out {barColor}"
              style="width: {pct}%"
            ></span>
          </span>
          <span class="hidden sm:inline text-xs">{t("statusbar_ctx", { pct: String(pct) })}</span>
          {#if compactVisible}
            <span
              class="text-[10px] text-miwarp-status-info font-medium animate-pulse"
              title={t("statusbar_compactDetail", {
                full: String(compactCount),
                micro: String(microcompactCount),
              })}>{t("statusbar_compacted")}</span
            >
          {/if}
        </span>
      {/if}

      {#if activeTaskCount && activeTaskCount > 0}
        <span class="text-foreground/30">&middot;</span>
        <span
          class="flex items-center gap-1 text-miwarp-status-info"
          title={t("bgTask_activeTitle", { count: String(activeTaskCount) })}
        >
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse"></span>
          <span class="text-[10px]">{t("bgTask_active", { count: String(activeTaskCount) })}</span>
        </span>
      {/if}
    </div>

    {#if onToolPanelTabChange && toolPanelActiveTab}
      <div
        class="hidden h-5 w-px shrink-0 self-center bg-border/50 min-[480px]:block"
        aria-hidden="true"
      ></div>
      <div class="flex h-9 min-w-0 shrink items-center overflow-hidden">
        <SessionPanelTabs
          active={toolPanelActiveTab}
          onSelect={onToolPanelTabChange}
          indicators={toolPanelIndicators ?? { context: false, files: false, tasks: false }}
        />
      </div>
    {/if}

    <!-- Right: summarize + scheduled tasks -->
    <div class="ml-auto flex shrink-0 items-center gap-2">
      {#if onSummarize}
        <button
          class="flex items-center gap-1.5 rounded p-1.5 text-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
          onclick={onSummarize}
          title={t("statusbar_summarize")}
        >
          <svg
            class="h-3.5 w-3.5"
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

      <button
        class="flex items-center gap-1.5 rounded p-1.5 text-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
        onclick={() => onToolPanelTabChange?.("scheduled-tasks")}
        title={t("statusbar_scheduledTasks")}
      >
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
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Tier 2: Details shown on hover (h-8) -->
  {#if islandHover}
    <div class="flex h-8 shrink-0 items-center justify-between border-t border-border/20 px-3">
      <!-- Left: session info -->
      <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <!-- Session title (inline editable) -->
        {#if run && onRename}
          {#if titleEditing}
            <input
              bind:this={titleInputEl}
              bind:value={titleEditValue}
              class="w-40 bg-transparent border-b border-primary outline-none text-foreground font-medium px-0.5 text-xs leading-8"
              onkeydown={(e) => {
                if (e.key === "Enter") commitTitleEdit();
                else if (e.key === "Escape") cancelTitleEdit();
              }}
              onblur={commitTitleEdit}
            />
          {:else}
            <button
              class="max-w-[240px] truncate text-xs leading-8 text-foreground/70 hover:text-foreground transition-colors {run.name
                ? 'font-medium'
                : 'italic text-foreground/40'}"
              onclick={startTitleEdit}
              title={run.name || run.prompt || t("statusbar_sessionTitle")}
            >
              {truncate(run.name || run.prompt, 40)}
            </button>
          {/if}
          <span class="text-xs leading-8 text-foreground/30">&middot;</span>
        {/if}

        {#if cwdShort}
          <span class="truncate text-xs leading-8" title={cwd || run?.cwd || ""}>{cwdShort}</span>
        {/if}

        {#if sessionIdShort}
          <span class="text-xs leading-8 text-foreground/30">&middot;</span>
          <button
            class="inline-flex h-8 items-center text-xs leading-8 text-foreground/40 hover:text-foreground/70 transition-colors"
            title="{t('statusbar_sessionLabel', {
              id: run?.session_id ?? '',
            })}\n{t('statusbar_clickToCopy')}"
            onclick={copySessionId}
          >
            {sidCopied ? t("statusbar_copied") : sessionIdShort}
          </button>
        {/if}

        {#if parentRunId && onNavigateParent}
          <span class="text-xs leading-8 text-foreground/30">&middot;</span>
          <button
            class="inline-flex h-8 items-center gap-1 text-xs leading-8 text-miwarp-status-info/70 hover:text-miwarp-status-info transition-colors"
            onclick={onNavigateParent}
            title={t("statusbar_viewParent")}
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle
                cx="18"
                cy="6"
                r="3"
              />
              <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" /><path d="M12 12v3" />
            </svg>
            <span>{t("statusbar_forked")}</span>
          </button>
        {/if}

        {#if shouldShowContextDetails(processVisibility) && (inputTokens > 0 || outputTokens > 0)}
          <span class="shrink-0 text-xs leading-8 text-foreground/30">&middot;</span>
          <span
            class="inline-flex h-8 shrink-0 items-center text-xs leading-8"
            title={`${t("statusbar_inputLabel")}: ${fmtNumber(inputTokens)} / ${t("statusbar_outputLabel")}: ${fmtNumber(outputTokens)}${cacheReadTokens ? `\n${t("statusbar_cacheReadLabel")}: ${fmtNumber(cacheReadTokens)}` : ""}${cacheWriteTokens ? `\n${t("statusbar_cacheWriteLabel")}: ${fmtNumber(cacheWriteTokens)}` : ""}`}
            >{formatTokenCount(inputTokens)} / {formatTokenCount(outputTokens)}
            {t("statusbar_tok")}</span
          >
          {#if cacheReadTokens > 0 || cacheWriteTokens > 0}
            <span
              class="inline-flex h-8 shrink-0 items-center text-[10px] leading-8 text-foreground/60"
              >{t("statusbar_cacheRW", {
                read: formatTokenCount(cacheReadTokens),
                write: formatTokenCount(cacheWriteTokens),
              })}</span
            >
          {/if}
        {/if}

        {#if mcpServers && mcpServers.length > 0 && onMcpToggle}
          <span class="text-xs leading-8 text-foreground/30">&middot;</span>
          <button
            class="inline-flex h-8 shrink-0 items-center gap-1 text-xs leading-8 text-foreground/70 hover:text-foreground transition-colors"
            onclick={onMcpToggle}
            title={t("statusbar_mcpTitle", { count: String(mcpServers.length) })}
          >
            <span class="inline-block h-1.5 w-1.5 rounded-full {mcpDotClass}"></span>
            <span>{t("statusbar_mcpLabel", { count: String(mcpServers.length) })}</span>
          </button>
        {/if}

        {#if numTurns && numTurns > 0}
          <span class="shrink-0 text-xs leading-8 text-foreground/30">&middot;</span>
          <span
            class="inline-flex h-8 shrink-0 items-center text-xs leading-8"
            title={t("statusbar_turnsTitle")}
            >{t("statusbar_turns", { count: String(numTurns) })}</span
          >
        {/if}
      </div>

      <!-- Right: badges -->
      <div class="flex shrink-0 items-center gap-1.5">
        {#if permissionBadge}
          <span
            class="inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-medium leading-none {permissionBadge.cls}"
            title={t("statusbar_permissionMode", { mode: permissionMode ?? "" })}
            >{permissionBadge.label}</span
          >
        {/if}

        {#if fastModeState === "on"}
          <span
            class="inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-medium leading-none bg-miwarp-status-warning/15 text-miwarp-status-warning"
            title={t("statusbar_fastModeTitle")}>{t("statusbar_fastMode")}</span
          >
        {/if}

        {#if authSourceLabel}
          {@const authBadgeColor =
            authSourceCategory === "login"
              ? "bg-emerald-500/15 text-emerald-500"
              : authSourceCategory === "env_key"
                ? "bg-miwarp-status-info/15 text-miwarp-status-info"
                : authSourceCategory === "none"
                  ? "bg-miwarp-status-warning/15 text-miwarp-status-warning"
                  : "bg-foreground/10 text-foreground/60"}
          <span
            class="inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-medium leading-none {authBadgeColor}"
            title={t("statusbar_authTitle", { source: apiKeySource ?? "" })}>{authSourceLabel}</span
          >
        {/if}

        {#if remoteHostName}
          <span
            class="inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-medium leading-none bg-miwarp-status-info/15 text-miwarp-status-info"
            title={t("statusbar_sshTitle", { name: remoteHostName ?? "" })}
            >{t("statusbar_sshLabel", { name: remoteHostName ?? "" })}</span
          >
        {/if}
      </div>
    </div>
  {/if}
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
          <svg
            class="h-3.5 w-3.5 shrink-0 text-primary"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
          >
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
    bind:this={dropdownEl}
    tabindex="-1"
    role="listbox"
    class="statusbar-popover animate-fade-in flex max-h-[min(420px,70vh)] flex-col overflow-hidden outline-none"
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
        <div class="px-2.5 py-6 text-center text-xs text-muted-foreground/60">
          {t("modelFilter_noResults")}
        </div>
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
            <svg
              class="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
            >
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
