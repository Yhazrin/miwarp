<!--
  SplitPaneTimelineView — read-only timeline for inactive split panes.
  Renders user/assistant messages and compact tool rows from a cached snapshot.
-->
<script lang="ts">
  import type { TimelineEntry } from "$lib/types";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let {
    timeline,
    renderLimit = 200,
  }: {
    timeline: TimelineEntry[];
    renderLimit?: number;
  } = $props();

  const visible = $derived(timeline.slice(-renderLimit));
  const hiddenCount = $derived(Math.max(0, timeline.length - visible.length));
</script>

<div class="flex h-full flex-col min-h-0">
  {#if hiddenCount > 0}
    <p class="shrink-0 border-b border-border/30 px-3 py-1.5 text-[10px] text-muted-foreground">
      {t("split_mode_snapshotTruncated", { count: String(hiddenCount) })}
    </p>
  {/if}
  <div class="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
    {#if visible.length === 0}
      <p class="text-center text-xs text-muted-foreground py-8">{t("split_mode_emptyPane")}</p>
    {:else}
      {#each visible as entry (entry.id)}
        {#if entry.kind === "user"}
          <div class="rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <MarkdownContent text={entry.content} />
          </div>
        {:else if entry.kind === "assistant"}
          <div class="rounded-lg border border-border/30 px-3 py-2 text-sm">
            <MarkdownContent text={entry.content} />
          </div>
        {:else if entry.kind === "tool"}
          <div
            class="flex items-center gap-2 rounded-md border border-border/20 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground"
          >
            <Icon name="wrench" size="xs" />
            <span class="truncate">{entry.tool.tool_name}</span>
            <span class="ml-auto shrink-0 uppercase tracking-wide">{entry.tool.status}</span>
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>
