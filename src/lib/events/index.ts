/**
 * Event System
 *
 * A lightweight event emitter system for decoupling components.
 * Based on Claude Code/Cowork design patterns for real-time updates.
 */

/**
 * Event handler type.
 */
type EventHandler<T = unknown> = (data: T) => void;

/**
 * Event emitter class for type-safe event handling.
 */
class EventEmitter<T extends object> {
  private handlers = new Map<keyof T, Set<EventHandler<unknown>>>();

  /**
   * Subscribe to an event.
   */
  on<K extends keyof T>(event: K, handler: EventHandler<T[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Subscribe once to an event.
   */
  once<K extends keyof T>(event: K, handler: EventHandler<T[K]>): () => void {
    const wrappedHandler = (data: T[K]) => {
      handler(data);
      this.off(event, wrappedHandler as EventHandler<unknown>);
    };
    return this.on(event, wrappedHandler as EventHandler<unknown>);
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends keyof T>(event: K, handler: EventHandler<T[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  /**
   * Emit an event.
   */
  emit<K extends keyof T>(event: K, data: T[K]): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`Event handler error for "${String(event)}":`, e);
      }
    });
  }

  /**
   * Remove all handlers for an event (or all events if no event specified).
   */
  removeAllListeners<K extends keyof T>(event?: K): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

// ── Skill Events ──

export interface SkillEvents {
  executing: { skillId: string; args: string };
  progress: { executionId: string; progress: number; message: string };
  completed: { executionId: string; result: string };
  failed: { executionId: string; error: string };
  cancelled: { executionId: string };
}

export const skillEvents = new EventEmitter<SkillEvents>();

// ── Task Events ──

export interface TaskEvents {
  created: { taskId: string; name: string; schedule: string };
  started: { taskId: string };
  completed: { taskId: string; duration: number };
  failed: { taskId: string; error: string };
  disabled: { taskId: string };
  enabled: { taskId: string };
}

export const taskEvents = new EventEmitter<TaskEvents>();

// ── UI Events ──

export interface UIEvents {
  notification: {
    type: "info" | "success" | "warning" | "error";
    message: string;
    duration?: number;
  };
  modal_open: { id: string; props?: Record<string, unknown> };
  modal_close: { id: string };
  toast: { message: string; type: "info" | "success" | "error"; duration?: number };
  theme_change: { theme: "light" | "dark" | "system" };
  locale_change: { locale: string };
}

export const uiEvents = new EventEmitter<UIEvents>();

// ── Session Events ──

export interface SessionEvents {
  created: { sessionId: string; cwd: string };
  selected: { sessionId: string };
  closed: { sessionId: string };
  phase_changed: { sessionId: string; phase: string };
  message_sent: { sessionId: string };
  message_received: { sessionId: string; content: string };
}

export const sessionEvents = new EventEmitter<SessionEvents>();

// ── Plugin Events ──

export interface PluginEvents {
  installed: { pluginId: string; name: string };
  uninstalled: { pluginId: string };
  enabled: { pluginId: string };
  disabled: { pluginId: string };
  update_available: { pluginId: string; version: string };
}

export const pluginEvents = new EventEmitter<PluginEvents>();

// ── Convenience Functions ──

/**
 * Emit a skill execution event.
 */
export function emitSkillExecuting(skillId: string, args: string): void {
  skillEvents.emit("executing", { skillId, args });
}

export function emitSkillProgress(executionId: string, progress: number, message: string): void {
  skillEvents.emit("progress", { executionId, progress, message });
}

export function emitSkillCompleted(executionId: string, result: string): void {
  skillEvents.emit("completed", { executionId, result });
}

export function emitSkillFailed(executionId: string, error: string): void {
  skillEvents.emit("failed", { executionId, error });
}

/**
 * Emit a task event.
 */
export function emitTaskCreated(taskId: string, name: string, schedule: string): void {
  taskEvents.emit("created", { taskId, name, schedule });
}

export function emitTaskFailed(taskId: string, error: string): void {
  taskEvents.emit("failed", { taskId, error });
}

/**
 * Emit a UI notification.
 */
export function emitNotification(
  type: UIEvents["notification"]["type"],
  message: string,
  duration = 5000,
): void {
  uiEvents.emit("notification", { type, message, duration });
}

/**
 * Emit a toast message.
 */
export function emitToast(
  message: string,
  type: UIEvents["toast"]["type"] = "info",
  duration = 3000,
): void {
  uiEvents.emit("toast", { message, type, duration });
}
