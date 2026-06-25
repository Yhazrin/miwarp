<script lang="ts">
  import { untrack } from "svelte";
  import { Select } from "$lib/ui/select-primitives";
  import Icon from "$lib/components/Icon.svelte";
  import { PROCESS_VISIBILITY_LEVELS, type ProcessVisibility } from "$lib/utils/process-visibility";
  import { t } from "$lib/i18n/index.svelte";
  import { MIWARP_SELECT_ITEM_CLASS, MIWARP_POPOVER_CONTENT_CLASS } from "$lib/ui/miwarp-surfaces";

  let {
    processVisibility = "output",
    open = $bindable(false),
    onchange,
    onOpenChange,
    label = "",
  }: {
    processVisibility?: ProcessVisibility;
    open?: boolean;
    onchange?: (mode: ProcessVisibility) => void;
    onOpenChange?: (open: boolean) => void;
    /** Visible trigger label (caller supplies localized short or long text). */
    label?: string;
  } = $props();

  // Picker owns its visual value so it can re-render immediately on click
  // without waiting for the parent's $state round-trip. The external prop
  // is re-synced whenever the parent updates (e.g. settings reload).
  let selected = $state<ProcessVisibility>(untrack(() => processVisibility));
  $effect(() => {
    selected = processVisibility;
  });

  function visibilityLabel(mode: ProcessVisibility): string {
    return mode === "output" ? t("processVisibility_mode_chat") : t("processVisibility_mode_full");
  }

  function visibilityDescription(mode: ProcessVisibility): string {
    return mode === "output" ? t("processVisibility_desc_chat") : t("processVisibility_desc_full");
  }

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }

  function handleValueChange(next: string | undefined) {
    if (!next) return;
    const mode = next as ProcessVisibility;
    if (mode === selected) return;
    selected = mode;
    onchange?.(mode);
  }
</script>

<Select.Root
  type="single"
  bind:open
  value={selected}
  onValueChange={handleValueChange}
  onOpenChange={handleOpenChange}
>
  <Select.Trigger aria-label={t("settings_processVisibility")}>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        class="inline-flex shrink-0 items-center gap-1 truncate rounded-md border border-transparent px-2 py-1 text-foreground/65 transition-colors hover:border-border/50 hover:bg-muted/50 hover:text-foreground data-[state=open]:border-border/60 data-[state=open]:bg-muted/60 data-[state=open]:text-foreground"
      >
        <span class="truncate font-medium">{label || visibilityLabel(selected)}</span>
        <Icon
          name="chevron-down"
          size="xs"
          class="shrink-0 text-foreground/40 transition-transform duration-200 data-[state=open]:rotate-180"
        />
      </button>
    {/snippet}
  </Select.Trigger>
  <Select.Portal>
    <Select.Content
      class="{MIWARP_POPOVER_CONTENT_CLASS} w-[240px]"
      side="bottom"
      sideOffset={6}
      align="start"
    >
      <Select.Viewport class="p-1">
        {#each PROCESS_VISIBILITY_LEVELS as mode (mode)}
          <Select.Item
            value={mode}
            label={visibilityLabel(mode)}
            class="{MIWARP_SELECT_ITEM_CLASS} rounded-[10px] px-2.5 py-2 data-[state=checked]:bg-primary/12 data-[state=checked]:text-primary data-highlighted:bg-muted/50"
          >
            {#snippet children({ selected: isSelected })}
              {#if isSelected}
                <Icon name="check" size="sm" class="shrink-0 text-primary" />
              {:else}
                <span class="h-3.5 w-3.5 shrink-0"></span>
              {/if}
              <span class="min-w-0 flex-1">
                <span class="block font-medium">{visibilityLabel(mode)}</span>
                <span class="mt-0.5 block text-[10px] leading-4 text-foreground/50">
                  {visibilityDescription(mode)}
                </span>
              </span>
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
