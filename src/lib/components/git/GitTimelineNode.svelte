<script lang="ts">
  import type { GitTimelineEntry } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { relativeTime } from "$lib/utils/format";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import GitBranchPill from "./GitBranchPill.svelte";

  let {
    entry,
    isLast = false,
  }: {
    entry: GitTimelineEntry;
    isLast?: boolean;
  } = $props();

  let hovered = $state(false);

  // Node size: 8px, rail width: 22px
  const RAIL_LEFT = 4;
  const NODE_SIZE = 8;

  const dotClass = $derived.by(() => {
    switch (entry.type) {
      case "working_tree":
        return entry.is_dirty ? "bg-amber-400" : "bg-emerald-400";
      case "branch_ref":
        return "bg-blue-400";
      case "remote_ref":
        return "bg-violet-400";
      case "base":
        return "bg-transparent border border-muted-foreground/30";
      default:
        return "bg-muted-foreground/50";
    }
  });

  const title = $derived.by(() => {
    if (entry.type === "working_tree") {
      return entry.is_dirty
        ? t("gitWorktree_timeline_working")
        : t("gitWorktree_timeline_working_clean");
    }
    return entry.label;
  });

  const pillVariant = $derived(
    entry.type === "remote_ref"
      ? "remote"
      : entry.type === "base"
        ? "base"
        : entry.type === "branch_ref"
          ? "current"
          : "default",
  );

  async function copyHash() {
    const hash = entry.short_hash || entry.hash;
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      showToast(t("gitWorktree_hash_copied"), "success");
    } catch {
      showToast(hash, "info");
    }
  }
</script>

<!-- Compact row: 36-40px height -->
<div
  class="git-timeline-node relative flex items-start gap-2 py-1.5 group"
  role="listitem"
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
>
  <!-- Narrow graph rail: 22px total -->
  <div class="relative shrink-0 w-[22px] flex flex-col items-center">
    <!-- Vertical line -->
    {#if !isLast}
      <div
        class="absolute top-0 bottom-0 w-px bg-border/40"
        style="left: {RAIL_LEFT}px;"
        aria-hidden="true"
      ></div>
    {/if}
    <!-- Node dot: 8px -->
    <div
      class="relative mt-1.5 rounded-full {dotClass} w-2 h-2"
      style="left: {RAIL_LEFT - NODE_SIZE / 2 + 1}px;"
      aria-hidden="true"
    ></div>
  </div>

  <!-- Content: compact row -->
  <div class="min-w-0 flex-1 py-0.5">
    <!-- Main row: message + time -->
    <div class="flex items-baseline gap-1.5 min-w-0">
      {#if entry.type === "working_tree"}
        <!-- Working tree: status -->
        <span class="text-[11px] font-medium text-foreground truncate">
          {title}
        </span>
        {#if entry.is_dirty && entry.changed_files != null}
          <span class="text-[10px] text-muted-foreground shrink-0">
            · {entry.changed_files} files
          </span>
        {/if}
      {:else}
        <!-- Commit: click to copy hash -->
        <button
          type="button"
          class="text-left text-[11px] font-medium text-foreground/85 truncate hover:text-foreground cursor-pointer min-w-0 flex-1"
          title="{title}{entry.author ? '\n' + entry.author + ' · ' : ''}{entry.date
            ? relativeTime(entry.date)
            : ''}"
          onclick={copyHash}
        >
          {title}
        </button>
      {/if}

      <!-- Time: always visible -->
      <span class="text-[10px] text-muted-foreground/60 shrink-0">
        {entry.date ? relativeTime(entry.date) : ""}
      </span>
    </div>

    <!-- Hover row: branch pill + author -->
    {#if hovered && entry.type === "commit"}
      <div class="flex items-center gap-1.5 mt-0.5">
        {#if entry.branch && entry.is_current}
          <GitBranchPill name={entry.branch} variant="current" maxWidth="5rem" />
        {/if}
        {#if entry.author}
          <span class="text-[10px] text-muted-foreground/50 truncate">
            {entry.author}
          </span>
        {/if}
        {#if entry.short_hash}
          <span class="text-[9px] text-muted-foreground/35 font-mono">
            {entry.short_hash}
          </span>
        {/if}
      </div>
    {/if}

    <!-- Branch pill on key nodes: always show -->
    {#if entry.type === "branch_ref" || entry.type === "remote_ref" || entry.type === "base"}
      <div class="mt-0.5">
        <GitBranchPill name={entry.label} variant={pillVariant} maxWidth="100%" />
      </div>
    {/if}
  </div>
</div>
