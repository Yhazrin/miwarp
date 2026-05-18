<script lang="ts">
  import type { SkillSourceSyncLogEntry } from "$lib/stores/skill-source-store.svelte";
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    entries: SkillSourceSyncLogEntry[];
    maxShown?: number;
  }

  let { entries, maxShown = 12 }: Props = $props();

  let slice = $derived(entries.slice(0, maxShown));

  function lineClass(kind: SkillSourceSyncLogEntry["kind"]) {
    switch (kind) {
      case "success":
        return "text-emerald-600 dark:text-emerald-400";
      case "error":
        return "text-destructive";
      default:
        return "text-muted-foreground";
    }
  }
</script>

<div class="rounded-xl border border-border/40 bg-muted/30 p-3 space-y-2">
  <h4 class="text-xs font-medium text-muted-foreground">{t("skillSources_sync_log")}</h4>
  {#if slice.length === 0}
    <p class="text-[11px] text-muted-foreground">{t("skillSources_sync_log_empty")}</p>
  {:else}
    <ul class="space-y-1 max-h-48 overflow-y-auto text-[11px] font-mono">
      {#each slice as row}
        <li class="{lineClass(row.kind)}">
          <span class="opacity-60">{new Date(row.ts).toLocaleTimeString()}</span>
          —
          {row.detail}
        </li>
      {/each}
    </ul>
  {/if}
</div>
