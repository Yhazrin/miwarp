<script lang="ts">
  import type { BusToolItem } from "$lib/types";
  import { getToolColor } from "$lib/utils/tool-colors";
  import { getToolSummary } from "$lib/utils/tool-summaries";
  import { getToolDetail, friendlyToolName } from "$lib/utils/tool-rendering";
  import StatusIcon from "$lib/components/StatusIcon.svelte";
  import { guidedToolRowStatusIconKind } from "$lib/utils/process-visibility";

  let { tool }: { tool: BusToolItem } = $props();

  let style = $derived(getToolColor(tool.tool_name));
  let label = $derived(friendlyToolName(tool.tool_name));
  let detail = $derived(getToolDetail(tool.input));
  let summary = $derived(
    getToolSummary(
      tool.tool_name,
      tool.input || {},
      tool.tool_use_result as Record<string, unknown> | undefined,
    ),
  );
  let line = $derived((summary || detail || "").trim());
  let iconKind = $derived(guidedToolRowStatusIconKind(tool));
  let statusIcon = $derived.by((): "done" | "error" | "running" | "other" => {
    if (iconKind === "done") return "done";
    if (iconKind === "error") return "error";
    if (iconKind === "running") return "running";
    return "other";
  });
</script>

<div
  class="motion-slide-up rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-xs shadow-sm"
  data-guided-tool-row
>
  <div class="flex min-w-0 items-center gap-2">
    <span
      class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-foreground/5 text-[10px] font-semibold {style.text}"
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
    <span class="min-w-0 truncate font-medium text-foreground">{label}</span>
    <StatusIcon status={statusIcon} size="sm" />
  </div>
  {#if line}
    <p class="mt-1 pl-7 text-[11px] leading-snug text-muted-foreground line-clamp-2">
      {line}
    </p>
  {/if}
</div>
