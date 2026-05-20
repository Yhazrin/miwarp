<script lang="ts">
  import type { MediaArtifact } from "$lib/types";

  let { artifact }: { artifact: MediaArtifact } = $props();

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<div
  class="audio-artifact-card flex items-center gap-3 rounded-lg border border-border px-3 py-2 max-w-sm"
>
  <svg
    class="h-8 w-8 text-muted-foreground shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
  <div class="flex-1 min-w-0">
    <div class="text-xs text-foreground truncate font-medium">{artifact.name}</div>
    <div class="text-[10px] text-muted-foreground">{formatBytes(artifact.size)}</div>
  </div>
  {#if artifact.contentBase64}
    <audio controls preload="metadata" class="flex-1 min-w-0">
      <source src="data:{artifact.mimeType};base64,{artifact.contentBase64}" />
    </audio>
  {/if}
</div>
