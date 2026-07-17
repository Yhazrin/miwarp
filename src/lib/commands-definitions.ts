/**
 * Command definitions — the static command registry.
 *
 * Contains CommandDef interface, type exports, and the full command list.
 * Search/filter/NL logic lives in commands-utils.ts.
 */

import type { SessionPhase } from "./stores/types";

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
  // Context-aware fields
  /** Session phases when this command should be shown. If undefined, shown in all phases. */
  contextPhases?: SessionPhase[];
  /** Whether this command is only available when session is running. */
  showDuringRun?: boolean;
  /** Whether this command is only available when session is idle/completed. */
  showWhenIdle?: boolean;
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
    fuzzyKeywords: ["review", "code review", "pr", "pull request", "feedback"],
    showWhenIdle: true, // Only relevant when session is idle
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
    fuzzyKeywords: ["stop", "cancel", "abort", "interrupt"],
    showDuringRun: true, // Only show during running
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
    fuzzyKeywords: ["settings", "preferences", "config", "options"],
  },
  {
    id: "go-personal",
    name: "Go to Personal",
    description: "Navigate to the personal profile page",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/personal",
    fuzzyKeywords: ["personal", "profile", "identity", "name", "role", "timezone"],
  },
  {
    id: "go-usage",
    name: "Go to Usage",
    description: "Navigate to usage statistics",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/usage",
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
    fuzzyKeywords: ["plugins", "extensions", "skills", "addons", "marketplace"],
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
    fuzzyKeywords: ["version", "info", "about", "miwarp"],
  },
];

export const multiAgentCommands: CommandDef[] = [
  {
    id: "multi",
    name: "multi",
    description: "cmd_multi_desc",
    category: "system",
    agent: "claude",
    action: "panel:multi-agent",
    fuzzyKeywords: ["multi", "agent", "team", "collaborate"],
  },
  {
    id: "fullstack",
    name: "fullstack",
    description: "cmd_fullstack_desc",
    category: "system",
    agent: "claude",
    action: "preset:fullstack",
    fuzzyKeywords: ["fullstack", "frontend", "backend", "full"],
  },
  {
    id: "review-all",
    name: "review-all",
    description: "cmd_reviewAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:review",
    fuzzyKeywords: ["review", "all", "code", "pr"],
  },
  {
    id: "implement-all",
    name: "implement-all",
    description: "cmd_implementAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:upgrade",
    fuzzyKeywords: ["implement", "upgrade", "improve", "all"],
  },
  {
    id: "test-all",
    name: "test-all",
    description: "cmd_testAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:test",
    fuzzyKeywords: ["test", "testing", "all", "run"],
  },
  {
    id: "docs-all",
    name: "docs-all",
    description: "cmd_docsAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:docs",
    fuzzyKeywords: ["docs", "documentation", "all", "generate"],
  },
];

// Add multi-agent commands to the main list
commands.push(...multiAgentCommands);

export const categoryLabels: Record<CommandCategory, string> = {
  chat: "cmd_cat_chat",
  tools: "cmd_cat_tools",
  navigation: "cmd_cat_navigation",
  settings: "cmd_cat_settings",
  diagnostics: "cmd_cat_diagnostics",
  system: "cmd_cat_system",
};
