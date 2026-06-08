<script lang="ts">
  /**
   * MobileServerPicker — Select from available remote hosts for mobile connection.
   * Uses MiSelect for accessible keyboard navigation.
   */
  import MiSelect from "$lib/ui/MiSelect.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  type ServerEntry = { value: string; label: string; description?: string; online?: boolean };

  let {
    value = $bindable(""),
    servers = [],
    onValueChange,
  }: {
    value?: string;
    servers?: ServerEntry[];
    onValueChange?: (value: string) => void;
  } = $props();

  let selectItems = $derived(
    servers.map((s) => ({ value: s.value, label: s.label })),
  );

  let currentLabel = $derived(
    servers.find((s) => s.value === value)?.label || t("settings_mobile_server"),
  );
</script>

<MiSelect
  bind:value
  items={selectItems}
  {onValueChange}
  contentClass="w-[min(320px,calc(100vw-32px))]"
  side="bottom"
  sideOffset={4}
>
  {#snippet trigger({ props })}
    <button
      {...props}
      type="button"
      class="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
    >
      <Icon name="monitor" size="sm" class="shrink-0 text-muted-foreground" />
      <span class="flex-1 truncate text-left">{currentLabel}</span>
      <Icon name="chevron-down" size="xs" class="shrink-0 text-muted-foreground/50" />
    </button>
  {/snippet}
  {#each servers as server (server.value)}
    <div
      class="flex w-full cursor-default select-none items-center gap-2 rounded-xl px-3 py-2.5 text-xs outline-hidden transition-colors data-highlighted:bg-accent/20 {value ===
      server.value
        ? 'bg-accent/15'
        : ''}"
      role="option"
      aria-selected={value === server.value}
    >
      {#if value === server.value}
        <Icon name="check" size="xs" class="shrink-0 text-primary" />
      {:else}
        <span class="h-3.5 w-3.5 shrink-0"></span>
      {/if}
      <div class="min-w-0 flex-1">
        <span class="block truncate font-medium">{server.label}</span>
        {#if server.description}
          <span class="mt-0.5 block truncate text-[10px] text-muted-foreground/65"
            >{server.description}</span
          >
        {/if}
      </div>
      {#if server.online !== undefined}
        <span
          class="h-1.5 w-1.5 shrink-0 rounded-full {server.online
            ? 'bg-miwarp-status-success'
            : 'bg-muted'}"
        ></span>
      {/if}
    </div>
  {/each}
</MiSelect>
