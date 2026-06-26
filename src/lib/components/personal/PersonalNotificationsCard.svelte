<script lang="ts">
  /**
   * Notifications card — surface the most-used notification toggles so the
   * user doesn't have to dig into settings. The full Feishu / sound / min
   * duration knobs still live in /settings.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { UserSettings } from "$lib/types";
  import SettingsToggle from "$lib/components/settings/SettingsToggle.svelte";
  import PersonalSection from "./PersonalSection.svelte";

  let {
    settings,
    onCommit,
  }: {
    settings: UserSettings;
    onCommit: (patch: Partial<UserSettings>) => Promise<void>;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }
</script>

<PersonalSection
  icon="zap"
  eyebrow={lk("personal_section_notifications_eyebrow")}
  title={lk("personal_section_notifications_title")}
  description={lk("personal_section_notifications_desc")}
>
  <div class="rounded-lg border border-border/40 divide-y divide-border/40">
    <div class="px-3 py-2">
      <SettingsToggle
        checked={!!settings.notifications_enabled}
        label={lk("settings_notif_enabled")}
        description={lk("settings_notif_enabledDesc")}
        onchange={(v) => onCommit({ notifications_enabled: v })}
      />
    </div>
    <div class="px-3 py-2">
      <SettingsToggle
        checked={!!settings.notify_on_run_completed}
        label={lk("settings_notif_runCompleted")}
        disabled={!settings.notifications_enabled}
        onchange={(v) => onCommit({ notify_on_run_completed: v })}
      />
    </div>
    <div class="px-3 py-2">
      <SettingsToggle
        checked={!!settings.notify_on_run_failed}
        label={lk("settings_notif_runFailed")}
        disabled={!settings.notifications_enabled}
        onchange={(v) => onCommit({ notify_on_run_failed: v })}
      />
    </div>
    <div class="px-3 py-2">
      <SettingsToggle
        checked={!!settings.notify_on_approval_required}
        label={lk("settings_notif_approvalRequired")}
        disabled={!settings.notifications_enabled}
        onchange={(v) => onCommit({ notify_on_approval_required: v })}
      />
    </div>
    <div class="px-3 py-2">
      <SettingsToggle
        checked={!!settings.notify_on_schedule_completed}
        label={lk("settings_notif_scheduleCompleted")}
        disabled={!settings.notifications_enabled}
        onchange={(v) => onCommit({ notify_on_schedule_completed: v })}
      />
    </div>
    <div class="px-3 py-2">
      <SettingsToggle
        checked={!!settings.notify_on_team_completed}
        label={lk("settings_notif_teamCompleted")}
        disabled={!settings.notifications_enabled}
        onchange={(v) => onCommit({ notify_on_team_completed: v })}
      />
    </div>
  </div>
</PersonalSection>
