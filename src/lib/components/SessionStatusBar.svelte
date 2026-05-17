<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
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
    normalizeProcessVisibility,
  } from "$lib/utils/process-visibility";
  import type { MessageKey } from "$lib/i18n/types";

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
    onFork,
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
    toolsCount = 0,
    onToolsClick,
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
    onExportHtml,
    toolPanelActiveTab,
    onToolPanelTabChange,
    toolPanelIndicators,
    processVisibility: processVisibilityProp,
    onProcessVisibilityChange,
    /** When true, the capsule spans the combined chat + tool-rail width (single fused top bar). */
    fuseToolRailCapsule = false,
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
    onFork?: () => void;
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
    toolsCount?: number;
    onToolsClick?: () => void;
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
    onExportHtml?: () => void;
    toolPanelActiveTab?: ToolActivityPanelTab;
    onToolPanelTabChange?: (tab: ToolActivityPanelTab) => void;
    toolPanelIndicators?: { context: boolean; files: boolean; tasks: boolean };
    processVisibility?: ProcessVisibility | string;
    onProcessVisibilityChange?: (v: ProcessVisibility) => void;
    fuseToolRailCapsule?: boolean;
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

  // ── Expansion state (persisted) ──
  let expanded = $state(
    typeof window !== "undefined"
      ? localStorage.getItem("ocv:statusbar-expanded") !== "false"
      : true,
  );

  $effect(() => {
    localStorage.setItem("ocv:statusbar-expanded", String(expanded));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ocv:statusbar-toggle", { detail: { expanded } }));
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

  // ── Dynamic Island hover (peek extra row without toggling persisted expanded) ──
  let islandHover = $state(false);
  let islandLeaveTimer: ReturnType<typeof setTimeout> | undefined;

  function onIslandPointerEnter() {
    clearTimeout(islandLeaveTimer);
    islandHover = true;
  }

  function onIslandPointerLeave() {
    islandLeaveTimer = setTimeout(() => {
      islandHover = false;
    }, 140);
  }

  let moreMenuOpen = $state(false);
  let moreMenuBtnEl: HTMLButtonElement | undefined = $state();
  let moreMenuEl: HTMLDivElement | undefined = $state();

  let processVisOpen = $state(false);
  let processVisBtnEl: HTMLButtonElement | undefined = $state();
  let processVisMenuEl: HTMLDivElement | undefined = $state();

  let processVisibility = $derived(normalizeProcessVisibility(processVisibilityProp));

  const PV_LABEL: Record<ProcessVisibility, MessageKey> = {
    output: "processVisibility_output",
    guided: "processVisibility_guided",
    developer: "processVisibility_developer",
    expert: "processVisibility_expert",
  };

  let showIslandExpanded = $derived(
    expanded || islandHover || dropdownOpen || moreMenuOpen || processVisOpen || titleEditing,
  );

  function positionDropdown() {
    if (!modelBtnEl) return;
    const rect = modelBtnEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 200) {
      dropdownStyle = `position:fixed; bottom:${window.innerHeight - rect.top + 4}px; left:${rect.left}px; z-index:99;`;
    } else {
      dropdownStyle = `position:fixed; top:${rect.bottom + 4}px; left:${rect.left}px; z-index:99;`;
    }
  }

  function toggleModelDropdown() {
    dropdownOpen = !dropdownOpen;
    if (dropdownOpen) {
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
        moreMenuOpen &&
        moreMenuBtnEl &&
        !moreMenuBtnEl.contains(e.target as Node) &&
        moreMenuEl &&
        !moreMenuEl.contains(e.target as Node)
      ) {
        moreMenuOpen = false;
      }
      if (
        processVisOpen &&
        processVisBtnEl &&
        !processVisBtnEl.contains(e.target as Node) &&
        processVisMenuEl &&
        !processVisMenuEl.contains(e.target as Node)
      ) {
        processVisOpen = false;
      }
    }
    function onDocKeydown(e: KeyboardEvent) {
      if (dropdownOpen && e.key === "Escape") {
        dropdownOpen = false;
        e.preventDefault();
        e.stopPropagation(); // Prevent bubble to window → keybindingStore.dispatch → chat:interrupt
      }
    }
    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onDocKeydown);
    return () => {
      document.removeEventListener("mousedown", onDocClick, true);
      document.removeEventListener("keydown", onDocKeydown);
    };
  });

  onDestroy(() => {
    clearTimeout(compactTimer);
    clearTimeout(confirmTimer);
    clearTimeout(islandLeaveTimer);
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

  const hasMoreActions = $derived(
    onExportHtml ||
      (!running && onRewind && persistedFiles && persistedFiles.length > 0) ||
      (onFork && run?.session_id) ||
      (running && onEndSession),
  );

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
  Four-tier shell (see app.css miwarp-shell-tier-*): sidebar → main → tool rail → this capsule.
  With fuseToolRailCapsule, the island stretches across chat + tool rail (panel tabs read as part of one bar).
  data-tauri-drag-region + .session-status-drag class on the OUTER shell makes
  the *entire* status-bar background a window drag region (not just the left
  and right spacers). Buttons, inputs and anchors inside are already marked
  `-webkit-app-region: no-drag` globally (see src/app.css), so the model
  selector, sidebar toggle, more menu etc. still work normally. The two
  spacers below are kept for Linux/Windows where the JS handler is needed.

  Inside the island: Tier 1 = primary controls row; Tier 2 = expandable detail row.
-->
<div
  class="session-status-drag session-island-shell relative mt-3 w-full min-w-0 border border-border/55 dark:border-white/[0.13] bg-background/[0.42] dark:bg-background/[0.34] font-mono text-xs text-foreground/70 backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.38)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] transition-[border-radius,background-color,border-color,box-shadow] duration-[520ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-150 motion-reduce:ease-linear {fuseToolRailCapsule
    ? 'max-w-none'
    : 'mx-auto max-w-[1100px]'} {showIslandExpanded ? 'rounded-[1.28rem]' : 'rounded-full'}"
  data-tauri-drag-region
  onpointerenter={onIslandPointerEnter}
  onpointerleave={onIslandPointerLeave}
  aria-label={t("statusbar_islandRegion")}
>
  <!-- Left drag spacer (Linux/Windows JS fallback) -->
  <WindowDragArea class="absolute left-0 top-0 bottom-0 w-24 rounded-l-full" />
  <!-- Right drag spacer (Linux/Windows JS fallback) -->
  <WindowDragArea class="absolute right-0 top-0 bottom-0 w-24 rounded-r-full" />
  <!-- Tier 1: session status + panel tabs + actions -->
  <div class="relative z-10 flex h-9 min-w-0 items-center gap-1.5 px-3">
    <!-- Left: core session status (segment 1) -->
    <div class="flex min-h-0 min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {#if onToggleSidebar}
        <button
          type="button"
          class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md -ml-1 mr-0.5 hover:bg-accent transition-colors"
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
          type="button"
          class="inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1 -mx-1 hover:bg-accent/50 transition-colors"
          onclick={onStatusClick}
          title={t("toolActivity_tabInfo")}
        >
          <span
            class="inline-block h-2 w-2 rounded-full {running
              ? 'bg-miwarp-status-success animate-slow-pulse'
              : 'bg-foreground/20'}"
          ></span>
          <span class="text-foreground font-medium">{agent}</span>
        </button>
      {:else}
        <span
          class="inline-block h-2 w-2 rounded-full {running
            ? 'bg-miwarp-status-success animate-pulse'
            : 'bg-foreground/20'}"
        ></span>
      {/if}

      <!-- Session title (inline editable) -->
      {#if run && onRename}
        {#if titleEditing}
          <input
            bind:this={titleInputEl}
            bind:value={titleEditValue}
            class="w-32 bg-transparent border-b border-primary outline-none text-foreground font-medium px-0.5"
            onkeydown={(e) => {
              if (e.key === "Enter") commitTitleEdit();
              else if (e.key === "Escape") cancelTitleEdit();
            }}
            onblur={commitTitleEdit}
          />
        {:else}
          <button
            class="max-w-[200px] truncate text-foreground/80 hover:text-foreground transition-colors {run.name
              ? 'font-medium'
              : 'italic text-foreground/40'}"
            onclick={startTitleEdit}
            title={run.name || run.prompt || t("statusbar_sessionTitle")}
          >
            {truncate(run.name || run.prompt, 30)}
          </button>
        {/if}
        <span class="text-foreground/30">&middot;</span>
      {/if}

      {#if !onStatusClick}
        <span class="text-foreground font-medium">{agent}</span>
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

      {#if model}
        <span class="text-foreground/30">&middot;</span>
        {#if onModelChange}
          <button
            bind:this={modelBtnEl}
            class="inline-flex h-7 max-w-[min(11rem,30vw)] min-w-0 shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 text-foreground/80 transition-colors hover:border-border hover:bg-accent hover:text-foreground"
            onclick={toggleModelDropdown}
            title={modelLabel}
          >
            <span class="truncate">{modelLabel}</span>
            {#if !effortDisabled && effort}
              <span class="text-foreground/60 text-[10px] shrink-0">{effort}</span>
            {/if}
            <svg
              class="h-3 w-3 text-foreground/40 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
            >
          </button>
        {:else}
          <span class="truncate max-w-[min(11rem,30vw)] text-foreground/80" title={model}
            >{model}</span
          >
        {/if}
      {/if}

      <!-- Context bar (Tier 1 — always visible when available) -->
      {#if contextWindow && contextWindow > 0 && contextUtilization != null}
        {@const pct = Math.round(contextUtilization * 100)}
        {@const barColor =
          contextWarningLevel === "critical"
            ? "bg-amber-600/85"
            : contextWarningLevel === "high"
              ? "bg-amber-500/70"
              : contextWarningLevel === "moderate"
                ? "bg-amber-400/55"
                : "bg-emerald-500/45"}
        {@const textColor =
          contextWarningLevel === "critical" || contextWarningLevel === "high"
            ? "text-amber-800/80 dark:text-amber-200/75"
            : contextWarningLevel === "moderate"
              ? "text-amber-900/55 dark:text-amber-100/55"
              : "text-muted-foreground/55"}
        <span class="text-foreground/30">&middot;</span>
        <span
          class="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-border/30 bg-muted/25 px-2 py-0.5 {textColor}"
          title={t("statusbar_contextTitle", {
            pct: String(pct),
            tokens: contextWindow ? fmtNumber(contextWindow) : "",
          })}
        >
          <span class="inline-flex h-1 w-[2.75rem] rounded-full bg-foreground/8 overflow-hidden">
            <span
              class="h-full rounded-full transition-all duration-700 ease-out {barColor}"
              style="width: {pct}%"
            ></span>
          </span>
          <span class="hidden sm:inline text-[10px] tabular-nums text-muted-foreground/70"
            >{t("statusbar_ctx", { pct: String(pct) })}</span
          >
          {#if compactVisible}
            <span
              class="text-[10px] text-miwarp-status-info/80 font-medium animate-pulse"
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

    {#if onToolPanelTabChange && toolPanelActiveTab && processVisibility !== "output"}
      <div
        class="hidden h-5 w-px shrink-0 self-center bg-border/50 min-[480px]:block"
        aria-hidden="true"
      ></div>
      <div class="flex h-9 min-w-0 shrink items-center">
        <SessionPanelTabs
          active={toolPanelActiveTab}
          onSelect={onToolPanelTabChange}
          indicators={toolPanelIndicators ?? { context: false, files: false, tasks: false }}
        />
      </div>
    {/if}

    <!-- Right: tools count + More menu + chevron -->
    <div class="ml-auto flex h-9 shrink-0 items-center gap-1.5">
      {#if toolsCount && toolsCount > 0 && onToolsClick && processVisibility !== "output"}
        <button
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
          onclick={onToolsClick}
          title={t("statusbar_showTools")}
        >
          {t("statusbar_tools", { count: String(toolsCount) })}
        </button>
      {/if}

      {#if onProcessVisibilityChange}
        <div class="relative">
          <button
            type="button"
            bind:this={processVisBtnEl}
            class="hidden sm:inline-flex h-7 max-w-[9.5rem] min-w-0 items-center gap-1 rounded-md border border-transparent px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border/40 hover:bg-accent/20 hover:text-foreground"
            onclick={() => (processVisOpen = !processVisOpen)}
            title={t("statusbar_processVisibilityTitle")}
          >
            <span class="shrink-0 opacity-80">{t("statusbar_processVisibility")}</span>
            <span class="min-w-0 truncate text-foreground/90">{t(PV_LABEL[processVisibility])}</span
            >
            <svg
              class="h-2.5 w-2.5 shrink-0 opacity-50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
            >
          </button>
          {#if processVisOpen}
            <div
              bind:this={processVisMenuEl}
              class="absolute right-0 top-full z-50 mt-1 w-64 max-w-[80vw] rounded-md border border-border/40 bg-popover p-1 text-xs shadow-lg"
            >
              {#each PROCESS_VISIBILITY_LEVELS as level (level)}
                <button
                  type="button"
                  class="flex w-full flex-col items-start gap-0.5 rounded px-2 py-2 text-left transition-colors hover:bg-accent {processVisibility ===
                  level
                    ? 'bg-accent/40'
                    : ''}"
                  onclick={() => {
                    onProcessVisibilityChange?.(level);
                    processVisOpen = false;
                  }}
                >
                  <span class="font-medium text-foreground">{t(PV_LABEL[level])}</span>
                  <span class="text-[10px] leading-snug text-muted-foreground"
                    >{t(
                      level === "output"
                        ? "processVisibility_outputDesc"
                        : level === "guided"
                          ? "processVisibility_guidedDesc"
                          : level === "developer"
                            ? "processVisibility_developerDesc"
                            : "processVisibility_expertDesc",
                    )}</span
                  >
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- More menu -->
      {#if hasMoreActions}
        <div class="relative">
          <button
            type="button"
            bind:this={moreMenuBtnEl}
            class="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/40 hover:bg-accent hover:text-foreground/70 transition-colors"
            onclick={() => (moreMenuOpen = !moreMenuOpen)}
            title={t("statusbar_moreMenu")}
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
              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle
                cx="5"
                cy="12"
                r="1"
              />
            </svg>
          </button>
          {#if moreMenuOpen}
            <div
              bind:this={moreMenuEl}
              class="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-border/40 bg-popover p-1 text-xs shadow-lg"
            >
              {#if onExportHtml}
                <button
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent transition-colors"
                  onclick={() => {
                    moreMenuOpen = false;
                    onExportHtml();
                  }}
                >
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline
                      points="16 6 12 2 8 6"
                    /><line x1="12" x2="12" y1="2" y2="15" /></svg
                  >
                  {t("statusbar_exportHtml")}
                </button>
              {/if}
              {#if !running && onRewind && persistedFiles && persistedFiles.length > 0}
                <button
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent transition-colors"
                  onclick={() => {
                    moreMenuOpen = false;
                    onRewind();
                  }}
                >
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path
                      d="M3 3v5h5"
                    /></svg
                  >
                  {t("statusbar_rewind")}
                </button>
              {/if}
              {#if onFork && run?.session_id}
                <button
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent transition-colors"
                  onclick={() => {
                    moreMenuOpen = false;
                    onFork();
                  }}
                >
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle
                      cx="18"
                      cy="6"
                      r="3"
                    /><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" /><path
                      d="M12 12v3"
                    /></svg
                  >
                  {t("statusbar_fork")}
                </button>
              {/if}
              {#if running && onEndSession}
                {#if confirmingEnd}
                  <div class="flex items-center gap-1 px-2 py-1.5">
                    <span class="text-miwarp-status-warning">{t("statusbar_endConfirm")}</span>
                    <button
                      class="ml-auto rounded px-1.5 py-0.5 bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
                      onclick={confirmEnd}>{t("statusbar_yes")}</button
                    >
                    <button
                      class="rounded px-1.5 py-0.5 text-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
                      onclick={cancelEnd}>{t("statusbar_no")}</button
                    >
                  </div>
                {:else}
                  <button
                    class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 transition-colors"
                    onclick={() => {
                      moreMenuOpen = false;
                      requestEnd();
                    }}
                  >
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg
                    >
                    {t("statusbar_endSession")}
                  </button>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Expand/collapse chevron -->
      <button
        type="button"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground/30 hover:bg-accent hover:text-foreground/60 transition-colors"
        onclick={() => (expanded = !expanded)}
        title={expanded ? t("statusbar_collapse") : t("statusbar_expand")}
      >
        <svg
          class="h-3.5 w-3.5 transition-transform {expanded ? '' : 'rotate-180'}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Tier 2: expands on hover (peek) or when pinned open via chevron -->
  <div
    class="grid transition-[grid-template-rows] duration-[520ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-150 motion-reduce:ease-linear"
    style="grid-template-rows: {showIslandExpanded ? '1fr' : '0fr'};"
    aria-hidden={!showIslandExpanded}
  >
    <div class="min-h-0 overflow-hidden {showIslandExpanded ? '' : 'pointer-events-none'}">
      <div
        class="flex h-7 min-h-[1.75rem] items-center justify-between border-t border-border/20 px-3"
      >
        <!-- Left: details -->
        <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          {#if cwdShort}
            <span class="truncate" title={cwd || run?.cwd || ""}>{cwdShort}</span>
          {/if}

          {#if sessionIdShort}
            <span class="text-foreground/30">&middot;</span>
            <button
              class="text-foreground/40 hover:text-foreground/70 transition-colors"
              title="{t('statusbar_sessionLabel', {
                id: run?.session_id ?? '',
              })}\n{t('statusbar_clickToCopy')}"
              onclick={copySessionId}
            >
              {sidCopied ? t("statusbar_copied") : sessionIdShort}
            </button>
          {/if}

          {#if parentRunId && onNavigateParent}
            <span class="text-foreground/30">&middot;</span>
            <button
              class="flex items-center gap-1 text-miwarp-status-info/70 hover:text-miwarp-status-info transition-colors"
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

          {#if cost > 0}
            <span class="text-foreground/30 shrink-0">&middot;</span>
            <span class="shrink-0">{formatCost(cost)}</span>
          {/if}

          {#if inputTokens > 0 || outputTokens > 0}
            <span class="text-foreground/30 shrink-0">&middot;</span>
            <span
              class="shrink-0"
              title={`${t("statusbar_inputLabel")}: ${fmtNumber(inputTokens)} / ${t("statusbar_outputLabel")}: ${fmtNumber(outputTokens)}${cacheReadTokens ? `\n${t("statusbar_cacheReadLabel")}: ${fmtNumber(cacheReadTokens)}` : ""}${cacheWriteTokens ? `\n${t("statusbar_cacheWriteLabel")}: ${fmtNumber(cacheWriteTokens)}` : ""}`}
              >{formatTokenCount(inputTokens)} / {formatTokenCount(outputTokens)}
              {t("statusbar_tok")}</span
            >
            {#if cacheReadTokens > 0 || cacheWriteTokens > 0}
              <span class="text-foreground/60 text-[10px] shrink-0"
                >{t("statusbar_cacheRW", {
                  read: formatTokenCount(cacheReadTokens),
                  write: formatTokenCount(cacheWriteTokens),
                })}</span
              >
            {/if}
          {/if}

          {#if mcpServers && mcpServers.length > 0 && onMcpToggle}
            <span class="text-foreground/30">&middot;</span>
            <button
              class="flex items-center gap-1 shrink-0 rounded border border-transparent px-1.5 py-0.5 -my-0.5 text-foreground/70 hover:text-foreground hover:bg-accent hover:border-border transition-colors"
              onclick={onMcpToggle}
              title={t("statusbar_mcpTitle", { count: String(mcpServers.length) })}
            >
              <span class="inline-block h-1.5 w-1.5 rounded-full {mcpDotClass}"></span>
              <span>{t("statusbar_mcpLabel", { count: String(mcpServers.length) })}</span>
            </button>
          {/if}

          {#if numTurns && numTurns > 0}
            <span class="text-foreground/30 shrink-0">&middot;</span>
            <span class="shrink-0" title={t("statusbar_turnsTitle")}
              >{t("statusbar_turns", { count: String(numTurns) })}</span
            >
          {/if}

          {#if durationMs && durationMs > 0}
            {@const turnDetail = turnUsages
              .filter((tu) => tu.durationMs && tu.durationMs > 0)
              .map((tu) => `T${tu.turnIndex}: ${formatDuration(tu.durationMs!)}`)
              .join(", ")}
            <span class="text-foreground/30 shrink-0">&middot;</span>
            <span
              class="shrink-0"
              title={t("statusbar_durationTitle") +
                (turnDetail ? `\n${t("statusbar_durationPerTurn")}: ${turnDetail}` : "")}
              >{formatDuration(durationMs)}</span
            >
          {/if}
        </div>

        <!-- Right: secondary controls -->
        <div class="flex items-center gap-1.5 shrink-0">
          {#if permissionBadge}
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium {permissionBadge.cls}"
              title={t("statusbar_permissionMode", { mode: permissionMode ?? "" })}
              >{permissionBadge.label}</span
            >
          {/if}

          {#if fastModeState === "on"}
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-miwarp-status-warning/15 text-miwarp-status-warning"
              title={t("statusbar_fastModeTitle")}>{t("statusbar_fastMode")}</span
            >
          {/if}

          {#if verbose}
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/15 text-sky-400 hidden sm:inline"
              title={t("statusbar_verboseTitle")}>{t("statusbar_verbose")}</span
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
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium {authBadgeColor}"
              title={t("statusbar_authTitle", { source: apiKeySource ?? "" })}
              >{authSourceLabel}</span
            >
          {/if}

          {#if remoteHostName}
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-miwarp-status-info/15 text-miwarp-status-info"
              title={t("statusbar_sshTitle", { name: remoteHostName ?? "" })}
              >{t("statusbar_sshLabel", { name: remoteHostName ?? "" })}</span
            >
          {/if}

          {#if cliVersion}
            <button
              class="text-foreground/30 hover:text-foreground/60 transition-colors hidden sm:inline"
              title={t("statusbar_cliVersionTitle", { version: cliVersion ?? "" })}
              onclick={() => goto("/release-notes")}>CLI v{cliVersion}</button
            >
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

{#if dropdownOpen}
  <div
    bind:this={dropdownEl}
    tabindex="-1"
    role="listbox"
    class="min-w-[560px] w-max rounded-md border bg-background shadow-lg animate-fade-in outline-none"
    style={dropdownStyle}
    onkeydown={handleDropdownKeydown}
  >
    {#if showModelFilter}
      <div class="px-2 pt-2 pb-1">
        <input
          bind:this={modelFilterEl}
          bind:value={modelFilter}
          placeholder={t("modelFilter_placeholder")}
          class="w-full rounded border border-border/40 bg-background/50 px-2 py-1 text-xs outline-none focus:border-ring/40"
          onkeydown={handleModelFilterKeydown}
        />
      </div>
    {/if}
    <div class="p-1">
      {#if filteredModels.length === 0}
        <div class="px-3 py-2 text-xs text-muted-foreground/60">{t("modelFilter_noResults")}</div>
      {/if}
      {#each filteredModels as m, i}
        <button
          class="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs hover:bg-accent transition-colors {model ===
          m.value
            ? 'bg-accent font-medium'
            : ''} {i === focusedModelIdx ? 'ring-1 ring-primary/50' : ''}"
          onclick={() => selectModel(m.value)}
        >
          {#if model === m.value}
            <svg
              class="h-3 w-3 text-primary shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="M20 6 9 17l-5-5" /></svg
            >
          {:else}
            <span class="w-3 shrink-0"></span>
          {/if}
          <span class="shrink-0 text-foreground">{m.displayName}</span>
          <span class="text-[10px] text-foreground/70 truncate">{m.description}</span>
        </button>
      {/each}
    </div>
    {#if effortLevels.length > 0 && onEffortChange}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        onkeydown={(e) => {
          if (["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.stopPropagation();
          }
        }}
      >
        <div class="border-t mx-1 my-1"></div>
        <div class="px-3 py-2">
          <div class="text-[10px] text-muted-foreground mb-1.5">
            {t("effort_label")}{#if effortDisabled}<span class="ml-1 opacity-50"
                >— {currentModelInfo?.displayName ?? model} not supported</span
              >{/if}
          </div>
          <div class="flex gap-1">
            {#each effortLevels as level}
              <button
                class="flex-1 rounded px-2 py-1 text-xs transition-colors
                  {effortDisabled
                  ? 'bg-muted/30 text-muted-foreground/40 cursor-not-allowed'
                  : effort === level
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'bg-muted/50 text-muted-foreground hover:bg-accent'}"
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
