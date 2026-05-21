<!--
  FileCard Component

  A rich media file card component inspired by Claude Code Cowork's
  present_files tool. Displays file metadata with type-specific icons,
  size, and date, along with action buttons.

  Supports file types:
  - image: Preview thumbnails
  - document: PDF, DOC, etc.
  - code: Source code files
  - other: Generic file icon
-->
<script lang="ts">
  interface Props {
    file: {
      name: string;
      path: string;
      size?: number;
      modifiedAt?: string;
      type?: "image" | "document" | "code" | "other";
    };
    onOpen?: () => void;
    onDelete?: () => void;
    onCopy?: () => void;
    showActions?: boolean;
    compact?: boolean;
  }

  let { file, onOpen, onDelete, onCopy, showActions = true, compact = false }: Props = $props();

  const iconMap: Record<string, string> = {
    image: "🖼️",
    document: "📄",
    code: "💻",
    other: "📁",
  };

  const fileType = $derived(file.type || detectFileType(file.name));

  function detectFileType(name: string): "image" | "document" | "code" | "other" {
    const ext = name.split(".").pop()?.toLowerCase() || "";

    const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
    const docExts = ["pdf", "doc", "docx", "txt", "md", "rtf", "odt"];
    const codeExts = [
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "rs",
      "go",
      "java",
      "c",
      "cpp",
      "h",
      "css",
      "scss",
      "html",
      "svelte",
      "vue",
      "json",
      "yaml",
      "yml",
      "toml",
      "sh",
      "bash",
      "zsh",
      "sql",
      "rb",
      "php",
      "swift",
      "kt",
      "scala",
    ];

    if (imageExts.includes(ext)) return "image";
    if (docExts.includes(ext)) return "document";
    if (codeExts.includes(ext)) return "code";
    return "other";
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  }

  function handleOpen(e: MouseEvent) {
    e.stopPropagation();
    onOpen?.();
  }

  function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    onCopy?.();
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    onDelete?.();
  }
</script>

<div
  class="file-card group flex items-center gap-3 p-3 rounded-xl border border-border/40
         bg-card/30 hover:bg-card/50 hover:border-border/60 transition-all
         {compact ? 'p-2' : ''}"
  class:cursor-pointer={onOpen}
  role={onOpen ? "button" : undefined}
  tabindex={onOpen ? 0 : undefined}
  onclick={onOpen}
  onkeydown={(e) => {
    if (onOpen && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onOpen();
    }
  }}
>
  <!-- File Icon -->
  <button
    class="file-icon shrink-0 flex items-center justify-center w-10 h-10 rounded-lg
           bg-muted/50 hover:bg-muted transition-colors
           {onOpen ? 'cursor-pointer' : 'cursor-default'}"
    onclick={handleOpen}
    disabled={!onOpen}
    title={onOpen ? "打开文件" : file.name}
  >
    {#if fileType === "image" && file.path}
      <img
        src={file.path}
        alt={file.name}
        class="w-full h-full object-cover rounded-lg"
        loading="lazy"
      />
    {:else}
      <span class="text-xl">{iconMap[fileType]}</span>
    {/if}
  </button>

  <!-- File Info -->
  <div class="flex-1 min-w-0">
    <span class="file-name block text-sm font-medium text-foreground truncate">
      {file.name}
    </span>
    <span class="file-meta flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
      {#if file.size}
        <span>{formatSize(file.size)}</span>
      {/if}
      {#if file.size && file.modifiedAt}
        <span class="opacity-50">·</span>
      {/if}
      {#if file.modifiedAt}
        <span>{formatDate(file.modifiedAt)}</span>
      {/if}
    </span>
  </div>

  <!-- Actions -->
  {#if showActions}
    <div
      class="file-actions flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      {#if onOpen}
        <button
          class="action-btn flex items-center justify-center w-7 h-7 rounded-md
                 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onclick={handleOpen}
          title="打开"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 2h6l3 3v9H3V2z"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <path d="M11 2v4h4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}

      {#if onCopy}
        <button
          class="action-btn flex items-center justify-center w-7 h-7 rounded-md
                 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onclick={handleCopy}
          title="复制路径"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
            <rect
              x="5"
              y="5"
              width="8"
              height="8"
              rx="1.5"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path
              d="M3 11V3a1 1 0 011-1h8"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      {/if}

      {#if onDelete}
        <button
          class="action-btn flex items-center justify-center w-7 h-7 rounded-md
                 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          onclick={handleDelete}
          title="删除"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M6.5 7v5M9.5 7v5M3.5 4l1 10h7l1-10"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .file-card:focus-visible {
    outline: 2px solid var(--ring, hsl(var(--primary)));
    outline-offset: 2px;
  }
</style>
