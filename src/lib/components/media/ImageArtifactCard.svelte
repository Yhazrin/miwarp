<script lang="ts">
  import type { MediaArtifact } from "$lib/types";
  // import { t } from "$lib/i18n/index.svelte";

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
    onkeydown={(e) => e.key === "Enter" && (showModal = true)}
  >
    <img
      src="data:{artifact.mimeType};base64,{artifact.contentBase64}"
      alt={artifact.name}
      class="max-h-48 max-w-xs rounded-lg border border-border object-contain transition-opacity opacity-0"
      class:opacity-100={loaded}
      onload={() => (loaded = true)}
      loading="lazy"
    />
    {#if !loaded}
      <div class="absolute inset-0 flex items-center justify-center bg-muted/30 rounded-lg">
        <div
          class="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin"
        ></div>
      </div>
    {/if}
    <div
      class="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded truncate max-w-[120px]"
    >
      {artifact.name}
    </div>
  </div>

  {#if showModal}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onclick={() => (showModal = false)}
      role="dialog"
      aria-modal="true"
    >
      <button
        class="absolute top-4 right-4 text-white/80 hover:text-white"
        onclick={() => (showModal = false)}
        aria-label="Close preview"
      >
        <svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <img
        src="data:{artifact.mimeType};base64,{artifact.contentBase64}"
        alt={artifact.name}
        class="max-w-[90vw] max-h-[90vh] object-contain"
        onclick={(e) => e.stopPropagation()}
        role="presentation"
      />
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-xs">
        {artifact.name} · {formatBytes(artifact.size)}
      </div>
    </div>
  {/if}
{/if}
