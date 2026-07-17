// Session, Run, and BusEvent types
// Auto-generated from types.ts — do not edit manually

import type { CliCommand } from "./settings";
import type { McpServerInfo } from "./settings";
import type { PermissionSuggestion } from "./settings";
import type { ModelUsageEntry } from "./common";
import type { Attachment } from "./chat";

import type { RunStatus } from "./primitives";
// RunStatus re-exported via primitives.ts
export type { RunStatus };


export type RunEventType = "system" | "stdout" | "stderr" | "command" | "user" | "assistant";


export type ExecutionPath = "session_actor" | "pipe_exec";


export type RunSurface = "chat" | "project_desk";


export interface ProjectDeskContextMeta {
  /** Char count of the system prompt that was injected. */
  contextCharCount: number;
  /** Estimated token count, derived from char count when the backend
   *  didn't supply a tighter number. */
  estimatedTokens: number;
  /** ISO 8601 timestamp of when the snapshot was generated. */
  snapshotGeneratedAt: string;
}


export type ConversationRef =
  | { kind: "claude_session"; id: string }
  | { kind: "codex_thread"; id: string }
  | { kind: "mimo_session"; id: string }
  | { kind: "opencode_session"; id: string };


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
  /** MiWarp surface that created this run. Undefined means the default chat surface. */
  run_surface?: RunSurface;
  /** P2-14 / P2-16: snapshot of the project-desk system context that was
   *  injected at spawn time. Lets the workbench label the context as a
   *  startup snapshot (not refreshed mid-run) and show real
   *  char/token counts instead of guessing. Undefined for chat-surface runs
   *  and runs created before the field landed. */
  project_desk_context?: ProjectDeskContextMeta;
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
  /** Scheduled task definition id (runs hidden from flat session list). */
  scheduled_task_id?: string;
  /** Scheduler execution record id. */
  scheduled_task_run_id?: string;
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


export interface ExportReport {
  sessionCount: number;
  totalBytes: number;
  failures: string[];
}


export interface ImportDetail {
  sessionId: string;
  cwd: string;
  runId?: string;
  status: string;
  error?: string;
}


export interface ImportReport {
  imported: number;
  skipped: number;
  duplicates: number;
  failed: number;
  missingCwd: number;
  details: ImportDetail[];
}


export interface CliSessionInfo {
  sessionId: string;
  cwd: string;
  relativePath: string;
  firstPrompt?: string;
  startedAt?: string;
  lastActivityAt?: string;
  messageCount: number;
  model?: string;
  alreadyImported: boolean;
  existingRunId?: string;
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


export type SessionMode = "new" | "resume" | "continue" | "fork";


export interface ChatDelta {
  text: string;
}


export interface ChatDone {
  ok: boolean;
  code: number;
  error?: string;
}


export interface FileEntry {
  path: string;
  action: "read" | "write" | "edit" | "persisted";
  toolUseId?: string; // only top-level tools can be scrolled to
  status?: string;
}


export interface SessionInfoData {
  sessionId?: string;
  runId?: string;
  runName?: string;
  cwd: string;
  numTurns: number;
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  lastTurnDurationMs: number;
  tokensEstimated: boolean;
  model: string;
  agent: string;
  cliVersion: string;
  permissionMode: string;
  fastModeState: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextWindow: number;
  contextUtilization: number;
  compactCount: number;
  microcompactCount: number;
  mcpServers: McpServerInfo[];
  remoteHostName?: string | null;
  platformId?: string | null;
  cliUsageIncomplete?: boolean;
  runSource?: string;
  authSourceLabel?: string;
  platformName?: string;
  cliUpdateAvailable?: string;
}


export type BusEvent =
  | {
      type: "session_init";
      run_id: string;
      session_id?: string;
      model?: string;
      tools: string[];
      cwd: string;
      slash_commands?: CliCommand[];
      mcp_servers?: McpServerInfo[];
      permissionMode?: string;
      apiKeySource?: string;
      claude_code_version?: string;
      output_style?: string;
      agents?: string[];
      skills?: string[];
      plugins?: unknown[];
      plugin_errors?: unknown[];
      fast_mode_state?: string;
    }
  | {
      type: "rate_limit_event";
      run_id: string;
      /** Rate limit status: "allowed", "allowed_warning", "rejected" */
      status: string;
      /** When the rate limit window resets (epoch seconds). */
      resets_at?: number;
      /** Which limit: "five_hour", "seven_day", etc. */
      rate_limit_type?: string;
      /** Utilization percentage (0.0-1.0). */
      utilization?: number;
      data: Record<string, unknown>;
    }
  | { type: "message_delta"; run_id: string; text: string; parent_tool_use_id?: string }
  | {
      type: "message_complete";
      run_id: string;
      message_id: string;
      text: string;
      parent_tool_use_id?: string;
      model?: string;
      stop_reason?: string | null;
      message_usage?: Record<string, unknown>;
    }
  | {
      type: "tool_start";
      run_id: string;
      tool_use_id: string;
      tool_name: string;
      input: Record<string, unknown>;
      parent_tool_use_id?: string;
    }
  | {
      type: "tool_end";
      run_id: string;
      tool_use_id: string;
      tool_name: string;
      output: Record<string, unknown>;
      status: string;
      duration_ms?: number;
      parent_tool_use_id?: string;
      /** Structured tool result metadata from CLI verbose mode */
      tool_use_result?: Record<string, unknown>;
    }
  | { type: "user_message"; run_id: string; text: string; uuid?: string }
  | { type: "run_state"; run_id: string; state: string; exit_code?: number; error?: string }
  | {
      /** v1.0.9: emitted by the recovery state machine on every
       * state transition. Mirrors src-tauri/src/agent/recovery.rs. */
      type: "session_lifecycle";
      run_id: string;
      session_id?: string;
      /** Actor lifecycle phase: starting | ready | crashed |
       * respawning | stopped | disposed. */
      phase: string;
      /** Recovery state machine value: healthy | degraded |
       * reconnecting | recovering | recovered | unrecoverable. */
      recovery_state: string;
      crash_reason?: string;
      crash_code?: number;
      crash_signal?: number;
      connection_generation?: number;
      consecutive_failures?: number;
      timestamp_ms: number;
    }
  | {
      type: "usage_update";
      run_id: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens?: number;
      cache_write_tokens?: number;
      total_cost_usd: number;
      /** Backend-authoritative turn index (1-based). Present for user turns. */
      turn_index?: number;
      model_usage?: Record<string, ModelUsageEntry>;
      context_window_used_percentage?: number;
      context_window_remaining_percentage?: number;
      duration_api_ms?: number;
      duration_ms?: number;
      num_turns?: number;
      stop_reason?: string | null;
      service_tier?: string;
      speed?: string;
      web_fetch_requests?: number;
      cache_creation_5m?: number;
      cache_creation_1h?: number;
    }
  | { type: "raw"; run_id: string; source: string; data: Record<string, unknown> }
  | { type: "thinking_delta"; run_id: string; text: string; parent_tool_use_id?: string }
  | {
      type: "tool_input_delta";
      run_id: string;
      tool_use_id: string;
      partial_json: string;
      parent_tool_use_id?: string;
    }
  | {
      type: "permission_denied";
      run_id: string;
      tool_name: string;
      tool_use_id: string;
      tool_input: Record<string, unknown>;
    }
  | {
      type: "permission_prompt";
      run_id: string;
      request_id: string;
      tool_name: string;
      tool_use_id: string;
      tool_input: Record<string, unknown>;
      decision_reason: string;
      parent_tool_use_id?: string;
      suggestions?: PermissionSuggestion[];
    }
  | { type: "compact_boundary"; run_id: string; trigger: string; pre_tokens?: number }
  | { type: "system_status"; run_id: string; status?: string; data: Record<string, unknown> }
  | {
      type: "hook_started";
      run_id: string;
      hook_event: string;
      hook_id: string;
      data: Record<string, unknown>;
      hook_name?: string;
    }
  | { type: "hook_progress"; run_id: string; hook_id: string; data: Record<string, unknown> }
  | {
      type: "hook_response";
      run_id: string;
      hook_id: string;
      hook_event: string;
      outcome: string;
      data: Record<string, unknown>;
      hook_name?: string;
      stdout?: string;
      stderr?: string;
      exit_code?: number;
    }
  | {
      type: "task_notification";
      run_id: string;
      task_id: string;
      status: string;
      data: Record<string, unknown>;
    }
  | { type: "files_persisted"; run_id: string; files: unknown; data: Record<string, unknown> }
  | {
      type: "tool_progress";
      run_id: string;
      tool_use_id: string;
      elapsed_time_seconds?: number;
      data: Record<string, unknown>;
      parent_tool_use_id?: string;
    }
  | {
      type: "tool_use_summary";
      run_id: string;
      tool_use_id: string;
      summary: string;
      preceding_tool_use_ids: string[];
      data: Record<string, unknown>;
      parent_tool_use_id?: string;
    }
  | {
      type: "auth_status";
      run_id: string;
      is_authenticating: boolean;
      output: string[];
      data: Record<string, unknown>;
    }
  | {
      type: "hook_callback";
      run_id: string;
      request_id: string;
      hook_event: string;
      hook_id: string;
      hook_name?: string;
      data: Record<string, unknown>;
    }
  | { type: "control_cancelled"; run_id: string; request_id: string }
  | { type: "command_output"; run_id: string; content: string }
  | {
      type: "elicitation_prompt";
      run_id: string;
      request_id: string;
      mcp_server_name: string;
      message: string;
      elicitation_id?: string;
      mode?: string;
      url?: string;
      requested_schema?: ElicitationSchema;
    }
  | {
      type: "ralph_started";
      run_id: string;
      prompt: string;
      max_iterations: number;
      completion_promise: string | null;
      started_at: string;
    }
  | { type: "ralph_iteration"; run_id: string; iteration: number; max_iterations: number }
  | {
      type: "ralph_complete";
      run_id: string;
      reason: RalphCompleteReason;
      iteration: number;
    }
  // v1.0.6 / hardening A1: session entered quarantine; UI should show a banner
  // that auto-dismisses when SessionRecovered arrives (or after deadline_ms).
  | {
      type: "session_recovering";
      run_id: string;
      reason: string;
      deadline_ms: number;
      from_internal?: boolean;
    }
  | {
      type: "session_recovered";
      run_id: string;
      ok: boolean;
    }
  // v1.0.6 / hardening A2: too many unparseable JSON lines within a window.
  // Force-fail already happened on the backend; UI shows a "会话状态已重置" toast.
  | {
      type: "protocol_desync";
      run_id: string;
      fail_count: number;
      sample: string;
    }
  // v1.1.0 / 110-A17: durable Attention Queue mutated; payload carries the
  // new revision + open/ack/resolved counts so the frontend can decide whether
  // to refetch the full snapshot.
  | {
      type: "attention_changed";
      revision: number;
      last_event_seq: number;
      open_count: number;
      acknowledged_count: number;
      resolved_count: number;
      last_changed_key?: string;
    }
  // v1.1.0 / 110-A4: runtime health probe (claude / codex / ...) changed
  // state. Frontend capability matrix listens and refreshes the row.
  | {
      type: "runtime_health_changed";
      agent: string;
      /** "healthy" | "degraded" | "unhealthy" */
      health: string;
      reason?: string;
      binary_path?: string;
      version?: string;
      logged_in: boolean;
      timestamp_ms: number;
    }
  // v1.1.0 / 110-S5: Resource Governor budget exceeded. Frontend surfaces a
  // toast and may offer to queue / retry.
  | {
      type: "governor_budget_exceeded";
      run_id: string;
      /** "concurrent_runs" | "memory_bytes" */
      budget_kind: string;
      current_value: number;
      limit_value: number;
      reason?: string;
      timestamp_ms: number;
    };


export type RalphCompleteReason =
  | "max_iterations"
  | "completion_promise"
  | "cancelled"
  | "fail_stopped";


export interface ElicitationFieldSchema {
  type: "string" | "number" | "boolean" | "enum" | "array";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  required?: boolean;
}


export interface ElicitationSchema {
  type?: string;
  properties?: Record<string, ElicitationFieldSchema>;
  required?: string[];
  [key: string]: unknown;
}


export interface BusToolItem {
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status:
    | "running"
    | "success"
    | "error"
    | "denied"
    | "ask_pending"
    | "permission_denied"
    | "permission_prompt";
  /** For permission_prompt status: the control_request ID needed to respond. */
  permission_request_id?: string;
  duration_ms?: number;
  /** Real-time elapsed time from tool_progress (seconds, float). */
  elapsed_time_seconds?: number;
  /** Summary text from tool_use_summary. */
  summary?: string;
  /** Permission update suggestions from CLI. */
  suggestions?: PermissionSuggestion[];
  /** Structured tool result metadata from CLI verbose mode (e.g. file info for Read). */
  tool_use_result?: Record<string, unknown>;
  [key: string]: unknown;
}


export type TimelineEntry =
  | {
      kind: "user";
      id: string;
      /** Stable anchor for DOM id and search scroll-to. */
      anchorId: string;
      content: string;
      ts: string;
      attachments?: Attachment[];
      cliUuid?: string;
    }
  | {
      kind: "assistant";
      id: string;
      anchorId: string;
      content: string;
      ts: string;
      thinkingText?: string;
      model?: string;
    }
  | {
      kind: "tool";
      id: string;
      anchorId: string;
      tool: BusToolItem;
      ts: string;
      subTimeline?: TimelineEntry[];
    }
  | { kind: "separator"; id: string; anchorId: string; content: string; ts: string }
  | { kind: "command_output"; id: string; anchorId: string; content: string; ts: string };


