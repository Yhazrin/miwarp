use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use super::usage::{McpServerInfo, ModelUsageEntry};

pub enum RalphCompleteReason {
    MaxIterations,
    CompletionPromise,
    Cancelled,
    FailStopped,
}

// ── Event Bus types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BusEvent {
    SessionInit {
        run_id: String,
        session_id: Option<String>,
        model: Option<String>,
        tools: Vec<String>,
        cwd: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        slash_commands: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        mcp_servers: Vec<McpServerInfo>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "permissionMode"
        )]
        permission_mode: Option<String>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "apiKeySource"
        )]
        api_key_source: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        claude_code_version: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output_style: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        agents: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        skills: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        plugins: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        plugin_errors: Vec<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fast_mode_state: Option<String>,
    },
    MessageDelta {
        run_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    MessageComplete {
        run_id: String,
        message_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        /// Actual model used for this message (e.g. "claude-opus-4-6").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// Stop reason (v2.1.41: usually null; future: "end_turn", "tool_use").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
        /// Per-message token usage (raw JSON — result event has aggregated totals).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message_usage: Option<Value>,
    },
    ToolStart {
        run_id: String,
        tool_use_id: String,
        tool_name: String,
        input: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    ToolEnd {
        run_id: String,
        tool_use_id: String,
        tool_name: String,
        output: Value,
        status: String,
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        /// Structured tool result metadata from CLI verbose mode (e.g. file info for Read)
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_use_result: Option<Value>,
    },
    UserMessage {
        run_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        uuid: Option<String>,
    },
    RunState {
        run_id: String,
        state: String,
        exit_code: Option<i32>,
        error: Option<String>,
    },
    /// v1.0.9: emitted by the recovery state machine on every state
    /// transition. The frontend projects this into the per-card
    /// session lifecycle UI; the diagnostic ring buffer subscribes
    /// to it. Mirrors the `ActorLifecycle` and `RecoveryState`
    /// enums in `src-tauri/src/agent/recovery.rs`. Fields are
    /// intentionally flat (no nested enums) so the bus contract
    /// stays text-only sync-able.
    SessionLifecycle {
        run_id: String,
        session_id: Option<String>,
        /// Actor lifecycle phase: starting | ready | crashed |
        /// respawning | stopped | disposed.
        phase: String,
        /// Recovery state machine value: healthy | degraded |
        /// reconnecting | recovering | recovered | unrecoverable.
        recovery_state: String,
        /// When `phase == "crashed"`, the typed `CrashReason` wire
        /// tag (e.g. `stdin_write_failed`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        crash_reason: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        crash_code: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        crash_signal: Option<i32>,
        /// Current connection generation. Bumped on every recovery
        /// and every actor respawn.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        connection_generation: Option<u64>,
        /// Number of consecutive `Reconnecting` transitions since
        /// the last `Healthy` or `Recovered`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        consecutive_failures: Option<u32>,
        /// Wall-clock millis since the Unix epoch.
        timestamp_ms: u64,
    },
    UsageUpdate {
        run_id: String,
        input_tokens: u64,
        output_tokens: u64,
        cache_read_tokens: Option<u64>,
        cache_write_tokens: Option<u64>,
        total_cost_usd: f64,
        /// Backend-authoritative turn index (1-based). Injected by session_actor for user turns.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn_index: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model_usage: Option<HashMap<String, ModelUsageEntry>>,
        /// Official CLI context window used percentage, when provided by status/result payloads.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context_window_used_percentage: Option<f64>,
        /// Official CLI context window remaining percentage, when provided by status/result payloads.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context_window_remaining_percentage: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_api_ms: Option<u64>,
        /// Total duration including hooks/overhead (from result event).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        /// Number of turns in this session (from result event).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        num_turns: Option<u64>,
        /// Stop reason from result event (v2.1.41: usually null).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
        /// Service tier (e.g. "standard").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        service_tier: Option<String>,
        /// Speed tier (e.g. "standard").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speed: Option<String>,
        /// Web fetch request count (from usage.server_tool_use).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        web_fetch_requests: Option<u64>,
        /// 5-minute ephemeral cache creation tokens.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache_creation_5m: Option<u64>,
        /// 1-hour ephemeral cache creation tokens.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache_creation_1h: Option<u64>,
    },
    Raw {
        run_id: String,
        source: String,
        data: Value,
    },
    PermissionDenied {
        run_id: String,
        tool_name: String,
        tool_use_id: String,
        tool_input: Value,
    },
    /// Thinking/reasoning text delta (from extended thinking).
    ThinkingDelta {
        run_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// Partial JSON input for a tool being invoked (real-time streaming).
    ToolInputDelta {
        run_id: String,
        tool_use_id: String,
        partial_json: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// Inline permission prompt from `--permission-prompt-tool stdio`.
    /// CLI is waiting for a control_response with allow/deny.
    PermissionPrompt {
        run_id: String,
        request_id: String,
        tool_name: String,
        tool_use_id: String,
        tool_input: Value,
        decision_reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        suggestions: Vec<Value>,
    },
    /// Context compaction boundary — CLI auto-compressed the conversation context.
    CompactBoundary {
        run_id: String,
        trigger: String,
        pre_tokens: Option<u64>,
    },
    /// System status change (e.g. "compacting").
    SystemStatus {
        run_id: String,
        /// CLI status string, e.g. "compacting", null for cleared
        status: Option<String>,
        data: Value,
    },
    /// Hook execution started.
    HookStarted {
        run_id: String,
        hook_event: String,
        hook_id: String,
        data: Value,
        /// Hook name (e.g. "SessionStart:startup").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hook_name: Option<String>,
    },
    /// Hook execution progress.
    HookProgress {
        run_id: String,
        hook_id: String,
        data: Value,
    },
    /// Hook execution completed with result.
    HookResponse {
        run_id: String,
        hook_id: String,
        hook_event: String,
        outcome: String,
        data: Value,
        /// Hook name (e.g. "SessionStart:startup").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hook_name: Option<String>,
        /// Hook stdout.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stdout: Option<String>,
        /// Hook stderr.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stderr: Option<String>,
        /// Hook process exit code.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
    /// Background task notification (file indexing, MCP init, etc.).
    TaskNotification {
        run_id: String,
        task_id: String,
        status: String,
        data: Value,
    },
    /// Files persisted notification.
    FilesPersisted {
        run_id: String,
        files: Value,
        data: Value,
    },
    /// Tool progress update (real-time elapsed time).
    /// Top-level event type "tool_progress" (not a content_block_delta subtype).
    ToolProgress {
        run_id: String,
        tool_use_id: String,
        elapsed_time_seconds: Option<f64>,
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// Tool use summary — top-level event type "tool_use_summary".
    ToolUseSummary {
        run_id: String,
        tool_use_id: String,
        summary: String,
        preceding_tool_use_ids: Vec<String>,
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// Authentication status update.
    AuthStatus {
        run_id: String,
        is_authenticating: bool,
        output: Vec<String>,
        data: Value,
    },
    /// Hook callback control_request — CLI requests hook execution/approval.
    /// Analogous to PermissionPrompt (needs a control_response).
    HookCallback {
        run_id: String,
        request_id: String,
        hook_event: String,
        hook_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        hook_name: Option<String>,
        data: Value,
    },
    /// CLI cancelled a pending control_request (e.g. cancelled permission prompt).
    ControlCancelled { run_id: String, request_id: String },
    /// Output from a CLI slash command (e.g. /context, /cost).
    /// Extracted from `<local-command-stdout>` tags in user messages.
    CommandOutput { run_id: String, content: String },
    /// MCP elicitation: CLI requests user input for MCP server authentication/configuration.
    ElicitationPrompt {
        run_id: String,
        request_id: String,
        mcp_server_name: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        elicitation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        requested_schema: Option<Value>,
    },
    /// Rate limit event — emitted when API rate limit status changes.
    RateLimitEvent {
        run_id: String,
        /// Rate limit status: "allowed", "allowed_warning", "rejected"
        status: String,
        /// When the rate limit window resets (epoch seconds).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resets_at: Option<f64>,
        /// Which limit: "five_hour", "seven_day", etc.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rate_limit_type: Option<String>,
        /// Utilization percentage (0.0-1.0).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        utilization: Option<f64>,
        data: Value,
    },
    /// Ralph loop started — carries full config for replay.
    RalphStarted {
        run_id: String,
        prompt: String,
        max_iterations: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        completion_promise: Option<String>,
        started_at: String,
    },
    /// Ralph loop iteration completed (not the final one).
    RalphIteration {
        run_id: String,
        iteration: u32,
        max_iterations: u32,
    },
    /// Ralph loop ended.
    RalphComplete {
        run_id: String,
        reason: RalphCompleteReason,
        iteration: u32,
    },
    /// v1.0.6 / hardening A1: emitted when a session enters quarantine.
    /// Lets the UI surface "会话恢复中…（最多 N 秒）" instead of going silent.
    SessionRecovering {
        run_id: String,
        reason: String,
        deadline_ms: u64,
        #[serde(default)]
        from_internal: bool,
    },
    /// v1.0.6 / hardening A1: emitted when a session exits quarantine.
    /// `ok=true` means CLI responded; `ok=false` means the deadline hit and
    /// the run was force-failed.
    SessionRecovered { run_id: String, ok: bool },
    /// v1.0.6 / hardening A2: emitted when JSON parse failures exceed the
    /// threshold within a sliding window. Frontend uses this to surface a
    /// "会话状态已重置" toast and unlock the input.
    ProtocolDesync {
        run_id: String,
        fail_count: u32,
        /// First 200 bytes of the most recent bad line, for debugging.
        sample: String,
    },
    /// v1.1.0 / 110-A17: emitted whenever the durable Attention Queue mutates
    /// (raise / refresh / acknowledge / resolve / reopen / reconcile). The
    /// payload carries just the revision and counts so listeners can decide
    /// whether to refetch the full snapshot via `attention_queue_get`.
    /// The realtime `attention_queue_changed` event remains as a lossy
    /// B-class hint; this variant is the persistent A-class event used by
    /// replay and audit.
    AttentionChanged {
        /// New queue revision after the mutation.
        revision: u64,
        /// Last `last_event_seq` value (for delta replay).
        last_event_seq: u64,
        /// Number of items in `Open` status after the mutation.
        open_count: u32,
        /// Number of items in `Acknowledged` status.
        acknowledged_count: u32,
        /// Number of items in `Resolved` status.
        resolved_count: u32,
        /// Optional stable_key of the most recently changed item (if any).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_changed_key: Option<String>,
    },
    /// v1.1.0 / 110-A4: emitted when a runtime health probe (claude / codex /
    /// other CLI provider) returns a result that differs from the previous
    /// snapshot. Used by the frontend capability matrix to surface degraded
    /// or unhealthy states without polling.
    RuntimeHealthChanged {
        /// Provider key (e.g. "claude", "codex", "opencode").
        agent: String,
        /// Current health state: "healthy" | "degraded" | "unhealthy".
        health: String,
        /// Optional reason string for unhealthy / degraded.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        /// Resolved binary path, when known.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        binary_path: Option<String>,
        /// Resolved version string, when known.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        version: Option<String>,
        /// Whether the user is currently logged in to this provider.
        logged_in: bool,
        /// Wall-clock millis when this snapshot was taken.
        timestamp_ms: u64,
    },
    /// v1.1.0 / 110-S5: emitted when a run is denied or aborted because the
    /// Resource Governor budget was exceeded. The frontend uses this to show
    /// "并发上限已满" / "内存上限已触发" toasts and offer to retry / queue.
    GovernorBudgetExceeded {
        /// Stable identifier for the run that was rejected (empty when an
        /// already-running run was forcibly cancelled by the governor).
        run_id: String,
        /// Which budget was exceeded: "concurrent_runs" | "memory_bytes".
        budget_kind: String,
        /// Current effective value when the budget tripped.
        current_value: u64,
        /// Configured ceiling that was crossed.
        limit_value: u64,
        /// Optional human-readable reason (free-form, may be shown in UI).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        /// Wall-clock millis when the budget tripped.
        timestamp_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    #[default]
    New,
    Resume,
    Continue,
    Fork,
}

