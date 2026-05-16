<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    x: number;
    y: number;
    path: string;
    label: string;
    onRename: (path: string, label: string) => void;
    onDuplicate: (path: string) => void;
    onClose: () => void;
  }

  let { x, y, path, label, onRename, onDuplicate, onClose }: Props = $props();

  function handleRename() {
    onRename(path, label);
    onClose();
  }

  function handleDuplicate() {
    onDuplicate(path);
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest("[data-memory-context-menu]")) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

<div
  data-memory-context-menu
  class="fixed z-[100] min-w-[140px] rounded-md border bg-popover p-1 shadow-md"
  style="left: {x}px; top: {y}px;"
>
  <button
    class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent transition-colors"
    onclick={handleRename}
  >
    <svg
      class="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
    {t("memory_rename")}
  </button>
  <button
    class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent transition-colors"
    onclick={handleDuplicate}
  >
    <svg
      class="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
    {t("memory_duplicate")}
  </button>
</div>
