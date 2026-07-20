// Settings, Config, CLI, and Auth types
// Auto-generated from types.ts — do not edit manually

export interface BackendCapabilities {
  appVersion: string;
  schemaVersion: number;
  supportedCommands: string[];
}

export interface MemoryFileCandidate {
  path: string;
  label: string;
  scope: "project" | "global" | "memory";
  exists: boolean;
}

export interface UserSettings {
  default_agent: string;
  default_model?: string;
  allowed_tools: string[];
  working_directory?: string;
  provider_mode: string;
  auth_mode: string;
  anthropic_api_key?: string;
  anthropic_base_url?: string;
  /** "ANTHROPIC_API_KEY" or "ANTHROPIC_AUTH_TOKEN" — set by platform preset */
  auth_env_var?: string;
  permission_mode: string;
  max_budget_usd?: number;
  fallback_model?: string;
  keybinding_overrides: KeyBindingOverride[];
  remote_hosts?: RemoteHost[];
  platform_credentials?: PlatformCredential[];
  active_platform_id?: string;
  ui_zoom?: number;
  onboarding_completed: boolean;
  web_server_enabled?: boolean;
  web_server_port?: number;
  web_server_bind?: string;
  web_server_allowed_origins?: string[];
  web_server_tunnel_url?: string;
  notifications_enabled?: boolean;
  notify_on_run_completed?: boolean;
  notify_on_run_failed?: boolean;
  notify_on_approval_required?: boolean;
  notify_on_schedule_completed?: boolean;
  notify_on_team_completed?: boolean;
  notification_min_duration_sec?: number;
  /** Semantic sound feedback: off | minimal | standard | detailed */
  sound_feedback_level?: string;
  feishu_webhook_url?: string;
  feishu_webhook_enabled?: boolean;
  feishu_webhook_triggers?: string[];
  feishu_webhook_template?: string;
  /** Default session mode: "single" or "worktree". */
  default_session_mode?: string;
  /** Auto-commit worktree changes when session completes. */
  auto_commit_on_complete?: boolean;
  /** Auto-create PR after auto-commit. */
  auto_pr_on_complete?: boolean;
  /** Cleanup worktree directory when session is deleted. */
  auto_cleanup_worktree?: boolean;
  /** Show per-turn token usage report below each AI response. Default true. */
  show_token_usage_report?: boolean;
  /** Process visibility for chat (output | guided | developer | expert). Default developer. */
  process_visibility?: "output" | "guided" | "developer" | "expert";
  /** Visual performance mode: auto (platform default), quality, balanced, performance. */
  visual_performance_mode?: "auto" | "quality" | "balanced" | "performance";
  /** Top session island capsule alignment. Default center. */
  session_island_alignment?: "center" | "right";
  /** Custom session status colors. */
  session_status_colors?: SessionStatusColors;
  /** Workspace display aliases: normalized_cwd → display_name */
  workspace_aliases?: Record<string, string>;
  /** Sidebar workspace folder sort: last_active | name_asc | name_desc | created_asc | created_desc */
  workspace_folder_sort_order?: string;
  /** Enable canvas mascot animation in sidebar. Default true. */
  mascot_enabled?: boolean;
  /** Show the left icon rail (Chat/Teams/Memory/.../Settings). Default true. */
  icon_rail_enabled?: boolean;
  /** Periodically sync CLI-imported sessions from ~/.claude transcripts. Default true. */
  cli_auto_sync_enabled?: boolean;
  /** Minutes between automatic CLI sync passes (1–120). Default 5. */
  cli_auto_sync_interval_minutes?: number;
  /** Also import newly discovered CLI sessions, not only sync existing imports. */
  cli_auto_sync_import_new?: boolean;
  /** Automatically check GitHub-backed MiWarp app updates on startup and periodically. */
  app_auto_update_check_enabled?: boolean;
  /** Enable native window-level glass material for the left sidebar
   * (macOS vibrancy / Windows mica-acrylic). Default true. */
  native_window_glass_enabled?: boolean;
  /** macOS NSVisualEffectMaterial choice. `sidebar` (default) is the heavier
   * frost (~30–40px); `header_view` is lighter (~15–20px). Only consulted on
   * macOS; ignored on Windows/Linux. */
  native_window_glass_material?: "header_view" | "sidebar";
  /** Display name appended to every session's system prompt. */
  user_display_name?: string;
  /** Optional social-style handle (e.g. "alex"). Local-only. */
  user_handle?: string;
  /** Optional contact email. Local-only, never sent to the model. */
  user_email?: string;
  /** Role / occupation appended to every session's system prompt. */
  user_role?: string;
  /** IANA time zone (e.g. "Asia/Shanghai") appended to every session's system prompt. */
  user_timezone?: string;
  updated_at: string;
}

export interface SessionStatusColors {
  running?: string;
  done?: string;
  failed?: string;
  pending?: string;
  paused?: string;
  blocked?: string;
  idle?: string;
}

export interface RemoteHost {
  name: string;
  host: string;
  user: string;
  port: number;
  key_path?: string;
  remote_cwd?: string;
  remote_claude_path?: string;
  forward_api_key: boolean;
}

export interface RemoteTestResult {
  ssh_ok: boolean;
  cli_found: boolean;
  cli_version?: string;
  cli_path?: string;
  error?: string;
}

export interface KeyBinding {
  command: string;
  label: string;
  key: string;
  context: "global" | "chat" | "prompt" | "cli";
  editable: boolean;
  source: "app" | "cli";
  /** If true, this binding is also registered as an OS-level global shortcut. */
  osGlobal?: boolean;
}

export interface ScreenshotPayload {
  contentBase64: string;
  mediaType: string;
  filename: string;
}

export interface KeyBindingOverride {
  command: string;
  key: string;
}

export interface AgentSettings {
  agent: string;
  model?: string;
  allowed_tools: string[];
  working_directory?: string;
  plan_mode?: boolean;
  disallowed_tools?: string[];
  append_system_prompt?: string;
  max_budget_usd?: number;
  fallback_model?: string;
  system_prompt?: string;
  tool_set?: string;
  add_dirs?: string[];
  json_schema?: unknown;
  include_partial_messages?: boolean;
  cli_debug?: string;
  no_session_persistence?: boolean;
  max_turns?: number;
  effort?: string;
  betas?: string[];
  agents_json?: string;
  /** MiMo-Code: custom binary path (auto-detected if undefined). */
  mimo_binary_path?: string;
  /** MiMo-Code: protocol mode (Auto/StreamJson/PTY/Pipe). */
  mimo_protocol_mode?: string;
  updated_at: string;
}

export interface CliCheckResult {
  agent: string;
  found: boolean;
  path?: string;
  version?: string;
}

export interface ProjectInitStatus {
  cwd: string;
  has_claude_md: boolean;
}

export interface CliDistTags {
  latest?: string;
  stable?: string;
}

export interface LocalProxyStatus {
  proxyId: string;
  running: boolean;
  needsAuth: boolean;
  baseUrl: string;
  error?: string;
}

export interface ApiTestResult {
  success: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
  /** True when auth+connectivity OK but probe model was rejected (no user model configured). */
  partial: boolean;
}

export interface CliModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
}

export interface CliCommand {
  name: string;
  description: string;
  aliases?: string[];
  [key: string]: unknown;
}

export interface CliAccount {
  tokenSource: string;
  [key: string]: unknown;
}

export interface CliInfo {
  agent: string;
  runtime_kind: "claude_code" | "mi_mo_code" | "codex";
  models: CliModelInfo[];
  commands: CliCommand[];
  available_output_styles: string[];
  account?: CliAccount;
  /** The model currently selected in Claude Code (from ~/.claude/settings.json) */
  current_model?: string;
  fetched_at: string;
}

export interface McpServerInfo {
  name: string;
  status: string;
  server_type?: string;
  scope?: string;
  error?: string;
}

export interface DiagnosticsReport {
  cli: CliDiagnostics;
  auth: AuthDiagnostics;
  project: ProjectDiagnostics;
  configs: ConfigDiagnostics;
  services: ServicesDiagnostics;
  system: SystemDiagnostics;
}

export interface CliDiagnostics {
  found: boolean;
  version: string | null;
  path: string | null;
  latest: string | null;
  stable: string | null;
  auto_update_channel: string | null;
  ripgrep_available: boolean;
}

export interface AuthDiagnostics {
  has_oauth: boolean;
  oauth_account: string | null;
  has_api_key: boolean;
  api_key_hint: string | null;
  api_key_source: string | null;
  app_has_credentials: boolean;
  app_platform_name: string | null;
}

export interface ProjectDiagnostics {
  cwd: string;
  has_claude_md: boolean;
  claude_md_files: ClaudeMdInfo[];
  skipped_project_scope: boolean;
}

export interface ClaudeMdInfo {
  path: string;
  size_chars: number;
}

export interface ConfigDiagnostics {
  settings_issues: ConfigIssue[];
  keybinding_issues: ConfigIssue[];
  mcp_issues: ConfigIssue[];
  env_var_issues: ConfigIssue[];
}

export interface ConfigIssue {
  scope: string;
  file: string;
  severity: string;
  message: string;
}

export interface ServicesDiagnostics {
  community_registry: boolean | null;
  mcp_registry: boolean | null;
}

export interface SystemDiagnostics {
  sandbox_available: boolean | null;
  lock_files: string[];
}

export interface PermissionSuggestion {
  type: string;
  rules?: string[];
  behavior?: string;
  mode?: string;
  directories?: string[];
  destination?: string;
  /** additionalContext hook data */
  message?: unknown;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  error: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export type HookEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "Stop"
  | "SubagentStop"
  | "SubagentTool"
  | "SubagentStart"
  | "SessionStart"
  | "SessionEnd"
  | "PermissionRequest"
  | "Setup"
  | "ConfigChange"
  | "MessageDisplay"
  | "TeammateIdle"
  | "TaskCompleted"
  | "WorktreeCreate"
  | "WorktreeRemove"
  | "InstructionsLoaded"
  | "Elicitation"
  | "ElicitationResult"
  | "PreCompact"
  | "PostCompact"
  | "StopFailure"
  | "TaskCreated"
  | "CwdChanged"
  | "FileChanged"
  | "PermissionDenied";

export interface HookHandler {
  type: "command" | "prompt" | "http" | "mcp_tool";
  command?: string;
  prompt?: string;
  timeout?: number;
  async?: boolean;
  statusMessage?: string;
  model?: string;
  once?: boolean;
  /** Conditional filter using permission rule syntax (e.g., `Bash(git *)`) — CLI 2.1.85+ */
  if?: string;
  /** mcp_tool handler: name of an already-configured MCP server to invoke — CLI 2.1.118+ */
  server?: string;
  /** mcp_tool handler: name of the tool on that server to call — CLI 2.1.118+ */
  tool?: string;
  /** mcp_tool handler: arguments passed to the MCP tool. String values support
   *  `${path}` interpolation from the hook input JSON (e.g. `${tool_input.file_path}`). */
  input?: Record<string, unknown>;
}

export interface HookMatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
  [key: string]: unknown;
}

export type HooksConfig = Record<string, HookMatcherGroup[]>;

export interface CliConfigSettingDef {
  key: string;
  label: string;
  description: string;
  group: "behavior" | "appearance" | "advanced";
  type: "boolean" | "enum" | "string";
  default: unknown;
  options?: { value: string; label: string }[];
}

export interface SshKeyInfo {
  key_path: string;
  key_path_expanded: string;
  pub_key_path: string;
  key_type: string;
  exists: boolean;
  pub_exists: boolean;
  ssh_copy_id_available: boolean;
}

export interface AuthCheckResult {
  has_oauth: boolean;
  has_api_key: boolean;
  oauth_account?: string;
}

export interface AuthOverview {
  auth_mode: string;
  cli_login_available: boolean;
  cli_login_account?: string;
  cli_has_api_key: boolean;
  cli_api_key_hint?: string;
  /** Source of CLI API key: "settings" | "env" | "shell_config" */
  cli_api_key_source?: string;
  app_has_credentials: boolean;
  app_platform_id?: string;
  app_platform_name?: string;
}

export interface ProductBootstrapStatus {
  version: number;
  targetVersion: number;
  skillsInstalled: string[];
  appendPromptApplied: boolean;
  completedAt?: string | null;
}

export interface ProductBootstrapRunResult {
  skillsInstalled: string[];
  appendPromptApplied: boolean;
  skipped: boolean;
}

export interface InstallMethod {
  id: string;
  name: string;
  command: string;
  available: boolean;
  unavailable_reason?: string;
  note?: string;
}

export interface PlatformPreset {
  id: string;
  name: string;
  base_url: string;
  auth_env_var: "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN";
  description: string;
  key_placeholder: string;
  category: "provider" | "proxy" | "local" | "custom";
  models?: string[];
  extra_env?: Record<string, string>;
  docs_url?: string;
  setup_hint?: string;
}

export interface PromptInputSnapshot {
  text: string;
  attachments: Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    contentBase64?: string;
    filePath?: string;
  }>;
  pastedBlocks: Array<{
    id: string;
    text: string;
    lineCount: number;
    charCount: number;
    preview: string;
  }>;
  pathRefs?: Array<{ id: string; name: string; path: string; isDir: boolean }>;
}

export interface PlatformCredential {
  platform_id: string;
  api_key?: string;
  base_url?: string;
  auth_env_var?: string;
  name?: string;
  models?: string[];
  extra_env?: Record<string, string>;
}

export interface AgentDefinitionSummary {
  file_name: string;
  name: string;
  description: string;
  model?: string;
  source: string;
  scope: "user" | "project" | "plugin";
  tools?: string[];
  disallowed_tools?: string[];
  permission_mode?: string;
  max_turns?: number;
  background?: boolean;
  isolation?: string;
  readonly: boolean;
  raw_content?: string;
}

export interface ElementSelection {
  url: string;
  viewport: { width: number; height: number };
  domPath: string;
  tagName: string;
  textContent: string;
  attributes: {
    id: string | null;
    class: string | null;
    role: string | null;
    name: string | null;
    ariaLabel: string | null;
  };
  outerHtmlSnippet: string;
  styleSummary: Record<string, string>;
}

export function isElementSelection(v: unknown): v is ElementSelection {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (
    typeof o.url !== "string" ||
    typeof o.domPath !== "string" ||
    typeof o.tagName !== "string" ||
    typeof o.textContent !== "string" ||
    typeof o.outerHtmlSnippet !== "string"
  )
    return false;
  const vp = o.viewport;
  if (!vp || typeof vp !== "object") return false;
  const vpc = vp as Record<string, unknown>;
  if (typeof vpc.width !== "number" || typeof vpc.height !== "number") return false;
  const attrs = o.attributes;
  if (!attrs || typeof attrs !== "object") return false;
  const a = attrs as Record<string, unknown>;
  for (const key of ["id", "class", "role", "name", "ariaLabel"]) {
    if (a[key] !== null && typeof a[key] !== "string") return false;
  }
  const styles = o.styleSummary;
  if (!styles || typeof styles !== "object") return false;
  if (!Object.values(styles as Record<string, unknown>).every((v) => typeof v === "string"))
    return false;
  return true;
}
