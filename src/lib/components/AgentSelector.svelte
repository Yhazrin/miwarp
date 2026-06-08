<script lang="ts">
  import { scale } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";

  let {
    value = $bindable("claude"),
    class: className = "",
    onchange,
  }: {
    value?: string;
    class?: string;
    onchange?: (agent: string) => void;
  } = $props();

  let open = $state(false);

  const agents = [{ id: "claude", label: "Claude" }];

  let currentLabel = $derived(agents.find((a) => a.id === value)?.label ?? "Claude");

  function select(id: string) {
    value = id;
    open = false;
    onchange?.(id);
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest("[data-agent-selector]")) {
      open = false;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="relative {className}" data-agent-selector>
  <button
    type="button"
    class="flex items-center gap-1 rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    onclick={() => (open = !open)}
  >
    {currentLabel}
    <Icon name="chevron-down" size="xs" class="opacity-50" />
  </button>

  {#if open}
    <div
      transition:scale={{ start: 0.95, duration: 100 }}
      class="absolute bottom-full left-0 mb-1 min-w-[120px] rounded-xl border border-border bg-background py-1 shadow-lg z-[9999]"
    >
      {#each agents as agent}
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors
            {value === agent.id
            ? 'text-foreground bg-accent'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
          onclick={() => select(agent.id)}
        >
          {agent.label}
          {#if value === agent.id}
            <Icon name="check" size="xs" class="ml-auto text-muted-foreground" />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
