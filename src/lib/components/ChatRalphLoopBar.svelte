<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    iteration: number;
    maxIterations: number | null;
    completionPromise: string | null;
    onCancel: () => void;
  }

  let { iteration, maxIterations, completionPromise, onCancel }: Props = $props();
</script>

<div class="mx-auto w-full max-w-3xl px-4 pb-2">
  <div
    class="flex items-center justify-between rounded-lg border border-[hsl(var(--miwarp-status-info)/0.3)] bg-[hsl(var(--miwarp-status-info)/0.1)] px-4 py-2 text-sm"
  >
    <div class="flex items-center gap-2 text-miwarp-status-info">
      <span class="animate-pulse">🔄</span>
      <span class="font-medium">{t("chat_ralphLoop")}</span>
      <span class="text-[hsl(var(--miwarp-status-info)/0.7)]">
        {t("ralphLoop_iteration", { iteration: String(iteration), maxIterations: String(maxIterations || "∞") })}
      </span>
      {#if completionPromise}
        <span class="text-[hsl(var(--miwarp-status-info)/0.5)]">
          · promise: "{completionPromise}"
        </span>
      {/if}
    </div>
    <button
      class="rounded px-2 py-0.5 text-xs text-miwarp-status-error hover:bg-[hsl(var(--miwarp-status-error)/0.2)] transition-colors"
      onclick={onCancel}
    >
      {t("ralphLoop_cancel")}
    </button>
  </div>
</div>
