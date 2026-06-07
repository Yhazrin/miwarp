<script lang="ts">
  /**
   * v1.0.6 follow-up: notifications tab shell. Receives state via
   * props from the orchestrator. The full inline form (master toggle,
   * sound feedback, 5 sub-toggles, feishu webhook card) lives
   * temporarily in +page.svelte until each piece is migrated into
   * sub-components.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";

  let {
    settings,
    notifEnabled = true,
    notifRunCompleted = true,
    notifRunFailed = true,
    notifApprovalRequired = true,
    notifScheduleCompleted = true,
    notifTeamCompleted = true,
    notifMinDuration = 10,
    soundFeedbackLevel = "minimal",
    feishuWebhookUrl = "",
    feishuWebhookEnabled = false,
    feishuWebhookTriggers = [] as string[],
    feishuTestResult = null as string | null,
    onSaveNotificationSettings = async () => {},
    onSaveFeishuSettings = async () => {},
    onTestFeishuWebhook = async () => {},
  }: {
    settings: UserSettings | null;
    notifEnabled?: boolean;
    notifRunCompleted?: boolean;
    notifRunFailed?: boolean;
    notifApprovalRequired?: boolean;
    notifScheduleCompleted?: boolean;
    notifTeamCompleted?: boolean;
    notifMinDuration?: number;
    soundFeedbackLevel?: "off" | "minimal" | "standard" | "detailed";
    feishuWebhookUrl?: string;
    feishuWebhookEnabled?: boolean;
    feishuWebhookTriggers?: string[];
    feishuTestResult?: string | null;
    onSaveNotificationSettings?: () => Promise<void>;
    onSaveFeishuSettings?: () => Promise<void>;
    onTestFeishuWebhook?: () => Promise<void>;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  const triggerOptions = [
    { value: "run_completed", label: () => lk("settings_notif_runCompleted") },
    { value: "run_failed", label: () => lk("settings_notif_runFailed") },
    { value: "approval_required", label: () => lk("settings_notif_approvalRequired") },
    { value: "schedule_completed", label: () => lk("settings_notif_scheduleCompleted") },
    { value: "team_completed", label: () => lk("settings_notif_teamCompleted") },
  ];
</script>

<div class="space-y-6">
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {lk("settings_notifications_title")}
    </h2>
    <div class="flex items-center justify-between gap-4 py-1">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium">{lk("settings_notifications_enable")}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {lk("settings_notifications_enableDesc")}
        </p>
      </div>
      <button
        type="button"
        aria-label={lk("settings_notifications_enable")}
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {notifEnabled
          ? 'bg-primary'
          : 'bg-muted'}"
        onclick={() => {
          onSaveNotificationSettings();
        }}
      >
        <span
          class="inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform {notifEnabled
            ? 'translate-x-6'
            : 'translate-x-1'}"
        ></span>
      </button>
    </div>
    <div class="flex items-center justify-between gap-4 py-1">
      <p class="text-sm font-medium flex-1 min-w-0">
        {lk("settings_notif_minDuration")}
      </p>
      <input
        type="number"
        min="0"
        step="1"
        value={notifMinDuration}
        onblur={(e) => {
          const v = parseInt((e.target as HTMLInputElement).value, 10);
          if (Number.isFinite(v)) onSaveNotificationSettings();
        }}
        class="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
      />
    </div>
    <div class="flex items-center justify-between gap-4 py-1">
      <p class="text-sm font-medium flex-1 min-w-0">
        {lk("settings_notifications_sound")}
      </p>
      <div class="flex flex-wrap gap-1">
        {#each ["off", "minimal", "standard", "detailed"] as level (level)}
          <button
            type="button"
            class="rounded-md px-2 py-1 text-xs font-medium transition-all duration-150
              {soundFeedbackLevel === level
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
            onclick={() => onSaveNotificationSettings()}
          >
            {lk(`settings_sound_${level}`)}
          </button>
        {/each}
      </div>
    </div>
  </Card>

  <!-- Feishu Webhook Card -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {lk("settings_feishu_title")}
    </h2>
    <div class="flex items-center justify-between gap-4 py-1">
      <p class="text-sm font-medium flex-1 min-w-0">
        {lk("settings_feishu_enable")}
      </p>
      <button
        type="button"
        aria-label={lk("settings_feishu_enable")}
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {feishuWebhookEnabled
          ? 'bg-primary'
          : 'bg-muted'}"
        onclick={() => onSaveFeishuSettings()}
      >
        <span
          class="inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform {feishuWebhookEnabled
            ? 'translate-x-6'
            : 'translate-x-1'}"
        ></span>
      </button>
    </div>
    <input
      type="url"
      value={feishuWebhookUrl}
      placeholder={lk("settings_feishu_urlPlaceholder")}
      onblur={(e) => onSaveFeishuSettings()}
      class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
    />
    <div class="flex flex-wrap gap-1">
      {#each triggerOptions as opt (opt.value)}
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs font-medium transition-all duration-150
            {feishuWebhookTriggers.includes(opt.value)
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
          onclick={() => onSaveFeishuSettings()}
        >
          {opt.label()}
        </button>
      {/each}
    </div>
    <button
      type="button"
      aria-label={lk("settings_feishu_test")}
      class="rounded-md border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
      onclick={() => onTestFeishuWebhook()}
    >
      {lk("settings_feishu_test")}
    </button>
    {#if feishuTestResult}
      <p class="text-xs text-muted-foreground">{feishuTestResult}</p>
    {/if}
  </Card>
</div>
