<script lang="ts">
  import type { BusToolItem } from "$lib/types";
  import { aggregateBatchStatus } from "$lib/utils/tool-rendering";
  import { dbg } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  let { tools }: { tools: BusToolItem[] } = $props();

  // Single-pass aggregation
  let stats = $derived(aggregateBatchStatus(tools));
  let allDone = $derived(stats.total > 0 && stats.completed + stats.failed === stats.total);

  // Debug: signature-based dedup
  let _lastDbgSig = "";
  $effect(() => {
    const sig = `${stats.total}:${stats.completed}:${stats.running}:${stats.failed}`;
    if (sig !== _lastDbgSig) {
      _lastDbgSig = sig;
      dbg("batch", "progress", stats);
    }
  });
</script>

<div class="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
  <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
    {#if allDone}
      <Icon name="check" size="xs" class="text-miwarp-status-success shrink-0" />
    {:else if stats.running > 0}
      <span class="inline-block h-1.5 w-1.5 rounded-full bg-miwarp-status-info animate-pulse shrink-0"></span>
    {/if}
    <span>
      {t("batch_status", {
        completed: String(stats.completed),
        total: String(stats.total),
        running: String(stats.running),
      })}
    </span>
    {#if stats.failed > 0}
      <span>·</span>
      <span class="text-destructive">
        {t("batch_failed", { failed: String(stats.failed) })}
      </span>
    {/if}
  </div>
  <div class="mt-1.5 h-1.5 rounded-full bg-border/30 overflow-hidden flex">
    {#if stats.completed > 0}
      <div
        class="bg-miwarp-status-success transition-all duration-300"
        style:width="{(stats.completed / stats.total) * 100}%"
      ></div>
    {/if}
    {#if stats.failed > 0}
      <div
        class="bg-destructive transition-all duration-300"
        style:width="{(stats.failed / stats.total) * 100}%"
      ></div>
    {/if}
  </div>
</div>
