<script lang="ts">
  import { onMount } from "svelte";
  import {
    listTeamRuns,
    getTeamRun,
    cancelTeamRun,
    listTeamPresets,
    createTeamRun,
  } from "$lib/api";
  import type { TeamPreset, TeamRun } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { dbgWarn } from "$lib/utils/debug";
  import Spinner from "$lib/components/Spinner.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import TeamPresetCard from "$lib/components/teams/TeamPresetCard.svelte";
  import TeamRunListItem from "$lib/components/teams/TeamRunListItem.svelte";
  import TeamRunDetail from "$lib/components/teams/TeamRunDetail.svelte";

  // ── TeamRun state ──
  let teamRuns = $state<TeamRun[]>([]);
  let selectedRunId = $state<string | null>(null);
  let selectedRun = $state<TeamRun | null>(null);
  let runsLoading = $state(true);
  let runsError = $state("");

  // ── Quick-launch state ──
  let presets = $state<TeamPreset[]>([]);
  let presetsLoading = $state(true);
  let launchingPresetId = $state<string | null>(null);
  let quickPrompt = $state("");
  let launchError = $state("");

  // ── Initial load + auto-select first run ──
  onMount(async () => {
    await Promise.all([loadTeamRuns(), loadPresets()]);
    if (teamRuns.length > 0 && !selectedRunId) {
      selectRun(teamRuns[0].id);
    }
  });

  async function loadTeamRuns() {
    runsLoading = true;
    runsError = "";
    try {
      teamRuns = await listTeamRuns();
    } catch (e) {
      runsError = String(e);
      dbgWarn("teams", "Failed to load team runs:", e);
    } finally {
      runsLoading = false;
    }
  }

  async function loadPresets() {
    presetsLoading = true;
    try {
      presets = await listTeamPresets();
    } catch (e) {
      dbgWarn("teams", "Failed to load team presets:", e);
    } finally {
      presetsLoading = false;
    }
  }

  async function selectRun(id: string) {
    selectedRunId = id;
    try {
      selectedRun = await getTeamRun(id);
    } catch (e) {
      dbgWarn("teams", "Failed to load team run:", e);
      selectedRun = null;
    }
  }

  async function handleCancelRun(id: string) {
    try {
      await cancelTeamRun(id);
      await loadTeamRuns();
      if (selectedRunId === id) {
        await selectRun(id);
      }
    } catch (e) {
      dbgWarn("teams", "Failed to cancel team run:", e);
    }
  }

  /** Launch the selected preset with the typed prompt, then navigate to chat. */
  async function launchPreset(presetId: string) {
    const prompt = quickPrompt.trim();
    if (!prompt || launchingPresetId) return;
    launchingPresetId = presetId;
    launchError = "";
    try {
      const run = await createTeamRun(presetId, prompt, "");
      teamRuns = [run, ...teamRuns];
      await selectRun(run.id);
      quickPrompt = "";
    } catch (e) {
      launchError = String(e);
      dbgWarn("teams", "Failed to launch preset:", e);
    } finally {
      launchingPresetId = null;
    }
  }
</script>

<div class="h-full overflow-y-auto">
  <!-- ── Page header ── -->
  <div class="border-b border-border px-6 py-4">
    <div class="flex items-start gap-3">
      <div
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
      >
        <svg
          class="h-4.5 w-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
      <div class="min-w-0">
        <h1 class="text-base font-semibold text-foreground leading-tight">
          {t("teamsPage_title")}
        </h1>
        <p class="text-xs text-muted-foreground mt-0.5 max-w-2xl">
          {t("teamsPage_subtitle")}
        </p>
      </div>
    </div>
  </div>

  <!-- ── Quick launch section ── -->
  <section class="border-b border-border/60 px-6 py-5">
    <div class="flex items-baseline justify-between mb-3">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("teamsPage_quickLaunch")}
      </h2>
      <span class="text-[10px] text-muted-foreground/60">
        {presets.length > 0
          ? t("teamsPage_presetMembers", {
              count: String(presets.reduce((n, p) => n + p.members.length, 0)),
            })
          : ""}
      </span>
    </div>

    {#if presetsLoading}
      <div class="flex items-center justify-center py-8">
        <Spinner size="sm" />
      </div>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each presets as preset (preset.id)}
          <TeamPresetCard {preset} busy={launchingPresetId === preset.id} onLaunch={launchPreset} />
        {/each}
      </div>

      <div class="mt-3 flex items-stretch gap-2">
        <input
          type="text"
          bind:value={quickPrompt}
          placeholder={t("teamsPage_promptPlaceholder")}
          class="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          onkeydown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && presets[0]) {
              e.preventDefault();
              launchPreset(presets[0].id);
            }
          }}
        />
      </div>

      {#if launchError}
        <p class="mt-2 text-[11px] text-miwarp-status-error">{launchError}</p>
      {:else if quickPrompt.trim() === ""}
        <p class="mt-2 text-[11px] text-muted-foreground/70">
          {t("teamsPage_promptPlaceholder")}
        </p>
      {/if}
    {/if}
  </section>

  <!-- ── Recent runs section ── -->
  <section class="px-6 py-5">
    <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {t("teamsPage_recent")}
    </h2>

    {#if runsLoading}
      <div class="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    {:else if runsError}
      <div class="px-3 py-6 text-center">
        <p class="text-xs text-miwarp-status-error">{runsError}</p>
        <button
          type="button"
          class="mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
          onclick={loadTeamRuns}
        >
          {t("teamRun_retry")}
        </button>
      </div>
    {:else if teamRuns.length === 0}
      <EmptyState
        iconName="users"
        description={t("teamsPage_noRuns")}
        class="border border-dashed border-border/60 rounded-xl py-10"
      />
    {:else}
      <div class="flex gap-4 min-h-0">
        <!-- Run list -->
        <div
          class="w-[280px] shrink-0 rounded-xl border border-border/60 bg-card/50 overflow-hidden flex flex-col"
        >
          <div class="flex-1 overflow-y-auto divide-y divide-border/30">
            {#each teamRuns as run (run.id)}
              <TeamRunListItem
                {run}
                selected={selectedRunId === run.id}
                onSelect={() => selectRun(run.id)}
              />
            {/each}
          </div>
        </div>

        <!-- Run detail -->
        <div
          class="flex-1 min-w-0 rounded-xl border border-border/60 bg-card/50 overflow-hidden flex flex-col"
        >
          {#if !selectedRun}
            <div class="flex flex-col items-center justify-center h-full text-center px-6 py-12">
              <p class="text-sm text-muted-foreground">{t("teamRun_selectRun")}</p>
            </div>
          {:else}
            <TeamRunDetail run={selectedRun} onCancel={handleCancelRun} />
          {/if}
        </div>
      </div>
    {/if}
  </section>
</div>
