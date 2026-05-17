<script lang="ts">
  import type { BusToolItem } from "$lib/types";
  import { getToolColor } from "$lib/utils/tool-colors";
  import { getToolSummary } from "$lib/utils/tool-summaries";

  let { tool }: { tool: BusToolItem } = $props();

  let style = $derived(getToolColor(tool.tool_name));
  let summary = $derived(
    getToolSummary(
      tool.tool_name,
      (tool.input ?? {}) as Record<string, unknown>,
      tool.tool_use_result as Record<string, unknown> | undefined,
    ),
  );
</script>

<!-- Output-mode running tools: stable one-line row (no motion-status flash on complete). -->
<div class="w-full py-1" id="tool-{tool.tool_use_id}">
  <div class="chat-content-width">
    <div
      class="flex min-h-[2.25rem] items-center gap-2 rounded-lg border border-border/45 bg-muted/15 px-3 py-1.5"
    >
      <div
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}"
        aria-hidden="true"
      >
        <svg
          class="h-3 w-3 {style.text}"
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
      <span class="shrink-0 text-xs font-medium text-foreground">{tool.tool_name}</span>
      <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
      <div
        class="h-3 w-3 shrink-0 rounded-full border-2 border-border border-t-muted-foreground animate-spin"
        aria-hidden="true"
      ></div>
    </div>
  </div>
</div>
