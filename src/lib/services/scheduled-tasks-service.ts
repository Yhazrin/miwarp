/**
 * Scheduled Tasks Service
 *
 * Communicates with the Rust scheduler backend via Tauri IPC.
 */
import { getTransport } from "$lib/transport";
import { dbg, dbgWarn } from "$lib/utils/debug";
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskInput,
  ScheduledTaskPatch,
} from "$lib/types/scheduled-task";

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}

export class ScheduledTasksService {
  async listTasks(): Promise<ScheduledTask[]> {
    try {
      const tasks = await invoke<ScheduledTask[]>("list_scheduled_tasks");
      dbg("scheduled-tasks", "listTasks", { count: tasks.length });
      return tasks;
    } catch (e) {
      dbgWarn("scheduled-tasks", "listTasks error", e);
      return [];
    }
  }

  async createTask(input: ScheduledTaskInput): Promise<ScheduledTask | null> {
    try {
      const task = await invoke<ScheduledTask>("create_scheduled_task", { input });
      dbg("scheduled-tasks", "createTask", task.name);
      return task;
    } catch (e) {
      dbgWarn("scheduled-tasks", "createTask error", e);
      throw e;
    }
  }

  async updateTask(id: string, patch: ScheduledTaskPatch): Promise<ScheduledTask | null> {
    try {
      const task = await invoke<ScheduledTask>("update_scheduled_task", { id, patch });
      dbg("scheduled-tasks", "updateTask", task.name);
      return task;
    } catch (e) {
      dbgWarn("scheduled-tasks", "updateTask error", e);
      throw e;
    }
  }

  async deleteTask(id: string): Promise<boolean> {
    try {
      await invoke<boolean>("delete_scheduled_task", { id });
      dbg("scheduled-tasks", "deleteTask", id);
      return true;
    } catch (e) {
      dbgWarn("scheduled-tasks", "deleteTask error", e);
      return false;
    }
  }

  async setTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTask | null> {
    try {
      const task = await invoke<ScheduledTask>("set_scheduled_task_enabled", { id, enabled });
      dbg("scheduled-tasks", "setTaskEnabled", { id, enabled });
      return task;
    } catch (e) {
      dbgWarn("scheduled-tasks", "setTaskEnabled error", e);
      throw e;
    }
  }

  async runTaskNow(id: string): Promise<ScheduledTaskRun | null> {
    try {
      const run = await invoke<ScheduledTaskRun>("run_scheduled_task_now", { id });
      dbg("scheduled-tasks", "runTaskNow", { id, status: run.status });
      return run;
    } catch (e) {
      dbgWarn("scheduled-tasks", "runTaskNow error", e);
      throw e;
    }
  }

  async listTaskRuns(taskId?: string, limit?: number): Promise<ScheduledTaskRun[]> {
    try {
      const runs = await invoke<ScheduledTaskRun[]>("list_scheduled_task_runs", {
        taskId: taskId ?? null,
        limit: limit ?? null,
      });
      dbg("scheduled-tasks", "listTaskRuns", { count: runs.length });
      return runs;
    } catch (e) {
      dbgWarn("scheduled-tasks", "listTaskRuns error", e);
      return [];
    }
  }

  /**
   * Validate a 5-field cron expression client-side.
   */
  static validateCronExpression(expr: string): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const ranges = [
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 6],
    ];
    return parts.every((part, i) => {
      const [min, max] = ranges[i];
      for (const seg of part.split(",")) {
        if (seg === "*") continue;
        if (seg.includes("/")) {
          const [range, step] = seg.split("/");
          if (!step || isNaN(+step) || +step === 0) return false;
          if (range !== "*") {
            if (range.includes("-")) {
              const [a, b] = range.split("-").map(Number);
              if (isNaN(a) || isNaN(b) || a < min || b > max) return false;
            } else {
              const v = +range;
              if (isNaN(v) || v < min || v > max) return false;
            }
          }
          continue;
        }
        if (seg.includes("-")) {
          const [a, b] = seg.split("-").map(Number);
          if (isNaN(a) || isNaN(b) || a < min || b > max) return false;
          continue;
        }
        const v = +seg;
        if (isNaN(v) || v < min || v > max) return false;
      }
      return true;
    });
  }

  /**
   * Parse cron expression into human-readable description.
   */
  static describeCronExpression(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return "Invalid expression";

    const [minute, hour, day, month, weekday] = parts;

    if (expr === "* * * * *") return "Every minute";
    if (minute.startsWith("*/")) return `Every ${minute.slice(2)} minutes`;
    if (hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;

    if (minute !== "*" && hour !== "*") {
      const h = parseInt(hour);
      const m = parseInt(minute);
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const displayMin = m.toString().padStart(2, "0");

      if (weekday !== "*") {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayList = weekday
          .split(",")
          .map((d) => days[parseInt(d)] ?? d)
          .join(", ");
        return `Every ${dayList} at ${displayHour}:${displayMin} ${period}`;
      }

      if (day === "*" && month === "*") {
        return `Every day at ${displayHour}:${displayMin} ${period}`;
      }

      return `At ${displayHour}:${displayMin} ${period}`;
    }

    return `Schedule: ${expr}`;
  }
}

export const scheduledTasksService = new ScheduledTasksService();
