<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { TeamRun, TeamRunStatus } from "$lib/types";
  import { goto } from "$app/navigation";

  let {
    teamRun,
    onViewDetails,
  }: {
    teamRun: TeamRun;
    onViewDetails?: () => void;
  } = $props();

  let doneCount = $derived(
    teamRun.memberRuns.filter((m) => m.status === "completed" || m.status === "failed").length,
  );
  let totalCount = $derived(teamRun.memberRuns.length);
  let progressPct = $derived(totalCount > 0 ? (doneCount / totalCount) * 100 : 0);

  const STATUS_COLORS: Record<TeamRunStatus, string> = {
    created: "bg-gray-400",
    planning: "bg-violet-500",
    running: "bg-blue-500",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
    cancelled: "bg-gray-400",
  };

  const STATUS_TEXT: Record<TeamRunStatus, () => string> = {
    created: () => t("teamRun_statusCreated"),
    planning: () => t("teamRun_statusPlanning"),
    running: () => t("teamRun_statusRunning"),
    completed: () => t("teamRun_statusCompleted"),
    failed: () => t("teamRun_statusFailed"),
    cancelled: () => t("teamRun_statusCancelled"),
  };

  const MEMBER_STATUS_COLORS: Record<string, string> = {
    pending: "bg-muted-foreground/30",
    running: "bg-blue-500",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
  };

  function handleViewTeams() {
    goto("/teams");
  }
</script>

/** * TeamRunCard — inline card shown in chat to display TeamRun status. * Shows preset, progress,
member status, and summary. */
<div
  class="rounded-lg border border-border bg-card/80 backdrop-blur-sm overflow-hidden my-2 max-w-lg"
>
  <!-- Header -->
  <div class="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border/50">
    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-semibold text-foreground">{teamRun.teamName}</span>
        <span
          class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium
          {teamRun.status === 'completed'
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : teamRun.status === 'failed'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : teamRun.status === 'running' || teamRun.status === 'planning'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'bg-muted text-muted-foreground'}"
        >
          <span
            class="h-1.5 w-1.5 rounded-full {STATUS_COLORS[teamRun.status]}
            {teamRun.status === 'running' || teamRun.status === 'planning' ? 'animate-pulse' : ''}"
          ></span>
          {STATUS_TEXT[teamRun.status]()}
        </span>
      </div>
      <p class="text-[11px] text-muted-foreground line-clamp-1">{teamRun.prompt}</p>
    </div>
  </div>

  <!-- Progress bar (when running) -->
  {#if teamRun.status === "running" || teamRun.status === "planning"}
    <div class="px-3.5 py-2">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[10px] text-muted-foreground">
          {teamRun.status === "planning" ? t("teamRun_planning") : t("teamRun_executing")}
        </span>
        {#if teamRun.status === "running"}
          <span class="text-[10px] text-muted-foreground tabular-nums">
            {t("teamRun_memberProgress", { done: String(doneCount), total: String(totalCount) })}
          </span>
        {/if}
      </div>
      {#if teamRun.status === "running"}
        <div class="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            class="h-full rounded-full bg-primary transition-all duration-500"
            style="width: {progressPct}%"
          ></div>
        </div>
      {:else}
        <div class="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div class="h-full rounded-full bg-violet-500 animate-pulse" style="width: 30%"></div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Members -->
  <div class="px-3.5 py-2 space-y-1">
    {#each teamRun.memberRuns as member (member.id)}
      <div class="flex items-center gap-2">
        <span
          class="h-2 w-2 shrink-0 rounded-full {MEMBER_STATUS_COLORS[member.status] || 'bg-muted'}"
        ></span>
        <span class="text-[11px] font-medium text-foreground/80 min-w-0 truncate"
          >{member.memberName}</span
        >
        <span class="text-[10px] text-muted-foreground/60">{member.role}</span>
        {#if member.status === "running"}
          <span class="ml-auto text-[10px] text-blue-500 animate-pulse">...</span>
        {:else if member.status === "completed"}
          <span class="ml-auto text-[10px] text-emerald-500">done</span>
        {:else if member.status === "failed"}
          <span class="ml-auto text-[10px] text-red-500">fail</span>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Summary preview (when completed) -->
  {#if teamRun.summary && (teamRun.status === "completed" || teamRun.status === "failed")}
    <div class="border-t border-border/50 px-3.5 py-2">
      <p class="text-[11px] text-muted-foreground line-clamp-4 whitespace-pre-wrap">
        {teamRun.summary}
      </p>
    </div>
  {/if}

  <!-- Error -->
  {#if teamRun.error}
    <div class="border-t border-red-500/20 px-3.5 py-2 bg-red-500/5">
      <p class="text-[11px] text-red-500">{teamRun.error}</p>
    </div>
  {/if}

  <!-- Footer actions -->
  <div class="flex items-center gap-2 border-t border-border/50 px-3.5 py-2">
    <button
      class="text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
      onclick={handleViewTeams}
    >
      {t("teamRun_viewDetails")}
    </button>
    {#if onViewDetails}
      <button
        class="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        onclick={onViewDetails}
      >
        {t("teamRun_summaryView")}
      </button>
    {/if}
  </div>
</div>
