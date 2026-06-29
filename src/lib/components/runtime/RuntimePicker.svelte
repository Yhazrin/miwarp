<script lang="ts">
  import MiSelect from "$lib/ui/MiSelect.svelte";
  import { Select } from "$lib/ui/select-primitives";
  import Icon from "$lib/components/Icon.svelte";
  import { getAgentAsset } from "$lib/utils/agent-assets";
  import { t } from "$lib/i18n/index.svelte";
  import { MIWARP_SELECT_ITEM_CLASS } from "$lib/ui/miwarp-surfaces";
  import type { ResolvedRuntime, SupportedRuntimeId } from "$lib/runtime";

  let {
    runtimes = [],
    selected = "claude",
    loading = false,
    onchange,
    onManageRuntimes,
  }: {
    runtimes: ResolvedRuntime[];
    selected?: SupportedRuntimeId;
    loading?: boolean;
    onchange?: (id: SupportedRuntimeId) => void;
    onManageRuntimes?: () => void;
  } = $props();

  let open = $state(false);

  const current = $derived(runtimes.find((r) => r.id === selected) ?? runtimes[0] ?? null);

  function statusBadgeClass(status: ResolvedRuntime["status"]): string {
    switch (status) {
      case "available":
        return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
      case "desktop":
        return "bg-sky-500/10 text-sky-700 dark:text-sky-400";
      case "coming-soon":
        return "bg-[hsl(var(--miwarp-accent-violet)/0.12)] text-[hsl(var(--miwarp-accent-violet))]";
      default:
        return "bg-muted text-muted-foreground";
    }
  }

  function handleValueChange(value: string | undefined) {
    if (!value || value === selected) return;
    const runtime = runtimes.find((r) => r.id === value);
    if (!runtime?.selectable) return;
    // Close first, then notify — bits-ui Select.Root will also dispatch
    // onOpenChange(false) after selection, but doing it ourselves means the
    // menu collapses on the same frame as the click and we never enter the
    // "open=true → bindable flush → open=false → onOpenChange(true)" race
    // that produced the visible flicker.
    open = false;
    onchange?.(value as SupportedRuntimeId);
  }
</script>

<div class="w-full" data-runtime-picker>
  <MiSelect
    bind:open
    value={selected}
    disabled={loading || runtimes.length === 0}
    onValueChange={handleValueChange}
    contentClass="w-[min(100vw-2rem,22rem)] p-0"
    viewportClass="p-0"
    ariaLabel={t("runtime_picker_label")}
  >
    {#snippet trigger({ props })}
      <button
        {...props}
        type="button"
        class="group/runtime flex w-full items-center gap-2.5 rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-left text-xs transition-colors hover:border-border/70 hover:bg-muted/35 data-[state=open]:border-primary/35 data-[state=open]:bg-primary/5 {props.class ??
          ''}"
        aria-label={t("runtime_picker_label")}
      >
        {#if current}
          {@const asset = getAgentAsset(current.agent)}
          <img
            src={asset.icon ?? asset.fallback}
            alt=""
            class="h-5 w-5 shrink-0 rounded-md object-cover"
          />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2">
              <span class="truncate font-medium text-foreground">{t(current.nameKey)}</span>
              <span
                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium {statusBadgeClass(
                  current.status,
                )}"
              >
                {t(current.statusKey)}
              </span>
            </span>
            {#if current.version}
              <span class="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/80">
                {current.version}
              </span>
            {/if}
          </span>
        {:else}
          <span class="text-muted-foreground">{t("runtime_picker_loading")}</span>
        {/if}
        <Icon
          name="chevron-down"
          size="xs"
          class="shrink-0 text-muted-foreground/60 transition-transform duration-200 group-data-[state=open]/runtime:rotate-180"
        />
      </button>
    {/snippet}

    <div class="border-b border-border/30 px-3 py-2">
      <p class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {t("runtime_picker_heading")}
      </p>
    </div>

    {#each runtimes as runtime (runtime.id)}
      {@const asset = getAgentAsset(runtime.agent)}
      <Select.Item
        value={runtime.id}
        label={t(runtime.nameKey)}
        disabled={!runtime.selectable}
        class="{MIWARP_SELECT_ITEM_CLASS} items-start rounded-none border-b border-border/15 px-3 py-2.5 last:border-b-0 data-disabled:opacity-55 data-[state=checked]:bg-primary/8"
      >
        {#snippet children({ selected: isSelected })}
          <img
            src={asset.icon ?? asset.fallback}
            alt=""
            class="mt-0.5 h-5 w-5 shrink-0 rounded-md object-cover opacity-90"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              {#if isSelected}
                <Icon name="check" size="xs" class="shrink-0 text-primary" />
              {/if}
              <span class="truncate font-medium text-foreground">{t(runtime.nameKey)}</span>
              <span
                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium {statusBadgeClass(
                  runtime.status,
                )}"
              >
                {t(runtime.statusKey)}
              </span>
              {#if runtime.version}
                <span class="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/75">
                  {runtime.version}
                </span>
              {/if}
            </div>
            <p class="mt-0.5 text-[10px] leading-snug text-muted-foreground/80">
              {t(runtime.capabilitiesKey)}
            </p>
          </div>
        {/snippet}
      </Select.Item>
    {/each}

    {#if onManageRuntimes}
      <div class="border-t border-border/30 p-1">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
          onclick={() => {
            open = false;
            onManageRuntimes();
          }}
        >
          <Icon name="settings" size="xs" class="shrink-0 opacity-70" />
          <span>{t("runtime_picker_manage")}</span>
        </button>
      </div>
    {/if}
  </MiSelect>
</div>
