<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { PERMISSION_MODE_OPTIONS, resolvePermissionMode } from "$lib/chat/permission-mode-options";
  import { t } from "$lib/i18n/index.svelte";
  import { portal } from "$lib/utils/portal";

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
  let btnEl = $state<HTMLButtonElement | undefined>();
  let dropdownEl = $state<HTMLDivElement | undefined>();
  let dropdownStyle = $state("");
  /** Ignore the opening click's mousedown (document capture runs before toggle). */
  let suppressOutsideClose = $state(false);

  let current = $derived(resolvePermissionMode(permissionMode));

  let btnClass = $derived(
    variant === "island-tab"
      ? `session-island-tab no-drag transition-colors ${current.cls} ${open ? "bg-muted/70 text-foreground shadow-sm ring-1 ring-border/45" : "text-muted-foreground hover:bg-muted/45 hover:text-foreground"}`
      : `no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-transparent transition-colors hover:border-border/40 hover:bg-accent/15 ${current.cls} ${open ? "border-border/50 bg-accent/20" : ""}`,
  );

  function updateDropdownPosition() {
    if (!btnEl) return;
    const rect = btnEl.getBoundingClientRect();
    if (placement === "below") {
      dropdownStyle = `position:fixed; top:${rect.bottom + 4}px; left:${rect.left}px; z-index:9999;`;
    } else {
      dropdownStyle = `position:fixed; bottom:${window.innerHeight - rect.top + 4}px; left:${rect.left}px; z-index:9999;`;
    }
  }

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (open) {
      open = false;
      return;
    }
    suppressOutsideClose = true;
    open = true;
    updateDropdownPosition();
    queueMicrotask(() => {
      suppressOutsideClose = false;
    });
  }

  function select(mode: string) {
    open = false;
    onchange?.(mode);
  }

  onMount(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (suppressOutsideClose || !open) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (btnEl?.contains(target) || dropdownEl?.contains(target)) return;
      open = false;
    }

    function onDocKeydown(e: KeyboardEvent) {
      if (open && e.key === "Escape") open = false;
    }

    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeydown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onDocKeydown);
    };
  });
</script>

<button
  type="button"
  bind:this={btnEl}
  class={btnClass}
  onclick={toggle}
  title={t("prompt_permissionModeTitle", { mode: t(current.labelKey) })}
  aria-label={t("prompt_permissionModeTitle", { mode: t(current.labelKey) })}
  aria-expanded={open}
  aria-haspopup="listbox"
>
  <Icon name={current.icon} size="md" class="shrink-0 opacity-90" />
</button>

{#if open}
  <div
    bind:this={dropdownEl}
    use:portal
    role="listbox"
    class="min-w-[220px] w-max rounded-2xl border border-border/35 bg-background/86 backdrop-blur-xl animate-fade-in statusbar-popover p-1"
    style={dropdownStyle}
  >
    {#each PERMISSION_MODE_OPTIONS as mode (mode.value)}
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs transition-colors hover:bg-accent/20
          {permissionMode === mode.value ? 'bg-accent/20 font-medium' : ''}"
        onclick={() => select(mode.value)}
      >
        {#if permissionMode === mode.value}
          <Icon name="check" size="xs" class="text-primary shrink-0" />
        {:else}
          <Icon name={mode.icon} size="xs" class="shrink-0 opacity-55" />
        {/if}
        <span class="shrink-0 {mode.cls}">{t(mode.labelKey)}</span>
        <span class="min-w-0 flex-1 truncate text-[10px] text-foreground/50">{t(mode.descKey)}</span>
      </button>
    {/each}
  </div>
{/if}
