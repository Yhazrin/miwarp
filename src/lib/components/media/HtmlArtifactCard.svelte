<script lang="ts">
  import type { MediaArtifact } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";

  let { artifact }: { artifact: MediaArtifact } = $props();

  let showPreview = $state(false);

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<div class="html-artifact-card rounded-lg border border-border overflow-hidden">
  <div class="px-3 py-2 bg-muted/30 flex items-center justify-between">
    <div class="flex items-center gap-2 min-w-0">
      <svg
        class="h-4 w-4 text-muted-foreground shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
      <div class="min-w-0">
        <div class="text-xs text-foreground truncate">{artifact.name}</div>
        <div class="text-[10px] text-muted-foreground">{formatBytes(artifact.size)}</div>
      </div>
    </div>
    <button type="button"
      class="shrink-0 text-xs text-primary hover:underline ml-2"
      onclick={() => (showPreview = !showPreview)}
    >
      {showPreview ? t("htmlArtifact_hide") : t("htmlArtifact_preview")}
    </button>
  </div>
  {#if showPreview && artifact.contentBase64}
    <iframe
      srcdoc={atob(artifact.contentBase64)}
      class="w-full h-64 border-t border-border"
      sandbox="allow-scripts"
      title={artifact.name}
    ></iframe>
  {/if}
</div>
