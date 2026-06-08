<script lang="ts">
  import MiPopover from "$lib/ui/MiPopover.svelte";
  import type { CliModelInfo } from "$lib/types";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { MIWARP_STATUSBAR_MENU_CLASS } from "$lib/ui/miwarp-surfaces";

  let {
    open = $bindable(false),
    model = "",
    models = [] as CliModelInfo[],
    modelLabel = "",
    effort = "",
    effortLevels = [] as string[],
    effortDisabled = true,
    currentModelInfo = null as CliModelInfo | null,
    onModelChange,
    onEffortChange,
    onOpenChange,
  }: {
    open?: boolean;
    model?: string;
    models?: CliModelInfo[];
    modelLabel?: string;
    effort?: string;
    effortLevels?: string[];
    effortDisabled?: boolean;
    currentModelInfo?: CliModelInfo | null;
    onModelChange?: (model: string) => void;
    onEffortChange?: (effort: string) => void;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  let modelFilter = $state("");
  let modelFilterEl: HTMLInputElement | undefined = $state();

  const showModelFilter = $derived(models.length >= 10);
  const filteredModels = $derived.by(() => {
    if (!modelFilter) return models;
    const q = modelFilter.toLowerCase();
    return models.filter(
      (m) =>
        m.value.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q)),
    );
  });

  let triggerClass = $derived(
    `inline-flex max-w-[11rem] shrink-0 items-center gap-1 truncate rounded-md border border-transparent px-1.5 py-0.5 font-medium text-foreground/85 transition-colors hover:border-border/50 hover:bg-muted/50 hover:text-foreground data-[state=open]:border-border/60 data-[state=open]:bg-muted/60 data-[state=open]:text-foreground`,
  );

  function handleOpenChange(next: boolean) {
    open = next;
    if (!next) modelFilter = "";
    else {
      requestAnimationFrame(() => {
        if (showModelFilter && modelFilterEl) modelFilterEl.focus();
      });
    }
    onOpenChange?.(next);
  }

  function selectModel(val: string) {
    open = false;
    onModelChange?.(val);
  }
</script>

<MiPopover
  bind:open
  onOpenChange={handleOpenChange}
  contentClass="{MIWARP_STATUSBAR_MENU_CLASS} w-[min(400px,calc(100vw-16px))]"
  sideOffset={6}
>
  {#snippet trigger({ props })}
    <button
      {...props}
      type="button"
      class="{triggerClass} {props.class ?? ''}"
      aria-label={modelLabel}
      onclick={(e: MouseEvent) => e.stopPropagation()}
    >
      <span class="truncate">{modelLabel}</span>
      {#if !effortDisabled && effort}
        <span class="text-[10px] font-normal text-foreground/55">{effort}</span>
      {/if}
      <Icon
        name="chevron-down"
        size="xs"
        class="shrink-0 text-foreground/40 transition-transform duration-200 data-[state=open]:rotate-180"
      />
    </button>
  {/snippet}
  {#if showModelFilter}
    <div class="shrink-0 border-b border-border/25 px-2.5 py-2">
      <input
        bind:this={modelFilterEl}
        bind:value={modelFilter}
        placeholder={t("modelFilter_placeholder")}
        class="w-full rounded-[10px] border border-border/35 bg-muted/25 px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/45 focus:bg-muted/35"
        onkeydown={(e) => e.stopPropagation()}
      />
    </div>
  {/if}
  <div class="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-width:thin]">
    {#if filteredModels.length === 0}
      <EmptyState iconName="search" title={t("modelFilter_noResults")} class="py-4" />
    {/if}
    {#each filteredModels as m (m.value)}
      <button
        type="button"
        role="option"
        aria-selected={model === m.value}
        class="flex w-full items-start gap-2 rounded-[10px] px-2 py-2 text-left transition-colors {model ===
        m.value
          ? 'bg-primary/12'
          : 'hover:bg-muted/45'}"
        onclick={() => selectModel(m.value)}
      >
        {#if model === m.value}
          <Icon name="check" size="sm" class="mt-0.5 shrink-0 text-primary" />
        {:else}
          <span class="mt-0.5 h-3.5 w-3.5 shrink-0"></span>
        {/if}
        <span class="min-w-0 flex-1">
          <span
            class="block truncate text-xs font-medium {model === m.value
              ? 'text-primary'
              : 'text-foreground'}">{m.displayName}</span
          >
          {#if m.description}
            <span class="mt-0.5 block truncate text-[10px] leading-snug text-muted-foreground/65"
              >{m.description}</span
            >
          {/if}
        </span>
      </button>
    {/each}
  </div>
  {#if effortLevels.length > 0 && onEffortChange}
    <div class="shrink-0 border-t border-border/25">
      <div class="px-3 py-2.5">
        <div class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {t("effort_label")}{#if effortDisabled}<span
              class="ml-1 font-normal normal-case opacity-50"
              >— {currentModelInfo?.displayName ?? model}</span
            >{/if}
        </div>
        <div class="flex gap-1">
          {#each effortLevels as level}
            <button
              type="button"
              class="flex-1 rounded-[10px] px-2 py-1.5 text-xs transition-colors
                {effortDisabled
                ? 'cursor-not-allowed bg-muted/25 text-muted-foreground/40'
                : effort === level
                  ? 'bg-primary font-medium text-primary-foreground shadow-sm'
                  : 'bg-muted/35 text-muted-foreground hover:bg-muted/55 hover:text-foreground'}"
              disabled={effortDisabled}
              onclick={() => onEffortChange(level)}>{level}</button
            >
          {/each}
        </div>
      </div>
    </div>
  {/if}
</MiPopover>
