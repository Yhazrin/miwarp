/**
 * Task Execution Dashboard Service
 *
 * 任务执行统计服务
 * 基于 Codex/Cowork 设计模式
 */

import type { SkillExecutionEnhanced, ExecutionLog } from "$lib/types/skill-execution";
import type { PipelineExecution } from "$lib/types/skill-pipeline";

/**
 * 任务统计概览
 */
export interface TaskDashboardStats {
  totalTasks: number;
  activeTasks: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  avgSuccessRate: number;
  avgDuration: number;
  taskHealthScore: number;
  tasksLast24h: number;
  tasksLast7d: number;
}

/**
 * 任务健康度指标
 */
export interface TaskHealthMetrics {
  score: number; // 0-100
  status: "healthy" | "warning" | "critical";
  factors: HealthFactor[];
}

/**
 * 健康度因素
 */
export interface HealthFactor {
  name: string;
  value: number;
  weight: number;
  status: "good" | "warning" | "critical";
}

/**
 * 任务趋势数据
 */
export interface TaskTrend {
  date: string;
  completed: number;
  failed: number;
  cancelled: number;
  avgDuration: number;
}

/**
 * 技能执行统计
 */
export interface SkillExecutionStats {
  skillId: string;
  skillName: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  lastExecutedAt?: string;
  successRate: number;
}

/**
 * 任务统计服务
 */
export class TaskExecutionDashboard {
  private executions: SkillExecutionEnhanced[] = [];
  private pipelines: PipelineExecution[] = [];

  constructor(executions?: SkillExecutionEnhanced[], pipelines?: PipelineExecution[]) {
    this.executions = executions || [];
    this.pipelines = pipelines || [];
  }

  /**
   * 更新执行记录
   */
  updateExecutions(executions: SkillExecutionEnhanced[]): void {
    this.executions = executions;
  }

  /**
   * 更新管道执行
   */
  updatePipelines(pipelines: PipelineExecution[]): void {
    this.pipelines = pipelines;
  }

  /**
   * 获取统计概览
   */
  getStats(): TaskDashboardStats {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const last7d = now - 7 * 24 * 60 * 60 * 1000;

    const activeTasks = this.executions.filter((e) => e.status === "running").length;
    const pendingTasks = this.executions.filter((e) => e.status === "pending").length;
    const completedTasks = this.executions.filter((e) => e.status === "completed").length;
    const failedTasks = this.executions.filter((e) => e.status === "failed").length;
    const cancelledTasks = this.executions.filter((e) => e.status === "cancelled").length;

    const tasksLast24h = this.executions.filter(
      (e) => new Date(e.startedAt).getTime() > last24h,
    ).length;
    const tasksLast7d = this.executions.filter(
      (e) => new Date(e.startedAt).getTime() > last7d,
    ).length;

    const successfulExecutions = this.executions.filter((e) => e.status === "completed");
    const avgSuccessRate =
      this.executions.length > 0 ? (completedTasks / this.executions.length) * 100 : 100;

    const durations = successfulExecutions
      .filter((e) => e.completedAt)
      .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime())
      .filter((d) => d > 0);

    const avgDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      totalTasks: this.executions.length,
      activeTasks,
      pendingTasks,
      completedTasks,
      failedTasks,
      cancelledTasks,
      avgSuccessRate,
      avgDuration,
      taskHealthScore: this.calculateHealthScore(),
      tasksLast24h,
      tasksLast7d,
    };
  }

  /**
   * 计算任务健康度分数
   */
  private calculateHealthScore(): number {
    const factors = this.calculateHealthFactors();
    if (factors.length === 0) return 100;

    let weightedScore = 0;
    let totalWeight = 0;

    for (const factor of factors) {
      weightedScore += factor.value * factor.weight;
      totalWeight += factor.weight;
    }

    return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 100;
  }

  /**
   * 计算健康度因素
   */
  calculateHealthFactors(): HealthFactor[] {
    const factors: HealthFactor[] = [];

    // 成功率因素
    const successRate =
      this.executions.length > 0
        ? (this.executions.filter((e) => e.status === "completed").length /
            this.executions.length) *
          100
        : 100;
    factors.push({
      name: "成功率",
      value: successRate,
      weight: 3,
      status: successRate >= 90 ? "good" : successRate >= 70 ? "warning" : "critical",
    });

    // 失败率趋势
    const recentFailures = this.getRecentFailureRate();
    factors.push({
      name: "近期失败率",
      value: 100 - recentFailures,
      weight: 2,
      status: recentFailures <= 5 ? "good" : recentFailures <= 15 ? "warning" : "critical",
    });

    // 平均执行时间稳定性
    const durationStability = this.calculateDurationStability();
    factors.push({
      name: "执行时间稳定性",
      value: durationStability,
      weight: 1,
      status: durationStability >= 80 ? "good" : durationStability >= 60 ? "warning" : "critical",
    });

    // 活跃任务比例
    const activeRatio =
      this.executions.length > 0
        ? (this.executions.filter((e) => e.status === "running").length / this.executions.length) *
          100
        : 0;
    factors.push({
      name: "任务活跃度",
      value: activeRatio,
      weight: 1,
      status: activeRatio > 0 ? "good" : "warning",
    });

    return factors;
  }

  /**
   * 获取近期失败率
   */
  private getRecentFailureRate(): number {
    const recent = this.executions.filter(
      (e) => new Date(e.startedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000,
    );
    if (recent.length === 0) return 0;

    const failures = recent.filter((e) => e.status === "failed").length;
    return (failures / recent.length) * 100;
  }

  /**
   * 计算执行时间稳定性
   */
  private calculateDurationStability(): number {
    const durations = this.executions
      .filter((e) => e.completedAt && e.status === "completed")
      .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime())
      .filter((d) => d > 0 && d < 3600000); // 过滤异常值 (> 1小时)

    if (durations.length < 2) return 100;

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? (stdDev / avg) * 100 : 0; // 变异系数

    // CV 越低越稳定，100 - CV (上限 100)
    return Math.max(0, 100 - cv);
  }

  /**
   * 获取技能执行统计
   */
  getSkillStats(): SkillExecutionStats[] {
    const skillMap = new Map<string, SkillExecutionEnhanced[]>();

    for (const execution of this.executions) {
      const list = skillMap.get(execution.skillId) || [];
      list.push(execution);
      skillMap.set(execution.skillId, list);
    }

    const stats: SkillExecutionStats[] = [];
    for (const [skillId, executions] of skillMap) {
      const successCount = executions.filter((e) => e.status === "completed").length;
      const failureCount = executions.filter((e) => e.status === "failed").length;
      const durations = executions
        .filter((e) => e.completedAt)
        .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime());

      stats.push({
        skillId,
        skillName: executions[0]?.skillName || skillId,
        totalExecutions: executions.length,
        successCount,
        failureCount,
        avgDuration:
          durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        lastExecutedAt: this.getLastExecutedAt(executions),
        successRate: executions.length > 0 ? (successCount / executions.length) * 100 : 0,
      });
    }

    return stats.sort((a, b) => b.totalExecutions - a.totalExecutions);
  }

  /**
   * 获取最后执行时间
   */
  private getLastExecutedAt(executions: SkillExecutionEnhanced[]): string | undefined {
    const completed = executions
      .filter((e) => e.completedAt)
      .map((e) => e.completedAt!)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    return completed[0];
  }

  /**
   * 获取趋势数据
   */
  getTrends(days: number = 7): TaskTrend[] {
    const trends: TaskTrend[] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      const dayExecutions = this.executions.filter((e) => {
        const execDate = new Date(e.startedAt).toISOString().split("T")[0];
        return execDate === dateStr;
      });

      const completed = dayExecutions.filter((e) => e.status === "completed");
      const failed = dayExecutions.filter((e) => e.status === "failed");
      const cancelled = dayExecutions.filter((e) => e.status === "cancelled");

      const durations = completed
        .filter((e) => e.completedAt)
        .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime());

      trends.push({
        date: dateStr,
        completed: completed.length,
        failed: failed.length,
        cancelled: cancelled.length,
        avgDuration:
          durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      });
    }

    return trends;
  }

  /**
   * 获取最近的执行日志
   */
  getRecentLogs(limit: number = 20): (ExecutionLog & { executionId: string; skillName: string })[] {
    const logs: (ExecutionLog & { executionId: string; skillName: string })[] = [];

    for (const execution of this.executions) {
      if (execution.logs) {
        for (const log of execution.logs) {
          logs.push({
            ...log,
            executionId: execution.id,
            skillName: execution.skillName,
          });
        }
      }
    }

    return logs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * 获取执行失败的原因分析
   */
  getFailureAnalysis(): {
    totalFailures: number;
    byError: Map<string, number>;
    bySkill: Map<string, number>;
  } {
    const failed = this.executions.filter((e) => e.status === "failed");
    const byError = new Map<string, number>();
    const bySkill = new Map<string, number>();

    for (const execution of failed) {
      // 按错误类型分组
      const errorKey = this.categorizeError(execution.error);
      byError.set(errorKey, (byError.get(errorKey) || 0) + 1);

      // 按技能分组
      bySkill.set(execution.skillName, (bySkill.get(execution.skillName) || 0) + 1);
    }

    return {
      totalFailures: failed.length,
      byError,
      bySkill,
    };
  }

  /**
   * 分类错误
   */
  private categorizeError(error?: string): string {
    if (!error) return "未知错误";

    const errorLower = error.toLowerCase();

    if (errorLower.includes("timeout") || errorLower.includes("超时")) {
      return "超时错误";
    }
    if (errorLower.includes("permission") || errorLower.includes("权限")) {
      return "权限错误";
    }
    if (
      errorLower.includes("network") ||
      errorLower.includes("network") ||
      errorLower.includes("网络")
    ) {
      return "网络错误";
    }
    if (errorLower.includes("not found") || errorLower.includes("不存在")) {
      return "资源不存在";
    }
    if (errorLower.includes("invalid") || errorLower.includes("参数错误")) {
      return "参数错误";
    }

    return "其他错误";
  }

  /**
   * 获取健康度状态
   */
  getHealthStatus(): TaskHealthMetrics {
    const factors = this.calculateHealthFactors();
    const score = this.calculateHealthScore();

    let status: "healthy" | "warning" | "critical" = "healthy";
    if (factors.some((f) => f.status === "critical")) {
      status = "critical";
    } else if (factors.some((f) => f.status === "warning")) {
      status = "warning";
    }

    return { score, status, factors };
  }
}

/**
 * 创建任务统计服务实例
 */
export function createTaskDashboard(
  executions?: SkillExecutionEnhanced[],
  pipelines?: PipelineExecution[],
): TaskExecutionDashboard {
  return new TaskExecutionDashboard(executions, pipelines);
}
