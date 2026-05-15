<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/components/Button.svelte";
  import ScheduledTaskCard from "$lib/components/ScheduledTaskCard.svelte";
  import ScheduledTaskEditor from "$lib/components/ScheduledTaskEditor.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import type { ScheduledTaskRun } from "$lib/types/scheduled-task";

  let activeTab = $state<"all" | "active" | "paused">("all");
  let runningNow = $state(false);

  async function handleRunNow(taskId: string) {
    if (runningNow) return;
    runningNow = true;
    try {
      await scheduledTasksStore.runTaskNow(taskId);
    } finally {
      runningNow = false;
    }
  }

  const filteredTasks = $derived.by(() => {
    switch (activeTab) {
      case "active":
        return scheduledTasksStore.activeTasks;
      case "paused":
        return scheduledTasksStore.inactiveTasks;
      default:
        return scheduledTasksStore.tasks;
    }
  });

  onMount(() => {
    scheduledTasksStore.loadTasks();
    scheduledTasksStore.loadAllRuns();
  });

  function runStatusIcon(status: ScheduledTaskRun["status"]) {
    switch (status) {
      case "running":
        return { icon: "⏳", color: "text-blue-500", label: t("sched_runRunning") };
      case "completed":
        return { icon: "✓", color: "text-green-500", label: t("sched_runCompleted") };
      case "failed":
        return { icon: "✗", color: "text-red-500", label: t("sched_runFailed") };
      case "cancelled":
        return { icon: "○", color: "text-yellow-500", label: t("sched_runCancelled") };
      case "queued":
        return { icon: "○", color: "text-muted-foreground", label: t("sched_runQueued") };
    }
  }

  function formatDuration(startedAt: string, endedAt?: string): string {
    if (!endedAt) return t("sched_inProgress");
    const start = new Date(startedAt).getTime();
    const end = new Date(endedAt).getTime();
    const seconds = Math.round((end - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
</script>

<svelte:head>
  <title>{t("sched_title")}</title>
</svelte:head>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div
    class="flex items-center justify-between px-6 py-4 border-b bg-background/50 backdrop-blur-sm"
  >
    <div>
      <h1 class="text-2xl font-bold">{t("sched_title")}</h1>
      <p class="text-sm text-muted-foreground">{t("sched_description")}</p>
    </div>
    <Button variant="default" onclick={() => scheduledTasksStore.openCreateEditor()}>
      <svg
        class="w-4 h-4 mr-2"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      {t("sched_newTask")}
    </Button>
  </div>

  <!-- Content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Task List -->
    <div class="flex flex-col w-1/2 border-r overflow-hidden">
      <!-- Tabs -->
      <div class="flex items-center gap-1 px-4 py-2 border-b bg-muted/20">
        <button
          class="px-3 py-1.5 text-sm rounded-md transition-colors
            {activeTab === 'all' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}"
          onclick={() => (activeTab = "all")}
        >
          {t("sched_tabAll")} ({scheduledTasksStore.tasks.length})
        </button>
        <button
          class="px-3 py-1.5 text-sm rounded-md transition-colors
            {activeTab === 'active' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}"
          onclick={() => (activeTab = "active")}
        >
          {t("sched_tabActive")} ({scheduledTasksStore.activeTasks.length})
        </button>
        <button
          class="px-3 py-1.5 text-sm rounded-md transition-colors
            {activeTab === 'paused' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}"
          onclick={() => (activeTab = "paused")}
        >
          {t("sched_tabPaused")} ({scheduledTasksStore.inactiveTasks.length})
        </button>
      </div>

      <!-- Task List -->
      <div class="flex-1 overflow-y-auto p-4 space-y-2">
        {#if scheduledTasksStore.loading}
          <div class="flex items-center justify-center py-8 text-muted-foreground">
            <svg
              class="w-5 h-5 animate-spin mr-2"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            {t("sched_loading")}
          </div>
        {:else if filteredTasks.length === 0}
          <div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <svg
              class="w-12 h-12 mb-4 opacity-50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p class="text-sm">{t("sched_noTasks")}</p>
            <Button variant="link" onclick={() => scheduledTasksStore.openCreateEditor()}>
              {t("sched_createFirst")}
            </Button>
          </div>
        {:else}
          {#each filteredTasks as task (task.id)}
            <ScheduledTaskCard {task} selected={scheduledTasksStore.selectedTaskId === task.id} />
          {/each}
        {/if}
      </div>
    </div>

    <!-- Task Details Panel -->
    <div class="flex-1 overflow-y-auto">
      {#if scheduledTasksStore.selectedTask}
        {@const task = scheduledTasksStore.selectedTask}
        <div class="p-6 space-y-6">
          <!-- Task Info -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold">{task.name}</h2>
              <div class="flex items-center gap-2">
                <span
                  class="px-2 py-1 text-xs rounded-full {task.enabled
                    ? 'bg-green-500/10 text-green-500'
                    : 'bg-muted text-muted-foreground'}"
                >
                  {task.enabled ? t("sched_active") : t("sched_paused")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  loading={runningNow}
                  disabled={runningNow}
                  onclick={() => handleRunNow(task.id)}
                >
                  {t("sched_runNow")}
                </Button>
              </div>
            </div>
            {#if task.description}
              <p class="text-muted-foreground">{task.description}</p>
            {/if}
          </div>

          <!-- Meta -->
          <div class="grid grid-cols-3 gap-4">
            <div class="p-3 rounded-lg bg-muted/30">
              <span class="text-xs text-muted-foreground">{t("sched_agent")}</span>
              <p class="text-sm font-medium uppercase">{task.agent}</p>
            </div>
            <div class="p-3 rounded-lg bg-muted/30">
              <span class="text-xs text-muted-foreground">{t("sched_workspace")}</span>
              <p class="text-sm font-mono truncate" title={task.workspace.cwd}>
                {task.workspace.cwd.split(/[/\\]/).pop() || task.workspace.cwd}
              </p>
            </div>
            {#if task.model}
              <div class="p-3 rounded-lg bg-muted/30">
                <span class="text-xs text-muted-foreground">{t("sched_model")}</span>
                <p class="text-sm">{task.model}</p>
              </div>
            {/if}
          </div>

          <!-- Schedule Info -->
          <div class="p-4 rounded-lg bg-muted/30 space-y-2">
            <h3 class="text-sm font-medium text-muted-foreground">{t("sched_schedule")}</h3>
            {#if task.schedule.type === "cron" && task.schedule.cronExpression}
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm">{task.schedule.cronExpression}</span>
                <span class="text-xs text-muted-foreground">
                  ({ScheduledTasksService.describeCronExpression(task.schedule.cronExpression)})
                </span>
              </div>
            {:else if task.schedule.type === "interval"}
              <p class="text-sm">
                {t("sched_everyMinutes", { n: String(task.schedule.intervalMinutes ?? 60) })}
              </p>
            {:else if task.schedule.type === "one-time" && task.schedule.fireAt}
              <p class="text-sm">{new Date(task.schedule.fireAt).toLocaleString()}</p>
            {/if}

            <div class="grid grid-cols-2 gap-4 pt-2">
              <div>
                <span class="text-xs text-muted-foreground">{t("sched_nextRun")}</span>
                <p class="text-sm">
                  {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : t("sched_never")}
                </p>
              </div>
              <div>
                <span class="text-xs text-muted-foreground">{t("sched_lastRun")}</span>
                <p class="text-sm">
                  {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : t("sched_never")}
                </p>
              </div>
            </div>
          </div>

          <!-- Prompt Preview -->
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-muted-foreground">{t("sched_prompt")}</h3>
            <div class="p-4 rounded-lg bg-muted/30">
              <pre class="text-sm whitespace-pre-wrap font-mono">{task.prompt}</pre>
            </div>
          </div>

          <!-- Execution Runs -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium text-muted-foreground">{t("sched_execHistory")}</h3>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => scheduledTasksStore.loadTaskRuns(task.id)}
              >
                {t("sched_refresh")}
              </Button>
            </div>

            {#if scheduledTasksStore.selectedTaskRuns.length === 0}
              <div
                class="p-8 text-center text-muted-foreground text-sm rounded-lg border border-dashed"
              >
                {t("sched_noExecutions")}
              </div>
            {:else}
              <div class="space-y-2">
                {#each scheduledTasksStore.selectedTaskRuns as run (run.id)}
                  {@const statusInfo = runStatusIcon(run.status)}
                  <div class="p-3 rounded-lg bg-muted/30 flex items-center gap-3">
                    <span class={statusInfo.color}>{statusInfo.icon}</span>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 text-sm">
                        <span>{statusInfo.label}</span>
                        <span class="text-muted-foreground">
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                        {#if run.endedAt}
                          <span class="text-muted-foreground/50">
                            ({formatDuration(run.startedAt, run.endedAt)})
                          </span>
                        {/if}
                      </div>
                      {#if run.error}
                        <p class="text-xs text-destructive mt-1 truncate">{run.error}</p>
                      {:else if run.summary}
                        <p class="text-xs text-muted-foreground mt-1 truncate">{run.summary}</p>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center h-full text-muted-foreground">
          <svg
            class="w-16 h-16 mb-4 opacity-50"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          <p class="text-sm">{t("sched_selectTask")}</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Editor Modal -->
<ScheduledTaskEditor />

<!-- Error Toast -->
{#if scheduledTasksStore.error}
  <div
    class="fixed bottom-4 right-4 p-4 rounded-lg bg-destructive text-destructive-foreground shadow-lg flex items-center gap-3 z-50"
  >
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
    <span class="text-sm">{scheduledTasksStore.error}</span>
    <button
      class="ml-2 p-1 hover:bg-white/20 rounded"
      onclick={() => scheduledTasksStore.clearError()}
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
{/if}
