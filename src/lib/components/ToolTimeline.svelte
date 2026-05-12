<script lang="ts">
  /**
   * ToolTimeline - Alternative timeline view for tool calls.
   * Shows tool calls as nodes on a vertical timeline with status colors.
   */

  interface ToolCall {
    id: string;
    name: string;
    status: "running" | "completed" | "failed" | "pending";
    startTime?: string;
    duration?: number;
    summary?: string;
  }

  interface Props {
    /** Array of tool calls to display */
    tools: ToolCall[];
    /** Currently expanded tool ID */
    expandedId?: string;
    /** Callback when a tool is selected */
    onSelect?: (id: string) => void;
  }

  let { tools, expandedId = "", onSelect }: Props = $props();

  function getStatusColor(status: ToolCall["status"]): string {
    switch (status) {
      case "running":
        return "hsl(var(--miwarp-accent-blue))";
      case "completed":
        return "hsl(var(--miwarp-status-success))";
      case "failed":
        return "hsl(var(--miwarp-status-error))";
      case "pending":
        return "hsl(var(--miwarp-text-tertiary))";
    }
  }

  function getStatusIcon(status: ToolCall["status"]): string {
    switch (status) {
      case "running":
        return "&#9679;"; // circle
      case "completed":
        return "&#10003;"; // checkmark
      case "failed":
        return "&#10007;"; // X
      case "pending":
        return "&#9675;"; // hollow circle
    }
  }

  function formatDuration(ms?: number): string {
    if (!ms) return "";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<div class="tool-timeline relative pl-6">
  <!-- Vertical connecting line -->
  <div
    class="absolute left-[11px] top-0 bottom-0 w-0.5"
    style="background: linear-gradient(
      180deg,
      hsl(var(--miwarp-accent-primary) / 0.3),
      hsl(var(--miwarp-accent-violet) / 0.1)
    );"
  ></div>

  {#each tools as tool, i (tool.id)}
    {@const isExpanded = expandedId === tool.id}
    {@const statusColor = getStatusColor(tool.status)}
    <div
      class="relative mb-3 cursor-pointer"
      role="button"
      tabindex="0"
      onclick={() => onSelect?.(tool.id)}
      onkeydown={(e) => e.key === "Enter" && onSelect?.(tool.id)}
    >
      <!-- Status node -->
      <div
        class="absolute -left-6 top-1.5 z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 text-[10px]"
        style="
          border-color: {statusColor};
          background: hsl(var(--miwarp-bg-deep));
          color: {statusColor};
          {tool.status === 'running' ? 'box-shadow: 0 0 8px ' + statusColor + '40;' : ''}
        "
      >
        {@html getStatusIcon(tool.status)}
      </div>

      <!-- Content card -->
      <div
        class="rounded-lg border px-3 py-2 transition-all duration-200"
        style="
          background: {isExpanded
          ? 'hsl(var(--miwarp-bg-elevated))'
          : 'hsl(var(--miwarp-bg-surface))'};
          border-color: {isExpanded
          ? 'hsl(var(--miwarp-accent-primary) / 0.3)'
          : 'hsl(var(--border))'};
          {isExpanded ? 'box-shadow: 0 0 12px hsla(239, 84%, 67%, 0.1);' : ''}
        "
      >
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-miwarp-text-primary">
            {tool.name}
          </span>
          <div class="flex items-center gap-2">
            {#if tool.duration}
              <span class="text-xs text-miwarp-text-tertiary">
                {formatDuration(tool.duration)}
              </span>
            {/if}
            {#if tool.startTime}
              <span class="text-xs text-miwarp-text-tertiary">
                {tool.startTime}
              </span>
            {/if}
          </div>
        </div>

        <!-- Summary (when expanded) -->
        {#if isExpanded && tool.summary}
          <div class="mt-2 border-t border-border pt-2">
            <p class="text-xs text-miwarp-text-secondary leading-relaxed">
              {tool.summary}
            </p>
          </div>
        {/if}
      </div>
    </div>
  {/each}

  <!-- Empty state -->
  {#if tools.length === 0}
    <div class="py-8 text-center">
      <p class="text-sm text-miwarp-text-tertiary">No tool calls yet</p>
    </div>
  {/if}
</div>
