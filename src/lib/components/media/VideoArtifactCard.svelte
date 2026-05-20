<script lang="ts">
  import type { MediaArtifact } from "$lib/types";

  let { artifact }: { artifact: MediaArtifact } = $props();

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<div class="video-artifact-card rounded-lg border border-border overflow-hidden max-w-sm">
  {#if artifact.contentBase64}
    <video controls preload="metadata" class="w-full max-h-48">
      <source src="data:{artifact.mimeType};base64,{artifact.contentBase64}" />
      Your browser does not support the video tag.
    </video>
  {:else}
    <div class="w-full h-32 flex items-center justify-center bg-muted/30">
      <svg
        class="h-10 w-10 text-muted-foreground/40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    </div>
  {/if}
  <div class="px-3 py-2 bg-muted/30 flex items-center gap-2">
    <svg
      class="h-4 w-4 text-muted-foreground shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
    <div class="flex-1 min-w-0">
      <div class="text-xs text-foreground truncate">{artifact.name}</div>
      <div class="text-[10px] text-muted-foreground">{formatBytes(artifact.size)}</div>
    </div>
  </div>
</div>
