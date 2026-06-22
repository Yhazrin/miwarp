<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { ConfigTransactionPreview } from "$lib/runtime-control-plane/types";

  let {
    preview,
    applying = false,
    onconfirm,
    oncancel,
  }: {
    preview: ConfigTransactionPreview;
    applying?: boolean;
    onconfirm?: () => void;
    oncancel?: () => void;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
>
  <div class="w-full max-w-lg overflow-hidden rounded-2xl border bg-card shadow-xl">
    <div class="border-b px-5 py-4">
      <h3 class="text-sm font-semibold">{lk("runtime_config_diff_title")}</h3>
      <p class="mt-1 text-xs text-muted-foreground">{lk("runtime_config_diff_description")}</p>
    </div>
    <div class="max-h-80 space-y-2 overflow-auto px-5 py-4">
      {#if preview.diffs.length === 0}
        <p class="text-sm text-muted-foreground">{lk("runtime_config_diff_empty")}</p>
      {:else}
        {#each preview.diffs as diff (diff.key)}
          <div class="rounded-lg border bg-background/60 px-3 py-2 text-xs">
            <div class="font-medium text-foreground">{diff.key}</div>
            <div class="mt-1 grid gap-1 font-mono text-[11px] text-muted-foreground">
              <div>
                <span class="text-destructive/80">{lk("runtime_config_diff_before")}:</span>
                {JSON.stringify(diff.before)}
              </div>
              <div>
                <span class="text-emerald-600 dark:text-emerald-400"
                  >{lk("runtime_config_diff_after")}:</span
                >
                {JSON.stringify(diff.after)}
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
    <div class="flex justify-end gap-2 border-t px-5 py-4">
      <button
        type="button"
        class="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        onclick={() => oncancel?.()}
        disabled={applying}
      >
        {lk("common_cancel")}
      </button>
      <button
        type="button"
        class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        onclick={() => onconfirm?.()}
        disabled={applying || preview.diffs.length === 0}
      >
        {lk("runtime_config_diff_confirm")}
      </button>
    </div>
  </div>
</div>
