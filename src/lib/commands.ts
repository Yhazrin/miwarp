export type CommandCategory =
  | "chat"
  | "tools"
  | "navigation"
  | "settings"
  | "diagnostics"
  | "system";
export type CommandAgent = "claude" | "codex" | "both";
export type CommandAction =
  | "send_prompt"
  | "navigate"
  | "ipc_command"
  | "toggle_state"
  | "open_modal"
  | "panel:multi-agent"
  | "preset:fullstack"
  | "preset:review"
  | "preset:upgrade"
  | "preset:test"
  | "preset:docs";

/**
 * Enhanced command definition with fuzzy search support.
 */
export interface CommandDef {
  id: string;
  name: string;
  description: string;
  category: CommandCategory;
  agent: CommandAgent;
  shortcut?: string;
  action: CommandAction;
  payload?: string;
  // Enhanced fields from Claude Code design
  fuzzyKeywords?: string[]; // Additional keywords for fuzzy matching
  usageCount?: number; // Track usage for sorting
  icon?: string; // Command icon
  preview?: (payload?: string) => Promise<string>; // Preview function
}

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

export const commands: CommandDef[] = [
  // Chat
  {
    id: "switch-model",
    name: "cmd_name_switchModel",
    description: "cmd_desc_switchModel",
    category: "chat",
    agent: "both",
    action: "open_modal",
    payload: "model-selector",
    icon: "🎯",
    fuzzyKeywords: ["model", "ai", "provider", "claude", "anthropic"],
  },
  {
    id: "compact",
    name: "cmd_name_compact",
    description: "cmd_desc_compact",
    category: "chat",
    agent: "claude",
    action: "send_prompt",
    payload: "/compact",
    icon: "📦",
    fuzzyKeywords: ["compact", "compress", "reduce", "context"],
  },
  {
    id: "toggle-plan",
    name: "cmd_name_togglePlan",
    description: "cmd_desc_togglePlan",
    category: "chat",
    agent: "claude",
    action: "toggle_state",
    payload: "plan_mode",
    icon: "📋",
    fuzzyKeywords: ["plan", "mode", "thinking"],
  },
  {
    id: "review",
    name: "cmd_name_review",
    description: "cmd_desc_review",
    category: "chat",
    agent: "claude",
    action: "send_prompt",
    payload:
      "Review my recent changes. Look at the git diff and provide feedback on code quality, potential bugs, and improvements.",
    icon: "🔍",
    fuzzyKeywords: ["review", "code review", "pr", "pull request", "feedback"],
  },
  {
    id: "export-chat",
    name: "cmd_name_exportChat",
    description: "cmd_desc_exportChat",
    category: "chat",
    agent: "both",
    shortcut: "Cmd+Shift+E",
    action: "ipc_command",
    payload: "export_conversation",
    icon: "📤",
    fuzzyKeywords: ["export", "save", "download", "chat history"],
  },
  {
    id: "export-chat-html",
    name: "cmd_name_exportChatHtml",
    description: "cmd_desc_exportChatHtml",
    category: "chat",
    agent: "both",
    shortcut: "Cmd+Shift+H",
    action: "ipc_command",
    payload: "export_conversation_html",
    icon: "🌐",
    fuzzyKeywords: ["export", "html", "web", "save"],
  },
  {
    id: "new-claude",
    name: "cmd_name_newClaude",
    description: "cmd_desc_newClaude",
    category: "chat",
    agent: "both",
    action: "navigate",
    payload: "/chat?agent=claude",
    icon: "💬",
    fuzzyKeywords: ["new", "chat", "conversation", "claude"],
  },
  {
    id: "stop-run",
    name: "cmd_name_stopRun",
    description: "cmd_desc_stopRun",
    category: "chat",
    agent: "both",
    action: "ipc_command",
    payload: "stop_run",
    icon: "⏹",
    fuzzyKeywords: ["stop", "cancel", "abort", "interrupt"],
  },

  // Tools
  {
    id: "git-diff",
    name: "cmd_name_gitDiff",
    description: "cmd_desc_gitDiff",
    category: "tools",
    agent: "both",
    shortcut: "Cmd+Shift+D",
    action: "ipc_command",
    payload: "get_git_diff",
    icon: "📊",
    fuzzyKeywords: ["git", "diff", "changes", "modifications"],
  },
  {
    id: "git-status",
    name: "cmd_name_gitStatus",
    description: "cmd_desc_gitStatus",
    category: "tools",
    agent: "both",
    action: "ipc_command",
    payload: "get_git_status",
    icon: "📁",
    fuzzyKeywords: ["git", "status", "files", "staged", "untracked"],
  },
  {
    id: "token-cost",
    name: "cmd_name_tokenCost",
    description: "cmd_desc_tokenCost",
    category: "tools",
    agent: "both",
    action: "ipc_command",
    payload: "get_run_artifacts",
    icon: "💰",
    fuzzyKeywords: ["token", "cost", "usage", "billing", "price"],
  },

  // Navigation
  {
    id: "go-scheduled-tasks",
    name: "cmd_name_scheduledTasks",
    description: "cmd_desc_scheduledTasks",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/scheduled-tasks",
    icon: "⏰",
    fuzzyKeywords: ["schedule", "tasks", "automated", "cron", "jobs"],
  },
  {
    id: "go-chat",
    name: "Go to Chat",
    description: "Navigate to the chat page",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/chat",
    icon: "💬",
    fuzzyKeywords: ["chat", "conversation", "message"],
  },
  {
    id: "go-settings",
    name: "Go to Settings",
    description: "Navigate to settings",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/settings",
    icon: "⚙️",
    fuzzyKeywords: ["settings", "preferences", "config", "options"],
  },
  {
    id: "go-memory",
    name: "Go to Memory",
    description: "Navigate to the memory editor",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/memory",
    icon: "🧠",
    fuzzyKeywords: ["memory", "context", "notes", "knowledge"],
  },
  {
    id: "go-usage",
    name: "Go to Usage",
    description: "Navigate to usage statistics",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/usage",
    icon: "📈",
    fuzzyKeywords: ["usage", "statistics", "stats", "analytics", "billing"],
  },
  {
    id: "go-plugins",
    name: "Go to Plugins",
    description: "Browse plugins and skills",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/plugins",
    icon: "🧩",
    fuzzyKeywords: ["plugins", "extensions", "skills", "addons", "marketplace"],
  },
  {
    id: "open-project-folder",
    name: "Open Project Folder",
    description: "Add or switch the active project folder",
    category: "navigation",
    agent: "both",
    action: "open_modal",
    payload: "folder-browser",
    icon: "📂",
    fuzzyKeywords: ["open", "folder", "project", "workspace", "directory", "cwd", "add", "browse"],
  },
  {
    id: "go-history-advanced",
    name: "History — Advanced Search",
    description: "Open run history with advanced filters",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/history?advanced=1",
    icon: "🔎",
    fuzzyKeywords: ["history", "search", "advanced", "filters", "runs", "find"],
  },

  // Settings
  {
    id: "set-model",
    name: "Set Default Model",
    description: "Change the default model for the agent",
    category: "settings",
    agent: "both",
    action: "open_modal",
    payload: "model-selector",
    icon: "🤖",
    fuzzyKeywords: ["default", "model", "ai", "change"],
  },
  {
    id: "set-cwd",
    name: "Set Working Directory",
    description: "Change the project working directory",
    category: "settings",
    agent: "both",
    action: "open_modal",
    payload: "folder-browser",
    icon: "📂",
    fuzzyKeywords: ["directory", "folder", "workspace", "path", "cwd"],
  },
  {
    id: "configure-tools",
    name: "Configure Tools",
    description: "Set allowed tools for the agent",
    category: "settings",
    agent: "both",
    action: "navigate",
    payload: "/settings",
    icon: "🔧",
    fuzzyKeywords: ["tools", "configure", "permissions", "allowed"],
  },
  {
    id: "permissions",
    name: "Permissions",
    description: "Manage tool permission rules (allow/deny)",
    category: "settings",
    agent: "both",
    action: "open_modal",
    payload: "permissions",
    icon: "🔐",
    fuzzyKeywords: ["permissions", "security", "rules", "allow", "deny"],
  },

  // Diagnostics
  {
    id: "doctor",
    name: "Run Doctor",
    description: "Check if agent CLIs are installed and working",
    category: "diagnostics",
    agent: "both",
    action: "ipc_command",
    payload: "check_agent_cli",
    icon: "🩺",
    fuzzyKeywords: ["doctor", "check", "diagnose", "health", "status"],
  },
  {
    id: "version",
    name: "Version Info",
    description: "Show MiWarp Desktop version information",
    category: "diagnostics",
    agent: "both",
    action: "open_modal",
    payload: "version-info",
    icon: "ℹ️",
    fuzzyKeywords: ["version", "info", "about", "miwarp"],
  },
];

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
export async function filterCommandsFuzzy(query: string, agent?: string): Promise<CommandDef[]> {
  const { multiFieldFuzzyMatch } = await import("./utils/fuzzy");
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
  const scored = await Promise.all(
    filtered.map(async (cmd) => {
      const usageCount = usageStats[cmd.id] || cmd.usageCount || 0;
      const { multiFieldFuzzyMatch: fuzzy } = await import("./utils/fuzzy");
      const fields = {
        name: cmd.name,
        description: cmd.description,
      };
      const result = fuzzy(query, fields);
      return { cmd, usageCount, fuzzyScore: result.score };
    }),
  );

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

export const categoryLabels: Record<CommandCategory, string> = {
  chat: "cmd_cat_chat",
  tools: "cmd_cat_tools",
  navigation: "cmd_cat_navigation",
  settings: "cmd_cat_settings",
  diagnostics: "cmd_cat_diagnostics",
  system: "cmd_cat_system",
};

// 多 Agent 命令
export const multiAgentCommands: CommandDef[] = [
  {
    id: "multi",
    name: "multi",
    description: "cmd_multi_desc",
    category: "system",
    agent: "claude",
    action: "panel:multi-agent",
    icon: "👥",
    fuzzyKeywords: ["multi", "agent", "team", "collaborate"],
  },
  {
    id: "fullstack",
    name: "fullstack",
    description: "cmd_fullstack_desc",
    category: "system",
    agent: "claude",
    action: "preset:fullstack",
    icon: "🚀",
    fuzzyKeywords: ["fullstack", "frontend", "backend", "full"],
  },
  {
    id: "review-all",
    name: "review-all",
    description: "cmd_reviewAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:review",
    icon: "🔍",
    fuzzyKeywords: ["review", "all", "code", "pr"],
  },
  {
    id: "implement-all",
    name: "implement-all",
    description: "cmd_implementAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:upgrade",
    icon: "⚡",
    fuzzyKeywords: ["implement", "upgrade", "improve", "all"],
  },
  {
    id: "test-all",
    name: "test-all",
    description: "cmd_testAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:test",
    icon: "🧪",
    fuzzyKeywords: ["test", "testing", "all", "run"],
  },
  {
    id: "docs-all",
    name: "docs-all",
    description: "cmd_docsAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:docs",
    icon: "📝",
    fuzzyKeywords: ["docs", "documentation", "all", "generate"],
  },
];

// 添加到所有命令
commands.push(...multiAgentCommands);

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
