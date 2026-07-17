<script lang="ts">
  /**
   * MiTooltip — Bits UI Tooltip wrapper with MiWarp surface tokens.
   *
   * Usage:
   *   <MiTooltip text="Delete">
   *     <button>🗑</button>
   *   </MiTooltip>
   *
   * RULE: only src/lib/ui/* may import bits-ui.
   */
  import { Tooltip } from "bits-ui";

  let {
    text = "",
    side = "top" as "top" | "right" | "bottom" | "left",
    sideOffset = 4,
    delayDuration = 400,
    disabled = false,
    children,
  }: {
    text?: string;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    delayDuration?: number;
    disabled?: boolean;
    children?: import("svelte").Snippet;
  } = $props();
</script>

<Tooltip.Provider {delayDuration}>
  <Tooltip.Root {disabled}>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <div {...props} class="inline-flex">
          {#if children}{@render children()}{/if}
        </div>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        {side}
        {sideOffset}
        class="z-[9999] rounded-lg border border-border/35 bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-md backdrop-blur-sm animate-fade-in"
      >
        {text}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
