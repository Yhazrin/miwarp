<script lang="ts">
  import { getContext } from "svelte";
  import { KeybindingStore, formatKeyDisplay } from "$lib/stores/keybindings.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import MiDialog from "$lib/ui/MiDialog.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const keybindingStore = getContext<KeybindingStore>("keybindings");

  let globalBindings = $derived(
    keybindingStore.resolved.filter((b) => b.context === "global" && b.source === "app"),
  );
  let chatBindings = $derived(
    keybindingStore.resolved.filter((b) => b.context === "chat" && b.source === "app"),
  );
  let promptBindings = $derived(
    keybindingStore.resolved.filter((b) => b.context === "prompt" && b.source === "app"),
  );
  let cliBindings = $derived(keybindingStore.resolved.filter((b) => b.source === "cli"));

  let cliExpanded = $state(false);
</script>

<MiDialog bind:open size="md" title={t("shortcutHelp_title")} contentClass="outline-none">
  <div class="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
    {#if globalBindings.length > 0}
      <section>
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("shortcutHelp_global")}
        </h3>
        <div class="space-y-1">
          {#each globalBindings as b (b.command)}
            <div class="flex items-center justify-between py-0.5">
              <span class="text-xs text-foreground/80">{b.label}</span>
              <kbd
                class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
                >{formatKeyDisplay(b.key)}</kbd
              >
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if chatBindings.length > 0}
      <section>
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("shortcutHelp_chat")}
        </h3>
        <div class="space-y-1">
          {#each chatBindings as b (b.command)}
            <div class="flex items-center justify-between py-0.5">
              <span class="text-xs text-foreground/80">{b.label}</span>
              <kbd
                class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
                >{formatKeyDisplay(b.key)}</kbd
              >
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section>
      <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("shortcutHelp_input")}
      </h3>
      <div class="space-y-1">
        {#each promptBindings as b (b.command)}
          <div class="flex items-center justify-between py-0.5">
            <span class="text-xs text-foreground/80">{b.label}</span>
            <kbd
              class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
              >{formatKeyDisplay(b.key)}</kbd
            >
          </div>
        {/each}
        <div class="flex items-center justify-between py-0.5">
          <span class="text-xs text-foreground/80">{t("shortcutHelp_hintSlash")}</span>
          <kbd
            class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
            >/</kbd
          >
        </div>
        <div class="flex items-center justify-between py-0.5">
          <span class="text-xs text-foreground/80">{t("shortcutHelp_hintAt")}</span>
          <kbd
            class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
            >@</kbd
          >
        </div>
        <div class="flex items-center justify-between py-0.5">
          <span class="text-xs text-foreground/80">{t("shortcutHelp_hintDoubleEsc")}</span>
          <kbd
            class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
            >⎋ ⎋</kbd
          >
        </div>
        <div class="flex items-center justify-between py-0.5">
          <span class="text-xs text-foreground/80">{t("shortcutHelp_hintNewline")}</span>
          <kbd
            class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
            >⇧↵</kbd
          >
        </div>
      </div>
    </section>

    {#if cliBindings.length > 0}
      <section>
        <h3>
          <button
            type="button"
            class="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            onclick={() => (cliExpanded = !cliExpanded)}
          >
            <Icon
              name="chevron-down"
              size="xs"
              class="transition-transform {cliExpanded ? '' : '-rotate-90'}"
            />
            {t("shortcutHelp_cliRef")}
          </button>
        </h3>
        {#if cliExpanded}
          <div class="mt-2 space-y-1">
            {#each cliBindings as b (b.command)}
              <div class="flex items-center justify-between py-0.5">
                <span class="text-xs text-foreground/50">{b.label}</span>
                <kbd
                  class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/50"
                  >{formatKeyDisplay(b.key)}</kbd
                >
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>

  <div class="border-t border-border px-5 py-2.5">
    <p class="text-[10px] text-muted-foreground">{t("shortcutHelp_customize")}</p>
  </div>
</MiDialog>
