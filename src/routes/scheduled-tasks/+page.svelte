<script lang="ts">
  import { onMount } from "svelte";
  import { slide } from "svelte/transition";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/components/Button.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import ScheduledTaskEditor from "$lib/components/ScheduledTaskEditor.svelte";
  import TaskExecutionMonitor from "$lib/components/TaskExecutionMonitor.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import type { ScheduledTaskRun } from "$lib/types/scheduled-task";
  import Icon from "$lib/components/Icon.svelte";
  import type { LucideIconName } from "$lib/lucide-icon";

  let runningNow = $state(false);

  // Read monitor state from the store so navigating away and back doesn't
  // reset the in-flight progress (#5).
  const activeMonitor = $derived(scheduledTasksStore.activeMonitor);
  const monitorLogs = $derived(scheduledTasksStore.monitorLogs);
  const monitorStatus = $derived(scheduledTasksStore.monitorStatus);
  const monitorProgress = $derived(scheduledTasksStore.monitorProgress);
  const monitorStep = $derived(scheduledTasksStore.monitorStep);
  const monitorTotalSteps = $derived(scheduledTasksStore.monitorTotalSteps);

  const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

  /** Poll a single run by id (cheap IPC) until terminal or timeout. */
  async function pollUntilDone(
    runId: string,
    intervalMs = 3000,
    timeoutMs = 10 * 60 * 1000, // 10 min
  ): Promise<ScheduledTaskRun | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await scheduledTasksStore.pollRun(runId);
      if (run && TERMINAL_STATUSES.has(run.status)) return run;
      await new Promise<void>((res) => setTimeout(res, intervalMs));
    }
    return null;
  }

  async function handleRunNow(taskId: string) {
    if (runningNow) return;

    const task = scheduledTasksStore.tasks.find((t) => t.id === taskId);
    if (!task) return;

    runningNow = true;
    scheduledTasksStore.startMonitor(taskId, task.name, 4);

    try {
      // Step 1: init
      scheduledTasksStore.addMonitorLog("info", `Starting task: ${task.name}`, "init");
      scheduledTasksStore.setMonitorProgress(1, 15);

      // Step 2: workspace
      scheduledTasksStore.addMonitorLog(
        "info",
        `Loading workspace: ${task.workspace.cwd}`,
        "workspace",
      );
      scheduledTasksStore.setMonitorProgress(2, 30);

      // Step 3: execute (start session)
      scheduledTasksStore.addMonitorLog("info", "Launching Claude session…", "execute");
      scheduledTasksStore.setMonitorProgress(3, 45);

      const taskRun = await scheduledTasksStore.runTaskNow(taskId);
      if (!taskRun) {
        throw new Error(scheduledTasksStore.error ?? "Failed to start task");
      }

      scheduledTasksStore.addMonitorLog(
        "info",
        `Session started (run: ${taskRun.runId ?? taskRun.id})`,
        "session",
      );
      scheduledTasksStore.setMonitorProgress(3, 55);

      // Step 4: poll for terminal status
      scheduledTasksStore.addMonitorLog("info", "Waiting for task to complete…", "poll");
      const finalRun = await pollUntilDone(taskRun.id);

      scheduledTasksStore.setMonitorProgress(4, 100);

      if (!finalRun) {
        scheduledTasksStore.setMonitorStatus("failed");
        scheduledTasksStore.addMonitorLog(
          "warn",
          "Timed out waiting for result — task may still be running in background",
          "timeout",
        );
      } else if (finalRun.status === "failed") {
        scheduledTasksStore.setMonitorStatus("failed");
        scheduledTasksStore.addMonitorLog(
          "error",
          finalRun.error || "Task execution failed",
          "error",
        );
      } else if (finalRun.status === "cancelled") {
        scheduledTasksStore.setMonitorStatus("failed");
        scheduledTasksStore.addMonitorLog("warn", "Task was cancelled", "cancel");
      } else {
        scheduledTasksStore.setMonitorStatus("completed");
        scheduledTasksStore.addMonitorLog("info", "Task completed successfully", "done");
      }
    } catch (err) {
      scheduledTasksStore.setMonitorStatus("failed");
      scheduledTasksStore.addMonitorLog("error", `Execution error: ${err}`, "error");
      scheduledTasksStore.setMonitorProgress(monitorTotalSteps, 100);
    } finally {
      runningNow = false;
      scheduledTasksStore.endMonitor();
      // Refresh task so updated lastRunAt / nextRunAt is visible.
      await scheduledTasksStore.loadTasks();
    }
  }

  function closeMonitor() {
    scheduledTasksStore.resetMonitor();
  }

  function retryTask() {
    if (activeMonitor) {
      handleRunNow(activeMonitor.taskId);
    }
  }

  onMount(() => {
    scheduledTasksStore.loadTasks();
    scheduledTasksStore.loadAllRuns();
  });

  function runStatusIcon(status: ScheduledTaskRun["status"]): {
    iconName: LucideIconName;
    color: string;
    label: string;
  } {
    switch (status) {
      case "running":
        return {
          iconName: "loader-2",
          color: "text-miwarp-status-info",
          label: t("sched_runRunning"),
        };
      case "completed":
        return {
          iconName: "check",
          color: "text-miwarp-status-success",
          label: t("sched_runCompleted"),
        };
      case "failed":
        return {
          iconName: "x",
          color: "text-miwarp-status-error",
          label: t("sched_runFailed"),
        };
      case "cancelled":
        return {
          iconName: "circle",
          color: "text-miwarp-status-warning",
          label: t("sched_runCancelled"),
        };
      case "queued":
        return {
          iconName: "circle",
          color: "text-sidebar-foreground/70",
          label: t("sched_runQueued"),
        };
    }
  }

  function formatDuration(startedAt: string, endedAt: string | undefined = undefined): string {
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
  <div class="flex items-center justify-between px-6 py-4">
    <div>
      <h1 class="text-2xl font-bold text-sidebar-foreground">{t("sched_title")}</h1>
      <p class="text-sm text-sidebar-foreground/70">{t("sched_description")}</p>
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
    <!-- Execution Monitor Panel -->
    {#if activeMonitor}
      <div
        class="w-[35%] border-r border-sidebar-border overflow-hidden p-4"
        transition:slide={{ duration: 200 }}
      >
        <h3 class="text-sm font-medium mb-3 flex items-center gap-2 text-sidebar-foreground">
          <span class="h-2 w-2 rounded-full bg-miwarp-status-info animate-pulse"></span>
          {t("scheduledTasks_executionMonitor")}
        </h3>
        <TaskExecutionMonitor
          taskId={activeMonitor.taskId}
          taskName={activeMonitor.taskName}
          status={monitorStatus}
          progress={monitorProgress}
          currentStep={monitorStep}
          totalSteps={monitorTotalSteps}
          logs={monitorLogs}
          onClose={closeMonitor}
          onCancel={() => {
            scheduledTasksStore.addMonitorLog("warn", "Task cancelled by user", "cancel");
            closeMonitor();
          }}
          onRetry={retryTask}
        />
      </div>
    {/if}

    <!-- Task Details Panel -->
    <div class="flex-1 overflow-y-auto {activeMonitor ? 'w-[25%]' : ''}">
      {#if scheduledTasksStore.selectedTask}
        {@const task = scheduledTasksStore.selectedTask}
        <div class="p-6 space-y-6">
          <!-- Task Info -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold text-sidebar-foreground">{task.name}</h2>
              <div class="flex items-center gap-2">
                <span
                  class="px-2 py-1 text-xs rounded-full {task.enabled
                    ? 'bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success'
                    : 'bg-sidebar-accent/40 text-sidebar-foreground/70'}"
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
              <p class="text-sidebar-foreground/70">{task.description}</p>
            {/if}
          </div>

          <!-- Meta -->
          <div class="grid grid-cols-3 gap-4">
            <div class="p-3 rounded-lg bg-sidebar-accent/30">
              <span class="text-xs text-sidebar-foreground/70">{t("sched_agent")}</span>
              <p class="text-sm font-medium uppercase text-sidebar-foreground">{task.agent}</p>
            </div>
            <div class="p-3 rounded-lg bg-sidebar-accent/30">
              <span class="text-xs text-sidebar-foreground/70">{t("sched_workspace")}</span>
              <p
                class="text-sm font-mono truncate text-sidebar-foreground"
                title={task.workspace.cwd}
              >
                {task.workspace.cwd.split(/[/\\]/).pop() || task.workspace.cwd}
              </p>
            </div>
            {#if task.model}
              <div class="p-3 rounded-lg bg-sidebar-accent/30">
                <span class="text-xs text-sidebar-foreground/70">{t("sched_model")}</span>
                <p class="text-sm text-sidebar-foreground">{task.model}</p>
              </div>
            {/if}
          </div>

          <!-- Schedule Info -->
          <div class="p-4 rounded-lg bg-sidebar-accent/30 space-y-2">
            <h3 class="text-sm font-medium text-sidebar-foreground/70">{t("sched_schedule")}</h3>
            {#if task.schedule.type === "cron" && task.schedule.cronExpression}
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm text-sidebar-foreground"
                  >{task.schedule.cronExpression}</span
                >
                <span class="text-xs text-sidebar-foreground/70">
                  ({ScheduledTasksService.describeCronExpression(task.schedule.cronExpression)})
                </span>
              </div>
            {:else if task.schedule.type === "interval"}
              <p class="text-sm text-sidebar-foreground">
                {t("sched_everyMinutes", { n: String(task.schedule.intervalMinutes ?? 60) })}
              </p>
            {:else if task.schedule.type === "one-time" && task.schedule.fireAt}
              <p class="text-sm text-sidebar-foreground">
                {new Date(task.schedule.fireAt).toLocaleString()}
              </p>
            {/if}

            <div class="grid grid-cols-2 gap-4 pt-2">
              <div>
                <span class="text-xs text-sidebar-foreground/70">{t("sched_nextRun")}</span>
                <p class="text-sm text-sidebar-foreground">
                  {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : t("sched_never")}
                </p>
              </div>
              <div>
                <span class="text-xs text-sidebar-foreground/70">{t("sched_lastRun")}</span>
                <p class="text-sm text-sidebar-foreground">
                  {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : t("sched_never")}
                </p>
              </div>
            </div>
          </div>

          <!-- Prompt Preview -->
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-sidebar-foreground/70">{t("sched_prompt")}</h3>
            <div class="p-4 rounded-lg bg-sidebar-accent/30">
              <pre
                class="text-sm whitespace-pre-wrap font-mono text-sidebar-foreground">{task.prompt}</pre>
            </div>
          </div>

          <!-- Execution Runs -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium text-sidebar-foreground/70">
                {t("sched_execHistory")}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => scheduledTasksStore.loadTaskRuns(task.id)}
              >
                {t("sched_refresh")}
              </Button>
            </div>

            {#if scheduledTasksStore.selectedTaskRuns.length === 0}
              <EmptyState iconName="bar-chart-2" variant="dashed" title={t("sched_noExecutions")} />
            {:else}
              <div class="space-y-2">
                {#each scheduledTasksStore.selectedTaskRuns as run (run.id)}
                  {@const statusInfo = runStatusIcon(run.status)}
                  <div class="p-3 rounded-lg bg-sidebar-accent/30 flex items-center gap-3">
                    <Icon name={statusInfo.iconName} size="sm" class={statusInfo.color} />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 text-sm">
                        <span class="text-sidebar-foreground">{statusInfo.label}</span>
                        <span class="text-sidebar-foreground/70">
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                        {#if run.endedAt}
                          <span class="text-sidebar-foreground/50">
                            ({formatDuration(run.startedAt, run.endedAt)})
                          </span>
                        {/if}
                      </div>
                      {#if run.error}
                        <p class="text-xs text-destructive mt-1 truncate">{run.error}</p>
                      {:else if run.summary}
                        <p class="text-xs text-sidebar-foreground/70 mt-1 truncate">
                          {run.summary}
                        </p>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center h-full text-sidebar-foreground/70">
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
      type="button"
      class="ml-2 p-1 hover:bg-[hsl(var(--miwarp-text-primary)/0.15)] rounded"
      aria-label={t("common_dismiss")}
      onclick={() => scheduledTasksStore.clearError()}
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
{/if}
