<script lang="ts">
  import type { MediaArtifact } from "$lib/types";
  import { showToast } from "$lib/stores/toast-store.svelte";

  let { artifact }: { artifact: MediaArtifact } = $props();

  const FILE_ICONS: Record<string, string> = {
    default: "📄",
    document: "📝",
    spreadsheet: "📊",
    archive: "📦",
    code: "💻",
  };

  function getIcon(mimeType: string): string {
    if (mimeType.startsWith("text/")) return FILE_ICONS.document;
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
      return FILE_ICONS.spreadsheet;
    if (mimeType.includes("zip") || mimeType.includes("tar")) return FILE_ICONS.archive;
    if (mimeType.includes("javascript") || mimeType.includes("json")) return FILE_ICONS.code;
    return FILE_ICONS.default;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(artifact.path);
      showToast("Path copied", "success");
    } catch {
      showToast(artifact.path, "info");
    }
  }
</script>

<div
  class="file-artifact-card flex items-center gap-2 rounded-lg border border-border px-3 py-2 max-w-sm"
>
  <span class="text-2xl shrink-0">{getIcon(artifact.mimeType)}</span>
  <div class="flex-1 min-w-0">
    <div class="text-xs font-medium text-foreground truncate">{artifact.name}</div>
    <div class="text-[10px] text-muted-foreground">
      {artifact.mimeType} · {formatBytes(artifact.size)}
    </div>
  </div>
  <button class="shrink-0 text-xs text-primary hover:underline" onclick={copyPath}> Copy </button>
</div>
