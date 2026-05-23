<script lang="ts">
  import type { GitTimelineEntry } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import GitTimelineNode from "./GitTimelineNode.svelte";

  let {
    entries = [],
    loading = false,
    error = null as string | null,
    initialVisibleCount = 6,
  }: {
    entries?: GitTimelineEntry[];
    loading?: boolean;
    error?: string | null;
    initialVisibleCount?: number;
  } = $props();

  const DEFAULT_VISIBLE = $derived(initialVisibleCount);
  let visibleCount = $state(0);
  let isExpanded = $state(false);

  const visibleEntries = $derived(isExpanded ? entries : entries.slice(0, visibleCount));
  const remainingCount = $derived(isExpanded ? 0 : Math.max(0, entries.length - visibleCount));
  const hasMore = $derived(remainingCount > 0);

  function showMore() {
    if (isExpanded) {
      isExpanded = false;
    } else {
      isExpanded = true;
    }
  }

  // Reset visible count when entries change
  $effect(() => {
    if (entries.length > 0) {
      visibleCount = DEFAULT_VISIBLE;
      isExpanded = false;
    }
  });
</script>

<div class="px-3 py-2">
  {#if loading}
    <div class="flex items-center gap-2 py-3 text-[11px] text-muted-foreground">
      <span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-pulse"></span>
      {t("gitWorktree_loading")}
    </div>
  {:else if error}
    <p class="py-2 text-[11px] text-red-500/80">{error}</p>
  {:else if entries.length === 0}
    <p class="py-2 text-[11px] text-muted-foreground">{t("gitWorktree_timeline_empty")}</p>
  {:else}
    <!-- No internal scroll - use "show more" button instead -->
    <div class="git-timeline-list space-y-0" role="list">
      {#each visibleEntries as entry, i (entry.id)}
        <GitTimelineNode {entry} isLast={i === visibleEntries.length - 1 && !hasMore} />
      {/each}
    </div>

    <!-- Show more button instead of internal scroll -->
    {#if hasMore || isExpanded}
      <button
        type="button"
        class="mt-2 w-full py-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/30 rounded-md transition-colors"
        onclick={showMore}
      >
        {isExpanded
          ? t("gitWorktree_collapse")
          : t("gitWorktree_show_more", { count: String(remainingCount) })}
      </button>
    {/if}
  {/if}
</div>
