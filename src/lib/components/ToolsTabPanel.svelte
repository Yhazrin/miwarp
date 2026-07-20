<!--
  ToolsTabPanel — the "tools" tab content inside ToolActivity.
  Displays tool statistics, summary chips, and the tool list (timeline or hook mode).
-->
<script lang="ts">
  import type { HookEvent } from "$lib/types";
  import { getToolColor } from "$lib/utils/tool-colors";
  import { truncate } from "$lib/utils/format";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import StatusIcon from "$lib/components/StatusIcon.svelte";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import {
    type ToolNode,
    type ToolTurn,
    type ToolActivityStats,
    type StatusCategory,
    categorizeBusStatus,
    categorizeHookStatus,
    getToolDetail,
    getHookDetail,
    getTurnBreakdown,
    countToolNodes,
    flattenNodes,
  } from "./tool-activity-utils";

  let {
    toolStats,
    turns,
    hookToolEvents,
    useTimeline,
    collapsedTurns,
    toggleTurn,
    onScrollToTool,
    onScrollToTurn,
    activeTab = $bindable("tools" as ToolActivityPanelTab),
  }: {
    toolStats: ToolActivityStats;
    turns: ToolTurn[];
    hookToolEvents: HookEvent[];
    useTimeline: boolean;
    collapsedTurns: Set<number>;
    toggleTurn: (turnIndex: number) => void;
    onScrollToTool?: (toolUseId: string) => void;
    onScrollToTurn?: (anchorId: string) => void;
    activeTab?: ToolActivityPanelTab;
  } = $props();
</script>

{#snippet statusIcon(category: StatusCategory)}
  <StatusIcon status={category} size="sm" />
{/snippet}

{#snippet categoryIcon(color: string, iconPath: string)}
  <span class="flex h-3 w-3 shrink-0 items-center justify-center rounded {color}">
    <svg
      class="h-1.5 w-1.5 text-miwarp-accent-on-accent"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"><path d={iconPath} /></svg
    >
  </span>
{/snippet}

{#snippet toolNodeView(node: ToolNode)}
  {@const style = getToolColor(node.tool.tool_name)}
  {@const detail = getToolDetail(node.tool)}
  {@const cat = categorizeBusStatus(node.tool.status)}
  <button
    type="button"
    class="w-full text-left px-2.5 py-1 hover:bg-accent/50 rounded-sm transition-colors group {cat ===
    'error'
      ? 'border-l-2 border-l-[hsl(var(--miwarp-status-error)/0.4)] bg-[hsl(var(--miwarp-status-error)/0.03)]'
      : ''}"
    onclick={() => onScrollToTool?.(node.tool.tool_use_id)}
    title={t("toolActivity_scrollToTool")}
  >
    <div class="flex items-center gap-1.5">
      {@render statusIcon(cat)}
      <div class="flex h-4 w-4 shrink-0 items-center justify-center rounded {style.bg}">
        <svg
          class="h-2.5 w-2.5 {style.text}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={style.icon} />
        </svg>
      </div>
      <span class="text-[11px] font-medium text-foreground shrink-0">{node.tool.tool_name}</span>
      {#if detail}
        <span
          class="text-[10px] text-muted-foreground truncate min-w-0 opacity-70 group-hover:opacity-100"
          >{detail}</span
        >
      {/if}
    </div>
  </button>
  {#if node.children.length > 0}
    <div class="ml-5 border-l-2 border-[hsl(var(--miwarp-status-info)/0.25)]">
      {#each node.children as child (child.tool.tool_use_id)}
        {@render toolNodeView(child)}
      {/each}
    </div>
  {/if}
{/snippet}

<!-- Overview: compact single-line session stats -->
{#if toolStats.totalToolCount > 0}
  <div class="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/50 text-[10px]">
    <span class="font-medium text-foreground"
      >{t("toolActivity_totalTools", { count: String(toolStats.totalToolCount) })}</span
    >
    {#if toolStats.reads > 0}
      <span class="text-muted-foreground/40">&middot;</span>
      <span class="flex items-center gap-0.5 text-miwarp-status-info">
        {@render categoryIcon(
          "bg-miwarp-status-info",
          "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
        )}
        {toolStats.reads}
      </span>
    {/if}
    {#if toolStats.searches > 0}
      <span class="text-muted-foreground/40">&middot;</span>
      <span class="flex items-center gap-0.5 text-miwarp-accent-violet">
        {@render categoryIcon(
          "bg-miwarp-accent-violet",
          "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35",
        )}
        {toolStats.searches}
      </span>
    {/if}
    {#if toolStats.bash > 0}
      <span class="text-muted-foreground/40">&middot;</span>
      <span class="flex items-center gap-0.5 text-miwarp-status-success">
        {@render categoryIcon("bg-miwarp-status-success", "M4 17l6-6-6-6M12 19h8")}
        {toolStats.bash}
      </span>
    {/if}
    {#if toolStats.writes > 0}
      <span class="text-muted-foreground/40">&middot;</span>
      <span class="flex items-center gap-0.5 text-miwarp-status-warning">
        {@render categoryIcon(
          "bg-miwarp-status-warning",
          "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
        )}
        {toolStats.writes}
      </span>
    {/if}
    {#if toolStats.errorCount > 0}
      <span class="text-muted-foreground/40">&middot;</span>
      <span class="flex items-center gap-0.5 text-miwarp-status-error">
        <StatusIcon status="error" size="xs" />
        {toolStats.errorCount}
      </span>
    {/if}
  </div>
{/if}

<!-- Summary chips -->
{#if toolStats.summary.length > 1}
  <div class="flex flex-wrap gap-1 px-2.5 py-1.5 border-b border-border/50">
    {#each toolStats.summary as [name, count]}
      {@const style = getToolColor(name)}
      <span
        class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded {style.bg} {style.text} font-medium"
      >
        {name}
        <span class="opacity-70">{count}</span>
      </span>
    {/each}
  </div>
{/if}

<!-- Tool list -->
<div class="flex-1 overflow-y-auto py-0.5 scrollbar-hide">
  {#if toolStats.totalToolCount === 0}
    <EmptyState
      title={t("toolActivity_noToolCalls")}
      description={t("toolActivity_emptyHint")}
      class="h-32 px-4 py-4"
    >
      {#snippet iconComponent()}
        <Icon name="wrench" size="lg" class="text-muted-foreground/20 mb-2" />
      {/snippet}
    </EmptyState>
  {:else if useTimeline}
    <!-- Timeline mode: grouped by turn -->
    {#each turns as turn (turn.turnIndex)}
      {@const isCollapsed = collapsedTurns.has(turn.turnIndex)}
      {@const hasTools = turn.tools.length > 0}
      {@const turnHasError =
        hasTools && flattenNodes(turn.tools).some((t) => categorizeBusStatus(t.status) === "error")}
      <!-- Turn header -->
      <div
        class="flex items-center w-full px-2.5 py-1.5 hover:bg-accent/50 transition-colors border-b border-border/30 {turnHasError
          ? 'border-l-2 border-l-[hsl(var(--miwarp-status-error)/0.5)]'
          : ''}"
      >
        <button
          type="button"
          class="flex-1 flex items-center gap-1.5 text-left min-w-0"
          onclick={() => {
            if (hasTools) {
              toggleTurn(turn.turnIndex);
            } else if (turn.anchorId) {
              onScrollToTurn?.(turn.anchorId);
            }
          }}
        >
          {#if hasTools}
            <Icon
              name="chevron-right"
              size="xs"
              class="text-muted-foreground/50 shrink-0 transition-transform {isCollapsed
                ? ''
                : 'rotate-90'}"
            />
          {/if}
          <span class="text-[11px] font-medium text-muted-foreground truncate">
            {#if turn.userPreview}
              {t("toolActivity_turn", { index: String(turn.turnIndex) })}
              <span class="text-foreground/70">{truncate(turn.userPreview, 25)}</span>
            {:else}
              <span class="text-muted-foreground/60">{t("toolActivity_systemResume")}</span>
            {/if}
          </span>
          <span class="ml-auto flex items-center gap-1.5 shrink-0">
            {#if hasTools}
              {@const bk = getTurnBreakdown(turn)}
              <span class="flex items-center gap-1 text-[10px]">
                {#if bk.reads > 0}<span class="text-[hsl(var(--miwarp-status-info)/0.7)]"
                    >{bk.reads}R</span
                  >{/if}
                {#if bk.searches > 0}<span class="text-[hsl(var(--miwarp-accent-violet)/0.7)]"
                    >{bk.searches}S</span
                  >{/if}
                {#if bk.bash > 0}<span class="text-[hsl(var(--miwarp-status-success)/0.7)]"
                    >{bk.bash}B</span
                  >{/if}
                {#if bk.writes > 0}<span class="text-[hsl(var(--miwarp-status-warning)/0.7)]"
                    >{bk.writes}W</span
                  >{/if}
                <span class="px-1 py-0.5 rounded-full bg-muted text-muted-foreground font-medium"
                  >{countToolNodes(turn.tools)}</span
                >
              </span>
            {/if}
            {#if turnHasError}
              <span class="text-[hsl(var(--miwarp-status-error)/0.7)]">
                <StatusIcon status="error" size="xs" />
              </span>
            {/if}
          </span>
        </button>
        {#if turn.anchorId}
          <button
            type="button"
            class="shrink-0 ml-1 p-0.5 rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
            onclick={() => onScrollToTurn?.(turn.anchorId!)}
            title={t("toolActivity_scrollToTurn")}
          >
            <Icon name="crosshair" size="xs" />
          </button>
        {/if}
      </div>

      <!-- Tools in this turn -->
      {#if hasTools && !isCollapsed}
        <div class="py-0.5">
          {#each turn.tools as node (node.tool.tool_use_id)}
            {@render toolNodeView(node)}
          {/each}
        </div>
      {/if}
    {/each}
  {:else}
    <!-- HookEvent fallback mode (pipe/PTY) -->
    {#each hookToolEvents as event, ei (ei)}
      {@const style = getToolColor(event.tool_name ?? "")}
      {@const detail = getHookDetail(event)}
      {@const cat = categorizeHookStatus(event.status)}
      <div class="px-2.5 py-1">
        <div class="flex items-center gap-1.5">
          {@render statusIcon(cat)}
          <div class="flex h-4 w-4 shrink-0 items-center justify-center rounded {style.bg}">
            <svg
              class="h-2.5 w-2.5 {style.text}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d={style.icon} />
            </svg>
          </div>
          <span class="text-[11px] font-medium text-foreground shrink-0"
            >{event.tool_name ?? event.hook_type}</span
          >
          {#if detail}
            <span class="text-[10px] text-muted-foreground truncate min-w-0">{detail}</span>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>

<!-- Stats footer -->
{#if toolStats.totalToolCount > 0}
  <div class="border-t border-border px-3 py-1.5">
    <div class="flex items-center gap-3 text-[11px]">
      {#if toolStats.doneCount > 0}
        <span class="flex items-center gap-1 text-miwarp-status-success">
          <StatusIcon status="done" size="sm" />
          {toolStats.doneCount}
        </span>
      {/if}
      {#if toolStats.runningCount > 0}
        <span class="flex items-center gap-1 text-muted-foreground">
          <StatusIcon status="running" size="sm" />
          {toolStats.runningCount}
        </span>
      {/if}
      {#if toolStats.errorCount > 0}
        <span class="flex items-center gap-1 text-destructive">
          <StatusIcon status="error" size="sm" />
          {toolStats.errorCount}
        </span>
      {/if}
    </div>
  </div>
{/if}
