<!--
  TeamsSidebarBody — body for `/teams`. Team search + list. Lazy-loaded so
  other routes don't pull team-sidebar-store on initial parse.
-->
<script lang="ts">
  import { getContext } from "svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { teamSidebarStore as tss } from "$lib/layout/team-sidebar-store.svelte";
  import type { TeamStore } from "$lib/stores/team-store.svelte";
  import type { TeamSummary } from "$lib/types";

  interface Props {
    filteredTeams: TeamSummary[];
  }

  let { filteredTeams = [] }: Props = $props();

  const teamStore = getContext<TeamStore>("teamStore");
</script>

<div class="px-2 pt-2 pb-1 shrink-0 flex items-center justify-between gap-2">
  <input
    type="text"
    bind:value={tss.teamStoreSearchQuery}
    placeholder={t("sidebar_searchTeams")}
    class="w-full min-w-0 rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50"
  />
  <a
    href="/teams"
    class="shrink-0 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
    title={t("teamsPage_quickLaunch")}
  >
    +
  </a>
</div>
<div class="flex-1 overflow-y-auto px-2 py-1">
  {#if teamStore.loading}
    <div class="flex items-center justify-center py-6">
      <Spinner size="sm" />
    </div>
  {:else if filteredTeams.length === 0}
    <div class="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
      <p class="text-xs text-muted-foreground">{t("sidebar_noActiveTeams")}</p>
      <a
        href="/teams"
        class="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
      >
        {t("teamsPage_quickLaunch")} →
      </a>
    </div>
  {:else}
    {#each filteredTeams as team}
      <button
        type="button"
        class="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors mb-0.5
                {teamStore.selectedTeam === team.name
          ? 'bg-sidebar-accent text-sidebar-foreground'
          : 'hover:bg-sidebar-accent/50 text-sidebar-foreground'}"
        onclick={() => teamStore.selectTeam(team.name)}
      >
        <div class="flex items-center gap-1.5">
          <span class="h-2 w-2 rounded-full bg-miwarp-status-info shrink-0"></span>
          <span class="text-[13px] font-medium min-w-0 truncate">{team.name}</span>
        </div>
        {#if team.description}
          <p class="text-xs text-muted-foreground truncate pl-3.5">
            {team.description}
          </p>
        {/if}
        <div class="flex items-center gap-2 pl-3.5 text-xs text-muted-foreground">
          <span>{t("sidebar_members", { count: String(team.member_count) })}</span>
          <span>{t("sidebar_tasks", { count: String(team.task_count) })}</span>
        </div>
      </button>
    {/each}
  {/if}
</div>
