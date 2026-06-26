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

  let loading = $state(true);
  let settings = $state<UserSettings | null>(null);
  let runtimes = $state<string[]>([]);

  // Activity (7d)
  let activity = $state<{
    runs7d: number | null;
    totalCostUsd: number | null;
    dailyCost: number[];
  }>({ runs7d: null, totalCostUsd: null, dailyCost: [] });

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function applyZoom(factor: number) {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--miwarp-ui-zoom", String(factor));
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

    // Background loads — never block first paint on these.
    void loadActivity();
    void skillStore.loadSkills().catch((e) => dbgWarn("personal", "load skills failed", e));
    void runtimeHubStore.refresh().catch(() => {});
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
    {:else}
      <PersonalHero {settings} stats={heroStats} />

      <PersonalIdentityCard {settings} onCommit={commit} />
      <PersonalAiPrefsCard {settings} {runtimes} onCommit={commit} />
      <PersonalMemoryCard {skillCount} />
      <PersonalSessionsCard {settings} onCommit={commit} />
      <PersonalProvidersCard {settings} />
      <PersonalActivityCard
        totalRuns={activity.runs7d}
        totalCostUsd={activity.totalCostUsd}
        dailyCost={activity.dailyCost}
      />
      <PersonalNotificationsCard {settings} onCommit={commit} />
      <PersonalDisplayCard {settings} onCommit={commit} onZoom={applyZoom} />
      <PersonalDataCard {settings} onReset={handleReset} />
    {/if}
  </div>
</div>
