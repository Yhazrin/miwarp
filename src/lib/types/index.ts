// Re-export domain modules that were previously split out.
// Note: skill-pipeline and skill have a conflicting SkillMetadata export,
// so they are NOT re-exported here — import directly from "$lib/types/skill" etc.
export * from "./background";
export * from "./bus-events";
export * from "./marketplace";
export * from "./plugins";
export * from "./scheduled-task";
export * from "./task-execution-monitor";
export * from "./teams";

export interface MemoryFileCandidate {
  path: string;
  label: string;
  scope: "project" | "global" | "memory";
  exists: boolean;
}

export type RunStatus =
  | "pending"
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "stopped"
  | "waiting_input"
  | "waiting_approval"
  | "error";

export type RunEventType = "system" | "stdout" | "stderr" | "command" | "user" | "assistant";

/** App-internal execution path for a run (materialized in TaskRun, never undefined). */
export type ExecutionPath = "session_actor" | "pipe_exec";

/** Unified resume/fork identity across agents. */
export type ConversationRef =
  | { kind: "claude_session"; id: string }
  | { kind: "codex_thread"; id: string };

export interface TaskRun {
  id: string;
  prompt: string;
  cwd: string;
  agent: string;
  auth_mode: string;
  status: RunStatus;
  started_at: string;
  ended_at?: string;
  exit_code?: number;
  error_message?: string;
  last_activity_at?: string;
  message_count?: number;
  last_message_preview?: string;
  session_id?: string;
  result_subtype?: string;
  /** Model used in this run (persisted on hot-switch). */
  model?: string;
  /** The run_id this session was forked from. */
  parent_run_id?: string;
  /** User-assigned display name. */
  name?: string;
  /** Remote host name (if running on a remote machine). */
  remote_host_name?: string;
  /** Snapshot of remote working directory at run creation. */
  remote_cwd?: string;
  /** Snapshot of active_platform_id at run creation time. */
  platform_id?: string;
  /** Whether the run is in a loop/sleeping state. */
  loop_sleeping?: boolean;
  /** Snapshot of anthropic_base_url at run creation time. */
  platform_base_url?: string;
  /** Run source (native or cli_import). */
  source?: "native" | "cli_import";
  /** CLI import watermark for incremental sync. */
  cli_import_watermark?: ImportWatermark;
  /** Absolute path to CLI session JSONL file. */
  cli_session_path?: string;
  /** True when CLI import couldn't reconstruct complete usage data. */
  cli_usage_incomplete?: boolean;
  /** Snapshot of no_session_persistence at run creation time. */
  no_session_persistence?: boolean;
  /** Resolved execution path (session_actor or pipe_exec). Always present in API output. */
  execution_path: ExecutionPath;
  /** Unified resume identity. Undefined = not resumable. */
  conversation_ref?: ConversationRef;
  /** User-created folder ID for organizing sessions. */
  folder_id?: string;
  /** Soft-delete timestamp. Populated by incremental sync. */
  deleted_at?: string;
  /** Session creation mode. */
  creation_mode?: "single" | "worktree";
  /** Path to git worktree directory. */
  worktree_path?: string;
  /** Auto-generated branch name for worktree sessions. */
  worktree_branch?: string;
  /** Original project cwd (for sidebar grouping of worktree sessions). */
  parent_cwd?: string;
}

export interface ImportWatermark {
  offset: number;
  mtimeNs: number;
  fileSize: number;
  lastUuid?: string;
}

export interface SessionFolder {
  id: string;
  name: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CliSessionSummary {
  sessionId: string;
  cwd: string;
  firstPrompt: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  model?: string;
  cliVersion?: string;
  fileSize: number;
  filePath: string;
  hasSubagents: boolean;
  alreadyImported: boolean;
  existingRunId?: string;
}

export interface ImportResult {
  runId: string;
  sessionId: string;
  eventsImported: number;
  eventsSkipped: number;
  usageIncomplete: boolean;
  skippedSubtypes: Record<string, number>;
}

export interface DiscoverResult {
  sessions: CliSessionSummary[];
  total: number;
  truncated: boolean;
}

export interface SyncResult {
  newEvents: number;
  newWatermark: ImportWatermark;
  usageIncomplete: boolean;
}

export interface RunEvent {
  id: string;
  task_id: string;
  seq: number;
  type: RunEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface RunArtifact {
  task_id: string;
  files_changed: string[];
  diff_summary: string;
  commands: string[];
  cost_estimate?: number;
  updated_at: string;
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
  feishu_webhook_url?: string;
  feishu_webhook_enabled?: boolean;
  feishu_webhook_triggers?: string[];
  feishu_webhook_template?: string;
  /** Feishu card image from upload API (`img_key`); takes precedence over image URL. */
  feishu_webhook_card_img_key?: string | null;
  /** Optional HTTPS image URL in card (Markdown img); used when img_key is unset. */
  feishu_webhook_card_image_url?: string | null;
  /** Preset CLI mascot for card image (resolved to CodeIsland GIF on GitHub). */
  feishu_webhook_card_mascot?: string | null;
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
  /** Per-agent mascot overrides. Maps agent kind → image URL or data URI. */
  mascot_overrides?: Record<string, string>;
  /** Process visibility level: "output" | "guided" | "developer" | "expert". */
  process_visibility?: string;
  updated_at: string;
}

// ── Remote SSH types ──

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

// ── Keybinding types ──

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

export interface HookEvent {
  run_id: string;
  hook_type: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  status?: string;
  usage?: TokenUsage;
  timestamp: string;
  source?: string;
  reason?: string;
  error?: string;
  message?: string;
  title?: string;
  notification_type?: string;
  agent_id?: string;
  agent_type?: string;
  trigger?: string;
  task_id?: string;
  task_subject?: string;
  model?: string;
  session_id?: string;
  worktree?: { name: string; path: string; branch: string; originalRepoDir: string };
  [key: string]: unknown;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cost: number;
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
  updated_at: string;
}

export type SessionMode = "new" | "resume" | "continue" | "fork";

export interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

export interface DirListing {
  path: string;
  entries: DirEntry[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  contentBase64: string;
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

export interface ModelUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface RunUsageSummary {
  runId: string;
  name: string;
  agent: string;
  model?: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
  numTurns: number;
  modelUsage?: Record<string, ModelUsageSummary>;
}

export interface ModelAggregate {
  model: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  pct: number;
}

export interface DailyAggregate {
  date: string;
  costUsd: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  /** Message count (Global mode — from Claude Code stats-cache). */
  messageCount?: number;
  /** Session count (Global mode — from Claude Code stats-cache). */
  sessionCount?: number;
  /** Tool call count (Global mode — from Claude Code stats-cache). */
  toolCallCount?: number;
  /** Per-model token breakdown (populated for last 30 daily entries only). */
  modelBreakdown?: Record<string, ModelTokens>;
}

export interface ModelTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface UsageOverview {
  totalCostUsd: number;
  totalTokens: number;
  totalRuns: number;
  avgCostPerRun: number;
  byModel: ModelAggregate[];
  daily: DailyAggregate[];
  runs: RunUsageSummary[];
  /** How the data was produced: "memory", "disk", "incremental", "full". */
  scanMode?: string;
  /** Number of days with activity. */
  activeDays: number;
  /** Current consecutive active days. */
  currentStreak: number;
  /** Longest consecutive active days ever. */
  longestStreak: number;
}

// ── Git types ──

export interface GitFileStat {
  path: string;
  status: string; // "M", "A", "D", "R", "?"
  insertions: number;
  deletions: number;
}

export interface GitSummary {
  branch: string;
  files: GitFileStat[];
  total_files: number;
  total_insertions: number;
  total_deletions: number;
}

// ── CLI Control Protocol types ──

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
  models: CliModelInfo[];
  commands: CliCommand[];
  available_output_styles: string[];
  account?: CliAccount;
  /** The model currently selected in Claude Code (from ~/.claude/settings.json) */
  current_model?: string;
  fetched_at: string;
}

// ── Per-model usage breakdown ──

export interface ModelUsageEntry {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_search_requests: number;
  cost_usd: number;
  context_window?: number;
  maxOutputTokens?: number;
}

// ── MCP server info ──

export interface McpServerInfo {
  name: string;
  status: string;
  server_type?: string;
  scope?: string;
  error?: string;
}

// ── Diagnostics report (run_diagnostics command) ──

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

// ── Permission suggestion ──

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

// ── Event Bus types ──

export interface ChatDelta {
  text: string;
}

export interface ChatDone {
  ok: boolean;
  code: number;
  error?: string;
}

// ── App Updates ──

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  error: string;
}

// ── Changelog ──

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

// ── Hook config types (mirrors ~/.claude/settings.json hooks) ──

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

// ── CLI Config types ──

export interface CliConfigSettingDef {
  key: string;
  label: string;
  description: string;
  group: "behavior" | "appearance" | "advanced";
  type: "boolean" | "enum" | "string";
  default: unknown;
  options?: { value: string; label: string }[];
}

// ── Onboarding types ──

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

/** Overview of all authentication sources (configuration state, no runtime inference). */
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

export interface InstallMethod {
  id: string;
  name: string;
  command: string;
  available: boolean;
  unavailable_reason?: string;
  note?: string;
}

// ── Prompt search & favorites ──

export interface PromptSearchResult {
  runId: string;
  runName?: string;
  runPrompt: string;
  agent: string;
  model?: string;
  status: RunStatus;
  startedAt: string;
  matchedText: string;
  matchedSeq: number;
  matchedTs: string;
  /** Stable event ID for scroll-to anchor (uuid or message_id). */
  matchedEventId?: string;
  isFavorite: boolean;
}

export interface PromptFavorite {
  runId: string;
  seq: number;
  text: string;
  tags: string[];
  note: string;
  createdAt: string;
}

// ── Run search (History page) ──

export interface RunSearchFilters {
  query?: string;
  projects?: string[];
  tools?: string[];
  dateFrom?: string;
  dateTo?: string;
  costMin?: number;
  costMax?: number;
  statuses?: RunStatus[];
  hasErrors?: boolean;
  agents?: string[];
  sortBy?: "date" | "cost" | "tokens" | "turns";
  sortAsc?: boolean;
  limit?: number;
  offset?: number;
}

export interface RunSearchResult {
  runId: string;
  cwd: string;
  agent: string;
  model?: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  name?: string;
  promptPreview: string;
  toolsUsed: string[];
  toolCallCount: number;
  filesTouchedCount: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  numTurns: number;
  hasErrors: boolean;
  errorSummary?: string;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface RunSearchFacets {
  projects: FacetCount[];
  tools: FacetCount[];
  agents: FacetCount[];
  costRange: [number, number];
  dateRange: [string, string];
  totalRuns: number;
  totalCost: number;
}

export interface RunSearchResponse {
  results: RunSearchResult[];
  facets: RunSearchFacets;
  totalMatching: number;
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

/** Snapshot of PromptInput state for stash/restore. */
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

/** BTW side question streaming events (from Tauri) */
export interface BtwDelta {
  btw_id: string;
  text: string;
}
export interface BtwComplete {
  btw_id: string;
}
export interface BtwError {
  btw_id: string;
  error: string;
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

// ── Preview / Element Picker ──

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

/** Runtime guard for ElementSelection payloads from preview bridge. */
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
