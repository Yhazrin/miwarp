<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { WorkspaceListEntry } from "$lib/types/workspace";
  import { relativeTime } from "$lib/utils/format";

  let {
    entries,
    selectedCwd = "",
    loading = false,
    onSelect,
  }: {
    entries: WorkspaceListEntry[];
    selectedCwd?: string;
    loading?: boolean;
    onSelect: (cwd: string) => void;
  } = $props();

  function displayLabel(entry: WorkspaceListEntry): string {
    if (entry.isUncategorized) return t("workspace_uncategorized");
    return entry.label || entry.cwd;
  }
</script>

<div class="flex h-full flex-col border-r border-border">
  <div class="shrink-0 border-b border-border px-4 py-3">
    <h2 class="text-sm font-semibold text-foreground">{t("workspace_list_title")}</h2>
    <p class="mt-0.5 text-xs text-muted-foreground">{t("workspace_list_subtitle")}</p>
  </div>

  <div class="flex-1 overflow-y-auto p-2">
    {#if loading && entries.length === 0}
      <div class="px-3 py-6 text-xs text-muted-foreground">{t("common_loading")}</div>
    {:else if entries.length === 0}
      <div class="px-3 py-6 text-xs text-muted-foreground">{t("workspace_empty_list")}</div>
    {:else}
      <ul class="space-y-1">
        {#each entries as entry (entry.folderKey)}
          <li>
            <button
              type="button"
              class="w-full rounded-lg border px-3 py-2.5 text-left transition-colors
                {selectedCwd === entry.cwd
                ? 'border-primary/40 bg-primary/10'
                : 'border-transparent hover:border-border hover:bg-muted/40'}"
              onclick={() => onSelect(entry.cwd)}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-foreground">
                    {displayLabel(entry)}
                  </p>
                  {#if !entry.isUncategorized}
                    <p
                      class="truncate font-mono text-[10px] text-muted-foreground"
                      title={entry.cwd}
                    >
                      {entry.cwd}
                    </p>
                  {/if}
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  {#if entry.failedCount > 0}
                    <span
                      class="rounded-full bg-[hsl(var(--miwarp-status-error)/0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--miwarp-status-error))]"
                      title={t("workspace_failed")}
                    >
                      {entry.failedCount}
                    </span>
                  {/if}
                  {#if entry.attentionCount > 0}
                    <span
                      class="rounded-full bg-[hsl(var(--miwarp-status-warning)/0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--miwarp-status-warning))]"
                      title={t("workspace_waiting")}
                    >
                      {entry.attentionCount}
                    </span>
                  {/if}
                  {#if entry.runningCount > 0}
                    <span
                      class="h-2 w-2 rounded-full bg-[hsl(var(--miwarp-status-info))]"
                      title={t("workspace_running")}
                    ></span>
                  {/if}
                </div>
              </div>
              <div
                class="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
              >
                <span>{entry.conversationCount} {t("workspace_sessions_count")}</span>
                {#if entry.latestActivityAt}
                  <span>{relativeTime(entry.latestActivityAt)}</span>
                {/if}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
