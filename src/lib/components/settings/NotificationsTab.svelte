<script lang="ts">
  import { onMount } from "svelte";
  import type { UserSettings } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import * as api from "$lib/api";
  import Card from "$lib/components/Card.svelte";
  import SettingsToggle from "$lib/components/settings/SettingsToggle.svelte";
  import { FEISHU_CARD_MASCOT_OPTIONS } from "$lib/utils/feishu-card-mascots";
  import { dbgWarn } from "$lib/utils/debug";

  let {
    initialSettings,
    onSettingsUpdated,
  }: {
    initialSettings: UserSettings;
    onSettingsUpdated: (updated: UserSettings) => void;
  } = $props();

  // ── Notification settings ──
  let notifEnabled = $state(true);
  let notifRunCompleted = $state(true);
  let notifRunFailed = $state(true);
  let notifApprovalRequired = $state(true);
  let notifScheduleCompleted = $state(true);
  let notifTeamCompleted = $state(true);
  let notifMinDuration = $state(10);
  let notifSaved = $state(false);

  // ── Feishu webhook settings ──
  let feishuWebhookUrl = $state("");
  let feishuWebhookEnabled = $state(false);
  let feishuWebhookTriggers = $state<string[]>([]);
  let feishuWebhookCardMascot = $state("");
  let feishuCardImgKey = $state("");
  let feishuSaved = $state(false);
  let feishuTesting = $state(false);
  let feishuTestResult = $state<string | null>(null);
  let feishuUrlError = $state<string | null>(null);

  // ── Local working copy of settings (updated after each save) ──
  let settings = $state<UserSettings>(initialSettings);

  onMount(() => {
    settings = initialSettings;
    notifEnabled = initialSettings.notifications_enabled ?? true;
    notifRunCompleted = initialSettings.notify_on_run_completed ?? true;
    notifRunFailed = initialSettings.notify_on_run_failed ?? true;
    notifApprovalRequired = initialSettings.notify_on_approval_required ?? true;
    notifScheduleCompleted = initialSettings.notify_on_schedule_completed ?? true;
    notifTeamCompleted = initialSettings.notify_on_team_completed ?? true;
    notifMinDuration = initialSettings.notification_min_duration_sec ?? 10;
    feishuWebhookUrl = initialSettings.feishu_webhook_url ?? "";
    feishuWebhookEnabled = initialSettings.feishu_webhook_enabled ?? false;
    feishuWebhookTriggers = initialSettings.feishu_webhook_triggers ?? [];
    feishuWebhookCardMascot = initialSettings.feishu_webhook_card_mascot ?? "";
    feishuCardImgKey = initialSettings.feishu_webhook_card_img_key ?? "";
  });

  // ── Functions ──

  async function saveNotificationSettings() {
    try {
      settings = await api.updateUserSettings({
        notifications_enabled: notifEnabled,
        notify_on_run_completed: notifRunCompleted,
        notify_on_run_failed: notifRunFailed,
        notify_on_approval_required: notifApprovalRequired,
        notify_on_schedule_completed: notifScheduleCompleted,
        notify_on_team_completed: notifTeamCompleted,
        notification_min_duration_sec: notifMinDuration,
      } as Partial<UserSettings>);
      notifSaved = true;
      setTimeout(() => (notifSaved = false), 1500);
      onSettingsUpdated(settings);
    } catch (e) {
      dbgWarn("settings", "saveNotificationSettings error", e);
    }
  }

  function validateFeishuUrl(url: string): string | null {
    if (!url) return null;
    if (
      url.startsWith("https://open.feishu.cn/open-apis/bot/v2/hook/") ||
      url.startsWith("https://open.larksuite.com/open-apis/bot/v2/hook/")
    ) {
      return null;
    }
    return t("settings_notif_feishuUrlInvalid") || "Invalid Feishu webhook URL";
  }

  async function saveFeishuSettings(): Promise<boolean> {
    feishuUrlError = validateFeishuUrl(feishuWebhookUrl);
    if (feishuUrlError && feishuWebhookEnabled) return false;
    try {
      settings = await api.updateUserSettings({
        feishu_webhook_url: feishuWebhookUrl || null,
        feishu_webhook_enabled: feishuWebhookEnabled,
        feishu_webhook_triggers: feishuWebhookTriggers,
        feishu_webhook_card_img_key: feishuCardImgKey.trim() || null,
        feishu_webhook_card_mascot: feishuWebhookCardMascot.trim() || null,
        feishu_webhook_card_image_url: null,
      } as Partial<UserSettings>);
      feishuSaved = true;
      setTimeout(() => (feishuSaved = false), 1500);
      onSettingsUpdated(settings);
      return true;
    } catch (e) {
      dbgWarn("settings", "saveFeishuSettings error", e);
      return false;
    }
  }

  async function testFeishuWebhook() {
    feishuUrlError = validateFeishuUrl(feishuWebhookUrl);
    if (feishuUrlError) return;
    const saved = await saveFeishuSettings();
    if (!saved) return;
    feishuTesting = true;
    feishuTestResult = null;
    try {
      const mascotLabel = FEISHU_CARD_MASCOT_OPTIONS.find(
        (o) => o.value === feishuWebhookCardMascot,
      )?.label;
      const body = mascotLabel
        ? t("settings_notif_feishuTestBodyWithMascot", { mascot: mascotLabel })
        : t("settings_notif_feishuTestBody");
      await api.sendFeishuNotification("Test", body, "test");
      feishuTestResult = t("settings_notif_feishuTestOk") || "Test notification sent";
    } catch (e: unknown) {
      feishuTestResult = (e as Error)?.message || "Failed to send";
    } finally {
      feishuTesting = false;
    }
  }
</script>

<!-- ═══ System Notifications ═══ -->
<Card class="p-6 space-y-5">
  <div class="flex items-center justify-between">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_notif_title") || "System Notifications"}
    </h2>
    {#if notifSaved}
      <span class="text-xs text-emerald-500 flex items-center gap-1 animate-fade-in">
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {t("settings_general_saved")}
      </span>
    {/if}
  </div>

  <p class="text-xs text-muted-foreground">
    {t("settings_notif_desc") || "Get notified when tasks complete, fail, or need your attention."}
  </p>

  <!-- Master toggle -->
  <SettingsToggle
    checked={notifEnabled}
    onchange={(v) => {
      notifEnabled = v;
      saveNotificationSettings();
    }}
    label={t("settings_notif_enabled") || "Enable notifications"}
    description={t("settings_notif_enabledDesc") || "Allow MiWarp to send system notifications"}
  />

  {#if notifEnabled}
    <div class="space-y-3 pl-1 border-l-2 border-muted/50 ml-1">
      <!-- Run completed -->
      <SettingsToggle
        checked={notifRunCompleted}
        onchange={(v) => {
          notifRunCompleted = v;
          saveNotificationSettings();
        }}
        label={t("settings_notif_runCompleted") || "Run completed"}
      />

      <!-- Run failed -->
      <SettingsToggle
        checked={notifRunFailed}
        onchange={(v) => {
          notifRunFailed = v;
          saveNotificationSettings();
        }}
        label={t("settings_notif_runFailed") || "Run failed"}
      />

      <!-- Approval required -->
      <SettingsToggle
        checked={notifApprovalRequired}
        onchange={(v) => {
          notifApprovalRequired = v;
          saveNotificationSettings();
        }}
        label={t("settings_notif_approvalRequired") || "Waiting for approval"}
      />

      <!-- Schedule completed -->
      <SettingsToggle
        checked={notifScheduleCompleted}
        onchange={(v) => {
          notifScheduleCompleted = v;
          saveNotificationSettings();
        }}
        label={t("settings_notif_scheduleCompleted") || "Scheduled task completed"}
      />

      <!-- Team completed -->
      <SettingsToggle
        checked={notifTeamCompleted}
        onchange={(v) => {
          notifTeamCompleted = v;
          saveNotificationSettings();
        }}
        label={t("settings_notif_teamCompleted") || "Team run completed"}
      />

      <!-- Min duration -->
      <div class="flex items-center justify-between py-1.5">
        <div>
          <span class="text-sm">{t("settings_notif_minDuration") || "Min task duration"}</span>
          <p class="text-xs text-muted-foreground mt-0.5">
            {t("settings_notif_minDurationDesc") || "Only notify for tasks longer than this"}
          </p>
        </div>
        <div class="flex items-center gap-1.5">
          <input
            type="number"
            min="0"
            max="300"
            step="5"
            bind:value={notifMinDuration}
            onchange={saveNotificationSettings}
            class="w-16 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-right
            focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span class="text-xs text-muted-foreground">s</span>
        </div>
      </div>
    </div>
  {/if}
</Card>

<!-- ═══ Feishu Webhook card ═══ -->
<Card class="p-6 space-y-5">
  <div class="flex items-center justify-between">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_notif_feishuTitle") || "Feishu Webhook"}
    </h2>
    {#if feishuSaved}
      <span class="text-xs text-emerald-500 flex items-center gap-1 animate-fade-in">
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {t("settings_general_saved")}
      </span>
    {/if}
  </div>

  <p class="text-xs text-muted-foreground">
    {t("settings_notif_feishuDesc") ||
      "Send task completion notifications to a Feishu group chat via webhook."}
  </p>

  <!-- Enable toggle -->
  <SettingsToggle
    checked={feishuWebhookEnabled}
    onchange={(v) => {
      feishuWebhookEnabled = v;
      saveFeishuSettings();
    }}
    label={t("settings_notif_feishuEnabled") || "Enable Feishu notifications"}
    description={t("settings_notif_feishuEnabledDesc") ||
      "Post to Feishu webhook when tasks or scheduled jobs complete"}
  />

  <!-- URL input -->
  <div class="space-y-1.5">
    <label class="text-sm font-medium" for="feishu-webhook-url">
      {t("settings_notif_feishuUrl") || "Webhook URL"}
    </label>
    <input
      id="feishu-webhook-url"
      type="url"
      bind:value={feishuWebhookUrl}
      oninput={() => {
        feishuUrlError = validateFeishuUrl(feishuWebhookUrl);
      }}
      onchange={saveFeishuSettings}
      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
      class="w-full rounded-md border {feishuUrlError
        ? 'border-destructive'
        : 'border-border'} bg-transparent px-3 py-2 text-sm
      font-mono placeholder:text-muted-foreground/50
      focus:outline-none focus:ring-1 focus:ring-ring"
    />
    {#if feishuUrlError}
      <p class="text-xs text-destructive">{feishuUrlError}</p>
    {/if}
  </div>

  <!-- Card cover image: Feishu img_key (official) — see Feishu docs on `img` + fit_horizontal -->
  <div class="space-y-2">
    <label class="text-sm font-medium" for="feishu-card-img-key">
      {t("settings_notif_feishuCardImgKey")}
    </label>
    <input
      id="feishu-card-img-key"
      type="text"
      bind:value={feishuCardImgKey}
      onchange={saveFeishuSettings}
      placeholder={t("settings_notif_feishuCardImgKeyPh")}
      class="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm
      font-mono placeholder:text-muted-foreground/50
      focus:outline-none focus:ring-1 focus:ring-ring"
    />
    <p class="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
      {t("settings_notif_feishuCardImgKeyHint")}
    </p>
  </div>

  <!-- Fallback mascot presets (Markdown image URL; used only if img_key is empty) -->
  <div class="space-y-2">
    <label class="text-sm font-medium" for="feishu-card-mascot">
      {t("settings_notif_feishuCardMascot")}
    </label>
    <select
      id="feishu-card-mascot"
      class="w-full max-w-md rounded-md border border-border bg-transparent px-3 py-2 text-sm
      focus:outline-none focus:ring-1 focus:ring-ring"
      bind:value={feishuWebhookCardMascot}
      onchange={saveFeishuSettings}
    >
      <option value="">{t("settings_notif_feishuCardMascotNone")}</option>
      {#each FEISHU_CARD_MASCOT_OPTIONS as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <p class="text-xs text-muted-foreground leading-relaxed">
      {t("settings_notif_feishuCardMascotHint")}
    </p>
  </div>

  <!-- Test button -->
  <div class="flex items-center gap-2">
    <button
      class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs
      font-medium hover:bg-muted transition-colors disabled:opacity-50"
      disabled={feishuTesting || !feishuWebhookUrl}
      onclick={testFeishuWebhook}
    >
      {#if feishuTesting}
        <svg
          class="h-3 w-3 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83" />
        </svg>
      {/if}
      {t("settings_notif_feishuTest") || "Send test"}
    </button>
    {#if feishuTestResult}
      <span
        class="text-xs {feishuTestResult.includes('Failed') || feishuTestResult.includes('Error')
          ? 'text-destructive'
          : 'text-emerald-500'}"
      >
        {feishuTestResult}
      </span>
    {/if}
  </div>

  <!-- Trigger scope -->
  {#if feishuWebhookEnabled}
    <div class="space-y-2 pt-2 border-t border-muted/50">
      <p class="text-xs text-muted-foreground">
        {t("settings_notif_feishuTriggersDesc") ||
          "Choose which events trigger Feishu notifications. Leave unchecked to notify on all events."}
      </p>
      <div class="grid grid-cols-2 gap-2">
        {#each [["run_completed", t("settings_notif_feishuTriggerRun") || "Run completed"], ["run_failed", t("settings_notif_feishuTriggerFailed") || "Run failed"], ["schedule_completed", t("settings_notif_feishuTriggerSchedule") || "Schedule completed"], ["team_completed", t("settings_notif_feishuTriggerTeam") || "Team completed"]] as [trigger, label]}
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={feishuWebhookTriggers.includes(trigger)}
              onchange={() => {
                if (feishuWebhookTriggers.includes(trigger)) {
                  feishuWebhookTriggers = feishuWebhookTriggers.filter((t) => t !== trigger);
                } else {
                  feishuWebhookTriggers = [...feishuWebhookTriggers, trigger];
                }
                saveFeishuSettings();
              }}
              class="rounded border-border"
            />
            {label}
          </label>
        {/each}
      </div>
    </div>
  {/if}
</Card>
