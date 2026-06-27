<script lang="ts">
  /**
   * Personal Profile — single scrollable page that aggregates everything
   * that is "about you as a MiWarp user":
   *   - Identity (name, handle, role, timezone, email)
   *   - AI preferences (default runtime, default + fallback model)
   *   - Memory & Skills (links)
   *   - Sessions defaults (mode + worktree automation)
   *   - Provider connections (read-only summary)
   *   - Activity (7-day cost / runs)
   *   - Notifications (top-level toggles)
   *   - Display & Locale (language + zoom)
   *   - Data (export JSON, reset to defaults)
   *
   * Every editable field is persisted via the existing `updateUserSettings`
   * partial-patch command — no new backend surface area is required.
   */
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import {
    getUserSettings,
    resetUserSettings,
    updateUserSettings,
    getUsageOverview,
    runtimeHubList,
  } from "$lib/api";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { skillStore } from "$lib/stores/skill-store.svelte";
  import { runtimeHubStore } from "$lib/stores/runtime-hub-store.svelte";
  import type { UserSettings } from "$lib/types";

  import PersonalHero from "$lib/components/personal/PersonalHero.svelte";
  import PersonalIdentityCard from "$lib/components/personal/PersonalIdentityCard.svelte";
  import PersonalAiPrefsCard from "$lib/components/personal/PersonalAiPrefsCard.svelte";
  import PersonalMemoryCard from "$lib/components/personal/PersonalMemoryCard.svelte";
  import PersonalSessionsCard from "$lib/components/personal/PersonalSessionsCard.svelte";
  import PersonalProvidersCard from "$lib/components/personal/PersonalProvidersCard.svelte";
  import PersonalActivityCard from "$lib/components/personal/PersonalActivityCard.svelte";
  import PersonalNotificationsCard from "$lib/components/personal/PersonalNotificationsCard.svelte";
  import PersonalDisplayCard from "$lib/components/personal/PersonalDisplayCard.svelte";
  import PersonalDataCard from "$lib/components/personal/PersonalDataCard.svelte";
  import type {
    AiSettings,
    DisplaySettings,
    IdentitySettings,
    NotificationSettings,
    ProviderSettings,
    SessionSettings,
  } from "$lib/components/personal/settings-slice";

  let loading = $state(true);
  let settings = $state<UserSettings | null>(null);
  let runtimes = $state<string[]>([]);

  // Activity (7d)
  let activity = $state<{
    runs7d: number | null;
    totalCostUsd: number | null;
    dailyCost: number[];
  }>({ runs7d: null, totalCostUsd: null, dailyCost: [] });

  // 把 settings 按域切成 5 个独立 prop。任意字段编辑只触发对应 slice 的
  // `$derived` 重算，不会让 9 个 card 同时重渲染（之前传整个 settings 时
  // 任何字段改动都会触发 9 棵子树级联刷新）。
  const identitySettings = $derived<IdentitySettings | null>(
    settings
      ? {
          user_display_name: settings.user_display_name,
          user_handle: settings.user_handle,
          user_role: settings.user_role,
          user_timezone: settings.user_timezone,
          user_email: settings.user_email,
        }
      : null,
  );
  const aiSettings = $derived<AiSettings | null>(
    settings
      ? {
          default_agent: settings.default_agent,
          default_model: settings.default_model,
          fallback_model: settings.fallback_model,
          allowed_tools: settings.allowed_tools,
        }
      : null,
  );
  const sessionSettings = $derived<SessionSettings | null>(
    settings
      ? {
          default_session_mode: settings.default_session_mode,
          auto_commit_on_complete: settings.auto_commit_on_complete,
          auto_pr_on_complete: settings.auto_pr_on_complete,
          auto_cleanup_worktree: settings.auto_cleanup_worktree,
        }
      : null,
  );
  const notificationSettings = $derived<NotificationSettings | null>(
    settings
      ? {
          notifications_enabled: settings.notifications_enabled,
          notify_on_run_completed: settings.notify_on_run_completed,
          notify_on_run_failed: settings.notify_on_run_failed,
          notify_on_approval_required: settings.notify_on_approval_required,
          notify_on_schedule_completed: settings.notify_on_schedule_completed,
          notify_on_team_completed: settings.notify_on_team_completed,
        }
      : null,
  );
  const displaySettings = $derived<DisplaySettings | null>(
    settings
      ? {
          ui_zoom: settings.ui_zoom,
        }
      : null,
  );
  const providerSettings = $derived<ProviderSettings | null>(
    settings
      ? {
          platform_credentials: settings.platform_credentials,
          active_platform_id: settings.active_platform_id,
        }
      : null,
  );

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function applyZoom(factor: number) {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--miwarp-ui-zoom", String(factor));
  }

  /**
   * 把"首次进入页面"分两批：
   * - 关键路径（getUserSettings / runtimeHubList / loadActivity）保持同步 await，
   *   否则 loading 骨架会闪烁或 activity 7d 数据延迟太久。
   * - skillStore.loadSkills + runtimeHubStore.refresh 是 heavy store 写入，
   *   会触发各自 `$derived` 全量重算。延后到主线程空闲时再启动，避免 mount 期
   *   4 路并发副作用同时打 IO + 触发 derived 重算。
   */
  function scheduleIdleLoad(task: () => Promise<void> | void) {
    if (typeof window === "undefined") return;
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const runner = () => {
      try {
        void task();
      } catch (e) {
        dbgWarn("personal", "idle task threw", e);
      }
    };
    if (typeof ric === "function") {
      ric(runner, { timeout: 1500 });
    } else {
      window.setTimeout(runner, 0);
    }
  }

  onMount(async () => {
    try {
      const [s, hub] = await Promise.all([
        getUserSettings(),
        runtimeHubList(false).catch(() => null),
      ]);
      settings = s;
      if (hub?.runtimes) {
        runtimes = hub.runtimes.map((r) => r.runtimeId).filter(Boolean);
      }
    } catch (e) {
      dbgWarn("personal", "load settings failed", e);
    } finally {
      loading = false;
    }

    // 关键路径立刻跑：7 天 activity 影响 PersonalHero 渲染。
    void loadActivity();

    // 重副作用延后到主线程空闲：避免 mount 期 4 路并发 + 2 个 store 的
    // `$derived` 全部同时重算导致 9 个 card 一起抖动。
    scheduleIdleLoad(() =>
      skillStore.loadSkills().catch((e) => dbgWarn("personal", "load skills failed", e)),
    );
    scheduleIdleLoad(() => runtimeHubStore.refresh().catch(() => {}));
  });

  async function loadActivity() {
    try {
      const overview = await getUsageOverview(7);
      const daily = (overview.daily ?? []).slice(-7).map((d) => d.costUsd ?? 0);
      activity = {
        runs7d: overview.totalRuns ?? null,
        totalCostUsd: overview.totalCostUsd ?? null,
        dailyCost: daily,
      };
    } catch (e) {
      dbgWarn("personal", "load activity failed", e);
      activity = { runs7d: null, totalCostUsd: null, dailyCost: [] };
    }
  }

  async function commit(patch: Partial<UserSettings>): Promise<void> {
    if (!settings) return;
    const next = await updateUserSettings(patch);
    settings = next;
    dbg("personal", "settings patched", Object.keys(patch));
  }

  async function handleReset(): Promise<void> {
    if (!settings) return;
    const next = await resetUserSettings();
    settings = next;
    showToast(lk("personal_reset_done"), "success");
  }

  const skillCount = $derived(skillStore.skills?.length ?? 0);
  const providerCount = $derived(settings?.platform_credentials?.length ?? 0);
  const sinceDays = $derived.by(() => {
    if (!settings?.updated_at) return null;
    const ts = Date.parse(settings.updated_at);
    if (Number.isNaN(ts)) return null;
    const diff = Date.now() - ts;
    return Math.max(0, Math.floor(diff / 86_400_000));
  });

  const heroStats = $derived({
    runs7d: activity.runs7d,
    skills: skillCount,
    providers: providerCount,
    sinceDays,
  });
</script>

<svelte:head>
  <title>{lk("personal_title")} · MiWarp</title>
</svelte:head>

<div class="min-h-full px-6 py-10 sm:px-10 sm:py-14">
  <div class="mx-auto w-full max-w-3xl space-y-6">
    {#if loading || !settings}
      <div class="space-y-4">
        <div class="h-40 animate-pulse rounded-xl bg-sidebar/40"></div>
        <div class="h-64 animate-pulse rounded-xl bg-sidebar/40"></div>
        <div class="h-48 animate-pulse rounded-xl bg-sidebar/40"></div>
      </div>
    {:else if identitySettings && aiSettings && sessionSettings && notificationSettings && displaySettings && providerSettings}
      <PersonalHero {identitySettings} stats={heroStats} />

      <PersonalIdentityCard {identitySettings} onCommit={commit} />
      <PersonalAiPrefsCard {aiSettings} {runtimes} onCommit={commit} />
      <PersonalMemoryCard {skillCount} />
      <PersonalSessionsCard {sessionSettings} onCommit={commit} />
      <PersonalProvidersCard {providerSettings} />
      <PersonalActivityCard
        totalRuns={activity.runs7d}
        totalCostUsd={activity.totalCostUsd}
        dailyCost={activity.dailyCost}
      />
      <PersonalNotificationsCard {notificationSettings} onCommit={commit} />
      <PersonalDisplayCard {displaySettings} onCommit={commit} onZoom={applyZoom} />
      <PersonalDataCard {settings} onReset={handleReset} />
    {/if}
  </div>
</div>
