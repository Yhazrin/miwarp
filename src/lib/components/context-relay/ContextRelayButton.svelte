<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { ContextClip } from "$lib/context-relay/context-clip-types";

  let {
    clip,
    currentRunId = "",
    currentCwd = "/",
    size = "md",
    variant = "ghost",
    disabled = false,
  }: {
    clip: ContextClip;
    currentRunId?: string;
    currentCwd?: string;
    size?: "sm" | "md";
    variant?: "ghost" | "primary";
    disabled?: boolean;
  } = $props();

  let hovered = $state(false);

  async function handleClick(e: MouseEvent) {
    e.stopPropagation();
    const { contextRelayStore } = await import("$lib/context-relay/context-relay-store.svelte");
    contextRelayStore.openModal(clip, currentRunId, currentCwd);
  }
</script>

<button
  class="rounded-md p-1 transition-all duration-150 {size === 'sm'
    ? 'h-6 w-6'
    : 'h-7 w-7'} {variant === 'ghost'
    ? 'text-miwarp-text-tertiary hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary'
    : 'bg-primary text-primary-foreground hover:bg-primary/90'} {disabled
    ? 'opacity-40 cursor-not-allowed'
    : 'opacity-100'} {!disabled && !hovered ? 'opacity-0' : ''}"
  {disabled}
  title={t("contextRelay_sendToSession")}
  data-export-exclude
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  onclick={handleClick}
>
  <svg
    class={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
</button>
