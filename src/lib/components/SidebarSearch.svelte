<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    placeholder?: string;
    value?: string;
    onSearch?: (query: string) => void;
    onClear?: () => void;
  }

  let { placeholder = "Search sessions...", value = "", onSearch, onClear }: Props = $props();

  let query = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl: HTMLInputElement | undefined = $state();

  // Sync external value changes
  $effect(() => {
    if (value !== query) query = value;
  });

  function handleInput(e: Event) {
    query = (e.target as HTMLInputElement).value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onSearch?.(query), 300);
  }

  function clear() {
    query = "";
    onSearch?.("");
    onClear?.();
    inputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && query) {
      e.preventDefault();
      clear();
    }
  }
</script>

<div class="relative">
  <!-- Search icon -->
  <svg
    class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
  <input
    bind:this={inputEl}
    type="text"
    value={query}
    oninput={handleInput}
    onkeydown={handleKeydown}
    {placeholder}
    class="w-full rounded-md border border-sidebar-border bg-sidebar py-1.5 pl-8 pr-7 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50 transition-colors"
  />
  {#if query}
    <button
      class="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
      onclick={clear}
      aria-label={t("sidebarSearch_clear")}
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
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  {/if}
</div>
