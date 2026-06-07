<script lang="ts">
  /**
   * v1.0.6 / 6.7: MiPopover — Bits UI Popover wrapper with MiWarp
   * surface tokens.
   */
  import { Popover } from "bits-ui";

  let {
    open = $bindable(false),
    trigger,
    children,
    placement = "bottom",
    align = "start",
    class: className = "",
  }: {
    open?: boolean;
    trigger: import("svelte").Snippet;
    children: import("svelte").Snippet;
    placement?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    class?: string;
  } = $props();
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {@render trigger()}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      side={placement}
      align={align}
      sideOffset={6}
      class="z-50 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg
        focus:outline-none {className}"
    >
      {@render children()}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
