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
   *
   * v1.1.0 perf: first paint is gated ONLY on the layout-shared Settings cache.
   * Runtime options come from the static startable-runtime registry. Activity
   * and skill count hydrate independently, so profile navigation never launches
   * CLI probes or waits on usage aggregation.
   */
  import { getContext, onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import {
    getUsageOverview,
    getSkillSummary,
    resetPersonalProfile,
    updateUserSettings,
  } from "$lib/api";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import {
    SETTINGS_CACHE_CONTEXT_KEY,
    resolveLayoutCachedSettings,
    type SettingsCacheContext,
  } from "$lib/layout-chrome-context";
  import { createPersonalColdStart } from "./personal-cold-start";
  import type { UserSettings } from "$lib/types";
  import { STARTABLE_RUNTIME_IDS } from "$lib/runtime";

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
  import type { PersonalExportStats } from "$lib/utils/personal-export";
  import type {
    AiSettings,
    DisplaySettings,
    IdentitySettings,
    NotificationSettings,
    ProviderSettings,
    SessionSettings,
  } from "$lib/components/personal/settings-slice";

  type LoadState = "pending" | "ready" | "failed";

  const settingsCache = getContext<SettingsCacheContext | undefined>(SETTINGS_CACHE_CONTEXT_KEY);
  /** Sync-read the layout cache so hot navigation skips the skeleton frame. */
  const initialSettings = settingsCache?.settings ?? null;
  let settingsLoad = $state<LoadState>(initialSettings ? "ready" : "pending");
  let settings = $state<UserSettings | null>(initialSettings);

  // The Personal page only needs the stable list of runtimes MiWarp can start.
  // Runtime installation/health probing belongs to Settings/Runtime Center and
  // must never run during profile navigation: each cold probe may spawn several
  // CLIs and previously froze the Tauri command loop for seconds.
  const runtimes = [...STARTABLE_RUNTIME_IDS];
  const runtimesLoading = false;

  // Activity (7d) — per-card skeleton, does not block first paint.
  let activity = $state<{
    runs7d: number | null;
    totalCostUsd: number | null;
    dailyCost: number[];
  }>({ runs7d: null, totalCostUsd: null, dailyCost: [] });

  // Skill count — fetched via the lightweight `get_skill_summary` IPC. We do
  // NOT touch `skillStore.loadSkills()` here; that triggers the full store
  // re-derivation and is reserved for the dedicated /skills page.
  let skillCount = $state<number | null>(null);

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
   * Defers work until the main thread is idle so cold-start mount does not
   * race the render path. Falls back to setTimeout(0) in environments without
   * `requestIdleCallback` (Safari SSR / test envs).
   */
  function scheduleIdleLoad(task: () => void): boolean {
    if (typeof window === "undefined") {
      task();
      return false;
    }
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const runner = () => {
      try {
        task();
      } catch (e) {
        dbgWarn("personal", "idle task threw", e);
      }
    };
    if (typeof ric === "function") {
      ric(runner, { timeout: 1500 });
      return true;
    }
    window.setTimeout(runner, 0);
    return false;
  }

  const coldStart = createPersonalColdStart(
    {
      resolveSettings: () => resolveLayoutCachedSettings(settingsCache),
      refreshSettings: async () => (settingsCache ? settingsCache.refresh() : null),
      getUsageOverview: () => getUsageOverview(7),
      getSkillSummary: () => getSkillSummary(),
      scheduleIdle: (task) => scheduleIdleLoad(task),
    },
    {
      onSettingsLoad: (state, s) => {
        settingsLoad = state;
        settings = s;
      },
      onActivityLoaded: (snapshot) => {
        activity = snapshot;
      },
      onSkillCountLoaded: (count) => {
        skillCount = count;
      },
    },
  );

  onMount(() => {
    coldStart.start();
  });

  async function retrySettings(): Promise<void> {
    await coldStart.retry();
  }

  function continueWithoutSettings(): void {
    // Synthesise an empty UserSettings so the page renders read-only; edits
    // are best-effort and may fail until the real settings come back.
    coldStart.continueWithoutSettings({} as UserSettings);
  }

  async function commit(patch: Partial<UserSettings>): Promise<void> {
    if (!settings) return;
    try {
      const next = await updateUserSettings(patch);
      settings = next;
      dbg("personal", "settings patched", Object.keys(patch));
    } catch (e) {
      dbgWarn("personal", "patch failed", e);
    }
  }

  async function handleReset(): Promise<void> {
    if (!settings) return;
    try {
      const next = await resetPersonalProfile();
      settings = next;
      showToast(lk("personal_reset_done"), "success");
    } catch (e) {
      dbgWarn("personal", "reset failed", e);
    }
  }

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

  // Stats embedded in the personal profile export. Mirrors `heroStats` minus
  // `sinceDays` (which is derived from `updated_at` and isn't part of the
  // export DTO). Fall back to zeros while activity / skillCount are still
  // hydrating so the export button stays usable from first paint.
  const exportStats = $derived<PersonalExportStats>({
    runs7d: activity.runs7d ?? 0,
    skillCount: skillCount ?? 0,
    providerCount,
  });
</script>

<svelte:head>
  <title>{lk("personal_title")} · MiWarp</title>
</svelte:head>

<div class="min-h-full px-6 py-10 sm:px-10 sm:py-14">
  <div class="mx-auto w-full max-w-3xl space-y-6">
    {#if settingsLoad === "pending" || (settingsLoad === "ready" && !settings)}
      <div class="space-y-4">
        <div class="h-40 animate-pulse rounded-xl bg-sidebar/40"></div>
        <div class="h-64 animate-pulse rounded-xl bg-sidebar/40"></div>
        <div class="h-48 animate-pulse rounded-xl bg-sidebar/40"></div>
      </div>
    {:else if settingsLoad === "failed"}
      <div class="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-6">
        <div class="space-y-1">
          <h2 class="text-base font-semibold text-foreground">
            {lk("personal_settings_load_failed_title")}
          </h2>
          <p class="text-sm text-muted-foreground">
            {lk("personal_settings_load_failed_desc")}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            onclick={() => {
              void retrySettings();
            }}
          >
            {lk("personal_settings_retry")}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onclick={continueWithoutSettings}
          >
            {lk("personal_settings_continue")}
          </button>
        </div>
      </div>
    {:else if identitySettings && aiSettings && sessionSettings && notificationSettings && displaySettings && providerSettings}
      <PersonalHero {identitySettings} stats={heroStats} />

      <PersonalIdentityCard {identitySettings} onCommit={commit} />
      <PersonalAiPrefsCard {aiSettings} {runtimes} {runtimesLoading} onCommit={commit} />
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
      <PersonalDataCard settings={settings!} onReset={handleReset} stats={exportStats} />
    {/if}
  </div>
</div>
