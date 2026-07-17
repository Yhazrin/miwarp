/**
 * Scheduled Tasks Store
 *
 * Reactive state management for scheduled tasks using Tauri IPC.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskInput,
  ScheduledTaskPatch,
} from "$lib/types/scheduled-task";
import { scheduledTasksService } from "$lib/services/scheduled-tasks-service";
import type {
  TaskExecutionMonitor as MonitorType,
  ExecutionLog,
} from "$lib/types/task-execution-monitor";

const DEFAULT_TOTAL_STEPS = 4;

class ScheduledTasksStore {
  tasks = $state<ScheduledTask[]>([]);
  runs = $state<ScheduledTaskRun[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  // Editor state
  editingTask = $state<ScheduledTask | null>(null);
  showEditor = $state(false);
  editorMode = $state<"create" | "edit">("create");

  // Selected task for details view
  selectedTaskId = $state<string | null>(null);

  // Live execution monitor state. Lives in the store (not the page) so
  // navigating away and back doesn't lose the in-flight progress.
  activeMonitor = $state<MonitorType | null>(null);
  monitorLogs = $state<ExecutionLog[]>([]);
  monitorStatus = $state<"queued" | "running" | "paused" | "completed" | "failed">("queued");
  monitorProgress = $state(0);
  monitorStep = $state(0);
  monitorTotalSteps = $state(DEFAULT_TOTAL_STEPS);

  activeTasks = $derived.by(() => this.tasks.filter((t) => t.enabled));

  inactiveTasks = $derived.by(() => this.tasks.filter((t) => !t.enabled));

  selectedTask = $derived.by(() => this.tasks.find((t) => t.id === this.selectedTaskId) || null);

  selectedTaskRuns = $derived.by(() => {
    if (!this.selectedTaskId) return [];
    return this.runs.filter((r) => r.taskId === this.selectedTaskId);
  });

  async loadTasks(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.tasks = await scheduledTasksService.listTasks();
      dbg("scheduled-tasks-store", "loadTasks", { count: this.tasks.length });
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "loadTasks error", e);
      this.error = e instanceof Error ? e.message : "Failed to load tasks";
    } finally {
      this.loading = false;
    }
  }

  async createTask(input: ScheduledTaskInput): Promise<boolean> {
    this.error = null;
    try {
      const task = await scheduledTasksService.createTask(input);
      if (task) {
        this.tasks = [...this.tasks, task];
        this.showEditor = false;
        this.editingTask = null;
        dbg("scheduled-tasks-store", "createTask", task.name);
        return true;
      }
      return false;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "createTask error", e);
      this.error = e instanceof Error ? e.message : "Failed to create task";
      return false;
    }
  }

  async updateTask(id: string, patch: ScheduledTaskPatch): Promise<boolean> {
    this.error = null;
    try {
      const task = await scheduledTasksService.updateTask(id, patch);
      if (task) {
        this.tasks = this.tasks.map((t) => (t.id === id ? task : t));
        this.showEditor = false;
        this.editingTask = null;
        dbg("scheduled-tasks-store", "updateTask", task.name);
        return true;
      }
      return false;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "updateTask error", e);
      this.error = e instanceof Error ? e.message : "Failed to update task";
      return false;
    }
  }

  async deleteTask(id: string): Promise<boolean> {
    this.error = null;
    try {
      const ok = await scheduledTasksService.deleteTask(id);
      if (ok) {
        this.tasks = this.tasks.filter((t) => t.id !== id);
        if (this.selectedTaskId === id) this.selectedTaskId = null;
        if (this.activeMonitor?.taskId === id) this.resetMonitor();
        dbg("scheduled-tasks-store", "deleteTask", id);
        return true;
      }
      return false;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "deleteTask error", e);
      this.error = e instanceof Error ? e.message : "Failed to delete task";
      return false;
    }
  }

  async toggleTaskEnabled(id: string): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    await this.updateTask(id, { enabled: !task.enabled });
  }

  async toggleSkipNextRun(id: string): Promise<void> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    try {
      const updated = await scheduledTasksService.setSkipNextRun(id, !task.skipNextRun);
      if (updated) {
        this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
        dbg("scheduled-tasks-store", "toggleSkipNextRun", { id, skip: updated.skipNextRun });
      }
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "toggleSkipNextRun error", e);
      this.error = e instanceof Error ? e.message : "Failed to update task";
    }
  }

  async runTaskNow(
    id: string,
  ): Promise<import("$lib/types/scheduled-task").ScheduledTaskRun | null> {
    this.error = null;
    try {
      const run = await scheduledTasksService.runTaskNow(id);
      if (run) {
        // Merge the new run record immediately so callers can poll by id
        this.runs = [run, ...this.runs.filter((r) => r.id !== run.id)];
        // Refresh task to update lastRunAt
        await this.loadTasks();
        dbg("scheduled-tasks-store", "runTaskNow", { id, status: run.status });
        return run;
      }
      return null;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "runTaskNow error", e);
      this.error = e instanceof Error ? e.message : "Failed to run task";
      return null;
    }
  }

  async loadTaskRuns(taskId: string): Promise<void> {
    try {
      const runs = await scheduledTasksService.listTaskRuns(taskId, 20);
      // Merge into global runs array, replacing runs for this task
      this.runs = [...this.runs.filter((r) => r.taskId !== taskId), ...runs];
      dbg("scheduled-tasks-store", "loadTaskRuns", { taskId, count: runs.length });
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "loadTaskRuns error", e);
    }
  }

  async loadAllRuns(): Promise<void> {
    try {
      this.runs = await scheduledTasksService.listTaskRuns(undefined, 50);
      dbg("scheduled-tasks-store", "loadAllRuns", { count: this.runs.length });
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "loadAllRuns error", e);
    }
  }

  /** Cheap single-run poll used by the live monitor. Updates the cached run
   * in place if the returned record is fresher. */
  async pollRun(runId: string): Promise<ScheduledTaskRun | null> {
    const run = await scheduledTasksService.getRun(runId);
    if (!run) return null;
    this.runs = [run, ...this.runs.filter((r) => r.id !== run.id)];
    return run;
  }

  openCreateEditor(): void {
    // Clear any stale editor state BEFORE flipping showEditor so the effect
    // sees a clean slate on its first run (#1 — avoid leaking form state from
    // a previous create/edit).
    this.editingTask = null;
    this.editorMode = "create";
    this.showEditor = true;
  }

  openEditEditor(task: ScheduledTask): void {
    this.editingTask = task;
    this.editorMode = "edit";
    this.showEditor = true;
  }

  closeEditor(): void {
    this.showEditor = false;
    this.editingTask = null;
  }

  selectTask(id: string | null): void {
    this.selectedTaskId = id;
    if (id) this.loadTaskRuns(id);
  }

  clearError(): void {
    this.error = null;
  }

  // ── Live monitor helpers ──

  startMonitor(taskId: string, taskName: string, totalSteps = DEFAULT_TOTAL_STEPS): void {
    this.monitorTotalSteps = totalSteps;
    this.monitorStep = 0;
    this.monitorProgress = 0;
    this.monitorStatus = "running";
    this.monitorLogs = [];
    this.activeMonitor = {
      taskId,
      taskName,
      status: "running",
      progress: 0,
      currentStep: 0,
      totalSteps,
      logs: [],
      startedAt: new Date().toISOString(),
      estimatedDuration: "1-2 min",
    };
  }

  addMonitorLog(level: ExecutionLog["level"], message: string, stepId?: string): void {
    const log: ExecutionLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      stepId,
    };
    this.monitorLogs = [...this.monitorLogs, log];
    dbg("scheduled-task-monitor", level, { message, stepId });
  }

  setMonitorStatus(status: typeof this.monitorStatus): void {
    this.monitorStatus = status;
    if (this.activeMonitor) {
      this.activeMonitor = { ...this.activeMonitor, status };
    }
  }

  setMonitorProgress(step: number, progress: number): void {
    this.monitorStep = step;
    this.monitorProgress = progress;
    if (this.activeMonitor) {
      this.activeMonitor = {
        ...this.activeMonitor,
        currentStep: step,
        progress,
      };
    }
  }

  endMonitor(): void {
    if (this.activeMonitor) {
      this.activeMonitor = {
        ...this.activeMonitor,
        endedAt: new Date().toISOString(),
      };
    }
  }

  resetMonitor(): void {
    this.activeMonitor = null;
    this.monitorLogs = [];
    this.monitorStatus = "queued";
    this.monitorProgress = 0;
    this.monitorStep = 0;
    this.monitorTotalSteps = DEFAULT_TOTAL_STEPS;
  }
}

export const scheduledTasksStore = new ScheduledTasksStore();
