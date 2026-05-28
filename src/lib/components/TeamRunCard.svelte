<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { TeamRun, TeamRunStatus } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";
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
  let expanded = $state<Set<string>>(new Set());

  const STATUS_COLORS: Record<TeamRunStatus, string> = {
    created: "bg-muted-foreground/30",
    planning: "bg-miwarp-accent-violet",
    running: "bg-miwarp-status-info",
    completed: "bg-miwarp-status-success",
    failed: "bg-miwarp-status-error",
    cancelled: "bg-muted-foreground/30",
  };

  const STATUS_TEXT: Record<TeamRunStatus, () => string> = {
    created: () => t("teamRun_statusCreated"),
    planning: () => t("teamRun_statusPlanning"),
    running: () => t("teamRun_statusRunning"),
    completed: () => t("teamRun_statusCompleted"),
    failed: () => t("teamRun_statusFailed"),
    cancelled: () => t("teamRun_statusCancelled"),
  };

  const MEMBER_STATUS_MAP: Record<
    string,
    { dot: string; ring: string; label: string; pulse: boolean }
  > = {
    pending: {
      dot: "bg-muted-foreground/30",
      ring: "ring-muted-foreground/20",
      label: "待命",
      pulse: false,
    },
    running: { dot: "bg-miwarp-status-info", ring: "ring-[hsl(var(--miwarp-status-info)/0.3)]", label: "运行中", pulse: true },
    completed: { dot: "bg-miwarp-status-success", ring: "ring-[hsl(var(--miwarp-status-success)/0.3)]", label: "完成", pulse: false },
    failed: { dot: "bg-miwarp-status-error", ring: "ring-[hsl(var(--miwarp-status-error)/0.3)]", label: "失败", pulse: false },
  };

  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function handleViewTeams() {
    goto("/teams");
  }
</script>

<div
  class="rounded-xl border border-border/60 bg-card/90 backdrop-blur-sm overflow-hidden my-2 w-full
    {teamRun.status === 'running' || teamRun.status === 'planning' ? 'motion-running-pulse' : ''}
    {teamRun.status === 'completed' ? 'motion-status-success' : ''}
    {teamRun.status === 'failed' ? 'motion-status-error' : ''}"
>
  <!-- Header -->
  <div class="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border/40">
    <div
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
    >
      <Icon name="users" size="sm" />
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-semibold text-foreground">{teamRun.teamName}</span>
        <span
          class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium
          {teamRun.status === 'completed'
            ? 'bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success'
            : teamRun.status === 'failed'
              ? 'bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error'
              : teamRun.status === 'running' || teamRun.status === 'planning'
                ? 'bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info'
                : 'bg-muted text-muted-foreground'}"
        >
          <span
            class="h-1.5 w-1.5 rounded-full {STATUS_COLORS[teamRun.status]}
            {teamRun.status === 'running' || teamRun.status === 'planning' ? 'animate-pulse' : ''}"
          ></span>
          {STATUS_TEXT[teamRun.status]()}
        </span>
        <span class="text-[10px] text-muted-foreground/50 ml-auto"
          >{doneCount}/{totalCount} 完成</span
        >
      </div>
      <p class="text-[11px] text-muted-foreground/70 line-clamp-1 mt-0.5">{teamRun.prompt}</p>
    </div>
  </div>

  <!-- Progress bar (when running or planning) -->
  {#if teamRun.status === "running" || teamRun.status === "planning"}
    <div class="px-3.5 pt-2 pb-1">
      <div class="h-1 w-full rounded-full bg-muted overflow-hidden">
        {#if teamRun.status === "planning"}
          <div class="h-full rounded-full bg-miwarp-accent-violet animate-pulse" style="width: 30%"></div>
        {:else}
          <div
            class="h-full rounded-full bg-primary transition-all duration-500"
            style="width: {progressPct}%"
          ></div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Agent Cards Grid (parallel layout) -->
  {#if teamRun.memberRuns.length > 0}
    <div
      class="px-3 py-2.5 grid gap-2"
      style="grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr));"
    >
      {#each teamRun.memberRuns as member (member.id)}
        {@const st = MEMBER_STATUS_MAP[member.status] ?? MEMBER_STATUS_MAP.pending}
        {@const isExpanded = expanded.has(member.id)}
        <div
          class="rounded-lg border bg-background/60 overflow-hidden ring-1 {st.ring} transition-all duration-200"
        >
          <!-- Agent card header -->
          <button
            class="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/20 transition-colors"
            onclick={() => toggleExpand(member.id)}
          >
            <span class="relative flex h-2 w-2 shrink-0">
              <span
                class="h-2 w-2 rounded-full {st.dot} {st.pulse
                  ? 'animate-ping absolute opacity-60'
                  : ''}"
              ></span>
              {#if st.pulse}
                <span class="relative h-2 w-2 rounded-full {st.dot}"></span>
              {/if}
            </span>
            <div class="flex-1 min-w-0">
              <p class="text-[11px] font-semibold text-foreground truncate">{member.memberName}</p>
              <p class="text-[10px] text-muted-foreground/60 truncate">{member.role}</p>
            </div>
            <Icon name="chevron-right" size="xs" class="shrink-0 text-muted-foreground/50 transition-transform duration-200 {isExpanded ? 'rotate-90' : ''}" />
          </button>

          <!-- Expanded content -->
          {#if isExpanded}
            <div class="border-t border-border/30 px-2.5 py-2 space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-muted-foreground">状态</span>
                <span class="text-[10px] font-medium {st.dot.replace('bg-', 'text-')}"
                  >{st.label}</span
                >
              </div>
              {#if member.summary}
                <p
                  class="text-[10px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap line-clamp-4"
                >
                  {member.summary}
                </p>
              {/if}
              {#if member.error}
                <p class="text-[10px] text-miwarp-status-error leading-relaxed">{member.error}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Summary preview (when completed/failed) -->
  {#if teamRun.summary && (teamRun.status === "completed" || teamRun.status === "failed")}
    <div class="border-t border-border/40 px-3.5 py-2.5">
      <p class="text-[11px] text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
        {teamRun.summary}
      </p>
    </div>
  {/if}

  <!-- Error -->
  {#if teamRun.error}
    <div class="border-t border-[hsl(var(--miwarp-status-error)/0.2)] px-3.5 py-2 bg-[hsl(var(--miwarp-status-error)/0.05)]">
      <p class="text-[11px] text-miwarp-status-error">{teamRun.error}</p>
    </div>
  {/if}

  <!-- Footer -->
  <div class="flex items-center gap-3 border-t border-border/40 px-3.5 py-2">
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
