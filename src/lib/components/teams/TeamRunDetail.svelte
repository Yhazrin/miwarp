<script lang="ts">
  import type { TeamRun, TeamRunStatus, TeamMemberRunStatus } from "$lib/types";
  import { t, tRaw } from "$lib/i18n/index.svelte";
  import { goto } from "$app/navigation";

  let {
    run,
    onCancel,
  }: {
    run: TeamRun;
    onCancel: (id: string) => Promise<void> | void;
  } = $props();

  const STATUS_COLORS: Record<TeamRunStatus, string> = {
    created: "bg-muted-foreground/30",
    planning: "bg-miwarp-accent-violet",
    running: "bg-miwarp-status-info",
    completed: "bg-miwarp-status-success",
    failed: "bg-miwarp-status-error",
    cancelled: "bg-muted-foreground/30",
  };

  const STATUS_TEXT_KEY: Record<TeamRunStatus, string> = {
    created: "teamRun_statusCreated",
    planning: "teamRun_statusPlanning",
    running: "teamRun_statusRunning",
    completed: "teamRun_statusCompleted",
    failed: "teamRun_statusFailed",
    cancelled: "teamRun_statusCancelled",
  };

  const MEMBER_STATUS_COLORS: Record<TeamMemberRunStatus, string> = {
    pending: "bg-muted-foreground/30",
    running: "bg-miwarp-status-info",
    completed: "bg-miwarp-status-success",
    failed: "bg-miwarp-status-error",
  };

  let doneCount = $derived(
    run.memberRuns.filter((m) => m.status === "completed" || m.status === "failed").length,
  );
  let totalCount = $derived(run.memberRuns.length);
  let progressPct = $derived(totalCount > 0 ? (doneCount / totalCount) * 100 : 0);
  let isActive = $derived(run.status === "running" || run.status === "planning");

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("team_justNow");
    if (minutes < 60) return t("team_minutesAgo", { count: String(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("team_hoursAgo", { count: String(hours) });
    return t("team_daysAgo", { count: String(Math.floor(hours / 24)) });
  }

  function openInChat() {
    goto("/chat");
  }
</script>

<!-- Header -->
<div class="shrink-0 border-b border-border px-4 py-3">
  <div class="flex items-center gap-2 mb-1">
    <h2 class="text-sm font-semibold text-foreground">{run.teamName}</h2>
    <span
      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium
      {run.status === 'completed'
        ? 'bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success'
        : run.status === 'failed'
          ? 'bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error'
          : run.status === 'running' || run.status === 'planning'
            ? 'bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info'
            : 'bg-muted text-muted-foreground'}"
    >
      <span
        class="h-1.5 w-1.5 rounded-full {STATUS_COLORS[run.status]} {isActive
          ? 'animate-pulse'
          : ''}"
      ></span>
      {tRaw(STATUS_TEXT_KEY[run.status])}
    </span>
    {#if isActive}
      <button
        type="button"
        class="ml-auto rounded-md px-2.5 py-1 text-[11px] font-medium border border-[hsl(var(--miwarp-status-error)/0.3)] text-miwarp-status-error hover:bg-[hsl(var(--miwarp-status-error)/0.1)] transition-colors"
        onclick={() => onCancel(run.id)}
      >
        {t("teamRun_cancel")}
      </button>
    {:else}
      <button
        type="button"
        class="ml-auto text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
        onclick={openInChat}
      >
        {t("teamsPage_runInChat")}
      </button>
    {/if}
  </div>
  <p class="text-xs text-foreground/80">{run.prompt}</p>
  <div class="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/60">
    <span>{t("teamRun_created")}: {relativeTime(run.createdAt)}</span>
    {#if run.cwd}
      <span class="font-mono truncate">{run.cwd}</span>
    {/if}
  </div>
</div>

<!-- Body -->
<div class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
  <!-- Progress bar -->
  {#if isActive}
    <div>
      <div class="h-1 w-full rounded-full bg-muted overflow-hidden">
        {#if run.status === "planning"}
          <div
            class="h-full rounded-full bg-miwarp-accent-violet animate-pulse"
            style="width: 30%"
          ></div>
        {:else}
          <div
            class="h-full rounded-full bg-primary transition-all duration-500"
            style="width: {progressPct}%"
          ></div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Lead plan -->
  {#if run.leadPlan}
    <div>
      <h3 class="text-xs font-medium text-foreground mb-1.5">{t("teamRun_leadPlan")}</h3>
      <div
        class="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed"
      >
        {run.leadPlan}
      </div>
    </div>
  {/if}

  <!-- Member cards grid -->
  {#if run.memberRuns.length > 0}
    <div>
      <h3 class="text-xs font-medium text-foreground mb-1.5">
        {tRaw("teamRun_membersLabel", { count: String(run.memberRuns.length) })}
      </h3>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each run.memberRuns as member (member.id)}
          {@const dot =
            MEMBER_STATUS_COLORS[member.status as TeamMemberRunStatus] ?? "bg-muted-foreground/30"}
          <div class="rounded-lg border border-border/40 bg-background/60 px-2.5 py-2">
            <div class="flex items-center gap-2 mb-1">
              <span
                class="h-2 w-2 shrink-0 rounded-full {dot} {member.status === 'running'
                  ? 'animate-pulse'
                  : ''}"
              ></span>
              <p class="text-[11px] font-semibold text-foreground truncate">{member.memberName}</p>
              <span class="ml-auto text-[10px] text-muted-foreground/60 truncate">
                {member.role}
              </span>
            </div>
            {#if member.task}
              <p class="text-[10px] text-muted-foreground/70 line-clamp-2 leading-snug mb-1">
                {member.task}
              </p>
            {/if}
            {#if member.summary}
              <p
                class="text-[10px] text-foreground/70 line-clamp-4 leading-snug whitespace-pre-wrap"
              >
                {member.summary}
              </p>
            {/if}
            {#if member.error}
              <p class="text-[10px] text-miwarp-status-error leading-snug">{member.error}</p>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Summary -->
  {#if run.summary}
    <div>
      <h3 class="text-xs font-medium text-foreground mb-1.5">{t("teamRun_summary")}</h3>
      <div
        class="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed"
      >
        {run.summary}
      </div>
    </div>
  {/if}

  <!-- Error -->
  {#if run.error}
    <div
      class="rounded-lg border border-[hsl(var(--miwarp-status-error)/0.2)] bg-[hsl(var(--miwarp-status-error)/0.05)] px-3 py-2 text-[11px] text-miwarp-status-error"
    >
      {run.error}
    </div>
  {/if}
</div>
