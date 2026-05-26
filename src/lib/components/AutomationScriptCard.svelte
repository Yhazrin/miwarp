<script lang="ts">
  /**
   * Automation Script Card Component
   *
   * Displays an automation script with quick actions.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { AutomationScript } from "$lib/types/automation";
  import { getCategoryInfo } from "$lib/types/automation";

  interface Props {
    script: AutomationScript;
    onSelect?: (script: AutomationScript) => void;
    onExecute?: (script: AutomationScript) => void;
    onEdit?: (script: AutomationScript) => void;
    onDelete?: (script: AutomationScript) => void;
    onDuplicate?: (script: AutomationScript) => void;
  }

  let { script, onSelect, onExecute, onEdit, onDelete, onDuplicate }: Props = $props();

  let showMenu = $state(false);

  const categoryInfo = $derived(getCategoryInfo(script.category));

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }
</script>

<div
  class="group relative rounded-lg border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md"
  role="button"
  tabindex="0"
  onclick={() => onSelect?.(script)}
  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(script); } }}
>
  <!-- Header -->
  <div class="flex items-start justify-between gap-3">
    <div class="flex items-center gap-2">
      <span class="text-xl">{categoryInfo.icon}</span>
      <div>
        <div class="font-medium">{script.name}</div>
        <div class="text-xs text-muted-foreground">
          {categoryInfo.label}
        </div>
      </div>
    </div>

    <!-- Status badge -->
    <span
      class="rounded-full px-2 py-0.5 text-[10px] font-medium
        {script.status === 'running'
        ? 'bg-primary/20 text-primary animate-pulse'
        : script.status === 'failed'
          ? 'bg-destructive/20 text-destructive'
          : 'bg-accent text-accent-foreground'}"
    >
      {script.status}
    </span>
  </div>

  <!-- Description -->
  {#if script.description}
    <p class="mt-2 text-sm text-muted-foreground line-clamp-2">
      {script.description}
    </p>
  {/if}

  <!-- Stats -->
  <div class="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
    <span class="flex items-center gap-1">
      <span>📋</span>
      {script.steps.length} steps
    </span>
    <span class="flex items-center gap-1">
      <span>▶</span>
      {script.usageCount} runs
    </span>
    {#if script.lastRunAt}
      <span class="flex items-center gap-1">
        <span>🕐</span>
        {formatDate(script.lastRunAt)}
      </span>
    {/if}
  </div>

  <!-- Tags -->
  {#if script.tags && script.tags.length > 0}
    <div class="mt-2 flex flex-wrap gap-1">
      {#each script.tags.slice(0, 3) as tag}
        <span class="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
          {tag}
        </span>
      {/each}
      {#if script.tags.length > 3}
        <span class="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
          +{script.tags.length - 3}
        </span>
      {/if}
    </div>
  {/if}

  <!-- Actions -->
  <div class="mt-3 flex items-center gap-2">
    <button
      class="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      onclick={(e) => {
        e.stopPropagation();
        onExecute?.(script);
      }}
    >
      ▶ Run
    </button>
    <button
      class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
      onclick={(e) => {
        e.stopPropagation();
        onEdit?.(script);
      }}
    >
      Edit
    </button>

    <!-- More menu -->
    <div class="relative">
      <button
        class="rounded-md p-1.5 hover:bg-accent transition-colors"
        aria-label="More options"
        onclick={(e) => {
          e.stopPropagation();
          showMenu = !showMenu;
        }}
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="6" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="18" r="1.5" />
        </svg>
      </button>

      {#if showMenu}
        <div
          class="absolute right-0 top-full mt-1 z-10 w-32 rounded-lg border bg-popover shadow-lg animate-fade-in"
          role="none"
          onclick={(e) => e.stopPropagation()}
        >
          <button
            class="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
            onclick={() => {
              showMenu = false;
              onDuplicate?.(script);
            }}
          >
            <span>📋</span> Duplicate
          </button>
          <button
            class="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            onclick={() => {
              showMenu = false;
              onDelete?.(script);
            }}
          >
            <span>🗑️</span> Delete
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
