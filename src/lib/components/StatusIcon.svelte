<script lang="ts">
  /**
   * Shared status icon: checkmark (done), X (error), spinner (running), or dot (other).
   * Used by ToolActivity and InlineToolCard for tool status display.
   */
  import Spinner from "$lib/components/Spinner.svelte";

  let {
    status,
    size = "sm",
  }: {
    status: "done" | "error" | "running" | "other";
    size?: "xs" | "sm" | "md";
  } = $props();

  const sizeClass: Record<string, string> = {
    xs: "h-2.5 w-2.5",
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
  };
</script>

{#if status === "done"}
  <svg
    class="{sizeClass[size]} shrink-0"
    style="color: var(--miwarp-status-done);"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
  >
{:else if status === "error"}
  <svg
    class="{sizeClass[size]} shrink-0"
    style="color: var(--miwarp-status-failed);"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
  >
{:else if status === "running"}
  {#if size === "xs"}
    <Spinner size="xxs" class="!h-2.5 !w-2.5 border-border border-t-miwarp-status-running shrink-0" />
  {:else if size === "md"}
    <Spinner size="xs" class="!h-3.5 !w-3.5 border-border border-t-miwarp-status-running shrink-0" />
  {:else}
    <Spinner size="xs" class="!h-3 !w-3 border-border border-t-miwarp-status-running shrink-0" />
  {/if}
{:else}
  <div
    class="{sizeClass[size]} rounded-full shrink-0"
    style="background-color: var(--miwarp-status-idle);"
  ></div>
{/if}
