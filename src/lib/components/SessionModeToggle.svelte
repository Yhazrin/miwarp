<script lang="ts">
  /**
   * v1.0.6 follow-up: shared 3-option toggle for the default session
   * creation mode. Replaces the three inline buttons that lived in the
   * Settings page — the previous pattern had a closure-capture issue
   * that made the third ("ask on new branch") option feel un-clickable
   * when the default was "worktree".
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";

  type Mode = "single" | "worktree" | "ask_on_new_branch";

  let {
    value = "single",
    onChange,
  }: {
    value?: string;
    onChange?: (mode: Mode) => void | Promise<void>;
  } = $props();

  const modes: Array<{ key: Mode; labelKey: MessageKey }> = [
    { key: "single", labelKey: "settings_sessionModeSingle" },
    { key: "worktree", labelKey: "settings_sessionModeWorktree" },
    { key: "ask_on_new_branch", labelKey: "settings_sessionModeAsk" },
  ];

  async function handleClick(mode: Mode) {
    if (mode === value) return;
    if (onChange) await onChange(mode);
  }
</script>

<div
  role="group"
  aria-label={t("settings_defaultSessionMode")}
  class="grid grid-cols-3 rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5"
>
  {#each modes as mode (mode.key)}
    <button
      type="button"
      data-mode={mode.key}
      aria-pressed={value === mode.key}
      class="cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-all
        duration-150 select-none whitespace-nowrap text-center
        {value === mode.key
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => handleClick(mode.key)}
    >
      {t(mode.labelKey)}
    </button>
  {/each}
</div>
