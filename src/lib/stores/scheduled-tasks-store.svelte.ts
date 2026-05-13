/**
 * Scheduled Tasks Store
 *
 * Reactive state management for scheduled tasks.
 * Handles CRUD operations and state updates.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { ScheduledTask, ScheduledTaskLog } from "$lib/types/scheduled-task";
import {
  scheduledTasksService,
  type CreateTaskParams,
  type UpdateTaskParams,
} from "$lib/services/scheduled-tasks-service";

export class ScheduledTasksStore {
  // State
  tasks = $state<ScheduledTask[]>([]);
  logs = $state<Record<string, ScheduledTaskLog[]>>({});
  loading = $state(false);
  error = $state<string | null>(null);

  // Editor state
  editingTask = $state<ScheduledTask | null>(null);
  showEditor = $state(false);
  editorMode = $state<"create" | "edit">("create");

  // Selected task for details view
  selectedTaskId = $state<string | null>(null);

  // Computed properties
  get activeTasks(): ScheduledTask[] {
    return this.tasks.filter((t) => t.enabled);
  }

  get inactiveTasks(): ScheduledTask[] {
    return this.tasks.filter((t) => !t.enabled);
  }

  get selectedTask(): ScheduledTask | null {
    return this.tasks.find((t) => t.taskId === this.selectedTaskId) || null;
  }

  get selectedTaskLogs(): ScheduledTaskLog[] {
    if (!this.selectedTaskId) return [];
    return this.logs[this.selectedTaskId] || [];
  }

  /**
   * Load all tasks from the service
   */
  async loadTasks(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      const tasks = await scheduledTasksService.listTasks();
      this.tasks = tasks;
      dbg("scheduled-tasks-store", "loadTasks", { count: tasks.length });
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "loadTasks error", e);
      this.error = e instanceof Error ? e.message : "Failed to load tasks";
    } finally {
      this.loading = false;
    }
  }

  /**
   * Create a new task
   */
  async createTask(params: CreateTaskParams): Promise<boolean> {
    this.error = null;

    try {
      const task = await scheduledTasksService.createTask(params);
      if (task) {
        this.tasks = [...this.tasks, task];
        dbg("scheduled-tasks-store", "createTask", task);
        this.showEditor = false;
        return true;
      }
      return false;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "createTask error", e);
      this.error = e instanceof Error ? e.message : "Failed to create task";
      return false;
    }
  }

  /**
   * Update an existing task
   */
  async updateTask(params: UpdateTaskParams): Promise<boolean> {
    this.error = null;

    try {
      const success = await scheduledTasksService.updateTask(params);
      if (success) {
        const index = this.tasks.findIndex((t) => t.taskId === params.taskId);
        if (index >= 0) {
          // Refresh the task from the list
          const updatedTasks = await scheduledTasksService.listTasks();
          this.tasks = updatedTasks;
        }
        this.showEditor = false;
        this.editingTask = null;
        dbg("scheduled-tasks-store", "updateTask", params.taskId);
        return true;
      }
      return false;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "updateTask error", e);
      this.error = e instanceof Error ? e.message : "Failed to update task";
      return false;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<boolean> {
    this.error = null;

    try {
      const success = await scheduledTasksService.deleteTask(taskId);
      if (success) {
        this.tasks = this.tasks.filter((t) => t.taskId !== taskId);
        delete this.logs[taskId];

        if (this.selectedTaskId === taskId) {
          this.selectedTaskId = null;
        }

        dbg("scheduled-tasks-store", "deleteTask", taskId);
        return true;
      }
      return false;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "deleteTask error", e);
      this.error = e instanceof Error ? e.message : "Failed to delete task";
      return false;
    }
  }

  /**
   * Toggle task enabled state
   */
  async toggleTaskEnabled(taskId: string): Promise<void> {
    const task = this.tasks.find((t) => t.taskId === taskId);
    if (!task) return;

    await this.updateTask({ taskId, enabled: !task.enabled });
  }

  /**
   * Trigger a task manually
   */
  async triggerTask(taskId: string): Promise<boolean> {
    this.error = null;

    try {
      const success = await scheduledTasksService.triggerTask(taskId);
      if (success) {
        // Refresh task to get updated lastRunAt
        const updatedTasks = await scheduledTasksService.listTasks();
        this.tasks = updatedTasks;
        dbg("scheduled-tasks-store", "triggerTask", taskId);
      }
      return success;
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "triggerTask error", e);
      this.error = e instanceof Error ? e.message : "Failed to trigger task";
      return false;
    }
  }

  /**
   * Load logs for a specific task
   */
  async loadTaskLogs(taskId: string): Promise<void> {
    try {
      const logs = await scheduledTasksService.getTaskLogs(taskId);
      this.logs = { ...this.logs, [taskId]: logs };
      dbg("scheduled-tasks-store", "loadTaskLogs", { taskId, count: logs.length });
    } catch (e) {
      dbgWarn("scheduled-tasks-store", "loadTaskLogs error", e);
    }
  }

  /**
   * Open the editor for creating a new task
   */
  openCreateEditor(): void {
    this.editingTask = null;
    this.editorMode = "create";
    this.showEditor = true;
  }

  /**
   * Open the editor for editing an existing task
   */
  openEditEditor(task: ScheduledTask): void {
    this.editingTask = task;
    this.editorMode = "edit";
    this.showEditor = true;
  }

  /**
   * Close the editor
   */
  closeEditor(): void {
    this.showEditor = false;
    this.editingTask = null;
  }

  /**
   * Select a task for details view
   */
  selectTask(taskId: string | null): void {
    this.selectedTaskId = taskId;
    if (taskId) {
      this.loadTaskLogs(taskId);
    }
  }

  /**
   * Clear any error state
   */
  clearError(): void {
    this.error = null;
  }
}

// Create singleton instance
export const scheduledTasksStore = new ScheduledTasksStore();
