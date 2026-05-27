<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { fade } from "svelte/transition";

  interface Props {
    pageDragActive: boolean;
    dragProcessing: boolean;
  }

  let { pageDragActive, dragProcessing }: Props = $props();
</script>

{#if pageDragActive || dragProcessing}
  <div
    class="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-[2px]"
    transition:fade={{ duration: 200 }}
    class:pointer-events-none={pageDragActive && !dragProcessing}
  >
    <div
      class="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 px-12 py-8"
    >
      {#if dragProcessing}
        <svg
          class="h-8 w-8 text-primary/60 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span class="text-sm font-medium text-primary/70">{t("drag_processing")}</span>
      {:else}
        <svg
          class="h-8 w-8 text-primary/60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" x2="12" y1="3" y2="15" />
        </svg>
        <span class="text-sm font-medium text-primary/70">{t("prompt_dropFiles")}</span>
      {/if}
    </div>
  </div>
{/if}
