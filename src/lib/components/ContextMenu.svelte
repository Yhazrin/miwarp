<script lang="ts">
  /**
   * Reusable context menu component.
   * Features:
   * - Fixed positioning at x/y
   * - Auto-repositions to stay within viewport
   * - Click outside / Esc to close
   * - Keyboard navigation
   * - Danger variant for destructive actions
   * - Separator support
   */

  export interface MenuItem {
    id: string;
    label: string;
    icon?:
      | "rename"
      | "folder"
      | "copy"
      | "export"
      | "archive"
      | "trash"
      | "pin"
      | "play"
      | "more"
      | "chevron-right";
    danger?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
  }

  let {
    x = 0,
    y = 0,
    items = [],
    onSelect,
    onClose,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
    onSelect: (id: string) => void;
    onClose: () => void;
  } = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let adjustedX = $state(x);
  let adjustedY = $state(y);

  $effect(() => {
    // Adjust position to stay within viewport
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Adjust horizontal
      if (x + rect.width > vw - 8) {
        adjustedX = x - rect.width;
      } else {
        adjustedX = x;
      }

      // Adjust vertical - prefer opening upward if not enough space below
      if (y + rect.height > vh - 8) {
        adjustedY = y - rect.height;
      } else {
        adjustedY = y;
      }
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (menuEl && !menuEl.contains(target)) {
      onClose();
    }
  }

  function handleSelect(item: MenuItem) {
    if (item.disabled) return;
    onSelect(item.id);
    onClose();
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    onClose();
  }

  function renderIcon(icon: MenuItem["icon"]) {
    switch (icon) {
      case "rename":
        return `<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />`;
      case "folder":
        return `<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /><path d="m9 13 2 2 4-4" />`;
      case "copy":
        return `<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`;
      case "export":
        return `<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />`;
      case "archive":
        return `<rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" />`;
      case "trash":
        return `<path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />`;
      case "pin":
        return `<path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />`;
      case "play":
        return `<polygon points="5 3 19 12 5 21 5 3" />`;
      case "chevron-right":
        return `<path d="m9 18 6-6-6-6" />`;
      default:
        return null;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

<div
  bind:this={menuEl}
  data-context-menu
  class="fixed z-[9999] min-w-[160px] rounded-xl border border-border/50 bg-background/95
         backdrop-blur-sm shadow-lg p-1"
  style="left: {adjustedX}px; top: {adjustedY}px;"
  role="menu"
  oncontextmenu={handleContextMenu}
>
  {#each items as item, i (item.id)}
    {#if item.separatorBefore && i > 0}
      <div class="my-1 h-px bg-border/40"></div>
    {/if}
    <button
      class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors
             {item.disabled
        ? 'opacity-40 cursor-not-allowed'
        : item.danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-muted/60'}"
      role="menuitem"
      disabled={item.disabled}
      onclick={() => handleSelect(item)}
    >
      {#if item.icon}
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          {@html renderIcon(item.icon)}
        </svg>
      {/if}
      <span class="flex-1 text-left">{item.label}</span>
      {#if item.icon === "chevron-right"}
        <svg
          class="h-3 w-3 shrink-0 opacity-50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      {/if}
    </button>
  {/each}
</div>
