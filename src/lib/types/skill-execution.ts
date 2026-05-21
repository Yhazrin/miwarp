/**
 * Enhanced Skill Execution types
 * Based on Claude Code/Cowork design patterns with progress tracking and logging.
 */

import type { ExecutionStatus } from "$lib/types/skill";

/**
 * Execution log entry for detailed progress tracking.
 */
export interface ExecutionLog {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Enhanced Skill Execution with detailed status tracking.
 */
export interface SkillExecutionEnhanced {
  id: string;
  skillId: string;
  skillName: string;
  args: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  sessionId?: string;

  // Enhanced fields from Claude Code design
  progress?: number; // 0-100
  currentStep?: string;
  logs?: ExecutionLog[];
  outputFiles?: string[];
  parentExecutionId?: string;
  cancelledAt?: string;
}

/**
 * Retry policy for failed executions.
 */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  exponential?: boolean;
}

/**
 * Pipeline stage definition for multi-step skills.
 */
export interface PipelineStage {
  id: string;
  name: string;
  skillId: string;
  condition?: string;
  retryPolicy?: RetryPolicy;
  onFailure: "stop" | "skip" | "fallback";
}

/**
 * Skill pipeline for chaining multiple skills.
 */
export interface SkillPipeline {
  id: string;
  name: string;
  description: string;
  stages: PipelineStage[];
  enabled: boolean;
}

/**
 * Create a new execution log entry.
 */
export function createExecutionLog(
  level: ExecutionLog["level"],
  message: string,
  context?: Record<string, unknown>,
): ExecutionLog {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };
}

/**
 * Create a new enhanced execution.
 */
export function createExecution(
  skillId: string,
  skillName: string,
  args: string = "",
  sessionId?: string,
): SkillExecutionEnhanced {
  return {
    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    skillId,
    skillName,
    args,
    status: "pending",
    startedAt: new Date().toISOString(),
    sessionId,
    progress: 0,
    logs: [],
  };
}

/**
 * Add a log entry to an execution.
 */
export function addExecutionLog(
  execution: SkillExecutionEnhanced,
  level: ExecutionLog["level"],
  message: string,
  context?: Record<string, unknown>,
): SkillExecutionEnhanced {
  return {
    ...execution,
    logs: [...(execution.logs || []), createExecutionLog(level, message, context)],
  };
}

/**
 * Update execution progress.
 */
export function updateExecutionProgress(
  execution: SkillExecutionEnhanced,
  progress: number,
  currentStep?: string,
): SkillExecutionEnhanced {
  return {
    ...execution,
    progress: Math.min(100, Math.max(0, progress)),
    ...(currentStep !== undefined && { currentStep }),
  };
}

/**
 * Mark execution as completed.
 */
export function completeExecution(
  execution: SkillExecutionEnhanced,
  result?: string,
): SkillExecutionEnhanced {
  return {
    ...execution,
    status: "completed",
    completedAt: new Date().toISOString(),
    progress: 100,
    currentStep: undefined,
    result,
  };
}

/**
 * Mark execution as failed.
 */
export function failExecution(
  execution: SkillExecutionEnhanced,
  error: string,
): SkillExecutionEnhanced {
  return {
    ...execution,
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
  };
}

/**
 * Cancel an execution.
 */
export function cancelExecution(execution: SkillExecutionEnhanced): SkillExecutionEnhanced {
  return {
    ...execution,
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}
