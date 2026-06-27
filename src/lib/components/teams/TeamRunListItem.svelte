<script lang="ts">
  import type { TeamRun, TeamRunStatus } from "$lib/types";
  import { t, tRaw } from "$lib/i18n/index.svelte";

  let {
    run,
    selected,
    onSelect,
  }: {
    run: TeamRun;
    selected: boolean;
    onSelect: () => void;
  } = $props();

  const STATUS_COLORS: Record<TeamRunStatus, string> = {
    created: "bg-muted-foreground/30",
    planning: "bg-miwarp-accent-violet",
    running: "bg-miwarp-status-info",
    completed: "bg-miwarp-status-success",
    failed: "bg-miwarp-status-error",
    cancelled: "bg-muted-foreground/30",
  };

  const STATUS_TEXT: Record<TeamRunStatus, string> = {
    created: "teamRun_statusCreated",
    planning: "teamRun_statusPlanning",
    running: "teamRun_statusRunning",
    completed: "teamRun_statusCompleted",
    failed: "teamRun_statusFailed",
    cancelled: "teamRun_statusCancelled",
  };

  let doneCount = $derived(
    run.memberRuns.filter((m) => m.status === "completed" || m.status === "failed").length,
  );
  let totalCount = $derived(run.memberRuns.length);

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return tRaw("team_justNow");
    if (minutes < 60) return tRaw("team_minutesAgo", { count: String(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return tRaw("team_hoursAgo", { count: String(hours) });
    return tRaw("team_daysAgo", { count: String(Math.floor(hours / 24)) });
  }
</script>

<button
  type="button"
  class="w-full text-left px-3 py-2.5 hover:bg-accent/30 transition-colors border-l-2 {selected
    ? 'border-l-primary bg-accent/20'
    : 'border-l-transparent'}"
  onclick={onSelect}
>
  <div class="flex items-center gap-2 mb-1">
    <span
      class="h-2 w-2 shrink-0 rounded-full {STATUS_COLORS[run.status]} {run.status === 'running' ||
      run.status === 'planning'
        ? 'animate-pulse'
        : ''}"
    ></span>
    <span class="text-xs font-medium text-foreground truncate">{run.teamName}</span>
    <span class="ml-auto text-[10px] text-muted-foreground shrink-0">
      {relativeTime(run.createdAt)}
    </span>
  </div>
  <p class="text-[11px] text-muted-foreground line-clamp-2">{run.prompt}</p>
  <div class="flex items-center gap-2 mt-1">
    <span
      class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium
      {run.status === 'completed'
        ? 'bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success'
        : run.status === 'failed'
          ? 'bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error'
          : run.status === 'running' || run.status === 'planning'
            ? 'bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info'
            : 'bg-muted text-muted-foreground'}"
    >
      {tRaw(STATUS_TEXT[run.status])}
    </span>
    <span class="text-[10px] text-muted-foreground/60">
      {t("teamsPage_memberProgress", {
        done: String(doneCount),
        total: String(totalCount),
      })}
    </span>
  </div>
</button>
