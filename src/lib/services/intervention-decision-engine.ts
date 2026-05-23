/**
 * Intervention Decision Engine
 *
 * 根据上下文自动判断技能执行的干预级别
 * 基于 Codex/Cowork 设计模式
 */

import type { Skill } from "$lib/types/skill";
import type { InterventionLevel } from "$lib/types/skill-pipeline";

/**
 * 执行上下文 - 用于决策干预级别
 */
export interface ExecutionContext {
  userId?: string;
  userRole?: UserRole;
  projectPath?: string;
  skillArgs?: Record<string, unknown>;
  projectSize?: "small" | "medium" | "large";
  isTestEnvironment?: boolean;
  timeOfDay?: "morning" | "afternoon" | "evening" | "night";
  recentFailures?: number; // 最近失败次数
}

/**
 * 用户角色
 */
export type UserRole = "admin" | "developer" | "viewer" | "guest";

/**
 * 干预决策结果
 */
export interface InterventionDecision {
  level: InterventionLevel;
  reason: string;
  factors: DecisionFactor[];
  bypassWarnings?: boolean;
  suggestedConfirmMessage?: string;
}

/**
 * 决策因素
 */
export interface DecisionFactor {
  type: "skill_default" | "risk_detected" | "user_preference" | "context_boost";
  value: string;
  weight: number; // 影响力权重
}

/**
 * 高风险操作模式
 */
const HIGH_RISK_PATTERNS = [
  // 文件操作
  {
    pattern: /rm\s+-rf|delete.*recursive|remove.*force/i,
    risk: "critical",
    message: "强制删除操作",
  },
  {
    pattern: /rm\s+-[rf]\s+["']?\.|del\s+\.\*|remove\s+node_modules/i,
    risk: "critical",
    message: "删除重要目录",
  },
  { pattern: /chmod\s+777|chmod\s+000|sudo|elevate/i, risk: "high", message: "权限提升操作" },
  { pattern: /git\s+push\s+--force|git\s+push\s+-f/i, risk: "high", message: "强制推送到远程" },
  {
    pattern: /git\s+reset\s+--hard|git\s+rebase\s+-i\s+HEAD/i,
    risk: "high",
    message: "破坏性 Git 操作",
  },

  // 网络操作
  { pattern: /curl|wget|fetch.*http|axios|request.*api/i, risk: "medium", message: "网络请求" },
  {
    pattern: /npm\s+publish|yarn\s+publish|pnpm\s+publish/i,
    risk: "high",
    message: "发布到包管理器",
  },
  {
    pattern: /docker\s+run\s+-d|docker\s+compose\s+up/i,
    risk: "medium",
    message: "启动 Docker 容器",
  },

  // 数据库操作
  {
    pattern: /DROP\s+TABLE|DELETE\s+FROM.*WHERE|TRUNCATE/i,
    risk: "critical",
    message: "数据库删除操作",
  },
  { pattern: /UPDATE.*SET.*WHERE|DROP\s+DATABASE/i, risk: "high", message: "数据库修改操作" },

  // 系统操作
  { pattern: /kill\s+-\d|killall|pkill/i, risk: "high", message: "终止进程" },
  { pattern: /reboot|shutdown|systemctl\s+restart/i, risk: "critical", message: "系统重启操作" },
  { pattern: /format|dd\s+if=/i, risk: "critical", message: "磁盘格式化操作" },

  // 敏感信息
  {
    pattern: /password|secret|api[_-]?key|token|credential/i,
    risk: "medium",
    message: "涉及敏感信息",
  },
  {
    pattern: /\.env|secrets?\.(json|yaml|toml)|config.*prod/i,
    risk: "medium",
    message: "配置文件访问",
  },
];

/**
 * 中等风险操作模式
 */
const MEDIUM_RISK_PATTERNS = [
  { pattern: /git\s+(add|commit|push|pull|merge)/i, risk: "low", message: "Git 操作" },
  {
    pattern: /npm\s+(install|update|remove)|yarn\s+(add|remove)/i,
    risk: "medium",
    message: "包管理器操作",
  },
  { pattern: /mkdir|create\s+directory|new\s+folder/i, risk: "low", message: "创建目录" },
  { pattern: /write\s+file|create\s+file|save\s+as/i, risk: "low", message: "创建文件" },
  { pattern: /modify\s+file|edit\s+file|replace\s+text/i, risk: "low", message: "修改文件" },
  { pattern: /exec|spawn|run\s+command|bash/i, risk: "medium", message: "执行命令" },
];

/**
 * 用户风险偏好配置
 */
export interface UserRiskPreferences {
  autoApproveLowRisk: boolean;
  autoApproveMediumRisk: boolean;
  alwaysConfirmCritical: boolean;
  maxAutoApprovePerDay: number;
}

/**
 * 默认风险偏好
 */
export const DEFAULT_RISK_PREFERENCES: UserRiskPreferences = {
  autoApproveLowRisk: true,
  autoApproveMediumRisk: false,
  alwaysConfirmCritical: true,
  maxAutoApprovePerDay: 10,
};

/**
 * 干预决策引擎
 */
export class InterventionDecisionEngine {
  private userPreferences: UserRiskPreferences;

  constructor(userPreferences?: Partial<UserRiskPreferences>) {
    this.userPreferences = { ...DEFAULT_RISK_PREFERENCES, ...userPreferences };
  }

  /**
   * 根据上下文决策干预级别
   */
  decide(skill: Skill, context: ExecutionContext): InterventionDecision {
    const factors: DecisionFactor[] = [];
    let suggestedLevel: InterventionLevel = "autonomous";

    // 1. 检查技能配置的默认级别
    const skillDefault = this.getSkillDefaultLevel(skill);
    if (skillDefault) {
      factors.push({
        type: "skill_default",
        value: `${skill.name} 默认级别: ${skillDefault}`,
        weight: 1.0,
      });
      suggestedLevel = skillDefault;
    }

    // 2. 检查技能参数的固有风险
    const argsRisk = this.analyzeArgsRisk(skill, context.skillArgs);
    if (argsRisk.level !== "low") {
      factors.push({
        type: "risk_detected",
        value: argsRisk.message,
        weight: argsRisk.level === "critical" ? 2.0 : 1.5,
      });
      suggestedLevel = this.boostInterventionLevel(suggestedLevel, argsRisk.level);
    }

    // 3. 检查危险操作模式
    const patternRisk = this.detectDangerousPatterns(skill.content);
    if (patternRisk.detected) {
      for (const match of patternRisk.matches) {
        factors.push({
          type: "risk_detected",
          value: match.message,
          weight: match.risk === "critical" ? 2.0 : 1.5,
        });
        suggestedLevel = this.boostInterventionLevel(suggestedLevel, match.risk);
      }
    }

    // 4. 根据用户角色调整
    if (context.userRole === "viewer" || context.userRole === "guest") {
      factors.push({
        type: "user_preference",
        value: `用户角色 ${context.userRole} 需要更高监管`,
        weight: 1.5,
      });
      suggestedLevel = this.boostInterventionLevel(suggestedLevel, "high");
    } else if (context.userRole === "admin") {
      factors.push({
        type: "user_preference",
        value: "管理员用户 - 降低干预",
        weight: 0.5,
      });
      suggestedLevel = this.lowerInterventionLevel(suggestedLevel);
    }

    // 5. 根据上下文增强风险评估
    if (context.recentFailures && context.recentFailures > 3) {
      factors.push({
        type: "context_boost",
        value: `最近失败 ${context.recentFailures} 次 - 谨慎执行`,
        weight: 1.2,
      });
      suggestedLevel = this.boostInterventionLevel(suggestedLevel, "medium");
    }

    if (context.isTestEnvironment === false) {
      factors.push({
        type: "context_boost",
        value: "生产环境 - 谨慎执行",
        weight: 1.5,
      });
      suggestedLevel = this.boostInterventionLevel(suggestedLevel, "medium");
    }

    // 6. 计算最终决定
    const finalDecision = this.computeFinalDecision(suggestedLevel, factors);

    return {
      level: finalDecision,
      reason: this.generateDecisionReason(finalDecision, factors),
      factors,
      suggestedConfirmMessage: this.generateConfirmMessage(finalDecision, factors),
    };
  }

  /**
   * 获取技能配置的默认干预级别
   */
  private getSkillDefaultLevel(skill: Skill): InterventionLevel | null {
    // @ts-expect-error - SkillMetadata 可能包含干预级别
    const metadata = skill.metadata as { interventionLevel?: InterventionLevel } | undefined;
    if (metadata?.interventionLevel) {
      return metadata.interventionLevel;
    }

    // 从内容中解析
    const levelMatch = skill.content.match(/intervention[_-]?level:\s*(\w+)/i);
    if (levelMatch) {
      const level = levelMatch[1].toLowerCase();
      switch (level) {
        case "autonomous":
        case "auto":
          return "autonomous";
        case "pre-confirm":
        case "confirm":
          return "pre-confirm";
        case "plan-approval":
        case "approval":
          return "plan-approval";
        case "full-handoff":
        case "handoff":
          return "full-handoff";
      }
    }

    return null;
  }

  /**
   * 分析技能参数的风险级别
   */
  private analyzeArgsRisk(
    skill: Skill,
    args?: Record<string, unknown>,
  ): { level: "low" | "medium" | "high" | "critical"; message: string } {
    if (!args || Object.keys(args).length === 0) {
      return { level: "low", message: "无参数" };
    }

    const dangerousParams = [
      "force",
      "delete",
      "remove",
      "exec",
      "sudo",
      "drop",
      "truncate",
      "reset",
      "destroy",
    ];

    for (const key of Object.keys(args)) {
      const value = String(args[key]).toLowerCase();
      if (dangerousParams.some((p) => key.toLowerCase().includes(p))) {
        return {
          level: value.includes("force") || value.includes("delete") ? "high" : "medium",
          message: `危险参数: ${key}`,
        };
      }
    }

    return { level: "low", message: "参数安全" };
  }

  /**
   * 检测技能内容中的危险模式
   */
  private detectDangerousPatterns(content: string): {
    detected: boolean;
    matches: { risk: "high" | "medium" | "critical"; message: string }[];
  } {
    const matches: { risk: "high" | "medium" | "critical"; message: string }[] = [];

    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.pattern.test(content)) {
        matches.push({
          risk: pattern.risk as "high" | "medium" | "critical",
          message: pattern.message,
        });
      }
    }

    return {
      detected: matches.length > 0,
      matches,
    };
  }

  /**
   * 提升干预级别
   */
  private boostInterventionLevel(
    current: InterventionLevel,
    riskLevel: "low" | "medium" | "high" | "critical",
  ): InterventionLevel {
    const levels: InterventionLevel[] = [
      "autonomous",
      "pre-confirm",
      "plan-approval",
      "full-handoff",
    ];
    const currentIndex = levels.indexOf(current);

    // 根据风险级别提升
    let boost = 0;
    switch (riskLevel) {
      case "critical":
        boost = 3;
        break;
      case "high":
        boost = 2;
        break;
      case "medium":
        boost = 1;
        break;
      case "low":
        boost = 0;
        break;
    }

    const newIndex = Math.min(currentIndex + boost, levels.length - 1);
    return levels[newIndex];
  }

  /**
   * 降低干预级别
   */
  private lowerInterventionLevel(current: InterventionLevel): InterventionLevel {
    const levels: InterventionLevel[] = [
      "autonomous",
      "pre-confirm",
      "plan-approval",
      "full-handoff",
    ];
    const currentIndex = levels.indexOf(current);
    const newIndex = Math.max(currentIndex - 1, 0);
    return levels[newIndex];
  }

  /**
   * 计算最终决策
   */
  private computeFinalDecision(
    suggested: InterventionLevel,
    factors: DecisionFactor[],
  ): InterventionLevel {
    // 如果有任何 critical 风险，强制提升到 full-handoff
    const hasCriticalRisk = factors.some((f) => f.value.includes("critical"));
    if (hasCriticalRisk) {
      return "full-handoff";
    }

    // 如果用户配置了总是确认 critical 操作
    if (this.userPreferences.alwaysConfirmCritical) {
      const hasHighRisk = factors.some((f) => f.type === "risk_detected");
      if (hasHighRisk) {
        return "plan-approval";
      }
    }

    return suggested;
  }

  /**
   * 生成决策原因
   */
  private generateDecisionReason(level: InterventionLevel, factors: DecisionFactor[]): string {
    const riskFactors = factors.filter((f) => f.type === "risk_detected");
    const riskCount = riskFactors.length;

    switch (level) {
      case "autonomous":
        return "技能评估为低风险，将自动执行";
      case "pre-confirm":
        return riskCount > 0 ? `检测到 ${riskCount} 个风险因素，需要执行前确认` : "需要执行前确认";
      case "plan-approval":
        return riskCount > 0
          ? `检测到 ${riskCount} 个高风险因素，需要审批执行计划`
          : "需要审批执行计划";
      case "full-handoff":
        return "检测到危险操作，建议手动执行";
    }
  }

  /**
   * 生成确认消息
   */
  private generateConfirmMessage(
    level: InterventionLevel,
    factors: DecisionFactor[],
  ): string | undefined {
    if (level === "autonomous") {
      return undefined;
    }

    const riskFactors = factors.filter((f) => f.type === "risk_detected");
    const messages = riskFactors.map((f) => f.value).join(", ");

    switch (level) {
      case "pre-confirm":
        return `此操作包含以下风险: ${messages}。是否继续执行?`;
      case "plan-approval":
        return `高风险操作: ${messages}。请确认是否授权执行。`;
      case "full-handoff":
        return `危险操作 detected: ${messages}。建议手动执行或分步确认。`;
    }
  }

  /**
   * 更新用户偏好
   */
  updatePreferences(preferences: Partial<UserRiskPreferences>): void {
    this.userPreferences = { ...this.userPreferences, ...preferences };
  }

  /**
   * 获取当前偏好
   */
  getPreferences(): UserRiskPreferences {
    return { ...this.userPreferences };
  }
}

/**
 * 创建默认引擎实例
 */
export function createInterventionEngine(
  preferences?: Partial<UserRiskPreferences>,
): InterventionDecisionEngine {
  return new InterventionDecisionEngine(preferences);
}

/**
 * 快速评估技能风险
 */
export function quickRiskAssessment(skill: Skill): {
  riskLevel: "low" | "medium" | "high" | "critical";
  warnings: string[];
} {
  const warnings: string[] = [];

  // 检测危险模式
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.pattern.test(skill.content)) {
      warnings.push(pattern.message);
    }
  }

  // 确定最高风险级别
  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  for (const warning of warnings) {
    if (warning.includes("critical") || warning.includes("磁盘") || warning.includes("数据库")) {
      riskLevel = "critical";
      break;
    } else if (riskLevel !== "critical" && (warning.includes("high") || warning.includes("删除"))) {
      riskLevel = "high";
    } else if (riskLevel === "low" && warning.includes("medium")) {
      riskLevel = "medium";
    }
  }

  return { riskLevel, warnings };
}
