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

export class ScheduledTasksStore {
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

  get activeTasks(): ScheduledTask[] {
    return this.tasks.filter((t) => t.enabled);
  }

  get inactiveTasks(): ScheduledTask[] {
    return this.tasks.filter((t) => !t.enabled);
  }

  get selectedTask(): ScheduledTask | null {
    return this.tasks.find((t) => t.id === this.selectedTaskId) || null;
  }

  get selectedTaskRuns(): ScheduledTaskRun[] {
    if (!this.selectedTaskId) return [];
    return this.runs.filter((r) => r.taskId === this.selectedTaskId);
  }

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

  async runTaskNow(id: string): Promise<boolean> {
    this.error = null;
    try {
      const run = await scheduledTasksService.runTaskNow(id);
      if (run) {
        // Refresh runs for this task
        await this.loadTaskRuns(id);
        // Refresh task to update lastRunAt
        await this.loadTasks();
        dbg("scheduled-tasks-store", "runTaskNow", { id, status: run.status });
        return true;
      }
      return false;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "runTaskNow error", e);
      this.error = e instanceof Error ? e.message : "Failed to run task";
      return false;
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

  openCreateEditor(): void {
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
}

export const scheduledTasksStore = new ScheduledTasksStore();
