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
    class="flex items-center justify-between rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm"
  >
    <div class="flex items-center gap-2 text-blue-400">
      <span class="animate-pulse">🔄</span>
      <span class="font-medium">{t("chat_ralphLoop")}</span>
      <span class="text-blue-400/70">
        iteration {iteration}/{maxIterations || "∞"}
      </span>
      {#if completionPromise}
        <span class="text-blue-400/50">
          · promise: "{completionPromise}"
        </span>
      {/if}
    </div>
    <button
      class="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
      onclick={onCancel}
    >
      Cancel
    </button>
  </div>
</div>
