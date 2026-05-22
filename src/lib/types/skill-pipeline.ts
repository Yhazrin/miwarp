/**
 * Skill Pipeline Types
 *
 * 技能组合与管道相关的类型定义
 */

/**
 * 技能管道中的单个步骤
 */
export interface SkillPipelineStep {
  skillName: string;
  args?: Record<string, unknown>;
  condition?: string;
  dependsOn?: string[]; // 前置步骤的 stepId 数组
  onSuccess?: string; // 下一步的 stepId
  onFailure?: string; // 失败时跳转的 stepId
  retryPolicy?: RetryPolicy;
  timeout?: number; // 超时时间（毫秒）
}

/**
 * 重试策略
 */
export interface RetryPolicy {
  maxRetries: number;
  backoff: "linear" | "exponential" | "fixed";
  initialDelay: number; // 毫秒
  maxDelay?: number; // 最大延迟
}

/**
 * 技能管道定义
 */
export interface SkillPipeline {
  id: string;
  name: string;
  description: string;
  steps: SkillPipelineStep[];
  parallel?: boolean;
  continueOnError?: boolean;
  timeout?: number;
}

/**
 * 技能管道执行状态
 */
export type PipelineStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export interface PipelineStepResult {
  stepId: string;
  skillName: string;
  status: PipelineStepStatus;
  output?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  retryCount: number;
}

/**
 * 技能管道执行实例
 */
export interface PipelineExecution {
  id: string;
  pipelineId: string;
  pipelineName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  steps: PipelineStepResult[];
  currentStepIndex: number;
  startedAt: string;
  completedAt?: string;
  totalDuration?: number;
  context: Record<string, unknown>;
}

/**
 * MCP 技能依赖
 */
export interface SkillMcpRequirement {
  serverName: string;
  tools?: string[];
  optional?: boolean;
  fallbackMessage?: string;
}

/**
 * 技能执行干预级别
 */
export type InterventionLevel =
  | "autonomous" // 完全自主执行
  | "pre-confirm" // 执行前确认
  | "plan-approval" // 需要审批计划
  | "full-handoff"; // 完整交接给用户

/**
 * 技能能力定义
 */
export interface SkillCapability {
  name: string;
  description: string;
  tools: string[];
  mcpRequirements?: SkillMcpRequirement[];
}

/**
 * 增强的技能元数据
 */
export interface SkillMetadata {
  name: string;
  description: string;
  category?: string;
  icon?: string;
  author?: string;
  version?: string;
  interventionLevel?: InterventionLevel;
  capabilities?: SkillCapability[];
  pipelines?: SkillPipeline[];
  retryPolicy?: RetryPolicy;
}
