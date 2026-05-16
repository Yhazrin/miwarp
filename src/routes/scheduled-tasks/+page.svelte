<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/components/Button.svelte";
  import ScheduledTaskCard from "$lib/components/ScheduledTaskCard.svelte";
  import ScheduledTaskEditor from "$lib/components/ScheduledTaskEditor.svelte";
  import TaskExecutionMonitor from "$lib/components/TaskExecutionMonitor.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import type { ScheduledTaskRun } from "$lib/types/scheduled-task";
  import type {
    TaskExecutionMonitor as MonitorType,
    ExecutionLog,
  } from "$lib/types/task-execution-monitor";
  import { dbg } from "$lib/utils/debug";

  let activeTab = $state<"all" | "active" | "paused">("all");
  let searchQuery = $state("");
  let runningNow = $state(false);
  let copiedPrompt = $state(false);

  // Execution monitoring state
  let activeMonitor = $state<MonitorType | null>(null);
  let monitorLogs = $state<ExecutionLog[]>([]);
  let monitorStatus = $state<"queued" | "running" | "paused" | "completed" | "failed">("queued");
  let monitorProgress = $state(0);
  let monitorStep = $state(0);
  let monitorTotalSteps = $state(3);

  function createMonitor(taskId: string, taskName: string, totalSteps: number): MonitorType {
    return {
      taskId,
      taskName,
      status: "running",
      progress: 0,
      currentStep: 0,
      totalSteps,
      logs: [],
      startTime: new Date().toISOString(),
    };
  }

  function addLog(level: ExecutionLog["level"], message: string, stepId?: string) {
    const log: ExecutionLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      stepId,
    };
    monitorLogs = [...monitorLogs, log];
    dbg("scheduled-task-monitor", level, { message, stepId });
  }

  function updateMonitorStatus(status: typeof monitorStatus) {
    monitorStatus = status;
    if (activeMonitor) {
      activeMonitor.status = status;
    }
  }

  function updateProgress(step: number, progress: number) {
    monitorStep = step;
    monitorProgress = progress;
    if (activeMonitor) {
      activeMonitor.currentStep = step;
      activeMonitor.progress = progress;
    }
  }

  const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

  async function pollUntilDone(
    taskId: string,
    runId: string,
    intervalMs = 3000,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<import("$lib/types/scheduled-task").ScheduledTaskRun | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await scheduledTasksStore.loadTaskRuns(taskId);
      const run = scheduledTasksStore.runs.find((r) => r.id === runId);
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
    monitorTotalSteps = 3;

    activeMonitor = createMonitor(taskId, task.name, monitorTotalSteps);
    monitorLogs = [];
    monitorStatus = "running";
    monitorProgress = 0;
    monitorStep = 0;

    try {
      addLog("info", `Starting task: ${task.name}`, "init");
      updateProgress(1, 15);

      addLog("info", `Loading workspace: ${task.workspace.cwd}`, "workspace");
      updateProgress(1, 30);
      addLog("info", "Launching Claude session...", "execute");
      updateProgress(2, 45);

      const taskRun = await scheduledTasksStore.runTaskNow(taskId);
      if (!taskRun) {
        throw new Error(scheduledTasksStore.error ?? "Failed to start task");
      }

      addLog("info", `Session started (run: ${taskRun.runId ?? taskRun.id})`, "session");
      updateProgress(2, 55);

      addLog("info", "Waiting for task to complete...", "poll");
      const finalRun = await pollUntilDone(taskId, taskRun.id);

      updateProgress(3, 100);

      if (!finalRun) {
        updateMonitorStatus("failed");
        addLog(
          "warn",
          "Timed out waiting for result - task may still be running in background",
          "timeout",
        );
      } else if (finalRun.status === "failed") {
        updateMonitorStatus("failed");
        addLog("error", finalRun.error || "Task execution failed", "error");
      } else if (finalRun.status === "cancelled") {
        updateMonitorStatus("failed");
        addLog("warn", "Task was cancelled", "cancel");
      } else {
        updateMonitorStatus("completed");
        addLog("info", "Task completed successfully", "done");
      }
    } catch (err) {
      updateMonitorStatus("failed");
      addLog("error", `Execution error: ${err}`, "error");
      monitorProgress = 100;
    } finally {
      runningNow = false;
      if (activeMonitor) {
        activeMonitor.endTime = new Date().toISOString();
      }
    }
  }

  function closeMonitor() {
    activeMonitor = null;
    monitorLogs = [];
    monitorStatus = "queued";
    monitorProgress = 0;
    monitorStep = 0;
  }

  function retryTask() {
    if (activeMonitor) {
      handleRunNow(activeMonitor.taskId);
    }
  }

  function runStatusIcon(status: ScheduledTaskRun["status"]) {
    switch (status) {
      case "running":
        return {
          icon: "spinner",
          color: "text-blue-500",
          bg: "bg-blue-500/10",
          label: t("sched_runRunning"),
        };
      case "completed":
        return {
          icon: "check",
          color: "text-green-500",
          bg: "bg-green-500/10",
          label: t("sched_runCompleted"),
        };
      case "failed":
        return {
          icon: "x",
          color: "text-red-500",
          bg: "bg-red-500/10",
          label: t("sched_runFailed"),
        };
      case "cancelled":
        return {
          icon: "circle",
          color: "text-yellow-500",
          bg: "bg-yellow-500/10",
          label: t("sched_runCancelled"),
        };
      case "queued":
        return {
          icon: "circle",
          color: "text-muted-foreground",
          bg: "bg-muted",
          label: t("sched_runQueued"),
        };
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

  async function copyPrompt() {
    const task = scheduledTasksStore.selectedTask;
    if (!task) return;
    try {
      await navigator.clipboard.writeText(task.prompt);
      copiedPrompt = true;
      setTimeout(() => (copiedPrompt = false), 2000);
    } catch {
      // clipboard API may fail in some environments
    }
  }

  const filteredTasks = $derived.by(() => {
    let tasks = scheduledTasksStore.tasks;
    switch (activeTab) {
      case "active":
        tasks = scheduledTasksStore.activeTasks;
        break;
      case "paused":
        tasks = scheduledTasksStore.inactiveTasks;
        break;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.agent.toLowerCase().includes(q),
      );
    }
    return tasks;
  });

  onMount(() => {
    scheduledTasksStore.loadTasks();
    scheduledTasksStore.loadAllRuns();
  });
</script>

<svelte:head>
  <title>{t("sched_title")}</title>
</svelte:head>

<div class="flex flex-col h-full">
  <!-- Page Header -->
  <div class="flex items-center justify-between px-8 pt-6 pb-4">
    <div>
      <h1 class="text-[26px] font-bold tracking-tight text-foreground">{t("sched_title")}</h1>
      <p class="text-sm text-muted-foreground mt-0.5">{t("sched_description")}</p>
    </div>
    <Button
      variant="default"
      class="rounded-xl h-9 px-4 gap-2"
      onclick={() => scheduledTasksStore.openCreateEditor()}
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      {t("sched_newTask")}
    </Button>
  </div>

  <!-- Content -->
  <div class="flex flex-1 overflow-hidden px-8 pb-6 gap-5">
    <!-- Left: Task List Panel -->
    <div
      class="flex flex-col w-[400px] shrink-0 rounded-2xl border border-border bg-card/50 overflow-hidden"
    >
      <!-- Tabs + Search -->
      <div class="px-4 pt-3 pb-2 space-y-2 border-b border-border/60">
        <div class="flex items-center gap-1">
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg transition-all
              {activeTab === 'all'
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
            onclick={() => (activeTab = "all")}
          >
            {t("sched_tabAll")} ({scheduledTasksStore.tasks.length})
          </button>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg transition-all
              {activeTab === 'active'
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
            onclick={() => (activeTab = "active")}
          >
            {t("sched_tabActive")} ({scheduledTasksStore.activeTasks.length})
          </button>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg transition-all
              {activeTab === 'paused'
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
            onclick={() => (activeTab = "paused")}
          >
            {t("sched_tabPaused")} ({scheduledTasksStore.inactiveTasks.length})
          </button>
        </div>
        <div class="relative">
          <svg
            class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search tasks..."
            class="w-full rounded-lg border border-border/60 bg-muted/30 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-colors"
            bind:value={searchQuery}
          />
        </div>
      </div>

      <!-- Task List -->
      <div class="flex-1 overflow-y-auto p-3 space-y-1.5">
        {#if scheduledTasksStore.loading}
          <div class="flex items-center justify-center py-12 text-muted-foreground">
            <svg
              class="w-4 h-4 animate-spin mr-2"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <span class="text-xs">{t("sched_loading")}</span>
          </div>
        {:else if filteredTasks.length === 0}
          <div class="flex flex-col items-center justify-center py-16 text-center px-4">
            <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/50 mb-4">
              <svg
                class="h-6 w-6 text-muted-foreground/50"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p class="text-sm font-medium text-foreground mb-1">
              {searchQuery ? "No matching tasks" : t("sched_noTasks")}
            </p>
            <p class="text-xs text-muted-foreground mb-4 max-w-[200px]">
              {searchQuery
                ? "Try a different search term"
                : t("sched_createFirst") || "Create an automated task to get started"}
            </p>
            {#if !searchQuery}
              <Button
                variant="outline"
                size="sm"
                class="rounded-lg"
                onclick={() => scheduledTasksStore.openCreateEditor()}
              >
                {t("sched_newTask")}
              </Button>
            {/if}
          </div>
        {:else}
          {#each filteredTasks as task (task.id)}
            <ScheduledTaskCard {task} selected={scheduledTasksStore.selectedTaskId === task.id} />
          {/each}
        {/if}
      </div>
    </div>

    <!-- Right: Task Detail Panel -->
    <div class="flex-1 min-w-0 overflow-y-auto">
      {#if activeMonitor}
        <!-- Execution Monitor -->
        <div class="rounded-2xl border border-border bg-card/50 overflow-hidden">
          <div class="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-foreground flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span>
              Execution Monitor
            </h3>
            <Button variant="ghost" size="icon" class="h-7 w-7" onclick={closeMonitor}>
              <svg
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </Button>
          </div>
          <div class="p-5">
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
                addLog("warn", "Task cancelled by user", "cancel");
                closeMonitor();
              }}
              onRetry={retryTask}
            />
          </div>
        </div>
      {:else if scheduledTasksStore.selectedTask}
        {@const task = scheduledTasksStore.selectedTask}
        {@const taskRuns = scheduledTasksStore.selectedTaskRuns}
        <div class="space-y-5">
          <!-- Hero Detail Card -->
          <div class="rounded-2xl border border-border bg-card/50 p-5">
            <div class="flex items-start justify-between gap-4 mb-1">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-3">
                  <h2 class="text-lg font-semibold text-foreground truncate">{task.name}</h2>
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0
                      {task.enabled
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'bg-muted text-muted-foreground'}"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full {task.enabled
                        ? 'bg-green-500'
                        : 'bg-muted-foreground/50'}"
                    ></span>
                    {task.enabled ? t("sched_active") : t("sched_paused")}
                  </span>
                </div>
                {#if task.description}
                  <p class="text-sm text-muted-foreground mt-1">{task.description}</p>
                {/if}
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <Button
                  variant="default"
                  size="sm"
                  class="rounded-lg gap-1.5"
                  loading={runningNow}
                  disabled={runningNow}
                  onclick={() => handleRunNow(task.id)}
                >
                  <svg
                    class="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                  {t("sched_runNow")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="rounded-lg"
                  onclick={() => scheduledTasksStore.openEditEditor(task)}
                >
                  {t("schedCard_edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="rounded-lg"
                  onclick={() => scheduledTasksStore.toggleTaskEnabled(task.id)}
                >
                  {task.enabled ? t("schedCard_pause") : t("schedCard_resume")}
                </Button>
              </div>
            </div>
          </div>

          <!-- Meta Grid -->
          <div class="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div class="rounded-xl border border-border/60 bg-card/30 p-3.5">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wide"
                >{t("sched_agent")}</span
              >
              <p class="text-sm font-semibold text-foreground mt-1 uppercase">{task.agent}</p>
            </div>
            <div class="rounded-xl border border-border/60 bg-card/30 p-3.5">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wide"
                >{t("sched_workspace")}</span
              >
              <p class="text-sm font-mono text-foreground mt-1 truncate" title={task.workspace.cwd}>
                {task.workspace.cwd.split(/[/\\]/).pop() || task.workspace.cwd}
              </p>
            </div>
            <div class="rounded-xl border border-border/60 bg-card/30 p-3.5">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wide"
                >{t("sched_schedule")}</span
              >
              <p class="text-sm font-medium text-foreground mt-1">
                {#if task.schedule.type === "cron" && task.schedule.cronExpression}
                  {ScheduledTasksService.describeCronExpression(task.schedule.cronExpression)}
                {:else if task.schedule.type === "interval"}
                  {t("sched_everyMinutes", { n: String(task.schedule.intervalMinutes ?? 60) })}
                {:else if task.schedule.type === "one-time" && task.schedule.fireAt}
                  {new Date(task.schedule.fireAt).toLocaleString()}
                {:else}
                  --
                {/if}
              </p>
              {#if task.schedule.type === "cron" && task.schedule.cronExpression}
                <p class="text-[11px] font-mono text-muted-foreground mt-0.5">
                  {task.schedule.cronExpression}
                </p>
              {/if}
            </div>
            {#if task.model}
              <div class="rounded-xl border border-border/60 bg-card/30 p-3.5">
                <span class="text-[11px] text-muted-foreground uppercase tracking-wide"
                  >{t("sched_model")}</span
                >
                <p class="text-sm font-medium text-foreground mt-1">{task.model}</p>
              </div>
            {/if}
            <div class="rounded-xl border border-border/60 bg-card/30 p-3.5">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wide"
                >{t("sched_nextRun")}</span
              >
              <p class="text-sm text-foreground mt-1">
                {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : t("sched_never")}
              </p>
            </div>
            <div class="rounded-xl border border-border/60 bg-card/30 p-3.5">
              <span class="text-[11px] text-muted-foreground uppercase tracking-wide"
                >{t("sched_lastRun")}</span
              >
              <p class="text-sm text-foreground mt-1">
                {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : t("sched_never")}
              </p>
            </div>
          </div>

          <!-- Prompt Card -->
          <div class="rounded-2xl border border-border bg-card/50 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3 border-b border-border/60">
              <h3 class="text-xs font-semibold text-foreground">{t("sched_prompt")}</h3>
              <button
                class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                onclick={copyPrompt}
              >
                {#if copiedPrompt}
                  <svg
                    class="h-3 w-3 text-green-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied
                {:else}
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                  Copy
                {/if}
              </button>
            </div>
            <div class="p-5 bg-muted/20">
              <pre
                class="text-sm whitespace-pre-wrap font-mono text-foreground/80 leading-relaxed">{task.prompt}</pre>
            </div>
          </div>

          <!-- Execution History -->
          <div class="rounded-2xl border border-border bg-card/50 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3 border-b border-border/60">
              <h3 class="text-xs font-semibold text-foreground">{t("sched_execHistory")}</h3>
              <button
                class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                onclick={() => scheduledTasksStore.loadTaskRuns(task.id)}
              >
                <svg
                  class="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
                {t("sched_refresh")}
              </button>
            </div>

            {#if taskRuns.length === 0}
              <div class="p-8 text-center">
                <p class="text-xs text-muted-foreground">{t("sched_noExecutions")}</p>
              </div>
            {:else}
              <div class="divide-y divide-border/40">
                {#each taskRuns as run (run.id)}
                  {@const statusInfo = runStatusIcon(run.status)}
                  <div
                    class="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors"
                  >
                    <div
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg {statusInfo.bg}"
                    >
                      {#if statusInfo.icon === "check"}
                        <svg
                          class="h-3.5 w-3.5 {statusInfo.color}"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      {:else if statusInfo.icon === "x"}
                        <svg
                          class="h-3.5 w-3.5 {statusInfo.color}"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                        >
                          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                      {:else if statusInfo.icon === "spinner"}
                        <svg
                          class="h-3.5 w-3.5 {statusInfo.color} animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" />
                        </svg>
                      {:else}
                        <svg
                          class="h-3.5 w-3.5 {statusInfo.color}"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <circle cx="12" cy="12" r="10" />
                        </svg>
                      {/if}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-medium {statusInfo.color}"
                          >{statusInfo.label}</span
                        >
                        <span class="text-[11px] text-muted-foreground">
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                        {#if run.endedAt}
                          <span class="text-[11px] text-muted-foreground/60">
                            {formatDuration(run.startedAt, run.endedAt)}
                          </span>
                        {/if}
                      </div>
                      {#if run.error}
                        <p class="text-[11px] text-red-500/70 mt-0.5 truncate">{run.error}</p>
                      {:else if run.summary}
                        <p class="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
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
        <!-- Empty state: no task selected -->
        <div class="flex flex-col items-center justify-center h-full text-center px-8">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/30 mb-5">
            <svg
              class="h-8 w-8 text-muted-foreground/30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p class="text-sm font-medium text-foreground/70 mb-1">{t("sched_selectTask")}</p>
          <p class="text-xs text-muted-foreground max-w-[260px]">
            View schedule details, prompt, and recent execution history
          </p>
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
    class="fixed bottom-4 right-4 p-4 rounded-xl bg-destructive text-destructive-foreground shadow-lg flex items-center gap-3 z-50"
  >
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
    <span class="text-sm">{scheduledTasksStore.error}</span>
    <button
      class="ml-2 p-1 hover:bg-white/20 rounded-lg"
      onclick={() => scheduledTasksStore.clearError()}
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
{/if}
