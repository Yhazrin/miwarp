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

export interface CommandDef {
  id: string;
  name: string;
  description: string;
  category: CommandCategory;
  agent: CommandAgent;
  shortcut?: string;
  action: CommandAction;
  payload?: string;
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
  },
  {
    id: "compact",
    name: "cmd_name_compact",
    description: "cmd_desc_compact",
    category: "chat",
    agent: "claude",
    action: "send_prompt",
    payload: "/compact",
  },
  {
    id: "toggle-plan",
    name: "cmd_name_togglePlan",
    description: "cmd_desc_togglePlan",
    category: "chat",
    agent: "claude",
    action: "toggle_state",
    payload: "plan_mode",
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
  },
  {
    id: "new-claude",
    name: "cmd_name_newClaude",
    description: "cmd_desc_newClaude",
    category: "chat",
    agent: "both",
    action: "navigate",
    payload: "/chat?agent=claude",
  },
  // Codex disabled
  // {
  //   id: "new-codex",
  //   name: "New Codex Chat",
  //   description: "Start a new Codex conversation",
  //   category: "chat",
  //   agent: "both",
  //   action: "navigate",
  //   payload: "/chat?agent=codex",
  // },
  {
    id: "stop-run",
    name: "cmd_name_stopRun",
    description: "cmd_desc_stopRun",
    category: "chat",
    agent: "both",
    action: "ipc_command",
    payload: "stop_run",
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
  },
  {
    id: "git-status",
    name: "cmd_name_gitStatus",
    description: "cmd_desc_gitStatus",
    category: "tools",
    agent: "both",
    action: "ipc_command",
    payload: "get_git_status",
  },
  {
    id: "token-cost",
    name: "cmd_name_tokenCost",
    description: "cmd_desc_tokenCost",
    category: "tools",
    agent: "both",
    action: "ipc_command",
    payload: "get_run_artifacts",
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
  },
  {
    id: "go-chat",
    name: "Go to Chat",
    description: "Navigate to the chat page",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/chat",
  },
  {
    id: "go-settings",
    name: "Go to Settings",
    description: "Navigate to settings",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/settings",
  },
  {
    id: "go-memory",
    name: "Go to Memory",
    description: "Navigate to the memory editor",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/memory",
  },
  {
    id: "go-usage",
    name: "Go to Usage",
    description: "Navigate to usage statistics",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/usage",
  },
  // Codex disabled
  // {
  //   id: "go-codex-config",
  //   name: "Go to Codex Config",
  //   description: "Navigate to Codex agent configuration",
  //   category: "navigation",
  //   agent: "both",
  //   action: "navigate",
  //   payload: "/config/codex",
  // },
  {
    id: "go-plugins",
    name: "Go to Plugins",
    description: "Browse plugins and skills",
    category: "navigation",
    agent: "both",
    action: "navigate",
    payload: "/plugins",
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
  },
  {
    id: "set-cwd",
    name: "Set Working Directory",
    description: "Change the project working directory",
    category: "settings",
    agent: "both",
    action: "open_modal",
    payload: "folder-browser",
  },
  {
    id: "configure-tools",
    name: "Configure Tools",
    description: "Set allowed tools for the agent",
    category: "settings",
    agent: "both",
    action: "navigate",
    payload: "/settings",
  },
  {
    id: "permissions",
    name: "Permissions",
    description: "Manage tool permission rules (allow/deny)",
    category: "settings",
    agent: "both",
    action: "open_modal",
    payload: "permissions",
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
  },
  {
    id: "version",
    name: "Version Info",
    description: "Show MiWarp Desktop version information",
    category: "diagnostics",
    agent: "both",
    action: "open_modal",
    payload: "version-info",
  },
];

export function filterCommands(query: string, agent?: string): CommandDef[] {
  const q = query.toLowerCase();
  return commands.filter((cmd) => {
    if (agent && cmd.agent !== "both" && cmd.agent !== agent) return false;
    if (!q) return true;
    return (
      cmd.name.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.id.includes(q)
    );
  });
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
  },
  {
    id: "fullstack",
    name: "fullstack",
    description: "cmd_fullstack_desc",
    category: "system",
    agent: "claude",
    action: "preset:fullstack",
  },
  {
    id: "review-all",
    name: "review-all",
    description: "cmd_reviewAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:review",
  },
  {
    id: "implement-all",
    name: "implement-all",
    description: "cmd_implementAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:upgrade",
  },
  {
    id: "test-all",
    name: "test-all",
    description: "cmd_testAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:test",
  },
  {
    id: "docs-all",
    name: "docs-all",
    description: "cmd_docsAll_desc",
    category: "system",
    agent: "claude",
    action: "preset:docs",
  },
];

// 添加到所有命令
commands.push(...multiAgentCommands);
