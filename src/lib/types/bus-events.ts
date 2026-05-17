import type { Attachment } from "./index";
import type { CliCommand } from "./index";
import type { McpServerInfo } from "./index";
import type { ModelUsageEntry } from "./index";
import type { PermissionSuggestion } from "./index";
import type { RunStatus } from "./index";

// ── Sidebar panel types ──

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
    };

export type RalphCompleteReason =
  | "max_iterations"
  | "completion_promise"
  | "cancelled"
  | "fail_stopped";

// ── MCP Elicitation types ──

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
