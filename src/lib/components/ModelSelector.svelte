<script lang="ts">
  import { getCliModels, loadCliInfo } from "$lib/stores/cli-info.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import MiPopover from "$lib/ui/MiPopover.svelte";

  let {
    value = $bindable(""),
    _agent = "claude",
    onchange,
  }: {
    value: string;
    _agent?: string;
    onchange?: (model: string) => void;
  } = $props();

  let open = $state(false);
  let showCustom = $state(false);
  let customModel = $state("");

  let models = $derived(getCliModels(_agent));

  $effect(() => {
    void loadCliInfo(false, _agent);
  });

  let displayValue = $derived.by(() => {
    const found = getCliModels(_agent).find((mdl) => mdl.value === value);
    return found?.displayName ?? (value || t("modelSelector_default"));
  });

  const triggerClass =
    "flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent data-[state=open]:bg-accent";

  function handleOpenChange(next: boolean) {
    open = next;
    if (!next) showCustom = false;
  }

  function selectModel(val: string) {
    value = val;
    open = false;
    showCustom = false;
    onchange?.(val);
  }

  function applyCustom() {
    if (customModel.trim()) {
      value = customModel.trim();
      onchange?.(value);
    }
    showCustom = false;
    open = false;
  }
</script>

<MiPopover bind:open onOpenChange={handleOpenChange} contentClass="w-80 p-0" sideOffset={4}>
  {#snippet trigger({ props })}
    <button
      {...props}
      type="button"
      class="{triggerClass} {props.class ?? ''}"
      aria-label={displayValue}
    >
      <svg
        class="h-3.5 w-3.5 text-muted-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path
          d="M2 14h2"
        /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg
      >
      {displayValue}
      <Icon
        name="chevron-down"
        size="xs"
        class="text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180"
      />
    </button>
  {/snippet}
  {#snippet children()}
    <div class="p-1">
      {#each models as mdl (mdl.value)}
        <button
          type="button"
          role="option"
          aria-selected={value === mdl.value}
          class="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors hover:bg-accent {value ===
          mdl.value
            ? 'bg-accent font-medium'
            : ''}"
          onclick={() => selectModel(mdl.value)}
        >
          {#if value === mdl.value}
            <Icon name="check" size="sm" class="text-primary" />
          {:else}
            <span class="w-3.5"></span>
          {/if}
          <span>{mdl.displayName}</span>
          <span class="text-xs text-muted-foreground/60">{mdl.description}</span>
          <span class="ml-auto text-xs text-muted-foreground">{mdl.value}</span>
        </button>
      {/each}

      <div class="my-1 border-t"></div>

      {#if showCustom}
        <div class="flex items-center gap-1 px-2 py-1">
          <input
            class="flex-1 rounded-sm border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            bind:value={customModel}
            placeholder={t("model_placeholder")}
            onkeydown={(e) => e.key === "Enter" && applyCustom()}
          />
          <button
            type="button"
            class="rounded-sm bg-primary px-2 py-1 text-xs text-primary-foreground"
            onclick={applyCustom}
          >
            {t("model_set")}
          </button>
        </div>
      {:else}
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
          onclick={() => (showCustom = true)}
        >
          <Icon name="plus" size="sm" />
          {t("model_customModel")}
        </button>
      {/if}
    </div>
  {/snippet}
</MiPopover>
