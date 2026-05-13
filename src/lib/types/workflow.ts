/**
 * Workflow Types - Type definitions for guided workflows
 */

export type WorkflowCategory =
  | "development"
  | "review"
  | "testing"
  | "documentation"
  | "deployment"
  | "custom";
export type StepStatus = "pending" | "active" | "completed" | "skipped" | "failed";
export type InterventionLevel = 0 | 1 | 2 | 3; // 0=autonomous, 1=pre-confirm, 2=plan-approval, 3=full-handoff

export interface WorkflowStep {
  id: string;
  title: string;
  instruction: string;
  prompt?: string;
  tools: string[];
  status: StepStatus;
  interventionLevel: InterventionLevel;
  estimatedTime?: string;
  output?: Record<string, unknown>;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  icon: string;
  estimatedTime: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInstance {
  id: string;
  templateId: string;
  templateName: string;
  currentStepIndex: number;
  status: "idle" | "running" | "paused" | "waiting" | "completed" | "cancelled";
  interventionLevel: InterventionLevel;
  state: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  checkpoints: WorkflowCheckpoint[];
}

export interface WorkflowCheckpoint {
  stepIndex: number;
  stepId: string;
  completed: boolean;
  output: Record<string, unknown> | null;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface WorkflowContext {
  projectPath?: string;
  projectName?: string;
  relevantFiles: string[];
  飞书Docs?: string[];
  calendarEvents?: string[];
  customContext: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolAdapter {
  name: string;
  canHandle: (step: WorkflowStep) => boolean;
  execute: (step: WorkflowStep, context: WorkflowContext) => Promise<ExecutionResult>;
  rollback?: (step: WorkflowStep, result: ExecutionResult) => Promise<void>;
  validateReadiness: () => Promise<boolean>;
}
