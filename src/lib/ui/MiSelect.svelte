<script lang="ts">
  /**
   * MiSelect — Bits UI Select wrapper with MiWarp surface tokens.
   *
   * Two usage modes:
   * 1. Simple: pass `items` array — wrapper renders default items.
   * 2. Custom: omit `items`, use `children` snippet with Select primitives
   *    re-exported from this module. Caller gets Select.Viewport scope.
   *
   * RULE: only src/lib/ui/* may import bits-ui directly.
   * Business components using "custom" mode may import Select from "$lib/ui/select-primitives".
   */
  import { Select } from "bits-ui";
  import { MIWARP_POPOVER_CONTENT_CLASS } from "./miwarp-surfaces";

  type SelectItem = { value: string; label: string; disabled?: boolean };
  type Side = "top" | "right" | "bottom" | "left";
  type Align = "start" | "center" | "end";

  let {
    value = $bindable(""),
    open = $bindable(false),
    items,
    disabled = false,
    allowDeselect = false,
    side = "bottom" as Side,
    sideOffset = 6,
    align = "start" as Align,
    contentClass = "",
    contentStyle = "",
    viewportClass = "p-1",
    triggerClass = "",
    ariaLabel = "",
    onValueChange,
    onOpenChange,
    trigger,
    children,
  }: {
    value?: string;
    open?: boolean;
    /** Pass for simple mode; omit for custom children mode. */
    items?: SelectItem[];
    disabled?: boolean;
    allowDeselect?: boolean;
    side?: Side;
    sideOffset?: number;
    align?: Align;
    contentClass?: string;
    contentStyle?: string;
    viewportClass?: string;
    triggerClass?: string;
    ariaLabel?: string;
    onValueChange?: (value: string) => void;
    onOpenChange?: (open: boolean) => void;
    trigger?: import("svelte").Snippet<[{ props: Record<string, unknown>; open: boolean }]>;
    /** Custom content — use with Select primitives from "$lib/ui/select-primitives". */
    children?: import("svelte").Snippet;
  } = $props();

  let simpleItems = $derived(items ?? []);

  let panelClass = $derived(`${MIWARP_POPOVER_CONTENT_CLASS} ${contentClass}`.trim());

  // Bits UI can fire onValueChange multiple times for the same selection in
  // a single microtask burst (once from the item click, once from the value
  // binding settling). We coalesce by deferring the callback through a
  // microtask and dropping repeats of the most recently-forwarded value.
  // This keeps real selections snappy (the first call in a burst wins)
  // while suppressing the redundant follow-up.
  let lastForwarded: string | null = null;
  let pendingValue: string | null = null;
  let pendingTick: Promise<void> | null = null;

  function handleValueChange(next: string | undefined) {
    if (next === undefined) return;
    if (next !== value) {
      value = next;
    }
    if (next === lastForwarded) return;
    pendingValue = next;
    if (pendingTick) return;
    pendingTick = Promise.resolve().then(() => {
      pendingTick = null;
      const toForward = pendingValue;
      pendingValue = null;
      if (toForward === null || toForward === lastForwarded) return;
      lastForwarded = toForward;
      onValueChange?.(toForward);
    });
  }

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }
</script>

<Select.Root
  type="single"
  bind:open
  bind:value
  items={simpleItems}
  {disabled}
  {allowDeselect}
  onValueChange={handleValueChange}
  onOpenChange={handleOpenChange}
>
  <Select.Trigger aria-label={ariaLabel}>
    {#snippet child({ props })}
      {#if trigger}
        {@render trigger({ props: props as Record<string, unknown>, open })}
      {:else}
        <button {...props} type="button" class={triggerClass}>
          <Select.Value placeholder={ariaLabel} />
        </button>
      {/if}
    {/snippet}
  </Select.Trigger>
  <Select.Portal>
    <Select.Content
      class={panelClass}
      style={contentStyle || undefined}
      {side}
      {sideOffset}
      {align}
    >
      <Select.Viewport class={viewportClass}>
        {#if children}
          {@render children()}
        {:else}
          {#each simpleItems as it (it.value)}
            <Select.Item
              value={it.value}
              label={it.label}
              disabled={it.disabled}
              class="flex w-full cursor-default select-none items-center gap-2 rounded-xl px-3 py-2 text-xs outline-hidden transition-colors data-highlighted:bg-accent/20 data-[state=checked]:bg-accent/20 data-[state=checked]:font-medium"
            >
              {#snippet children({ selected })}
                {#if selected}
                  <span class="shrink-0 text-primary">&#10003;</span>
                {/if}
                <span>{it.label}</span>
              {/snippet}
            </Select.Item>
          {/each}
        {/if}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
