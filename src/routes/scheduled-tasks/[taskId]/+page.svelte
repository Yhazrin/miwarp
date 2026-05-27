<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/components/Button.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ScheduledTaskEditor from "$lib/components/ScheduledTaskEditor.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import type { ScheduledTaskRun } from "$lib/types/scheduled-task";
  import type { TaskRun } from "$lib/types";
  import { listRuns } from "$lib/api";
  import { relativeTime } from "$lib/utils/format";

  let taskId = $derived(($page.params as Record<string, string>).taskId);
  let selectedRunId = $state<string | null>(null);
  let linkedRuns = $state<TaskRun[]>([]);
  let loadingRuns = $state(false);

  const task = $derived(scheduledTasksStore.tasks.find((item) => item.id === taskId) ?? null);

  const taskExecutions = $derived(
    scheduledTasksStore.runs
      .filter((run) => run.taskId === taskId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );

  const selectedExecution = $derived(
    selectedRunId ? (taskExecutions.find((run) => run.id === selectedRunId) ?? null) : null,
  );

  const selectedLinkedRun = $derived(
    selectedExecution?.runId
      ? (linkedRuns.find((run) => run.id === selectedExecution.runId) ?? null)
      : null,
  );

  onMount(async () => {
    if (scheduledTasksStore.tasks.length === 0) {
      await scheduledTasksStore.loadTasks();
    }
    if (taskId) {
      scheduledTasksStore.selectTask(taskId);
      await scheduledTasksStore.loadTaskRuns(taskId);
      await loadLinkedRuns();
    }
  });

  $effect(() => {
    const id = taskId;
    if (!id) return;
    scheduledTasksStore.selectTask(id);
    void scheduledTasksStore.loadTaskRuns(id);
    void loadLinkedRuns();
  });

  async function loadLinkedRuns() {
    loadingRuns = true;
    try {
      const allRuns = await listRuns();
      linkedRuns = allRuns.filter((run) => run.scheduled_task_id === taskId);
    } finally {
      loadingRuns = false;
    }
  }

  function runStatusIcon(status: ScheduledTaskRun["status"]) {
    switch (status) {
      case "running":
        return { icon: "⏳", color: "text-[hsl(var(--miwarp-status-info))]", label: t("sched_runRunning") };
      case "completed":
        return { icon: "✓", color: "text-[hsl(var(--miwarp-status-success))]", label: t("sched_runCompleted") };
      case "failed":
        return { icon: "✗", color: "text-[hsl(var(--miwarp-status-error))]", label: t("sched_runFailed") };
      case "cancelled":
        return { icon: "○", color: "text-[hsl(var(--miwarp-status-warning))]", label: t("sched_runCancelled") };
      default:
        return { icon: "○", color: "text-muted-foreground", label: t("sched_runQueued") };
    }
  }

  function formatDuration(startedAt: string, endedAt?: string): string {
    if (!endedAt) return t("sched_inProgress");
    const seconds = Math.round(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    );
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  function openInChat(runId?: string) {
    if (!runId) return;
    goto(`/chat?run=${runId}`);
  }
</script>

<svelte:head>
  <title>{task?.name ?? t("sched_title")}</title>
</svelte:head>

<div class="flex h-full flex-col">
  <div class="flex items-center gap-3 border-b px-6 py-4">
    <Button variant="ghost" size="sm" onclick={() => goto("/scheduled-tasks")}>
      ← {t("schedHub_backToList")}
    </Button>
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-xl font-semibold">{task?.name ?? t("schedHub_loading")}</h1>
      {#if task?.description}
        <p class="truncate text-sm text-muted-foreground">{task.description}</p>
      {/if}
    </div>
    {#if task}
      <div class="flex items-center gap-2">
        <span
          class="rounded-full px-2 py-1 text-xs {task.enabled
            ? 'bg-[hsl(var(--miwarp-status-success)/0.1)] text-[hsl(var(--miwarp-status-success))]'
            : 'bg-muted text-muted-foreground'}"
        >
          {task.enabled ? t("sched_active") : t("sched_paused")}
        </span>
        <Button
          variant="outline"
          size="sm"
          onclick={() => scheduledTasksStore.openEditEditor(task)}
        >
          {t("schedHub_editTask")}
        </Button>
        <Button variant="default" size="sm" onclick={() => scheduledTasksStore.runTaskNow(task.id)}>
          {t("sched_runNow")}
        </Button>
      </div>
    {/if}
  </div>

  {#if !task}
    <div class="flex flex-1 items-center justify-center text-muted-foreground">
      {loadingRuns ? t("schedHub_loading") : t("schedHub_taskNotFound")}
    </div>
  {:else}
    <div
      class="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
    >
      <div class="space-y-6 overflow-y-auto border-r p-6">
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-lg bg-muted/30 p-3">
            <span class="text-xs text-muted-foreground">{t("sched_agent")}</span>
            <p class="text-sm font-medium uppercase">{task.agent}</p>
          </div>
          <div class="rounded-lg bg-muted/30 p-3">
            <span class="text-xs text-muted-foreground">{t("sched_workspace")}</span>
            <p class="truncate font-mono text-sm" title={task.workspace.cwd}>
              {task.workspace.cwd.split(/[/\\]/).pop() || task.workspace.cwd}
            </p>
          </div>
        </div>

        <div class="space-y-2 rounded-lg bg-muted/30 p-4">
          <h2 class="text-sm font-medium text-muted-foreground">{t("sched_schedule")}</h2>
          {#if task.schedule.type === "cron" && task.schedule.cronExpression}
            <p class="font-mono text-sm">{task.schedule.cronExpression}</p>
            <p class="text-xs text-muted-foreground">
              {ScheduledTasksService.describeCronExpression(task.schedule.cronExpression)}
            </p>
          {:else if task.schedule.type === "interval"}
            <p class="text-sm">
              {t("sched_everyMinutes", { n: String(task.schedule.intervalMinutes ?? 60) })}
            </p>
          {:else if task.schedule.type === "one-time" && task.schedule.fireAt}
            <p class="text-sm">{new Date(task.schedule.fireAt).toLocaleString()}</p>
          {/if}
          <div class="grid grid-cols-2 gap-3 pt-2">
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

        <div class="space-y-2">
          <h2 class="text-sm font-medium text-muted-foreground">{t("sched_prompt")}</h2>
          <div class="rounded-lg bg-muted/30 p-4">
            <pre class="whitespace-pre-wrap font-mono text-sm">{task.prompt}</pre>
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-muted-foreground">{t("sched_execHistory")}</h2>
            <Button
              variant="ghost"
              size="sm"
              onclick={() => scheduledTasksStore.loadTaskRuns(task.id)}
            >
              {t("sched_refresh")}
            </Button>
          </div>

          {#if taskExecutions.length === 0}
            <div
              class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            >
              {t("sched_noExecutions")}
            </div>
          {:else}
            <div class="space-y-2">
              {#each taskExecutions as execution (execution.id)}
                {@const statusInfo = runStatusIcon(execution.status)}
                <div
                  role="button"
                  tabindex="0"
                  class="flex w-full items-center gap-3 rounded-lg bg-muted/30 p-3 text-left transition-colors hover:bg-muted/50 cursor-pointer
                    {selectedRunId === execution.id ? 'ring-1 ring-primary/40' : ''}"
                  onclick={() => {
                    selectedRunId = execution.id;
                  }}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectedRunId = execution.id;
                    }
                  }}
                >
                  <span class={statusInfo.color}>{statusInfo.icon}</span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2 text-sm">
                      <span>{statusInfo.label}</span>
                      <span class="text-muted-foreground">
                        {new Date(execution.startedAt).toLocaleString()}
                      </span>
                      {#if execution.endedAt}
                        <span class="text-muted-foreground/50">
                          ({formatDuration(execution.startedAt, execution.endedAt)})
                        </span>
                      {/if}
                    </div>
                    {#if execution.error}
                      <p class="mt-1 truncate text-xs text-destructive">{execution.error}</p>
                    {:else if execution.summary}
                      <p class="mt-1 truncate text-xs text-muted-foreground">{execution.summary}</p>
                    {/if}
                  </div>
                  {#if execution.runId}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={(e) => {
                        e.stopPropagation();
                        openInChat(execution.runId);
                      }}
                    >
                      {t("schedHub_openInChat")}
                    </Button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="overflow-y-auto p-6">
        {#if selectedExecution}
          <div class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold">{t("schedHub_executionDetail")}</h2>
              <p class="text-sm text-muted-foreground">
                {relativeTime(selectedExecution.startedAt)} · {runStatusIcon(
                  selectedExecution.status,
                ).label}
              </p>
            </div>

            <div class="space-y-2">
              <h3 class="text-sm font-medium text-muted-foreground">{t("sched_prompt")}</h3>
              <div class="rounded-lg bg-muted/30 p-4">
                <pre class="whitespace-pre-wrap font-mono text-sm">{task.prompt}</pre>
              </div>
            </div>

            {#if selectedExecution.error}
              <div class="space-y-2">
                <h3 class="text-sm font-medium text-destructive">{t("sched_runFailed")}</h3>
                <div class="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                  {selectedExecution.error}
                </div>
              </div>
            {/if}

            {#if selectedExecution.summary}
              <div class="space-y-2">
                <h3 class="text-sm font-medium text-muted-foreground">
                  {t("schedHub_outputSummary")}
                </h3>
                <div class="rounded-lg bg-muted/30 p-4 text-sm whitespace-pre-wrap">
                  {selectedExecution.summary}
                </div>
              </div>
            {/if}

            {#if selectedLinkedRun}
              <div class="space-y-2">
                <h3 class="text-sm font-medium text-muted-foreground">{t("schedHub_session")}</h3>
                <div class="rounded-lg bg-muted/30 p-4 text-sm">
                  <p class="font-mono text-xs text-muted-foreground">{selectedLinkedRun.id}</p>
                  <p class="mt-2">{selectedLinkedRun.prompt}</p>
                </div>
                <Button variant="outline" onclick={() => openInChat(selectedLinkedRun.id)}>
                  {t("schedHub_openInChat")}
                </Button>
              </div>
            {/if}
          </div>
        {:else}
          <div
            class="flex h-full flex-col items-center justify-center text-center text-muted-foreground"
          >
            <Icon name="clock" class="mb-4 h-16 w-16 opacity-40" />
            <p class="text-sm">{t("schedHub_selectExecution")}</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<ScheduledTaskEditor />
