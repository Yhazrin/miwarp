/**
 * Command utilities — search, filtering, NLP matching, and context-aware logic.
 *
 * Pure functions that operate on the command registry from commands-definitions.ts.
 */

import type { SessionPhase } from "./stores/types";
import { multiFieldFuzzyMatch } from "./utils/fuzzy";
import {
  type CommandDef,
  type CommandCategory,
  commands,
} from "./commands-definitions";

// Command usage statistics storage key
const USAGE_STATS_KEY = "miwarp:command-usage-stats";

/**
 * Get command usage statistics from localStorage.
 */
export function getCommandUsageStats(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const stored = localStorage.getItem(USAGE_STATS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Increment command usage count.
 */
export function recordCommandUsage(commandId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const stats = getCommandUsageStats();
    stats[commandId] = (stats[commandId] || 0) + 1;
    localStorage.setItem(USAGE_STATS_KEY, JSON.stringify(stats));
  } catch {
    // Silently fail if localStorage is not available
  }
}

/**
 * Get usage count for a specific command.
 */
export function getCommandUsageCount(commandId: string): number {
  return getCommandUsageStats()[commandId] || 0;
}

/**
 * Basic filter - uses substring matching only (synchronous).
 */
export function filterCommands(query: string, agent?: string): CommandDef[] {
  const q = query.toLowerCase().trim();
  const usageStats = getCommandUsageStats();

  const filtered = commands.filter((cmd) => {
    // Agent filter
    if (agent && cmd.agent !== "both" && cmd.agent !== agent) {
      return false;
    }

    // Empty query returns all commands
    if (!q) {
      return true;
    }

    // Build searchable fields
    const searchable = [
      cmd.name.toLowerCase(),
      cmd.description.toLowerCase(),
      cmd.id,
      ...(cmd.fuzzyKeywords || []).map((k) => k.toLowerCase()),
    ];

    // Exact substring match
    return searchable.some((str) => str.includes(q));
  });

  // Sort by: usage count (desc), then by name (asc)
  return filtered.sort((a, b) => {
    const aUsage = usageStats[a.id] || a.usageCount || 0;
    const bUsage = usageStats[b.id] || b.usageCount || 0;
    if (bUsage !== aUsage) {
      return bUsage - aUsage;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Advanced fuzzy filter - uses Levenshtein distance for better matching (async).
 */
export function filterCommandsFuzzy(query: string, agent?: string): CommandDef[] {
  const usageStats = getCommandUsageStats();

  const filtered = commands.filter((cmd) => {
    // Agent filter
    if (agent && cmd.agent !== "both" && cmd.agent !== agent) {
      return false;
    }

    // Empty query returns all commands
    if (!query.trim()) {
      return true;
    }

    // Build searchable fields with weights
    const fields: Record<string, string> = {
      name: cmd.name,
      description: cmd.description,
      id: cmd.id,
    };

    // Add keywords
    (cmd.fuzzyKeywords || []).forEach((kw, i) => {
      fields[`keyword_${i}`] = kw;
    });

    const weights: Record<string, number> = {
      name: 1.5, // Name has higher weight
      description: 1.0,
      id: 0.5, // ID has lower weight
    };

    // Add lower weights to keywords
    Object.keys(fields).forEach((key) => {
      if (key.startsWith("keyword_") && weights[key] === undefined) {
        weights[key] = 0.8;
      }
    });

    const result = multiFieldFuzzyMatch(query, fields, { weights });
    return result.matched;
  });

  // Sort by: usage count (desc), then by fuzzy score, then by name
  const scored = filtered.map((cmd) => {
    const usageCount = usageStats[cmd.id] || cmd.usageCount || 0;
    const fields = {
      name: cmd.name,
      description: cmd.description,
    };
    const result = multiFieldFuzzyMatch(query, fields);
    return { cmd, usageCount, fuzzyScore: result.score };
  });

  return scored
    .sort((a, b) => {
      if (b.usageCount !== a.usageCount) {
        return b.usageCount - a.usageCount;
      }
      if (b.fuzzyScore !== a.fuzzyScore) {
        return b.fuzzyScore - a.fuzzyScore;
      }
      return a.cmd.name.localeCompare(b.cmd.name);
    })
    .map((s) => s.cmd);
}

export function groupByCategory(cmds: CommandDef[]): Record<CommandCategory, CommandDef[]> {
  const groups: Record<CommandCategory, CommandDef[]> = {
    chat: [],
    tools: [],
    navigation: [],
    settings: [],
    diagnostics: [],
    system: [],
  };
  for (const cmd of cmds) {
    groups[cmd.category].push(cmd);
  }
  return groups;
}

// ── Natural Language Pattern Matching ──
// 支持中文自然语言查询转换为命令

interface NLPattern {
  /** 正则表达式模式 */
  regex: RegExp;
  /** 匹配的命令ID */
  commandId: string;
  /** 中文描述 */
  description: string;
}

/**
 * 自然语言模式库
 * 这些模式将中文查询映射到具体命令
 */
const NL_PATTERNS: NLPattern[] = [
  // 审查相关
  { regex: /审(查|阅|核)/i, commandId: "review", description: "代码审查" },
  { regex: /检查代码|代码审查|review/i, commandId: "review", description: "代码审查" },
  { regex: /安全漏|安全检查|security/i, commandId: "review", description: "安全审查" },

  // 模型切换相关
  {
    regex: /切换模型|换模型|change.*model|switch.*model/i,
    commandId: "switch-model",
    description: "切换AI模型",
  },
  { regex: /使用claude|claude.*model/i, commandId: "set-model", description: "设置默认模型" },

  // 导出相关
  { regex: /导出(对话|聊天|会话)/i, commandId: "export-chat", description: "导出对话" },
  { regex: /导出html|html.*导出/i, commandId: "export-chat-html", description: "导出HTML" },
  { regex: /下载对话|下载.*md/i, commandId: "export-chat", description: "下载对话" },

  // Git 相关
  { regex: /git.*diff|差异|changes|改动/i, commandId: "git-diff", description: "查看Git差异" },
  { regex: /git.*status|文件状态|staged/i, commandId: "git-status", description: "查看Git状态" },
  { regex: /提交记录|commit.*log|git.*log/i, commandId: "git-log", description: "查看Git日志" },

  // 导航相关
  { regex: /去(设置|首选项)/i, commandId: "go-settings", description: "打开设置" },
  { regex: /去(记忆|知识库)/i, commandId: "go-memory", description: "打开记忆" },
  { regex: /去(历史|记录)/i, commandId: "go-history", description: "打开历史" },
  { regex: /去(使用量|用量|账单)/i, commandId: "go-usage", description: "查看使用量" },
  { regex: /去(插件|扩展)/i, commandId: "go-plugins", description: "打开插件" },
  { regex: /去(定时|定时任务)/i, commandId: "go-scheduled-tasks", description: "打开定时任务" },

  // 工作流相关
  { regex: /全栈|frontend.*backend|前后端/i, commandId: "fullstack", description: "全栈开发" },
  { regex: /测试|test|单元测试|test.*case/i, commandId: "test-all", description: "测试开发" },
  { regex: /文档|docs|生成文档/i, commandId: "docs-all", description: "生成文档" },
  { regex: /升级|upgrade|改进/i, commandId: "implement-all", description: "代码升级" },

  // 权限相关
  { regex: /权限|permission|允许.*工具/i, commandId: "permissions", description: "管理权限" },
  { regex: /配置工具|tools.*config/i, commandId: "configure-tools", description: "配置工具" },

  // 诊断相关
  { regex: /诊断|doctor|健康.*检查/i, commandId: "doctor", description: "运行诊断" },
  { regex: /版本.*信息|about|关于.*miwarp/i, commandId: "version", description: "版本信息" },

  // 压缩上下文
  { regex: /压缩|compact|精简.*上下文/i, commandId: "compact", description: "压缩上下文" },

  // 计划模式
  {
    regex: /计划.*模式|plan.*mode|思考模式/i,
    commandId: "toggle-plan",
    description: "切换计划模式",
  },

  // 停止运行
  { regex: /停止|stop|cancel|abort/i, commandId: "stop-run", description: "停止运行" },

  // Token/成本
  {
    regex: /token.*cost|用量.*费用|billing/i,
    commandId: "token-cost",
    description: "查看Token成本",
  },

  // 多Agent
  { regex: /多.*agent|并行|团队.*协作/i, commandId: "multi", description: "多Agent协作" },
];

/**
 * 从自然语言查询中提取命令
 * 支持中文语义匹配
 */
export function matchNLQuery(query: string): CommandDef | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // 先尝试直接匹配
  const directMatch = commands.find(
    (cmd) =>
      cmd.name.toLowerCase().includes(trimmed.toLowerCase()) ||
      cmd.id.toLowerCase().includes(trimmed.toLowerCase()),
  );
  if (directMatch) return directMatch;

  // 尝试语义模式匹配
  for (const pattern of NL_PATTERNS) {
    if (pattern.regex.test(trimmed)) {
      const cmd = commands.find((c) => c.id === pattern.commandId);
      if (cmd) return cmd;
    }
  }

  return null;
}

/**
 * 获取自然语言查询的候选命令列表
 * 用于显示搜索建议
 */
export function getNLCandidates(query: string, maxResults = 5): CommandDef[] {
  if (!query.trim()) return [];

  const results: { cmd: CommandDef; relevance: number }[] = [];

  for (const cmd of commands) {
    let relevance = 0;

    // 检查名称匹配
    if (cmd.name.toLowerCase().includes(query.toLowerCase())) {
      relevance += 10;
    }

    // 检查描述匹配
    if (cmd.description.toLowerCase().includes(query.toLowerCase())) {
      relevance += 5;
    }

    // 检查模糊关键词匹配
    if (cmd.fuzzyKeywords?.some((kw) => kw.toLowerCase().includes(query.toLowerCase()))) {
      relevance += 3;
    }

    // 检查ID匹配
    if (cmd.id.toLowerCase().includes(query.toLowerCase())) {
      relevance += 2;
    }

    if (relevance > 0) {
      results.push({ cmd, relevance });
    }
  }

  return results
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxResults)
    .map((r) => r.cmd);
}

// ── Recent commands (persisted in localStorage) ──

const RECENT_KEY = "ocv:recent-commands";
const RECENT_MAX = 8;

export function loadRecentCommandIds(): string[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate: only keep IDs that still exist in the command list
    return parsed.filter(
      (id: unknown) => typeof id === "string" && commands.some((c) => c.id === id),
    );
  } catch {
    return [];
  }
}

export function recordRecentCommand(id: string): void {
  try {
    if (typeof window === "undefined") return;
    const recent = loadRecentCommandIds().filter((r) => r !== id);
    recent.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, RECENT_MAX)));
  } catch {
    // localStorage unavailable — silently ignore
  }
}

export function getRecentCommands(agent?: string): CommandDef[] {
  const ids = loadRecentCommandIds();
  return ids
    .map((id) =>
      commands.find((c) => c.id === id && (!agent || c.agent === "both" || c.agent === agent)),
    )
    .filter((c): c is CommandDef => !!c);
}

// ── Context-aware command filtering ──

export interface ContextFilter {
  phase?: SessionPhase;
  cwd?: string;
  recentFiles?: string[];
  activeAgent?: string;
}

/**
 * Get commands filtered by session context.
 * This provides smarter command suggestions based on current state.
 */
export function getContextAwareCommands(context: ContextFilter): CommandDef[] {
  const { phase, cwd = "/", recentFiles = [], activeAgent = "both" } = context;
  const usageStats = getCommandUsageStats();

  // Base commands filtered by agent
  const filtered = commands.filter((cmd) => {
    // Agent filter
    if (cmd.agent !== "both" && cmd.agent !== activeAgent) {
      return false;
    }

    // Phase-based filtering
    if (cmd.contextPhases && phase) {
      if (!cmd.contextPhases.includes(phase)) {
        return false;
      }
    }

    // Special handling for running/idle phases
    if (phase === "running") {
      // Only show commands marked for running
      if (cmd.showDuringRun === false) {
        return false;
      }
    } else if (
      phase === "idle" ||
      phase === "completed" ||
      phase === "failed" ||
      phase === "stopped"
    ) {
      // Only show commands marked for idle state
      if (cmd.showWhenIdle === false) {
        return false;
      }
    }

    return true;
  });

  // Add dynamic context-specific commands
  const contextCommands: CommandDef[] = [];

  // Add recent files command if there are recent files
  if (recentFiles.length > 0) {
    contextCommands.push({
      id: "recent-files",
      name: "Recent Files",
      description: `Open ${Math.min(recentFiles.length, 5)} recently edited files`,
      category: "navigation",
      agent: "both",
      action: "open_modal",
      payload: "recent-files",
      fuzzyKeywords: ["recent", "files", "edited", "open"],
    });
  }

  // Add git-related commands based on cwd
  if (cwd !== "/") {
    contextCommands.push({
      id: "git-log",
      name: "Git Log",
      description: "Show recent git commits",
      category: "tools",
      agent: "both",
      action: "ipc_command",
      payload: "get_git_log",
      fuzzyKeywords: ["git", "log", "commits", "history"],
      showWhenIdle: true,
    });
  }

  // Combine and sort by usage
  const allCommands = [...filtered, ...contextCommands];
  return allCommands.sort((a, b) => {
    const aUsage = usageStats[a.id] || a.usageCount || 0;
    const bUsage = usageStats[b.id] || b.usageCount || 0;
    if (bUsage !== aUsage) {
      return bUsage - aUsage;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get commands that should be prominently displayed based on current context.
 * Used for quick access bar and smart suggestions.
 */
export function getProminentCommands(context: ContextFilter): CommandDef[] {
  const allCommands = getContextAwareCommands(context);

  // Get top 5 commands by usage
  return allCommands.slice(0, 5);
}

/**
 * Check if a command should be shown in the given context.
 */
export function isCommandVisibleInContext(cmd: CommandDef, context: ContextFilter): boolean {
  const { phase, activeAgent = "both" } = context;

  // Agent check
  if (cmd.agent !== "both" && cmd.agent !== activeAgent) {
    return false;
  }

  // Phase check
  if (cmd.contextPhases && phase) {
    if (!cmd.contextPhases.includes(phase)) {
      return false;
    }
  }

  // Running state check
  if (phase === "running" && cmd.showDuringRun === false) {
    return false;
  }

  // Idle state check
  if (
    (phase === "idle" || phase === "completed" || phase === "failed" || phase === "stopped") &&
    cmd.showWhenIdle === false
  ) {
    return false;
  }

  return true;
}
