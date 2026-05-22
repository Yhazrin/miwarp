/**
 * Pipeline Orchestrator - 技能管道编排器
 *
 * 负责 DAG 验证、执行调度、中间结果传递
 */

import type {
  SkillPipeline,
  SkillPipelineStep,
  PipelineExecution,
  PipelineStepResult,
  PipelineStepStatus,
} from "$lib/types/skill-pipeline";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Pipeline Orchestrator 负责技能管道的验证和执行
 */
export class PipelineOrchestrator {
  /**
   * 验证 Pipeline DAG 是否合法
   */
  validate(pipeline: SkillPipeline): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const stepIds = new Set<string>();

    // 1. 检查重复的 stepId
    for (const step of pipeline.steps) {
      if (stepIds.has(step.skillName)) {
        errors.push(`Duplicate step ID: ${step.skillName}`);
      }
      stepIds.add(step.skillName);
    }

    // 2. 检查循环依赖
    const cycle = this.detectCycle(pipeline.steps);
    if (cycle.length > 0) {
      errors.push(`Circular dependency detected: ${cycle.join(" -> ")}`);
    }

    // 3. 检查缺失的前置依赖
    for (const step of pipeline.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepIds.has(dep)) {
            errors.push(
              `Missing dependency: ${step.skillName} depends on ${dep} which doesn't exist`,
            );
          }
        }
      }
    }

    // 4. 检查超时配置
    for (const step of pipeline.steps) {
      if (step.timeout && step.timeout < 1000) {
        warnings.push(`Step ${step.skillName} has very short timeout (< 1s)`);
      }
    }

    // 5. 检查重试配置
    for (const step of pipeline.steps) {
      if (step.retryPolicy) {
        if (step.retryPolicy.maxRetries > 10) {
          warnings.push(`Step ${step.skillName} has high retry count (> 10)`);
        }
        if (step.retryPolicy.initialDelay < 100) {
          warnings.push(`Step ${step.skillName} has very short retry delay (< 100ms)`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检测 DAG 中的循环依赖
   */
  private detectCycle(steps: SkillPipelineStep[]): string[] {
    const graph = new Map<string, string[]>();
    for (const step of steps) {
      graph.set(step.skillName, step.dependsOn || []);
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): string[] | null => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          const cycle = dfs(neighbor);
          if (cycle) return cycle;
        } else if (recursionStack.has(neighbor)) {
          // 找到循环
          const cycleStart = path.indexOf(neighbor);
          return [...path.slice(cycleStart), neighbor];
        }
      }

      path.pop();
      recursionStack.delete(node);
      return null;
    };

    for (const step of steps) {
      if (!visited.has(step.skillName)) {
        const cycle = dfs(step.skillName);
        if (cycle) return cycle;
      }
    }

    return [];
  }

  /**
   * 拓扑排序确定执行顺序
   */
  topologicalSort(steps: SkillPipelineStep[]): string[][] {
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const step of steps) {
      graph.set(step.skillName, step.dependsOn || []);
      inDegree.set(step.skillName, 0);
    }

    // 计算入度
    for (const step of steps) {
      for (const dep of step.dependsOn || []) {
        inDegree.set(step.skillName, (inDegree.get(step.skillName) || 0) + 1);
      }
    }

    const levels: string[][] = [];
    const executed = new Set<string>();

    while (executed.size < steps.length) {
      const level: string[] = [];

      for (const [stepId, degree] of inDegree.entries()) {
        if (degree === 0 && !executed.has(stepId)) {
          level.push(stepId);
        }
      }

      if (level.length === 0) {
        // 应该不会发生（因为已经验证过无循环）
        break;
      }

      levels.push(level);

      for (const stepId of level) {
        executed.add(stepId);
        // 减少依赖该节点的入度
        for (const [otherStep, deps] of graph.entries()) {
          if (deps.includes(stepId)) {
            inDegree.set(otherStep, (inDegree.get(otherStep) || 0) - 1);
          }
        }
      }
    }

    return levels;
  }

  /**
   * 计算延迟（用于重试策略）
   */
  calculateDelay(retryCount: number, policy: SkillPipelineStep["retryPolicy"]): number {
    if (!policy) return 0;

    const { backoff, initialDelay, maxDelay } = policy;
    let delay: number;

    switch (backoff) {
      case "linear":
        delay = initialDelay * (retryCount + 1);
        break;
      case "exponential":
        delay = initialDelay * Math.pow(2, retryCount);
        break;
      case "fixed":
      default:
        delay = initialDelay;
        break;
    }

    if (maxDelay) {
      delay = Math.min(delay, maxDelay);
    }

    return delay;
  }

  /**
   * 创建执行实例
   */
  createExecution(pipeline: SkillPipeline): PipelineExecution {
    return {
      id: crypto.randomUUID(),
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      status: "running",
      steps: pipeline.steps.map((step) => ({
        stepId: step.skillName,
        skillName: step.skillName,
        status: "pending" as PipelineStepStatus,
        startedAt: new Date().toISOString(),
        retryCount: 0,
      })),
      currentStepIndex: 0,
      startedAt: new Date().toISOString(),
      context: {},
    };
  }
}

// 单例导出
export const pipelineOrchestrator = new PipelineOrchestrator();
