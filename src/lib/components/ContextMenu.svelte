<script lang="ts">
  /**
   * Reusable context menu component.
   * Features:
   * - Portaled to document.body (escapes sidebar stacking context)
   * - Fixed positioning at x/y
   * - Auto-repositions to stay within viewport
   * - Click outside / Esc to close
   * - Keyboard navigation
   * - Danger variant for destructive actions
   * - Separator support
   */

  import { portal } from "$lib/utils/portal";
  import Icon from "$lib/components/Icon.svelte";
  import { scale } from "svelte/transition";

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
  let adjustedX = $state(0);
  let adjustedY = $state(0);
  let focusedIndex = $state(0);
  let itemButtons: (HTMLButtonElement | undefined)[] = $state([]);
  let typeAheadBuffer = $state("");
  let typeAheadTimer: ReturnType<typeof setTimeout> | undefined;

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

  /** Returns indices of non-disabled items in display order. */
  function navigableIndices(): number[] {
    return items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => !item.disabled)
      .map(({ i }) => i);
  }

  /** Focus the button at the given index and scroll it into view. */
  function focusItem(index: number) {
    focusedIndex = index;
    const btn = itemButtons[index];
    if (btn) {
      btn.focus();
      btn.scrollIntoView({ block: "nearest" });
    }
  }

  /** Jump to the next navigable item in the given direction, wrapping around. */
  function moveFocus(direction: 1 | -1) {
    const nav = navigableIndices();
    if (nav.length === 0) return;
    const currentPos = nav.indexOf(focusedIndex);
    const nextPos =
      currentPos === -1
        ? 0
        : (currentPos + direction + nav.length) % nav.length;
    focusItem(nav[nextPos]);
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;

      case "ArrowDown":
        e.preventDefault();
        moveFocus(1);
        break;

      case "ArrowUp":
        e.preventDefault();
        moveFocus(-1);
        break;

      case "Home":
        e.preventDefault();
        {
          const nav = navigableIndices();
          if (nav.length > 0) focusItem(nav[0]);
        }
        break;

      case "End":
        e.preventDefault();
        {
          const nav = navigableIndices();
          if (nav.length > 0) focusItem(nav[nav.length - 1]);
        }
        break;

      case "Enter":
      case " ":
        e.preventDefault();
        {
          const item = items[focusedIndex];
          if (item && !item.disabled) handleSelect(item);
        }
        break;

      default:
        // Type-ahead: single printable character jumps to next matching item
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          clearTimeout(typeAheadTimer);
          typeAheadBuffer += e.key.toLowerCase();
          typeAheadTimer = setTimeout(() => {
            typeAheadBuffer = "";
          }, 500);

          const nav = navigableIndices();
          if (nav.length === 0) return;
          // Search from the item after the current focused index
          const startPos = nav.indexOf(focusedIndex);
          for (let offset = 1; offset <= nav.length; offset++) {
            const idx = nav[(startPos + offset) % nav.length];
            const label = items[idx].label.toLowerCase();
            if (label.startsWith(typeAheadBuffer)) {
              focusItem(idx);
              break;
            }
          }
        }
        break;
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

  // Auto-focus first navigable item when menu opens
  $effect(() => {
    // Subscribe to items to re-run when they change
    void items;
    const nav = navigableIndices();
    if (nav.length > 0) {
      focusedIndex = nav[0];
      // Defer focus to next microtask so the DOM is ready
      queueMicrotask(() => {
        const btn = itemButtons[focusedIndex];
        btn?.focus();
      });
    }
  });

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
  use:portal
  data-context-menu
  class="fixed z-[45] min-w-[160px] rounded-xl border border-border/50 bg-background/95
         backdrop-blur-sm shadow-lg p-1"
  style="left: {adjustedX}px; top: {adjustedY}px;"
  transition:scale={{ start: 0.95, duration: 100 }}
  role="menu"
  tabindex="-1"
  oncontextmenu={handleContextMenu}
>
  {#each items as item, i (item.id)}
    {#if item.separatorBefore && i > 0}
      <div class="my-1 h-px bg-border/40"></div>
    {/if}
    <button type="button"
      class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors
             focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
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
        <Icon name="chevron-right" size="xs" class="shrink-0 opacity-50" />
      {/if}
    </button>
  {/each}
</div>
