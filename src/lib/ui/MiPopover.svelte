<script lang="ts">
  import { Popover } from "bits-ui";
  import { MIWARP_POPOVER_CONTENT_CLASS } from "$lib/ui/miwarp-surfaces";

  type Side = "top" | "right" | "bottom" | "left";
  type Align = "start" | "center" | "end";

  let {
    open = $bindable(false),
    contentClass = "",
    side = "bottom" as Side,
    sideOffset = 6,
    align = "start" as Align,
    disabled = false,
    onOpenChange,
    trigger,
    children,
  }: {
    open?: boolean;
    contentClass?: string;
    side?: Side;
    sideOffset?: number;
    align?: Align;
    disabled?: boolean;
    onOpenChange?: (open: boolean) => void;
    trigger?: import("svelte").Snippet<[{ props: Record<string, unknown> }]>;
    children?: import("svelte").Snippet;
  } = $props();

  let panelClass = $derived(`${MIWARP_POPOVER_CONTENT_CLASS} ${contentClass}`.trim());

  function handleOpenChange(next: boolean) {
    if (disabled && next) {
      open = false;
      return;
    }
    open = next;
    onOpenChange?.(next);
  }

  function handleContentKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") e.stopPropagation();
  }
</script>

<Popover.Root bind:open onOpenChange={handleOpenChange}>
  <Popover.Trigger {disabled}>
    {#snippet child({ props })}
      {#if trigger}
        {@render trigger({ props })}
      {/if}
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      class={panelClass}
      {side}
      {sideOffset}
      {align}
      onkeydown={handleContentKeydown}
    >
      {#if children}
        {@render children()}
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
