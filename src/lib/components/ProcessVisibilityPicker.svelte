<script lang="ts">
  import MiSelect from "$lib/ui/MiSelect.svelte";
  import { Select } from "$lib/ui/select-primitives";
  import Icon from "$lib/components/Icon.svelte";
  import { PROCESS_VISIBILITY_LEVELS, type ProcessVisibility } from "$lib/utils/process-visibility";
  import { t } from "$lib/i18n/index.svelte";
  import { MIWARP_SELECT_ITEM_CLASS } from "$lib/ui/miwarp-surfaces";

  let {
    processVisibility = "developer",
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

  let selectItems = $derived(
    PROCESS_VISIBILITY_LEVELS.map((mode) => ({
      value: mode,
      label: visibilityLabel(mode),
    })),
  );

  let triggerClass = $derived(
    `inline-flex shrink-0 items-center gap-1 truncate rounded-md border border-transparent px-2 py-1 text-foreground/65 transition-colors hover:border-border/50 hover:bg-muted/50 hover:text-foreground data-[state=open]:border-border/60 data-[state=open]:bg-muted/60 data-[state=open]:text-foreground`,
  );

  function visibilityLabel(mode: ProcessVisibility): string {
    switch (mode) {
      case "output":
        return t("processVisibility_mode_output");
      case "guided":
        return t("processVisibility_mode_guided");
      case "expert":
        return t("processVisibility_mode_expert");
      default:
        return t("processVisibility_mode_developer");
    }
  }

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }

  function handleValueChange(value: string | undefined) {
    if (!value) return;
    const mode = value as ProcessVisibility;
    if (mode !== processVisibility) onchange?.(mode);
  }
</script>

<MiSelect
  bind:open
  value={processVisibility}
  onValueChange={handleValueChange}
  onOpenChange={handleOpenChange}
  items={selectItems}
  contentClass="w-[200px]"
>
  {#snippet trigger({ props })}
    <button
      {...props}
      type="button"
      class="{triggerClass} {props.class ?? ''}"
      aria-label={t("settings_processVisibility")}
      title={t("settings_processVisibility")}
      onclick={(e: MouseEvent) => e.stopPropagation()}
    >
      <span class="truncate font-medium">{label || visibilityLabel(processVisibility)}</span>
      <Icon
        name="chevron-down"
        size="xs"
        class="shrink-0 text-foreground/40 transition-transform duration-200 data-[state=open]:rotate-180"
      />
    </button>
  {/snippet}
  {#each PROCESS_VISIBILITY_LEVELS as mode (mode)}
    <Select.Item
      value={mode}
      label={visibilityLabel(mode)}
      class="{MIWARP_SELECT_ITEM_CLASS} rounded-[10px] px-2.5 py-2 data-[state=checked]:bg-primary/12 data-[state=checked]:text-primary data-highlighted:bg-muted/50"
    >
      {#snippet children({ selected })}
        {#if selected}
          <Icon name="check" size="sm" class="shrink-0 text-primary" />
        {:else}
          <span class="h-3.5 w-3.5 shrink-0"></span>
        {/if}
        <span class="flex-1">{visibilityLabel(mode)}</span>
      {/snippet}
    </Select.Item>
  {/each}
</MiSelect>
