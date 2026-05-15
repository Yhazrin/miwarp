<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { getTeamTask, listTeamRuns, getTeamRun, cancelTeamRun } from "$lib/api";
  import type { TeamStore } from "$lib/stores/team-store.svelte";
  import type { TeamTask, TeamInboxMessage, TeamRun, TeamRunStatus } from "$lib/types";
  import { dbg } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";

  const teamStore = getContext<TeamStore>("teamStore");

  // ── Page mode: "runs" (TeamRun history) or "monitor" (legacy Team Monitor) ──
  let pageMode = $state<"runs" | "monitor">("runs");

  // ── TeamRun state ──
  let teamRuns = $state<TeamRun[]>([]);
  let selectedRunId = $state<string | null>(null);
  let selectedRun = $state<TeamRun | null>(null);
  let runsLoading = $state(true);
  let runsError = $state("");

  // ── Monitor state (existing) ──
  let expandPending = $state(true);
  let expandInProgress = $state(true);
  let expandCompleted = $state(false);
  let inboxTab = $state("all");
  let taskDescriptions = $state<Record<string, string>>({});
  let taskDescLoading = $state<Record<string, boolean>>({});
  let expandedMsgKey = $state<string | null>(null);
  let sidebarCollapsed = $state(false);
  let expandedMemberName = $state<string | null>(null);
  let _isLargeScreen = $state(true);
  let deleteConfirm = $state<string | null>(null);
  let deleting = $state(false);

  // ── Load TeamRuns on mount ──
  onMount(async () => {
    await loadTeamRuns();
  });

  async function loadTeamRuns() {
    runsLoading = true;
    runsError = "";
    try {
      teamRuns = await listTeamRuns();
    } catch (e) {
      runsError = String(e);
      console.error("Failed to load team runs:", e);
    } finally {
      runsLoading = false;
    }
  }

  async function selectRun(id: string) {
    selectedRunId = id;
    try {
      selectedRun = await getTeamRun(id);
    } catch (e) {
      console.error("Failed to load team run:", e);
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
      console.error("Failed to cancel team run:", e);
    }
  }

  function goToChat() {
    goto("/chat");
  }

  // ── Status helpers ──
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

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("team_justNow");
    if (minutes < 60) return t("team_minutesAgo", { count: String(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("team_hoursAgo", { count: String(hours) });
    return t("team_daysAgo", { count: String(Math.floor(hours / 24)) });
  }

  // ── Monitor helpers (existing) ──
  $effect(() => {
    const _team = teamStore.selectedTeam;
    inboxTab = "all";
    expandedMsgKey = null;
    expandedMemberName = null;
    taskDescriptions = {};
    taskDescLoading = {};
    teamStore.expandedTaskId = null;
  });

  $effect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    _isLargeScreen = mql.matches;
    if (!mql.matches) sidebarCollapsed = true;
    const handler = (e: MediaQueryListEvent) => {
      _isLargeScreen = e.matches;
      if (!e.matches) sidebarCollapsed = true;
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  });

  $effect(() => {
    if (teamStore.teams.length > 0 && !teamStore.selectedTeam) {
      teamStore.selectTeam(teamStore.teams[0].name);
    }
  });

  let displayedMessages = $derived.by((): TeamInboxMessage[] => {
    if (inboxTab === "all") return teamStore.allInbox;
    return teamStore.inbox;
  });

  function msgKey(msg: TeamInboxMessage): string {
    return `${msg.from}::${msg.timestamp}`;
  }

  function handleInboxTabClick(agentName: string) {
    inboxTab = agentName;
    if (!teamStore.selectedTeam) return;
    teamStore.loadInbox(teamStore.selectedTeam, agentName);
  }

  function handleAllInboxClick() {
    inboxTab = "all";
    if (teamStore.selectedTeam) {
      teamStore.loadAllInbox(teamStore.selectedTeam);
    }
  }

  async function toggleTaskExpand(task: TeamTask) {
    if (teamStore.expandedTaskId === task.id) {
      teamStore.expandedTaskId = null;
      return;
    }
    teamStore.expandedTaskId = task.id;
    if (!taskDescriptions[task.id] && !taskDescLoading[task.id]) {
      taskDescLoading = { ...taskDescLoading, [task.id]: true };
      try {
        const detail = await getTeamTask(teamStore.selectedTeam, task.id);
        taskDescriptions = { ...taskDescriptions, [task.id]: detail.description };
      } catch {
        taskDescriptions = {
          ...taskDescriptions,
          [task.id]: task.description || t("team_noDescription"),
        };
      } finally {
        taskDescLoading = { ...taskDescLoading, [task.id]: false };
      }
    }
  }

  function parseMessageType(text: string): { type: string; data: Record<string, unknown> } | null {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type) {
        const payload =
          parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
            ? parsed.data
            : parsed;
        return { type: parsed.type, data: payload };
      }
    } catch {
      /* plain text */
    }
    return null;
  }

  function timeAgoEpoch(epochMs: number): string {
    if (!epochMs || epochMs <= 0) return "";
    const diff = Date.now() - epochMs;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("team_justNow");
    if (minutes < 60) return t("team_minutesAgo", { count: String(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("team_hoursAgo", { count: String(hours) });
    return t("team_daysAgo", { count: String(Math.floor(hours / 24)) });
  }

  function timeAgo(timestamp: string): string {
    const ts = new Date(timestamp).getTime();
    if (isNaN(ts)) return "";
    return timeAgoEpoch(ts);
  }

  function truncatePath(path: string, maxLen: number = 35): string {
    if (path.length <= maxLen) return path;
    return "..." + path.slice(path.length - maxLen + 3);
  }

  async function handleDeleteTeam(name: string) {
    deleting = true;
    try {
      await teamStore.deleteTeam(name);
      deleteConfirm = null;
    } catch (e) {
      console.error("delete team failed:", e);
    } finally {
      deleting = false;
    }
  }

  function memberColorClass(color: string): string {
    const map: Record<string, string> = {
      purple: "bg-purple-500",
      blue: "bg-blue-500",
      green: "bg-green-500",
      red: "bg-red-500",
      orange: "bg-orange-500",
      yellow: "bg-yellow-500",
      cyan: "bg-cyan-500",
      pink: "bg-pink-500",
      teal: "bg-teal-500",
    };
    return map[color] ?? "bg-muted-foreground";
  }

  function msgColorClass(color: string): string {
    const map: Record<string, string> = {
      purple: "text-purple-500",
      blue: "text-blue-500",
      green: "text-green-500",
      red: "text-red-500",
      orange: "text-orange-500",
      yellow: "text-yellow-500",
      cyan: "text-cyan-500",
      pink: "text-pink-500",
      teal: "text-teal-500",
    };
    return map[color] ?? "text-muted-foreground";
  }

  function shortModel(model: string): string {
    if (!model) return "";
    const newFmt = model.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/i);
    if (newFmt) {
      const name = newFmt[1].charAt(0).toUpperCase() + newFmt[1].slice(1);
      return `${name} ${newFmt[2]}.${newFmt[3]}`;
    }
    const legacyFmt = model.match(/(\d+)-(\d+)-(opus|sonnet|haiku)/i);
    if (legacyFmt) {
      const name = legacyFmt[3].charAt(0).toUpperCase() + legacyFmt[3].slice(1);
      return `${name} ${legacyFmt[1]}.${legacyFmt[2]}`;
    }
    if (model.includes("opus")) return "Opus";
    if (model.includes("sonnet")) return "Sonnet";
    if (model.includes("haiku")) return "Haiku";
    return model.split("-").slice(0, 2).join("-");
  }
</script>

<div class="h-full overflow-hidden flex flex-col">
  <!-- Tab bar -->
  <div class="shrink-0 flex items-center gap-1 border-b border-border px-4 h-10">
    <button
      class="px-3 py-1.5 text-xs font-medium transition-colors border-b-2 {pageMode === 'runs'
        ? 'text-foreground border-primary'
        : 'text-muted-foreground hover:text-foreground border-transparent'}"
      onclick={() => (pageMode = "runs")}
    >
      {t("teamRun_tabRuns")}
    </button>
    <button
      class="px-3 py-1.5 text-xs font-medium transition-colors border-b-2 {pageMode === 'monitor'
        ? 'text-foreground border-primary'
        : 'text-muted-foreground hover:text-foreground border-transparent'}"
      onclick={() => (pageMode = "monitor")}
    >
      {t("teamRun_tabMonitor")}
    </button>
  </div>

  {#if pageMode === "runs"}
    <!-- ═══ TeamRun History Mode ═══ -->
    <div class="flex flex-1 min-h-0">
      <!-- Left: TeamRun list -->
      <div class="w-[300px] shrink-0 border-r border-border flex flex-col h-full">
        <div class="shrink-0 flex items-center justify-between px-3 h-10 border-b border-border/40">
          <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >{t("teamRun_history")}</span
          >
          <button
            class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            title={t("teamRun_refresh")}
            onclick={loadTeamRuns}
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto">
          {#if runsLoading}
            <div class="flex items-center justify-center py-12">
              <div
                class="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"
              ></div>
            </div>
          {:else if runsError}
            <div class="px-3 py-6 text-center">
              <p class="text-xs text-red-500">{runsError}</p>
              <button
                class="mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
                onclick={loadTeamRuns}>{t("teamRun_retry")}</button
              >
            </div>
          {:else if teamRuns.length === 0}
            <!-- Empty state -->
            <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div
                class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted"
              >
                <svg
                  class="h-5 w-5 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <p class="text-xs text-muted-foreground mb-3">{t("teamRun_emptyDesc")}</p>
              <button
                class="rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onclick={goToChat}
              >
                {t("teamRun_goToChat")}
              </button>
            </div>
          {:else}
            <div class="py-1">
              {#each teamRuns as run (run.id)}
                <button
                  class="w-full text-left px-3 py-2.5 hover:bg-accent/30 transition-colors border-l-2 {selectedRunId ===
                  run.id
                    ? 'border-l-primary bg-accent/20'
                    : 'border-l-transparent'}"
                  onclick={() => selectRun(run.id)}
                >
                  <div class="flex items-center gap-2 mb-1">
                    <span
                      class="h-2 w-2 shrink-0 rounded-full {STATUS_COLORS[
                        run.status
                      ]} {run.status === 'running' || run.status === 'planning'
                        ? 'animate-pulse'
                        : ''}"
                    ></span>
                    <span class="text-xs font-medium text-foreground truncate">{run.teamName}</span>
                    <span class="ml-auto text-[10px] text-muted-foreground shrink-0"
                      >{relativeTime(run.createdAt)}</span
                    >
                  </div>
                  <p class="text-[11px] text-muted-foreground line-clamp-2">{run.prompt}</p>
                  <div class="flex items-center gap-2 mt-1">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium
                        {run.status === 'completed'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : run.status === 'failed'
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : run.status === 'running' || run.status === 'planning'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-muted text-muted-foreground'}"
                    >
                      {STATUS_TEXT[run.status]()}
                    </span>
                    <span class="text-[10px] text-muted-foreground/60">
                      {run.memberRuns.filter((m) => m.status === "completed").length}/{run
                        .memberRuns.length}
                      {t("teamRun_membersDone")}
                    </span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Right: TeamRun detail -->
      <div class="flex-1 flex flex-col min-w-0 h-full">
        {#if !selectedRun}
          <div class="flex flex-col items-center justify-center h-full text-center px-6">
            <svg
              class="h-8 w-8 text-muted-foreground/30 mb-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p class="text-sm text-muted-foreground">{t("teamRun_selectRun")}</p>
          </div>
        {:else}
          <!-- Detail header -->
          <div class="shrink-0 border-b border-border px-4 py-3">
            <div class="flex items-center gap-2 mb-1">
              <h2 class="text-sm font-semibold text-foreground">{selectedRun.teamName}</h2>
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium
                  {selectedRun.status === 'completed'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : selectedRun.status === 'failed'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : selectedRun.status === 'running' || selectedRun.status === 'planning'
                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'bg-muted text-muted-foreground'}"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full {STATUS_COLORS[
                    selectedRun.status
                  ]} {selectedRun.status === 'running' || selectedRun.status === 'planning'
                    ? 'animate-pulse'
                    : ''}"
                ></span>
                {STATUS_TEXT[selectedRun.status]()}
              </span>
              {#if selectedRun.status === "running" || selectedRun.status === "planning"}
                <button
                  class="ml-auto rounded-md px-2.5 py-1 text-[11px] font-medium border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
                  onclick={() => handleCancelRun(selectedRun!.id)}
                >
                  {t("teamRun_cancel")}
                </button>
              {/if}
            </div>
            <p class="text-xs text-muted-foreground">{selectedRun.prompt}</p>
            <div class="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/60">
              <span>{t("teamRun_created")}: {relativeTime(selectedRun.createdAt)}</span>
              {#if selectedRun.cwd}
                <span class="font-mono truncate">{selectedRun.cwd}</span>
              {/if}
            </div>
          </div>

          <!-- Detail body -->
          <div class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            <!-- Lead plan -->
            {#if selectedRun.leadPlan}
              <div>
                <h3 class="text-xs font-medium text-foreground mb-2">{t("teamRun_leadPlan")}</h3>
                <div
                  class="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap"
                >
                  {selectedRun.leadPlan}
                </div>
              </div>
            {/if}

            <!-- Members -->
            <div>
              <h3 class="text-xs font-medium text-foreground mb-2">
                {t("teamRun_members")} ({selectedRun.memberRuns.length})
              </h3>
              <div class="space-y-2">
                {#each selectedRun.memberRuns as member (member.id)}
                  <div class="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
                    <div class="flex items-center gap-2 mb-1.5">
                      <span
                        class="h-2 w-2 shrink-0 rounded-full {MEMBER_STATUS_COLORS[member.status] ||
                          'bg-muted'}"
                      ></span>
                      <span class="text-xs font-medium text-foreground">{member.memberName}</span>
                      <span class="text-[10px] text-muted-foreground/60">{member.role}</span>
                      {#if member.status === "running"}
                        <span class="ml-auto text-[10px] text-blue-500 animate-pulse">...</span>
                      {:else if member.status === "completed"}
                        <span class="ml-auto text-[10px] text-emerald-500">{t("teamRun_done")}</span
                        >
                      {:else if member.status === "failed"}
                        <span class="ml-auto text-[10px] text-red-500">{t("teamRun_failed")}</span>
                      {:else}
                        <span class="ml-auto text-[10px] text-muted-foreground/40"
                          >{t("teamRun_pending")}</span
                        >
                      {/if}
                    </div>
                    <p class="text-[11px] text-muted-foreground/70 mb-1">{member.task}</p>
                    {#if member.summary}
                      <div
                        class="mt-1.5 pt-1.5 border-t border-border/30 text-[11px] text-muted-foreground whitespace-pre-wrap"
                      >
                        {member.summary}
                      </div>
                    {/if}
                    {#if member.error}
                      <div
                        class="mt-1.5 pt-1.5 border-t border-red-500/20 text-[11px] text-red-500"
                      >
                        {member.error}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>

            <!-- Summary -->
            {#if selectedRun.summary}
              <div>
                <h3 class="text-xs font-medium text-foreground mb-2">{t("teamRun_summary")}</h3>
                <div
                  class="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap"
                >
                  {selectedRun.summary}
                </div>
              </div>
            {/if}

            <!-- Error -->
            {#if selectedRun.error}
              <div
                class="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-500"
              >
                {selectedRun.error}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- ═══ Legacy Team Monitor Mode ═══ -->
    <div class="flex-1 min-h-0">
      {#if teamStore.teams.length === 0 && !teamStore.loading}
        <div class="flex flex-col items-center justify-center h-full text-center px-6">
          <div
            class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted"
          >
            <svg
              class="h-6 w-6 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h2 class="text-sm font-medium text-foreground mb-1">{t("team_noActiveTeams")}</h2>
          <p class="text-xs text-muted-foreground max-w-sm">
            {t("team_emptyDesc")}
          </p>
        </div>
      {:else if teamStore.loading}
        <div class="flex items-center justify-center h-full">
          <div
            class="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"
          ></div>
        </div>
      {:else if teamStore.selectedTeam && teamStore.teamConfig}
        <div class="flex h-full overflow-hidden">
          <!-- Left: Status Bar + Conversation -->
          <div class="flex flex-1 flex-col min-w-0">
            <!-- Team Status Bar -->
            <div class="shrink-0 border-b border-border">
              <div class="flex items-center gap-3 px-4 h-9">
                <div class="flex-1 min-w-0 flex items-center gap-2">
                  <h1 class="text-sm font-semibold text-foreground truncate">
                    {teamStore.teamConfig.name}
                  </h1>
                  <span
                    class="rounded-full bg-teal-500/10 px-2 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400"
                    >{t("team_membersCount", {
                      count: String(teamStore.teamConfig.members.length),
                    })}</span
                  >
                  <span
                    class="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400"
                    >{t("team_tasksCount", { count: String(teamStore.tasks.length) })}</span
                  >
                  {#if teamStore.teamConfig.createdAt}
                    <span class="text-[10px] text-muted-foreground"
                      >{timeAgoEpoch(teamStore.teamConfig.createdAt)}</span
                    >
                  {/if}
                  {#if teamStore.teamConfig.description}
                    <span class="text-[10px] text-muted-foreground truncate hidden sm:inline"
                      >{teamStore.teamConfig.description}</span
                    >
                  {/if}
                </div>
                <div class="shrink-0">
                  {#if deleteConfirm === teamStore.selectedTeam}
                    <div class="flex items-center gap-1.5">
                      <span class="text-xs text-muted-foreground">{t("team_deleteConfirm")}</span>
                      <button
                        class="rounded px-2 py-1 text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                        disabled={deleting}
                        onclick={() => handleDeleteTeam(teamStore.selectedTeam)}
                        >{deleting ? "..." : t("team_deleteYes")}</button
                      >
                      <button
                        class="rounded px-2 py-1 text-xs font-medium border border-border text-foreground hover:bg-accent transition-colors"
                        onclick={() => (deleteConfirm = null)}>{t("team_deleteNo")}</button
                      >
                    </div>
                  {:else}
                    <button
                      class="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title={t("team_deleteTeam")}
                      onclick={() => (deleteConfirm = teamStore.selectedTeam)}
                    >
                      <svg
                        class="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path
                          d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
                        />
                      </svg>
                    </button>
                  {/if}
                </div>
              </div>

              <div class="flex items-center gap-1.5 px-4 py-1.5 overflow-x-auto">
                {#each teamStore.teamConfig.members as member (member.name)}
                  {@const isLead = member.agentId === teamStore.teamConfig.leadAgentId}
                  <button
                    class="shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors {expandedMemberName ===
                    member.name
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border/40 bg-card hover:bg-accent/50'}"
                    onclick={() =>
                      (expandedMemberName =
                        expandedMemberName === member.name ? null : member.name)}
                  >
                    <span class="relative h-2 w-2 shrink-0">
                      <span class="absolute inset-0 rounded-full {memberColorClass(member.color)}"
                      ></span>
                      {#if member.isActive}
                        <span
                          class="absolute inset-0 rounded-full {memberColorClass(
                            member.color,
                          )} animate-ping opacity-50"
                        ></span>
                      {/if}
                    </span>
                    <span class="font-medium text-foreground">{member.name}</span>
                    {#if member.agentType}
                      <span class="rounded bg-muted px-1 py-0.5 text-[10px] font-medium"
                        >{member.agentType}</span
                      >
                    {/if}
                    {#if member.model}
                      <span class="text-muted-foreground">{shortModel(member.model)}</span>
                    {/if}
                    {#if member.isActive}
                      <span
                        class="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                        >{t("team_badgeActive")}</span
                      >
                    {/if}
                    {#if member.planModeRequired}
                      <span
                        class="rounded bg-violet-500/10 px-1 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400"
                        >{t("team_badgePlan")}</span
                      >
                    {/if}
                    {#if isLead}
                      <span
                        class="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-bold text-primary uppercase"
                        >{t("team_badgeLead")}</span
                      >
                    {/if}
                  </button>
                {/each}
              </div>

              {#if expandedMemberName}
                {@const member = teamStore.teamConfig.members.find(
                  (m) => m.name === expandedMemberName,
                )}
                {#if member}
                  <div class="border-t border-border/40 px-4 py-2.5 bg-muted/20">
                    <div class="flex items-start gap-4 text-[11px] text-muted-foreground flex-wrap">
                      {#if member.cwd}
                        <div class="flex items-center gap-1">
                          <span class="text-muted-foreground/50">{t("team_labelCwd")}</span>
                          <span class="font-mono text-foreground/70" title={member.cwd}
                            >{truncatePath(member.cwd, 50)}</span
                          >
                        </div>
                      {/if}
                      {#if member.model}
                        <div class="flex items-center gap-1">
                          <span class="text-muted-foreground/50">{t("team_labelModel")}</span>
                          <span class="text-foreground/70">{member.model}</span>
                        </div>
                      {/if}
                      {#if member.backendType && member.backendType !== "in-process"}
                        <div class="flex items-center gap-1">
                          <span class="text-muted-foreground/50">{t("team_labelBackend")}</span>
                          <span class="text-foreground/70">{member.backendType}</span>
                        </div>
                      {/if}
                      {#if member.joinedAt}
                        <div class="flex items-center gap-1">
                          <span class="text-muted-foreground/50">{t("team_labelJoined")}</span>
                          <span class="text-foreground/70">{timeAgoEpoch(member.joinedAt)}</span>
                        </div>
                      {/if}
                    </div>
                    {#if member.prompt}
                      <div class="mt-1.5">
                        <span class="text-[10px] text-muted-foreground"
                          >{t("team_labelPrompt")}</span
                        >
                        <p
                          class="text-xs text-foreground/70 whitespace-pre-wrap break-words mt-0.5"
                        >
                          {member.prompt}
                        </p>
                      </div>
                    {/if}
                  </div>
                {/if}
              {/if}
            </div>

            <!-- Conversation Area -->
            <div class="flex flex-1 flex-col min-h-0">
              {#if teamStore.teamConfig.members.length > 0}
                <div class="shrink-0 flex gap-0.5 border-b border-border px-4 overflow-x-auto">
                  <button
                    class="shrink-0 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 {inboxTab ===
                    'all'
                      ? 'text-foreground border-primary'
                      : 'text-muted-foreground hover:text-foreground border-transparent'}"
                    onclick={handleAllInboxClick}>{t("team_inboxAll")}</button
                  >
                  {#each teamStore.teamConfig.members as member (member.name)}
                    <button
                      class="shrink-0 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 {inboxTab ===
                      member.name
                        ? 'text-foreground border-primary'
                        : 'text-muted-foreground hover:text-foreground border-transparent'}"
                      onclick={() => handleInboxTabClick(member.name)}
                    >
                      <span
                        class="inline-block h-1.5 w-1.5 rounded-full mr-1 {memberColorClass(
                          member.color,
                        )}"
                      ></span>{member.name}
                    </button>
                  {/each}
                </div>

                <div class="flex-1 overflow-y-auto px-4 py-2 space-y-1">
                  {#if displayedMessages.length === 0}
                    <div class="flex items-center justify-center h-full">
                      <p class="text-xs text-muted-foreground">{t("team_noMessages")}</p>
                    </div>
                  {:else}
                    {#each displayedMessages as msg (msg.timestamp)}
                      {@const parsed = parseMessageType(msg.text)}
                      {@const isExpMsg = expandedMsgKey === msgKey(msg)}
                      <button
                        class="w-full text-left flex gap-2 rounded-lg px-3 py-2 hover:bg-muted/30 transition-colors {!msg.read
                          ? 'border-l-2 border-l-primary/60'
                          : ''}"
                        onclick={() =>
                          (expandedMsgKey = expandedMsgKey === msgKey(msg) ? null : msgKey(msg))}
                      >
                        <span
                          class="h-2 w-2 rounded-full shrink-0 mt-1.5 {memberColorClass(msg.color)}"
                        ></span>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="text-[11px] font-medium {msgColorClass(msg.color)}"
                              >{msg.from}</span
                            >
                            <span class="text-[10px] text-muted-foreground ml-auto shrink-0"
                              >{timeAgo(msg.timestamp)}</span
                            >
                            {#if !msg.read}
                              <span class="h-1.5 w-1.5 rounded-full bg-primary shrink-0"></span>
                            {/if}
                          </div>
                          <div class="mt-0.5">
                            {#if parsed}
                              {#if parsed.type === "message"}
                                <div class="text-[11px]">
                                  {#if parsed.data.recipient}
                                    {@const recipientMember = teamStore.teamConfig?.members.find(
                                      (m) => m.name === parsed.data.recipient,
                                    )}
                                    <span class="text-muted-foreground">{t("team_msgTo")} </span>
                                    <span
                                      class="font-medium {recipientMember
                                        ? msgColorClass(recipientMember.color)
                                        : 'text-foreground/70'}">{parsed.data.recipient}</span
                                    >
                                    <span class="text-muted-foreground"> · </span>
                                  {/if}
                                  {#if isExpMsg}
                                    <span class="text-foreground/80 whitespace-pre-wrap break-words"
                                      >{parsed.data.content ?? ""}</span
                                    >
                                  {:else}
                                    <span class="text-foreground/80 line-clamp-3"
                                      >{parsed.data.summary ?? parsed.data.content ?? ""}</span
                                    >
                                  {/if}
                                </div>
                              {:else if parsed.type === "idle_notification"}
                                <div
                                  class="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap"
                                >
                                  <span class="text-blue-400"
                                    >{parsed.data.idleReason ?? t("team_msgIdle")}</span
                                  >
                                  {#if parsed.data.completedTaskId}
                                    <span
                                      >{t("team_msgCompleted", {
                                        id: String(parsed.data.completedTaskId),
                                      })}{parsed.data.completedTaskSubject
                                        ? `: ${parsed.data.completedTaskSubject}`
                                        : ""}</span
                                    >
                                  {/if}
                                  {#if parsed.data.failureReason}
                                    <span class="text-red-400">{parsed.data.failureReason}</span>
                                  {/if}
                                  {#if parsed.data.peerDmSummary}
                                    <span class="text-muted-foreground/60"
                                      >| {parsed.data.peerDmSummary}</span
                                    >
                                  {/if}
                                </div>
                              {:else if parsed.type === "task_completed"}
                                <div class="text-[11px] text-emerald-600 dark:text-emerald-400">
                                  {t("team_msgCompleted", {
                                    id: String(parsed.data.taskId),
                                  })}{parsed.data.taskSubject ? `: ${parsed.data.taskSubject}` : ""}
                                </div>
                              {:else if parsed.type === "task_assignment"}
                                <div class="text-[11px] text-teal-600 dark:text-teal-400">
                                  {t("team_msgAssigned", { id: String(parsed.data.taskId) })}{parsed
                                    .data.subject
                                    ? `: ${parsed.data.subject}`
                                    : ""}{parsed.data.assignedBy
                                    ? ` by ${parsed.data.assignedBy}`
                                    : ""}
                                  {#if isExpMsg && parsed.data.description}
                                    <p
                                      class="mt-0.5 text-muted-foreground whitespace-pre-wrap break-words"
                                    >
                                      {parsed.data.description}
                                    </p>
                                  {/if}
                                </div>
                              {:else if parsed.type === "shutdown_request"}
                                <div class="text-[11px] text-red-500">
                                  {t("team_msgShutdownRequested")}{parsed.data.reason
                                    ? `: ${parsed.data.reason}`
                                    : ""}
                                </div>
                              {:else if parsed.type === "shutdown_approved"}
                                <div class="text-[11px] text-red-400/70">
                                  {t("team_msgShutDown")}
                                </div>
                              {:else if parsed.type === "shutdown_rejected"}
                                <div class="text-[11px] text-amber-500">
                                  {t("team_msgShutdownRejected")}{parsed.data.reason
                                    ? `: ${parsed.data.reason}`
                                    : ""}
                                </div>
                              {:else if parsed.type === "plan_approval_request"}
                                <div class="text-[11px] text-violet-600 dark:text-violet-400">
                                  {t("team_msgPlanApprovalNeeded")}
                                  {#if parsed.data.planFilePath}
                                    <span class="text-muted-foreground/60 ml-1"
                                      >{parsed.data.planFilePath}</span
                                    >
                                  {/if}
                                  {#if parsed.data.planContent}
                                    {#if isExpMsg}
                                      <p
                                        class="mt-0.5 text-muted-foreground whitespace-pre-wrap break-words"
                                      >
                                        {parsed.data.planContent}
                                      </p>
                                    {:else}
                                      <p
                                        class="mt-0.5 text-muted-foreground line-clamp-3 whitespace-pre-wrap"
                                      >
                                        {parsed.data.planContent}
                                      </p>
                                    {/if}
                                  {/if}
                                </div>
                              {:else if parsed.type === "plan_approval_response"}
                                <div
                                  class="text-[11px] {parsed.data.approved
                                    ? 'text-emerald-500'
                                    : 'text-red-500'}"
                                >
                                  {parsed.data.approved
                                    ? t("team_msgPlanApproved")
                                    : t("team_msgPlanRejected")}{parsed.data.feedback
                                    ? `: ${parsed.data.feedback}`
                                    : ""}
                                  {#if parsed.data.permissionMode}
                                    <span class="text-muted-foreground/60 ml-1"
                                      >({parsed.data.permissionMode})</span
                                    >
                                  {/if}
                                </div>
                              {:else if parsed.type === "permission_request"}
                                <div class="text-[11px] text-amber-600 dark:text-amber-400">
                                  {t("team_msgPermission", {
                                    tool: String(parsed.data.tool_name ?? "tool"),
                                  })}{parsed.data.description
                                    ? ` — ${parsed.data.description}`
                                    : ""}
                                  {#if isExpMsg && parsed.data.input}
                                    <pre
                                      class="mt-1 text-[10px] text-muted-foreground bg-muted/50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-words">{typeof parsed
                                        .data.input === "string"
                                        ? parsed.data.input
                                        : JSON.stringify(parsed.data.input, null, 2)}</pre>
                                  {/if}
                                </div>
                              {:else if parsed.type === "mode_set_request"}
                                <div class="text-[11px] text-muted-foreground">
                                  {t("team_msgModeSet", {
                                    mode: String(parsed.data.mode ?? "unknown"),
                                  })}
                                </div>
                              {:else}
                                <div class="flex items-center gap-1.5 text-[11px]">
                                  <span
                                    class="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                                    >{parsed.type}</span
                                  >
                                  <span class="text-muted-foreground"
                                    >{parsed.data.content ?? parsed.data.summary ?? ""}</span
                                  >
                                </div>
                              {/if}
                            {:else if isExpMsg}
                              <p
                                class="text-[11px] text-foreground/80 whitespace-pre-wrap break-words"
                              >
                                {msg.text}
                              </p>
                            {:else if msg.summary}
                              <p class="text-[11px] text-foreground/80">{msg.summary}</p>
                            {:else}
                              <p
                                class="text-[11px] text-foreground/80 line-clamp-4 whitespace-pre-wrap"
                              >
                                {msg.text}
                              </p>
                            {/if}
                          </div>
                        </div>
                      </button>
                    {/each}
                  {/if}
                </div>
              {:else}
                <div class="flex items-center justify-center flex-1">
                  <p class="text-xs text-muted-foreground">{t("team_noMembers")}</p>
                </div>
              {/if}
            </div>
          </div>

          <!-- Task Board Sidebar -->
          <div
            class="shrink-0 border-l border-border flex flex-col h-full transition-all duration-200 {sidebarCollapsed
              ? 'w-8'
              : 'w-[280px]'}"
          >
            {#if sidebarCollapsed}
              <button
                class="flex flex-col items-center py-3 gap-2 h-full hover:bg-accent/30 transition-colors"
                title={t("team_expandTaskBoard")}
                onclick={() => (sidebarCollapsed = false)}
              >
                <svg
                  class="h-3.5 w-3.5 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
                <span
                  class="text-[10px] text-muted-foreground font-medium"
                  style="writing-mode: vertical-rl"
                  >{t("team_tasksBoardCount", { count: String(teamStore.tasks.length) })}</span
                >
              </button>
            {:else}
              <div
                class="shrink-0 flex items-center justify-between px-3 h-9 border-b border-border/40"
              >
                <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >{t("team_tasksBoardCount", { count: String(teamStore.tasks.length) })}</span
                >
                <button
                  class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                  title={t("team_collapseTaskBoard")}
                  onclick={() => (sidebarCollapsed = true)}
                >
                  <svg
                    class="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>

              <div class="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {#if teamStore.tasks.length === 0}
                  <p class="text-xs text-muted-foreground py-6 text-center">{t("team_noTasks")}</p>
                {/if}

                {#if teamStore.inProgressTasks.length > 0}
                  <div>
                    <button
                      class="flex w-full items-center gap-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 transition-colors py-1"
                      onclick={() => (expandInProgress = !expandInProgress)}
                    >
                      <svg
                        class="h-3 w-3 transition-transform {expandInProgress ? 'rotate-90' : ''}"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"><path d="m9 18 6-6-6-6" /></svg
                      >
                      {t("team_inProgress", { count: String(teamStore.inProgressTasks.length) })}
                    </button>
                    {#if expandInProgress}
                      <div class="space-y-1">
                        {#each teamStore.inProgressTasks as task (task.id)}
                          {@const isExpanded = teamStore.expandedTaskId === task.id}
                          <button
                            class="w-full text-left rounded-lg border border-blue-500/20 bg-blue-500/5 px-2.5 py-2 hover:bg-blue-500/10 transition-colors"
                            onclick={() => toggleTaskExpand(task)}
                          >
                            <div class="flex items-start gap-1.5">
                              <span class="text-[11px] font-mono text-blue-500/60 shrink-0 mt-0.5"
                                >#{task.id}</span
                              >
                              <div class="flex-1 min-w-0">
                                <div class="text-xs font-medium text-foreground">
                                  {task.subject}
                                </div>
                                <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {#if task.owner}
                                    <span class="text-[10px] text-muted-foreground"
                                      >{task.owner}</span
                                    >
                                  {/if}
                                  {#if task.activeForm}
                                    <span class="text-[10px] text-blue-400 italic"
                                      >{task.activeForm}</span
                                    >
                                  {/if}
                                </div>
                                {#if task.blockedBy.length > 0}
                                  <div class="flex items-center gap-1 mt-1 flex-wrap">
                                    <span class="text-[10px] text-amber-600 dark:text-amber-400"
                                      >{t("team_blockedBy")}</span
                                    >
                                    {#each task.blockedBy as dep}
                                      <span
                                        class="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-mono text-amber-600 dark:text-amber-400"
                                        >#{dep}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                                {#if task.blocks.length > 0}
                                  <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                    <span class="text-[10px] text-emerald-600 dark:text-emerald-400"
                                      >{t("team_unblocks")}</span
                                    >
                                    {#each task.blocks as dep}
                                      <span
                                        class="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400"
                                        >#{dep}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                              <svg
                                class="h-3 w-3 shrink-0 text-muted-foreground/40 mt-1 transition-transform {isExpanded
                                  ? 'rotate-180'
                                  : ''}"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
                              >
                            </div>
                            {#if isExpanded}
                              <div class="mt-2 pt-2 border-t border-blue-500/10">
                                {#if taskDescLoading[task.id]}
                                  <div
                                    class="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                                  >
                                    <div
                                      class="h-3 w-3 border border-primary/30 border-t-primary rounded-full animate-spin"
                                    ></div>
                                    {t("team_loading")}
                                  </div>
                                {:else}
                                  <p
                                    class="text-[11px] text-muted-foreground whitespace-pre-wrap break-words"
                                  >
                                    {taskDescriptions[task.id] ||
                                      task.description ||
                                      t("team_noDescription")}
                                  </p>
                                {/if}
                                {#if task.metadata}
                                  <div class="mt-1.5 flex flex-wrap gap-1">
                                    {#each Object.entries(task.metadata as Record<string, unknown>) as [k, v]}
                                      <span
                                        class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                        >{k}: {typeof v === "string" ? v : JSON.stringify(v)}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}

                {#if teamStore.pendingTasks.length > 0}
                  <div>
                    <button
                      class="flex w-full items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors py-1"
                      onclick={() => (expandPending = !expandPending)}
                    >
                      <svg
                        class="h-3 w-3 transition-transform {expandPending ? 'rotate-90' : ''}"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"><path d="m9 18 6-6-6-6" /></svg
                      >
                      {t("team_pending", { count: String(teamStore.pendingTasks.length) })}
                    </button>
                    {#if expandPending}
                      <div class="space-y-1">
                        {#each teamStore.pendingTasks as task (task.id)}
                          {@const isExpanded = teamStore.expandedTaskId === task.id}
                          <button
                            class="w-full text-left rounded-lg border border-border/30 bg-muted/20 px-2.5 py-2 hover:bg-muted/40 transition-colors"
                            onclick={() => toggleTaskExpand(task)}
                          >
                            <div class="flex items-start gap-1.5">
                              <span
                                class="text-[11px] font-mono text-muted-foreground/60 shrink-0 mt-0.5"
                                >#{task.id}</span
                              >
                              <div class="flex-1 min-w-0">
                                <div class="text-xs text-foreground">{task.subject}</div>
                                <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {#if task.owner}
                                    <span class="text-[10px] text-muted-foreground"
                                      >{task.owner}</span
                                    >
                                  {/if}
                                  {#if task.activeForm}
                                    <span class="text-[10px] text-muted-foreground/60 italic"
                                      >{task.activeForm}</span
                                    >
                                  {/if}
                                </div>
                                {#if task.blockedBy.length > 0}
                                  <div class="flex items-center gap-1 mt-1 flex-wrap">
                                    <span class="text-[10px] text-amber-600 dark:text-amber-400"
                                      >{t("team_blockedBy")}</span
                                    >
                                    {#each task.blockedBy as dep}
                                      <span
                                        class="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-mono text-amber-600 dark:text-amber-400"
                                        >#{dep}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                                {#if task.blocks.length > 0}
                                  <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                    <span class="text-[10px] text-emerald-600 dark:text-emerald-400"
                                      >{t("team_unblocks")}</span
                                    >
                                    {#each task.blocks as dep}
                                      <span
                                        class="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400"
                                        >#{dep}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                              <svg
                                class="h-3 w-3 shrink-0 text-muted-foreground/40 mt-1 transition-transform {isExpanded
                                  ? 'rotate-180'
                                  : ''}"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
                              >
                            </div>
                            {#if isExpanded}
                              <div class="mt-2 pt-2 border-t border-border/20">
                                {#if taskDescLoading[task.id]}
                                  <div
                                    class="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                                  >
                                    <div
                                      class="h-3 w-3 border border-primary/30 border-t-primary rounded-full animate-spin"
                                    ></div>
                                    {t("team_loading")}
                                  </div>
                                {:else}
                                  <p
                                    class="text-[11px] text-muted-foreground whitespace-pre-wrap break-words"
                                  >
                                    {taskDescriptions[task.id] ||
                                      task.description ||
                                      t("team_noDescription")}
                                  </p>
                                {/if}
                                {#if task.metadata}
                                  <div class="mt-1.5 flex flex-wrap gap-1">
                                    {#each Object.entries(task.metadata as Record<string, unknown>) as [k, v]}
                                      <span
                                        class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                        >{k}: {typeof v === "string" ? v : JSON.stringify(v)}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}

                {#if teamStore.completedTasks.length > 0}
                  <div>
                    <button
                      class="flex w-full items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors py-1"
                      onclick={() => (expandCompleted = !expandCompleted)}
                    >
                      <svg
                        class="h-3 w-3 transition-transform {expandCompleted ? 'rotate-90' : ''}"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"><path d="m9 18 6-6-6-6" /></svg
                      >
                      {t("team_completed", { count: String(teamStore.completedTasks.length) })}
                    </button>
                    {#if expandCompleted}
                      <div class="space-y-1">
                        {#each teamStore.completedTasks as task (task.id)}
                          {@const isExpanded = teamStore.expandedTaskId === task.id}
                          <button
                            class="w-full text-left rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-2.5 py-2 hover:bg-emerald-500/10 transition-colors"
                            onclick={() => toggleTaskExpand(task)}
                          >
                            <div class="flex items-start gap-1.5">
                              <span
                                class="text-[11px] font-mono text-emerald-500/50 shrink-0 mt-0.5"
                                >#{task.id}</span
                              >
                              <div class="flex-1 min-w-0">
                                <div
                                  class="text-xs text-foreground/70 line-through decoration-foreground/20"
                                >
                                  {task.subject}
                                </div>
                                <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {#if task.owner}
                                    <span class="text-[10px] text-muted-foreground"
                                      >{task.owner}</span
                                    >
                                  {/if}
                                  {#if task.activeForm}
                                    <span class="text-[10px] text-emerald-400/60 italic"
                                      >{task.activeForm}</span
                                    >
                                  {/if}
                                </div>
                                {#if task.blockedBy.length > 0}
                                  <div class="flex items-center gap-1 mt-1 flex-wrap">
                                    <span class="text-[10px] text-amber-600 dark:text-amber-400"
                                      >{t("team_blockedBy")}</span
                                    >
                                    {#each task.blockedBy as dep}
                                      <span
                                        class="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-mono text-amber-600 dark:text-amber-400"
                                        >#{dep}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                                {#if task.blocks.length > 0}
                                  <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                    <span class="text-[10px] text-emerald-600 dark:text-emerald-400"
                                      >{t("team_unblocks")}</span
                                    >
                                    {#each task.blocks as dep}
                                      <span
                                        class="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400"
                                        >#{dep}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                              <svg
                                class="h-3 w-3 shrink-0 text-muted-foreground/30 mt-1 transition-transform {isExpanded
                                  ? 'rotate-180'
                                  : ''}"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
                              >
                            </div>
                            {#if isExpanded}
                              <div class="mt-2 pt-2 border-t border-emerald-500/10">
                                {#if taskDescLoading[task.id]}
                                  <div
                                    class="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                                  >
                                    <div
                                      class="h-3 w-3 border border-primary/30 border-t-primary rounded-full animate-spin"
                                    ></div>
                                    {t("team_loading")}
                                  </div>
                                {:else}
                                  <p
                                    class="text-[11px] text-muted-foreground whitespace-pre-wrap break-words"
                                  >
                                    {taskDescriptions[task.id] ||
                                      task.description ||
                                      t("team_noDescription")}
                                  </p>
                                {/if}
                                {#if task.metadata}
                                  <div class="mt-1.5 flex flex-wrap gap-1">
                                    {#each Object.entries(task.metadata as Record<string, unknown>) as [k, v]}
                                      <span
                                        class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                        >{k}: {typeof v === "string" ? v : JSON.stringify(v)}</span
                                      >
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center h-full text-center px-6">
          <p class="text-sm text-muted-foreground">{t("team_selectTeam")}</p>
        </div>
      {/if}
    </div>
  {/if}
</div>
