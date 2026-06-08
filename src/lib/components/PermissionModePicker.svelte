<script lang="ts">
  import MiSelect from "$lib/ui/MiSelect.svelte";
  import { Select } from "$lib/ui/select-primitives";
  import Icon from "$lib/components/Icon.svelte";
  import { PERMISSION_MODE_OPTIONS, resolvePermissionMode } from "$lib/chat/permission-mode-options";
  import { t } from "$lib/i18n/index.svelte";

  let {
    permissionMode = "default",
    onchange,
    variant = "input" as "input" | "island-tab",
    placement = "above" as "above" | "below",
  }: {
    permissionMode?: string;
    onchange?: (mode: string) => void;
    /** input = chat dock h-7; island-tab = status bar tab-sized */
    variant?: "input" | "island-tab";
    /** Dropdown opens above or below the trigger */
    placement?: "above" | "below";
  } = $props();

  let open = $state(false);
  let current = $derived(resolvePermissionMode(permissionMode));

  let selectItems = $derived(
    PERMISSION_MODE_OPTIONS.map((m) => ({
      value: m.value,
      label: t(m.labelKey),
    })),
  );

  let btnClass = $derived(
    variant === "island-tab"
      ? `session-island-tab no-drag transition-colors ${current.cls} data-[state=open]:bg-muted/70 data-[state=open]:text-foreground data-[state=open]:shadow-sm data-[state=open]:ring-1 data-[state=open]:ring-border/45 text-muted-foreground hover:bg-muted/45 hover:text-foreground`
      : `no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-transparent transition-colors hover:border-border/40 hover:bg-accent/15 ${current.cls} data-[state=open]:border-border/50 data-[state=open]:bg-accent/20`,
  );

  let triggerLabel = $derived(
    t("prompt_permissionModeTitle", { mode: t(current.labelKey) }),
  );

  function handleValueChange(value: string | undefined) {
    if (value && value !== permissionMode) onchange?.(value);
  }
</script>

<MiSelect
  bind:open
  value={permissionMode}
  onValueChange={handleValueChange}
  items={selectItems}
  side={placement === "above" ? "top" : "bottom"}
  contentClass="max-h-[min(420px,70vh)]"
  viewportClass="p-0"
>
  {#snippet trigger({ props })}
    <button {...props} type="button" class="{btnClass} {props.class ?? ''}" title={triggerLabel}>
      <Icon name={current.icon} size="md" class="shrink-0 opacity-90" />
    </button>
  {/snippet}
  {#each PERMISSION_MODE_OPTIONS as mode (mode.value)}
    <Select.Item
      value={mode.value}
      label={t(mode.labelKey)}
      class="flex w-full cursor-default select-none items-center gap-2 rounded-xl px-3 py-2 text-xs outline-hidden transition-colors data-highlighted:bg-accent/20 data-[state=checked]:bg-accent/20 data-[state=checked]:font-medium"
    >
      {#snippet children({ selected })}
        {#if selected}
          <Icon name="check" size="xs" class="shrink-0 text-primary" />
        {:else}
          <Icon name={mode.icon} size="xs" class="shrink-0 opacity-55" />
        {/if}
        <span class="shrink-0 {mode.cls}">{t(mode.labelKey)}</span>
        <span class="min-w-0 flex-1 truncate text-[10px] text-foreground/50"
          >{t(mode.descKey)}</span
        >
      {/snippet}
    </Select.Item>
  {/each}
</MiSelect>
