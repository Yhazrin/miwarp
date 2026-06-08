<script lang="ts">
  import { onDestroy } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  interface Props {
    placeholder?: string;
    value?: string;
    onSearch?: (query: string) => void;
    onClear?: () => void;
  }

  let { placeholder = "", value = "", onSearch, onClear }: Props = $props();

  let effectivePlaceholder = $derived(placeholder || t("sidebar_searchChats"));

  let query = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl: HTMLInputElement | undefined = $state();

  // Sync external value changes
  $effect(() => {
    if (value !== query) query = value;
  });

  onDestroy(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
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
  <Icon
    name="search"
    size="sm"
    class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
  />
  <input
    bind:this={inputEl}
    type="text"
    value={query}
    oninput={handleInput}
    onkeydown={handleKeydown}
    placeholder={effectivePlaceholder}
    class="w-full rounded-md border border-sidebar-border bg-sidebar py-1.5 pl-8 pr-7 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50 transition-colors"
  />
  {#if query}
    <button
      type="button"
      class="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
      onclick={clear}
      aria-label={t("sidebarSearch_clear")}
    >
      <Icon name="x" size="xs" />
    </button>
  {/if}
</div>
