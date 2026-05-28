<script lang="ts">
  import type { MediaArtifact } from "$lib/types";
  import { fade, scale } from "svelte/transition";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";

  let { artifact }: { artifact: MediaArtifact } = $props();

  let showModal = $state(false);
  let loaded = $state(false);

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

{#if artifact.contentBase64}
  <div
    class="image-artifact-card group cursor-pointer"
    onclick={() => (showModal = true)}
    role="button"
    tabindex="0"
    aria-label={artifact.name}
    onkeydown={(e) => e.key === "Enter" && (showModal = true)}
  >
    <img
      src="data:{artifact.mimeType};base64,{artifact.contentBase64}"
      alt={artifact.name}
      class="max-h-48 max-w-xs rounded-lg border border-border object-contain transition-opacity transition-transform duration-200 hover:scale-[1.02] opacity-0"
      class:opacity-100={loaded}
      onload={() => (loaded = true)}
      loading="lazy"
    />
    {#if !loaded}
      <div class="absolute inset-0 flex items-center justify-center bg-muted/30 rounded-lg">
        <Spinner size="md" class="border-primary border-t-transparent" />
      </div>
    {/if}
    <div
      class="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-miwarp-overlay text-miwarp-text-primary text-[10px] px-1.5 py-0.5 rounded truncate max-w-[120px]"
    >
      {artifact.name}
    </div>
  </div>

  {#if showModal}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--miwarp-bg-deepest)/0.9)]"
      transition:fade={{ duration: 200 }}
      onclick={() => (showModal = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") showModal = false;
      }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <button type="button"
        class="absolute top-4 right-4 text-[hsl(var(--miwarp-text-primary)/0.8)] hover:text-miwarp-text-primary"
        onclick={() => (showModal = false)}
        aria-label={t("imageArtifact_closePreview")}
      >
        <Icon name="x" class="h-8 w-8" />
      </button>
      <img
        src="data:{artifact.mimeType};base64,{artifact.contentBase64}"
        alt={artifact.name}
        class="max-w-[90vw] max-h-[90vh] object-contain"
        transition:scale={{ start: 0.95, duration: 200 }}
        onclick={(e) => e.stopPropagation()}
        role="presentation"
      />
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-[hsl(var(--miwarp-text-primary)/0.6)] text-xs">
        {artifact.name} · {formatBytes(artifact.size)}
      </div>
    </div>
  {/if}
{/if}
