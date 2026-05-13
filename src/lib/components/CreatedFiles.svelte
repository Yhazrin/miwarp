<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  interface FileEntry {
    path: string;
    name: string;
  }

  let {
    files,
    onOpenFile,
  }: {
    files: FileEntry[];
    onOpenFile?: (path: string) => void;
  } = $props();

  function getDirPath(path: string): string {
    const parts = path.split("/");
    parts.pop();
    return parts.join("/") || "/";
  }

  function getFileIcon(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const iconMap: Record<string, string> = {
      ts: "📘",
      tsx: "📘",
      js: "📒",
      jsx: "📒",
      svelte: "✨",
      css: "🎨",
      scss: "🎨",
      html: "🌐",
      json: "📋",
      md: "📝",
      py: "🐍",
      rs: "🦀",
      go: "🔵",
      java: "☕",
      txt: "📄",
      yml: "⚙️",
      yaml: "⚙️",
      toml: "📦",
    };
    return iconMap[ext] || "📄";
  }
</script>

{#if files.length > 0}
  <div
    class="mt-4 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--muted)/0.3)] p-3"
  >
    <div class="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <svg
        class="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
      <span>{t("createdFiles_title", { count: String(files.length) })}</span>
    </div>
    <div class="flex flex-wrap gap-2">
      {#each files as file}
        <button
          class="group flex items-center gap-1.5 rounded-md border border-[hsl(var(--border)/0.3)] bg-[hsl(var(--background))] px-2.5 py-1.5 text-xs transition-all hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--primary)/0.08)]"
          onclick={() => onOpenFile?.(file.path)}
          title={file.path}
        >
          <span class="text-sm">{getFileIcon(file.name)}</span>
          <span class="font-medium text-foreground group-hover:text-[hsl(var(--primary))]"
            >{file.name}</span
          >
          <span class="text-[hsl(var(--muted-foreground))]">{getDirPath(file.path)}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}
