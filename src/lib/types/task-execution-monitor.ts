/**
 * Task Execution Monitor Types
 *
 * Real-time monitoring types for scheduled task execution.
 * Based on Claude Cowork design patterns.
 */

export interface TaskExecutionMonitor {
  taskId: string;
  taskName: string;
  status: TaskExecutionStatus;

  // Progress tracking
  currentStep: number;
  totalSteps: number;
  progress: number; // 0-100

  // Execution context
  startTime?: string;
  endTime?: string;
  startedAt?: string;
  endedAt?: string;
  estimatedDuration?: string;

  // Logs
  logs: ExecutionLog[];

  // Resource usage
  resourceUsage?: ResourceUsage;

  // Error info
  error?: TaskError;

  // Metadata
  metadata?: Record<string, unknown>;
}

export type TaskExecutionStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExecutionLog {
  id?: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  stepId?: string;
  source?: string;
}

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface ResourceUsage {
  cpu: number; // percentage
  memory: number; // MB
  duration: number; // seconds
  tokensUsed?: number;
}

export interface TaskError {
  code: string;
  message: string;
  stack?: string;
  recoverable: boolean;
}

/**
 * Step execution result
 */
export interface StepResult {
  stepId: string;
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
  artifacts?: string[];
}

/**
 * Create a new execution monitor instance
 */
export function createExecutionMonitor(
  taskId: string,
  taskName: string,
  totalSteps: number = 1,
): TaskExecutionMonitor {
  return {
    taskId,
    taskName,
    status: "queued",
    currentStep: 0,
    totalSteps,
    progress: 0,
    logs: [],
    startTime: new Date().toISOString(),
  };
}

/**
 * Add a log entry to the monitor
 */
export function addLog(
  monitor: TaskExecutionMonitor,
  level: LogLevel,
  message: string,
  stepId?: string,
): void {
  monitor.logs.push({
    timestamp: new Date().toISOString(),
    level,
    message,
    stepId,
  });
}

/**
 * Update progress
 */
export function updateProgress(
  monitor: TaskExecutionMonitor,
  currentStep: number,
  progress: number,
): void {
  monitor.currentStep = currentStep;
  monitor.progress = Math.min(100, Math.max(0, progress));
}

/**
 * Mark monitor as completed
 */
export function markCompleted(monitor: TaskExecutionMonitor): void {
  monitor.status = "completed";
  monitor.endTime = new Date().toISOString();
  monitor.progress = 100;
  addLog(monitor, "info", "Task completed successfully");
}

/**
 * Mark monitor as failed
 */
export function markFailed(monitor: TaskExecutionMonitor, error: TaskError): void {
  monitor.status = "failed";
  monitor.endTime = new Date().toISOString();
  monitor.error = error;
  addLog(monitor, "error", `Task failed: ${error.message}`);
}

/**
 * Calculate execution statistics
 */
export function getExecutionStats(monitor: TaskExecutionMonitor): {
  duration: number;
  avgStepTime: number;
  successRate: number;
} {
  const start = monitor.startTime ? new Date(monitor.startTime).getTime() : Date.now();
  const end = monitor.endTime ? new Date(monitor.endTime).getTime() : Date.now();
  const duration = (end - start) / 1000;

  return {
    duration,
    avgStepTime: duration / Math.max(1, monitor.currentStep),
    successRate: monitor.status === "completed" ? 100 : 0,
  };
}
