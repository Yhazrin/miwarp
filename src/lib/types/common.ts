import type { RunStatus } from "./primitives";
// Usage, Git, Project, Team, Plugin, Fleet, and other types
// Auto-generated from types.ts — do not edit manually

// RunStatus moved to primitives.ts
// TaskRun still in session.ts — import directly if needed
import type { SkillRemoteRef } from "./skill";

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


export type GitTimelineEntryType = "working_tree" | "commit" | "branch_ref" | "remote_ref" | "base";


export interface GitTimelineEntry {
  id: string;
  type: GitTimelineEntryType;
  label: string;
  description?: string;
  hash?: string;
  short_hash?: string;
  author?: string;
  date?: string;
  branch?: string;
  remote?: string;
  is_current?: boolean;
  is_dirty?: boolean;
  changed_files?: number;
}


export interface GitTimelineResponse {
  is_repo: boolean;
  branch: string;
  is_detached: boolean;
  is_clean: boolean;
  changed_files: number;
  entries: GitTimelineEntry[];
}


export interface ProjectStack {
  typescript: boolean;
  rust: boolean;
  python: boolean;
  go: boolean;
}


export interface ProjectCommands {
  test: string[];
  build: string[];
  dev: string[];
  lint: string[];
  start: string[];
}


export interface ProjectDocExcerpt {
  exists: boolean;
  excerpt: string;
}


export interface ProjectMetadata {
  stack: ProjectStack;
  commands: ProjectCommands;
  claude_md: ProjectDocExcerpt;
  readme: ProjectDocExcerpt;
}


export interface ProjectLastCommit {
  shortHash: string;
  subject: string;
  author: string;
  timeIso: string;
}


export interface ProjectGitStatus {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  dirtyCount: number;
  lastCommit: ProjectLastCommit | null;
}


export interface ProjectNotes {
  content: string;
  modifiedAt: string | null;
}


export type MediaArtifactKind = "image" | "video" | "audio" | "html" | "pdf" | "file";


export interface MediaArtifact {
  id: string;
  kind: MediaArtifactKind;
  path: string;
  name: string;
  size: number;
  mimeType: string;
  contentBase64?: string;
  previewable: boolean;
}


export type ArtifactFailureCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "SENSITIVE_PATH";


export interface ArtifactResolutionResult {
  ok: true;
  artifact: MediaArtifact;
}


export interface ArtifactResolutionFailure {
  ok: false;
  path: string;
  reason: string;
  code: ArtifactFailureCode;
}


export type ArtifactResolution = ArtifactResolutionResult | ArtifactResolutionFailure;


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


export interface TeamConfig {
  name: string;
  description: string;
  /** camelCase from serde rename */
  createdAt: number;
  leadAgentId: string;
  leadSessionId: string;
  members: TeamMember[];
}


export interface TeamMember {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  color: string;
  planModeRequired: boolean;
  joinedAt: number;
  tmuxPaneId: string;
  cwd: string;
  subscriptions: string[];
  backendType: string;
  /** The prompt given to spawned teammates (empty for leader) */
  prompt: string;
  /** Runtime active status from Claude Code SDK */
  isActive: boolean;
}


export interface TeamInboxMessage {
  from: string;
  text: string;
  summary: string;
  timestamp: string;
  color: string;
  read: boolean;
}


export interface TeamTask {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner: string;
  status: string;
  blocks: string[];
  blockedBy: string[];
  metadata?: unknown;
}


export interface TeamSummary {
  name: string;
  description: string;
  /** snake_case — internal type, not deserialized from Claude Code files */
  member_count: number;
  task_count: number;
  created_at: number;
}


export type TeamRunStatus =
  | "created"
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";


export type TeamMemberRunStatus = "pending" | "running" | "completed" | "failed";


export interface TeamPresetMember {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  defaultModel?: string;
}


export interface TeamPreset {
  id: string;
  name: string;
  description: string;
  members: TeamPresetMember[];
}


export interface TeamMemberRun {
  id: string;
  memberId: string;
  memberName: string;
  role: string;
  task: string;
  status: TeamMemberRunStatus;
  runId?: string;
  summary?: string;
  error?: string;
}


export interface TeamRun {
  id: string;
  teamName: string;
  presetId: string;
  cwd: string;
  sourceRunId?: string;
  prompt: string;
  mode: string;
  status: TeamRunStatus;
  memberRuns: TeamMemberRun[];
  summary?: string;
  error?: string;
  leadRunId?: string;
  leadPlan?: string;
  createdAt: string;
  updatedAt: string;
}


export interface PluginAuthor {
  name: string;
  email?: string;
}


export interface PluginComponents {
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: boolean;
  mcp_servers: string[];
  lsp_servers: string[];
}


export interface MarketplacePlugin {
  name: string;
  description: string;
  version?: string;
  author?: PluginAuthor;
  category?: string;
  homepage?: string;
  source?: unknown;
  tags: string[];
  strict?: boolean;
  lsp_servers?: unknown;
  marketplace_name?: string;
  install_count?: number;
  components: PluginComponents;
}


export interface MarketplaceInfo {
  name: string;
  source: unknown;
  install_location: string;
  last_updated?: string;
  plugin_count: number;
}


export interface StandaloneSkill {
  name: string;
  description: string;
  path: string;
  scope?: string;
  remoteRef?: SkillRemoteRef;
}


export interface SkillSummary {
  total: number;
  builtIn: number;
  custom: number;
}


export interface InstalledPlugin {
  name: string;
  description: string;
  version?: string;
  scope?: string;
  enabled?: boolean;
  marketplace?: string;
  pluginId?: string;
  /** Project directory this plugin was installed in (project/local scope only). */
  projectPath?: string;
  [key: string]: unknown;
}


export interface PluginOperationResult {
  success: boolean;
  message: string;
}


export interface CommunitySkillResult {
  id: string;
  name: string;
  skill_id: string;
  installs: number;
  source: string;
}


export interface CommunitySkillDetail {
  id: string;
  name: string;
  description: string;
  installs: number;
  source: string;
  content: string | null;
  raw_url: string | null;
  skills_sh_url: string | null;
  github_url: string | null;
}


export interface ProviderHealth {
  available: boolean;
  reason: string | null;
}


export interface ContextSnapshot {
  runId: string;
  turnIndex: number;
  ts: string;
  data: import("$lib/utils/context-parser").ContextData;
}


export interface McpRegistrySearchResult {
  servers: McpRegistryServer[];
  nextCursor: string | null;
  count: number;
}


export interface McpRegistryServer {
  name: string;
  description: string;
  title?: string;
  version: string;
  packages: McpRegistryPackage[];
  remotes: McpRegistryRemote[];
  repository?: McpRegistryRepository;
}


export interface McpRegistryPackage {
  registryType: string;
  identifier: string;
  version?: string;
  environmentVariables: McpRegistryEnvVar[];
}


export interface McpRegistryRemote {
  type: string;
  url: string;
  headers: McpRegistryHeader[];
}


export interface McpRegistryEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}


export interface McpRegistryHeader {
  name: string;
  description?: string;
  value?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}


export interface McpRegistryRepository {
  url?: string;
  source?: string;
}


export interface ConfiguredMcpServer {
  name: string;
  server_type: string;
  scope: string;
  command?: string;
  args: string[];
  url?: string;
  env_keys: string[];
  header_keys: string[];
}


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


export type FleetStatus =
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "stopped"
  | "detached";


export interface FleetMemberMetrics {
  uptimeSecs: number;
  toolCalls: number;
  tokensUsed: number;
  costUsdEstimate: number;
  messageCount: number;
}


export interface FleetMemberSummary {
  id: string;
  agent: string;
  status: FleetStatus;
  cwd: string;
  workspaceAlias?: string;
  startedAt: string;
  lastActivityAt: string;
  currentTaskPreview?: string;
  metrics: FleetMemberMetrics;
  model?: string;
}


export interface FleetMemberDetail extends FleetMemberSummary {
  permissionMode?: string;
  teamIds: string[];
  recentRuns: TaskRun[];
}


export interface FleetMetrics {
  total: number;
  byStatus: Record<string, number>;
  byAgent: Record<string, number>;
  totalTokensToday: number;
  totalCostTodayUsd: number;
}


export interface FleetSendResult {
  runId: string;
  accepted: boolean;
}


export interface DocExcerpt {
  exists: boolean;
  excerpt: string;
}


export interface ProjectMetadata {
  stack: ProjectStack;
  commands: ProjectCommands;
  claudeMd: DocExcerpt;
  readme: DocExcerpt;
}


export interface LastCommit {
  shortHash: string;
  subject: string;
  author: string;
  timeIso: string;
}


export interface ProjectGitStatus {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  dirtyCount: number;
  lastCommit: LastCommit | null;
}


