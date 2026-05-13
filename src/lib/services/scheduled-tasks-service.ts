/**
 * Scheduled Tasks Service
 *
 * Handles communication with the MCP scheduled-tasks tool.
 * Provides a clean API for CRUD operations on scheduled tasks.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { ScheduledTask, ScheduledTaskLog } from "$lib/types/scheduled-task";

export interface CreateTaskParams {
  taskId: string;
  description: string;
  prompt: string;
  cronExpression?: string;
  fireAt?: string;
}

export interface UpdateTaskParams {
  taskId: string;
  prompt?: string;
  description?: string;
  cronExpression?: string;
  fireAt?: string;
  enabled?: boolean;
}

export class ScheduledTasksService {
  /**
   * List all scheduled tasks
   */
  async listTasks(): Promise<ScheduledTask[]> {
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "list_scheduled_tasks",
            arguments: {},
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      dbg("scheduled-tasks", "listTasks", data);

      // Parse the MCP response format
      if (data.result?.content?.[0]?.text) {
        const text = data.result.content[0].text;
        const parsed = JSON.parse(text);
        return parsed.map((t: any) => this.parseTaskFromMCP(t));
      }

      return [];
    } catch (e) {
      dbgWarn("scheduled-tasks", "listTasks error", e);
      return [];
    }
  }

  /**
   * Create a new scheduled task
   */
  async createTask(params: CreateTaskParams): Promise<ScheduledTask | null> {
    try {
      const args: Record<string, any> = {
        taskId: params.taskId,
        description: params.description,
        prompt: params.prompt,
      };

      if (params.cronExpression) {
        args.cronExpression = params.cronExpression;
      } else if (params.fireAt) {
        args.fireAt = params.fireAt;
      } else {
        throw new Error("Either cronExpression or fireAt is required");
      }

      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "create_scheduled_task",
            arguments: args,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      dbg("scheduled-tasks", "createTask", data);

      if (data.result?.content?.[0]?.text) {
        const parsed = JSON.parse(data.result.content[0].text);
        return this.parseTaskFromMCP(parsed);
      }

      return null;
    } catch (e) {
      dbgWarn("scheduled-tasks", "createTask error", e);
      return null;
    }
  }

  /**
   * Update an existing scheduled task
   */
  async updateTask(params: UpdateTaskParams): Promise<boolean> {
    try {
      const args: Record<string, any> = { taskId: params.taskId };

      if (params.prompt !== undefined) args.prompt = params.prompt;
      if (params.description !== undefined) args.description = params.description;
      if (params.cronExpression !== undefined) args.cronExpression = params.cronExpression;
      if (params.fireAt !== undefined) args.fireAt = params.fireAt;
      if (params.enabled !== undefined) args.enabled = params.enabled;

      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "update_scheduled_task",
            arguments: args,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      dbg("scheduled-tasks", "updateTask", data);
      return true;
    } catch (e) {
      dbgWarn("scheduled-tasks", "updateTask error", e);
      return false;
    }
  }

  /**
   * Delete a scheduled task
   */
  async deleteTask(taskId: string): Promise<boolean> {
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "delete_scheduled_task",
            arguments: { taskId },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      dbg("scheduled-tasks", "deleteTask", taskId);
      return true;
    } catch (e) {
      dbgWarn("scheduled-tasks", "deleteTask error", e);
      return false;
    }
  }

  /**
   * Enable or disable a task
   */
  async setTaskEnabled(taskId: string, enabled: boolean): Promise<boolean> {
    return this.updateTask({ taskId, enabled });
  }

  /**
   * Trigger a task manually (runs it immediately)
   */
  async triggerTask(taskId: string): Promise<boolean> {
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "execute_scheduled_task",
            arguments: { taskId },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      dbg("scheduled-tasks", "triggerTask", taskId);
      return true;
    } catch (e) {
      dbgWarn("scheduled-tasks", "triggerTask error", e);
      return false;
    }
  }

  /**
   * Get execution logs for a task
   */
  async getTaskLogs(taskId: string, limit = 50): Promise<ScheduledTaskLog[]> {
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "get_task_logs",
            arguments: { taskId, limit },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.result?.content?.[0]?.text) {
        return JSON.parse(data.result.content[0].text);
      }

      return [];
    } catch (e) {
      dbgWarn("scheduled-tasks", "getTaskLogs error", e);
      return [];
    }
  }

  /**
   * Parse task from MCP response format
   */
  private parseTaskFromMCP(data: any): ScheduledTask {
    return {
      taskId: data.taskId || data.task_id || "",
      description: data.description || "",
      prompt: data.prompt || "",
      cronExpression: data.cronExpression || data.cron_expression,
      fireAt: data.fireAt || data.fire_at,
      enabled: data.enabled ?? true,
      nextRunAt: data.nextRunAt || data.next_run_at,
      lastRunAt: data.lastRunAt || data.last_run_at,
      createdAt: data.createdAt || data.created_at || new Date().toISOString(),
    };
  }

  /**
   * Validate a cron expression
   */
  static validateCronExpression(expr: string): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    // Basic validation for each field
    const patterns = [
      /^(\*|[\d]+|[\d]+[-][\d]+|[\d]+[,][\d]+|[\d]+\/[\d]+)$/, // minute
      /^(\*|[\d]+|[\d]+[-][\d]+|[\d]+[,][\d]+|[\d]+\/[\d]+)$/, // hour
      /^(\*|[\d]+|[\d]+[-][\d]+|[\d]+[,][\d]+|[\d]+\/[\d]+)$/, // day
      /^(\*|[\d]+|[\d]+[-][\d]+|[\d]+[,][\d]+|[\d]+\/[\d]+)$/, // month
      /^(\*|[\d]+|[\d]+[-][\d]+|[\d]+[,][\d]+|[\d]+\/[\d]+)$/, // weekday
    ];

    return parts.every((part, i) => patterns[i].test(part));
  }

  /**
   * Parse cron expression into human-readable description
   */
  static describeCronExpression(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return "Invalid expression";

    const [minute, hour, day, month, weekday] = parts;

    if (expr === "* * * * *") return "Every minute";
    if (expr === "*/5 * * * *") return "Every 5 minutes";
    if (expr === "*/15 * * * *") return "Every 15 minutes";
    if (expr === "0 * * * *") return "Every hour";

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
          .map((d) => days[parseInt(d)])
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
