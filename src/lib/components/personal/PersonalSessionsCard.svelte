<script lang="ts">
  /**
   * Sessions Defaults — per-session boot behavior. Reuses the existing
   * UserSettings fields so changes show up immediately on the new-session
   * card in /chat.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { UserSettings } from "$lib/types";
  import type { SessionSettings } from "./settings-slice";
  import SettingsToggle from "$lib/components/settings/SettingsToggle.svelte";
  import PersonalSection from "./PersonalSection.svelte";

  let {
    sessionSettings,
    onCommit,
  }: {
    sessionSettings: SessionSettings;
    onCommit: (patch: Partial<UserSettings>) => Promise<void>;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  const SESSION_MODES = [
    { value: "single", labelKey: "personal_sessions_mode_single" },
    { value: "worktree", labelKey: "personal_sessions_mode_worktree" },
  ];

  async function pickMode(value: string) {
    if (value === (sessionSettings.default_session_mode ?? "single")) return;
    await onCommit({ default_session_mode: value });
  }
</script>

<PersonalSection
  icon="layout"
  eyebrow={lk("personal_section_sessions_eyebrow")}
  title={lk("personal_section_sessions_title")}
  description={lk("personal_section_sessions_desc")}
>
  <div class="space-y-3">
    <div class="space-y-2">
      <div>
        <p class="text-sm font-medium text-foreground">
          {lk("personal_sessions_defaultMode")}
        </p>
        <p class="text-xs text-muted-foreground">
          {lk("personal_sessions_defaultModeDesc")}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label={lk("personal_sessions_defaultMode")}
        class="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5"
      >
        {#each SESSION_MODES as opt (opt.value)}
          <button
            type="button"
            role="radio"
            aria-checked={(sessionSettings.default_session_mode ?? "single") === opt.value}
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150
              {(sessionSettings.default_session_mode ?? 'single') === opt.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => pickMode(opt.value)}
          >
            {lk(opt.labelKey)}
          </button>
        {/each}
      </div>
    </div>

    <div class="rounded-lg border border-border/40 divide-y divide-border/40">
      <div class="px-3 py-2">
        <SettingsToggle
          checked={!!sessionSettings.auto_commit_on_complete}
          label={lk("personal_sessions_autoCommit")}
          description={lk("personal_sessions_autoCommitDesc")}
          onchange={(v) => onCommit({ auto_commit_on_complete: v })}
        />
      </div>
      <div class="px-3 py-2">
        <SettingsToggle
          checked={!!sessionSettings.auto_pr_on_complete}
          label={lk("personal_sessions_autoPr")}
          description={lk("personal_sessions_autoPrDesc")}
          onchange={(v) => onCommit({ auto_pr_on_complete: v })}
        />
      </div>
      <div class="px-3 py-2">
        <SettingsToggle
          checked={!!sessionSettings.auto_cleanup_worktree}
          label={lk("personal_sessions_cleanupWorktree")}
          description={lk("personal_sessions_cleanupWorktreeDesc")}
          onchange={(v) => onCommit({ auto_cleanup_worktree: v })}
        />
      </div>
    </div>
  </div>
</PersonalSection>
