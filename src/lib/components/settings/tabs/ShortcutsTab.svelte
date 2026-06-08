<script lang="ts">
  /**
   * v1.0.6 follow-up: extracted from settings +page.svelte's
   * `activeTab === "shortcuts"` branch. Owns the 3 keybinding cards
   * (editable app / fixed / cli) + reset-all. Pulls keybinding data
   * from the existing `keybindings` context (see +layout.svelte).
   */
  import { getContext } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import { IS_WINDOWS } from "$lib/utils/platform";
  import { formatKeyDisplay } from "$lib/stores/keybindings.svelte";
  import type { KeybindingStore } from "$lib/stores/keybindings.svelte";
  import KeybindingEditor from "$lib/components/KeybindingEditor.svelte";
  import Card from "$lib/components/Card.svelte";
  import Icon from "$lib/components/Icon.svelte";

  const keybindingStore = getContext<KeybindingStore>("keybindings");

  const appBindings = $derived(
    keybindingStore.resolved.filter((b) => b.source === "app" && b.editable),
  );
  const fixedBindings = $derived(
    keybindingStore.resolved.filter((b) => b.source === "app" && !b.editable),
  );
  const cliBindings = $derived(keybindingStore.resolved.filter((b) => b.source === "cli"));
  const hasOverrides = $derived(keybindingStore.overrides.length > 0);

  let cliSectionOpen = $state(false);
  let cliSource = $state<"defaults" | "file">("defaults");
  let recordingConflict = $state("");

  function isOverridden(command: string): boolean {
    return keybindingStore.overrides.some((o) => o.command === command);
  }

  function getConflictWarning(
    key: string,
    context: string | null | undefined,
    excludeCmd: string,
  ): string {
    const c = keybindingStore.findConflict(key, context ?? "", excludeCmd);
    return c ? String(c) : "";
  }

  function lk(key: string): string {
    return t(key as MessageKey);
  }
</script>

<div class="space-y-4">
  <!-- App shortcuts (editable) -->
  <Card class="p-5">
    <div class="mb-4">
      <h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_shortcuts_appShortcuts")}
      </h2>
      <p class="text-[11px] text-muted-foreground/60 mt-0.5">
        {lk("settings_shortcuts_inputAppDesc")}
      </p>
    </div>
    <div class="divide-y divide-border/50 -mx-3 px-3">
      {#each appBindings as binding (binding.command)}
        <KeybindingEditor
          {binding}
          isOverridden={isOverridden(binding.command)}
          conflictWarning={recordingConflict}
          onSave={(key) => {
            const conflict = getConflictWarning(key, binding.context, binding.command);
            if (conflict) {
              recordingConflict = conflict;
            }
            keybindingStore.setOverride(binding.command, key);
            recordingConflict = "";
          }}
          onReset={isOverridden(binding.command)
            ? () => keybindingStore.resetBinding(binding.command)
            : undefined}
        />
      {/each}
    </div>
  </Card>

  <!-- Fixed shortcuts -->
  <Card class="p-5">
    <div class="mb-4">
      <h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_shortcuts_inputFixed")}
      </h2>
      <p class="text-[11px] text-muted-foreground/60 mt-0.5">
        {t("settings_shortcuts_inputFixedDesc")}
      </p>
    </div>
    <div class="divide-y divide-border/50 -mx-3 px-3">
      {#each fixedBindings as binding (binding.command)}
        <div class="flex items-center gap-3 py-1.5 group">
          <span class="text-sm text-foreground/70 flex-1 min-w-0 truncate">{binding.label}</span>
          <span
            class="shrink-0 inline-flex items-center rounded border bg-muted/40 px-2 py-0.5 text-xs font-mono text-muted-foreground"
          >
            {formatKeyDisplay(binding.key)}
          </span>
        </div>
      {/each}
    </div>
  </Card>

  <!-- CLI shortcuts (collapsible) -->
  <Card class="p-5">
    <button
      type="button"
      class="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors w-full mb-3"
      onclick={() => (cliSectionOpen = !cliSectionOpen)}
    >
      <Icon
        name="chevron-right"
        size="xs"
        class="transition-transform {cliSectionOpen ? 'rotate-90' : ''}"
      />
      {t("settings_shortcuts_cliShortcuts")}
      <span
        class="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/50 ml-1"
        >{t("settings_shortcuts_readOnly")}</span
      >
    </button>
    {#if cliSectionOpen}
      <div class="divide-y divide-border/50 -mx-3 px-3">
        {#each cliBindings as binding (binding.command)}
          <div class="flex items-center gap-3 py-1.5">
            <span class="text-sm text-foreground/60 flex-1 min-w-0 truncate">{binding.label}</span>
            <span
              class="shrink-0 inline-flex items-center rounded border bg-muted/40 px-2 py-0.5 text-xs font-mono text-muted-foreground"
            >
              {formatKeyDisplay(binding.key)}
            </span>
          </div>
        {/each}
      </div>
      <p class="text-[10px] text-muted-foreground/50 mt-3 font-mono">
        {cliSource === "file"
          ? IS_WINDOWS
            ? "%USERPROFILE%\\.claude\\keybindings.json"
            : "~/.claude/keybindings.json"
          : t("settings_shortcuts_cliDefaults")}
      </p>
    {/if}
  </Card>

  <!-- Reset all -->
  {#if hasOverrides}
    <div class="flex justify-end pt-1">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 hover:border-destructive/50 transition-colors"
        onclick={() => keybindingStore.resetAll()}
      >
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"></svg>
        {lk("settings_shortcuts_resetAll")}
      </button>
    </div>
  {/if}
</div>
