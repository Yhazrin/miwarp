<script lang="ts">
  /**
   * v1.0.6 follow-up: re-extracted from settings +page.svelte (was
   * bundled inside the old "general" tab as the "Session Mode Card").
   * The default session mode toggle itself moved to the chat welcome
   * screen — this tab only carries the worktree-completion toggles
   * (auto-commit / auto-PR / auto-cleanup) that used to be nested
   * under that card.
   *
   * State is lifted to the orchestrator (+page.svelte).
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import SettingsToggle from "../SettingsToggle.svelte";

  let {
    settings,
    onSaveGeneralPatch = async (_patch: Record<string, unknown>) => {},
  }: {
    settings: UserSettings | null;
    onSaveGeneralPatch?: (patch: Record<string, unknown>) => Promise<void>;
  } = $props();
</script>

<div class="space-y-6">
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_sessionMode")}
    </h2>
    <p class="text-xs text-muted-foreground">
      {t("settings_worktreeTabDesc")}
    </p>

    <SettingsToggle
      checked={settings?.auto_commit_on_complete === true}
      label={t("settings_autoCommit")}
      description={t("settings_autoCommitDesc")}
      onchange={(value) => onSaveGeneralPatch({ auto_commit_on_complete: value })}
    />

    {#if settings?.auto_commit_on_complete}
      <SettingsToggle
        checked={settings?.auto_pr_on_complete === true}
        label={t("settings_autoPR")}
        description={t("settings_autoPRDesc")}
        onchange={(value) => onSaveGeneralPatch({ auto_pr_on_complete: value })}
      />
    {/if}

    <SettingsToggle
      checked={settings?.auto_cleanup_worktree !== false}
      label={t("settings_autoCleanupWorktree")}
      description={t("settings_autoCleanupWorktreeDesc")}
      onchange={(value) => onSaveGeneralPatch({ auto_cleanup_worktree: value })}
    />
  </Card>
</div>
