<script lang="ts">
  /**
   * MiDropdownMenu — Bits UI DropdownMenu wrapper with MiWarp surface tokens.
   *
   * Provides a trigger + dropdown content with keyboard nav, Esc to close,
   * click-outside to close. Use for context menus, action menus, etc.
   *
   * RULE: only src/lib/ui/* may import bits-ui.
   */
  import { DropdownMenu } from "bits-ui";

  let {
    open = $bindable(false),
    side = "bottom" as "top" | "right" | "bottom" | "left",
    sideOffset = 4,
    align = "start" as "start" | "center" | "end",
    contentClass = "",
    onOpenChange,
    trigger,
    children,
  }: {
    open?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "start" | "center" | "end";
    contentClass?: string;
    onOpenChange?: (open: boolean) => void;
    trigger?: import("svelte").Snippet<[{ props: Record<string, unknown> }]>;
    children?: import("svelte").Snippet;
  } = $props();

  let panelClass = $derived(
    `z-[9999] min-w-[180px] rounded-xl border border-border/35 bg-background/95 p-1 text-foreground shadow-lg backdrop-blur-xl animate-fade-in outline-hidden ${contentClass}`.trim(),
  );

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }
</script>

<DropdownMenu.Root bind:open onOpenChange={handleOpenChange}>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      {#if trigger}
        {@render trigger({ props })}
      {/if}
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class={panelClass} {side} {sideOffset} {align}>
      {#if children}
        {@render children()}
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
