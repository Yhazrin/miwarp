use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use super::settings::{RemoteHost, UserSettings};

pub enum RunStatus {
    Pending,
    Running,
    /// Turn complete, waiting for user input. Session is still alive.
    Idle,
    Completed,
    Failed,
    Stopped,
}

impl std::fmt::Display for RunStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunStatus::Pending => write!(f, "pending"),
            RunStatus::Running => write!(f, "running"),
            RunStatus::Idle => write!(f, "idle"),
            RunStatus::Completed => write!(f, "completed"),
            RunStatus::Failed => write!(f, "failed"),
            RunStatus::Stopped => write!(f, "stopped"),
        }
    }
}

/// Run source — how this run was created.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunSource {
    Native,    // app-created run
    CliImport, // imported from CLI transcript
}

/// Session creation mode — single-branch or isolated worktree.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionCreationMode {
    Single,
    Worktree,
}

/// Import watermark for incremental CLI session sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWatermark {
    pub offset: u64,
    pub mtime_ns: u128,
    pub file_size: u64,
    pub last_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunEventType {
    System,
    Stdout,
    Stderr,
    Command,
    User,
    Assistant,
}

impl std::fmt::Display for RunEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunEventType::System => write!(f, "system"),
            RunEventType::Stdout => write!(f, "stdout"),
            RunEventType::Stderr => write!(f, "stderr"),
            RunEventType::Command => write!(f, "command"),
            RunEventType::User => write!(f, "user"),
            RunEventType::Assistant => write!(f, "assistant"),
        }
    }
}

/// App-internal execution path — which backend subsystem handles this run.
/// NOT a protocol description; a single agent may support multiple paths.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionPath {
    /// Long-lived process with bidirectional control protocol (Claude stream-json via session_actor)
    SessionActor,
    /// Single-shot process, stdout only (Codex exec, Claude --print via stream.rs)
    PipeExec,
}

/// Which agent runtime backend powers this run.
/// Determines binary, protocol, settings, and session management.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeKind {
    /// Anthropic Claude Code CLI (`claude`)
    #[default]
    ClaudeCode,
    /// Xiaomi MiMo-Code CLI (`mimo`)
    MiMoCode,
    /// OpenAI Codex CLI (`codex`)
    Codex,
    /// OpenCode CLI (`opencode`)
    OpenCode,
    /// Cursor Agent CLI (`agent`)
    Cursor,
}

impl std::fmt::Display for AgentRuntimeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ClaudeCode => write!(f, "claude"),
            Self::MiMoCode => write!(f, "mimo"),
            Self::Codex => write!(f, "codex"),
            Self::OpenCode => write!(f, "opencode"),
            Self::Cursor => write!(f, "cursor"),
        }
    }
}

impl AgentRuntimeKind {
    /// Parse from the agent string stored in RunMeta.
    pub fn from_agent(agent: &str) -> Self {
        Self::try_parse_agent(agent).unwrap_or(Self::ClaudeCode)
    }

    /// Parse a known agent key, or None for unrecognized values.
    pub fn try_parse_agent(agent: &str) -> Option<Self> {
        match agent {
            "claude" => Some(Self::ClaudeCode),
            "mimo" | "mimocode" => Some(Self::MiMoCode),
            "codex" => Some(Self::Codex),
            "opencode" => Some(Self::OpenCode),
            "cursor" => Some(Self::Cursor),
            _ => None,
        }
    }

    /// Strict parse for run creation — rejects unknown agent strings.
    pub fn parse_agent(agent: &str) -> Result<Self, String> {
        Self::try_parse_agent(agent).ok_or_else(|| {
            format!(
                "unknown agent '{}': supported agents are {}",
                agent,
                Self::supported_agent_keys().join(", ")
            )
        })
    }

    pub fn supported_agent_keys() -> &'static [&'static str] {
        &["claude", "codex", "mimo", "opencode", "cursor"]
    }

    pub fn default_execution_path(&self) -> ExecutionPath {
        match self {
            Self::ClaudeCode | Self::MiMoCode | Self::Cursor => ExecutionPath::SessionActor,
            Self::Codex | Self::OpenCode => ExecutionPath::PipeExec,
        }
    }

    pub fn supports_execution_path(&self, path: &ExecutionPath) -> bool {
        matches!(
            (self, path),
            (Self::ClaudeCode, _)
                | (Self::MiMoCode | Self::Cursor, ExecutionPath::SessionActor)
                | (Self::Codex | Self::OpenCode, ExecutionPath::PipeExec)
        )
    }

    pub fn validate_execution_path(&self, path: &ExecutionPath) -> Result<(), String> {
        if self.supports_execution_path(path) {
            Ok(())
        } else {
            Err(format!(
                "agent '{}' does not support execution_path {:?}",
                self, path
            ))
        }
    }
}

/// Communication protocol between MiWarp and the agent runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeProtocolKind {
    /// NDJSON line-delimited JSON events (Claude stream-json, MiMo --format json)
    StreamJson,
    /// PTY embedded mode (TUI rendering in xterm.js)
    Pty,
    /// Single-shot pipe (stdout text, no streaming)
    Pipe,
    /// Protocol not yet determined
    #[default]
    Unknown,
}

/// Unified resume/fork identity across agents.
/// Claude = session_id from system/init; Codex = thread_id from thread.started.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "id")]
pub enum ConversationRef {
    /// Claude Code session ID (from system/init event)
    #[serde(rename = "claude_session")]
    ClaudeSession(String),
    /// Codex thread ID (from thread.started event)
    #[serde(rename = "codex_thread")]
    CodexThread(String),
    /// MiMo-Code session ID (from sessionID in JSON events)
    #[serde(rename = "mimo_session")]
    MimoSession(String),
    /// OpenCode session ID (from sessionID in NDJSON events)
    #[serde(rename = "opencode_session")]
    OpenCodeSession(String),
}

/// First-class MiWarp surface that created or owns a run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunSurface {
    Chat,
    ProjectDesk,
}

/// P2-14 / P2-16: snapshot of the project-desk system context that was
/// injected into the run at spawn time. The workbench sidebar uses
/// `snapshot_generated_at` to label the context as a startup snapshot
/// (not refreshed mid-run) and `context_char_count` / `estimated_tokens`
/// to give users a real token number instead of a rough estimate.
/// None for chat-surface runs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeskContextMeta {
    /// Char count of the system prompt that was injected for this run.
    pub context_char_count: u64,
    /// Estimated token count, derived if backend didn't supply one.
    pub estimated_tokens: u64,
    /// When the snapshot was generated (ISO 8601 string).
    pub snapshot_generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRun {
    pub id: String,
    pub prompt: String,
    pub cwd: String,
    pub agent: String,
    #[serde(default = "default_auth_mode")]
    pub auth_mode: String,
    pub status: RunStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The run_id this session was forked from (None if not a fork).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_run_id: Option<String>,
    /// User-assigned display name (None = use prompt as label).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Remote host name (if this run is on a remote machine).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_host_name: Option<String>,
    /// Snapshot of remote working directory at run creation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_cwd: Option<String>,
    /// Snapshot of active_platform_id at run creation time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_id: Option<String>,
    /// Snapshot of anthropic_base_url at run creation time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_base_url: Option<String>,
    /// Run source (native or cli_import).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<RunSource>,
    /// CLI import watermark for incremental sync.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_import_watermark: Option<ImportWatermark>,
    /// Absolute path to CLI session JSONL file (read-only reference).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_session_path: Option<String>,
    /// True when CLI import couldn't reconstruct complete usage data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_usage_incomplete: Option<bool>,
    /// Snapshot of no_session_persistence at run creation time.
    #[serde(default)]
    pub no_session_persistence: bool,
    /// Resolved execution path (materialized from RunMeta, never None in API output).
    pub execution_path: ExecutionPath,
    /// Resolved conversation identity (None = not resumable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_ref: Option<ConversationRef>,
    /// MiWarp surface that created this run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_surface: Option<RunSurface>,
    /// User-created folder ID for organizing sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    /// Soft-delete timestamp. Populated by incremental sync so frontend can remove deleted runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    /// Archive timestamp. Mirrors `RunMeta.archived_at`; archived members are
    /// hidden from the default fleet view but stay discoverable with
    /// `include_archived=true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    /// Session creation mode (single-branch or worktree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_mode: Option<SessionCreationMode>,
    /// Path to the git worktree directory (only when creation_mode = Worktree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    /// Auto-generated branch name for worktree sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    /// Original project cwd before worktree redirection (for sidebar grouping).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_cwd: Option<String>,
    /// Scheduled task definition id when this run was created by the scheduler.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_task_id: Option<String>,
    /// Scheduler execution record id (`scheduler/runs/<id>.json`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_task_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunEvent {
    pub id: String,
    pub task_id: String,
    pub seq: u64,
    #[serde(rename = "type")]
    pub event_type: RunEventType,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunArtifact {
    pub task_id: String,
    pub files_changed: Vec<String>,
    pub diff_summary: String,
    pub commands: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_estimate: Option<f64>,
    pub updated_at: String,
pub struct RunMeta {
    pub id: String,
    pub prompt: String,
    pub cwd: String,
    pub agent: String,
    #[serde(default = "default_auth_mode")]
    pub auth_mode: String,
    pub status: RunStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_subtype: Option<String>,
    /// The model used in this run (updated on hot-switch).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The run_id this session was forked from (None if not a fork).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_run_id: Option<String>,
    /// User-assigned display name (None = use prompt as label).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Remote host name (references UserSettings.remote_hosts by name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_host_name: Option<String>,
    /// Snapshot of remote_cwd at run creation time (stable — not affected by later settings changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_cwd: Option<String>,
    /// Full snapshot of RemoteHost config at run creation time.
    /// Used to restore remote sessions even if the host is renamed/deleted from settings.
    /// Falls back to name-based lookup for old runs that don't have this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_host_snapshot: Option<RemoteHost>,
    /// Snapshot of active_platform_id at run creation time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_id: Option<String>,
    /// Snapshot of anthropic_base_url at run creation time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_base_url: Option<String>,
    /// Run source (native or cli_import).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<RunSource>,
    /// CLI import watermark for incremental sync.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_import_watermark: Option<ImportWatermark>,
    /// Absolute path to CLI session JSONL file (read-only reference).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_session_path: Option<String>,
    /// True when CLI import couldn't reconstruct complete usage data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_usage_incomplete: Option<bool>,
    /// User-created folder ID for organizing sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    /// Soft-delete timestamp (ISO 8601). When set, run is hidden from all read paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    /// Archive timestamp (ISO 8601). Set by the fleet view's opportunistic reaper
    /// when a non-running member sits idle past the threshold. Archived members
    /// stay in storage (history-preserving) but are excluded from the default
    /// fleet listing and metrics. Pass `include_archived=true` to surface them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    /// Session creation mode (single-branch or worktree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_mode: Option<SessionCreationMode>,
    /// Path to the git worktree directory (only when creation_mode = Worktree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    /// Auto-generated branch name for worktree sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    /// Original project cwd before worktree redirection (for sidebar grouping).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_cwd: Option<String>,
    /// Snapshot of no_session_persistence at run creation time (metadata only — runtime
    /// resume gate uses current agent settings, not this snapshot).
    #[serde(default)]
    pub no_session_persistence: bool,
    /// App execution path for this run. Option on disk (backward compat); resolved via agent heuristic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_path: Option<ExecutionPath>,
    /// Unified resume identity. None = not resumable. Written by runtime events (session_init / thread.started).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_ref: Option<ConversationRef>,
    /// MiWarp surface that created this run. None means the default chat surface.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_surface: Option<RunSurface>,
    /// P2-14 / P2-16: snapshot of the project-desk system context that was
    /// injected into the run at spawn time. The workbench sidebar uses
    /// `snapshot_generated_at` to label the context as a startup snapshot
    /// (not refreshed mid-run) and `context_char_count` /
    /// `estimated_tokens` to give users a real token number instead of a
    /// rough estimate. None for chat-surface runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_desk_context: Option<ProjectDeskContextMeta>,
    /// Scheduled task definition id when this run was created by the scheduler.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_task_id: Option<String>,
    /// Scheduler execution record id (`scheduler/runs/<id>.json`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_task_run_id: Option<String>,
    /// Runtime backend kind. None for old runs → resolved via AgentRuntimeKind::from_agent(agent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_kind: Option<AgentRuntimeKind>,
    /// Communication protocol used by this runtime. None → resolved via runtime_kind default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol_kind: Option<RuntimeProtocolKind>,
}

impl RunMeta {
    /// Resolve execution_path for old runs that don't have it on disk.
    /// Migration assumption: historically, Claude runs used session_actor,
    /// Codex runs used pipe_exec. MiMoCode uses session_actor (StreamJson protocol).
    pub fn resolved_execution_path(&self) -> ExecutionPath {
        self.execution_path.clone().unwrap_or_else(|| {
            let rk = self.resolved_runtime_kind();
            match rk {
                AgentRuntimeKind::ClaudeCode | AgentRuntimeKind::Cursor => {
                    ExecutionPath::SessionActor
                }
                AgentRuntimeKind::MiMoCode => ExecutionPath::SessionActor,
                AgentRuntimeKind::Codex | AgentRuntimeKind::OpenCode => ExecutionPath::PipeExec,
            }
        })
    }

    /// Resolve runtime_kind for old runs that don't have it on disk.
    pub fn resolved_runtime_kind(&self) -> AgentRuntimeKind {
        self.runtime_kind
            .clone()
            .unwrap_or_else(|| AgentRuntimeKind::from_agent(&self.agent))
    }

    /// Resolve protocol_kind for old runs that don't have it on disk.
    pub fn resolved_protocol_kind(&self) -> RuntimeProtocolKind {
        self.protocol_kind.clone().unwrap_or_else(|| {
            let rk = self.resolved_runtime_kind();
            match rk {
                AgentRuntimeKind::ClaudeCode | AgentRuntimeKind::Cursor => {
                    RuntimeProtocolKind::StreamJson
                }
                AgentRuntimeKind::MiMoCode | AgentRuntimeKind::OpenCode => {
                    RuntimeProtocolKind::StreamJson
                }
                AgentRuntimeKind::Codex => RuntimeProtocolKind::Pipe,
            }
        })
    }

    /// Resolve conversation_ref for old runs. Falls back to session_id → ClaudeSession.
    pub fn resolved_conversation_ref(&self) -> Option<ConversationRef> {
        self.conversation_ref.clone().or_else(|| {
            self.session_id
                .as_ref()
                .map(|sid| ConversationRef::ClaudeSession(sid.clone()))
        })
    }

    pub fn to_task_run(
        &self,
        last_activity_at: Option<String>,
        message_count: Option<u32>,
        last_message_preview: Option<String>,
    ) -> TaskRun {
        TaskRun {
            id: self.id.clone(),
            prompt: self.prompt.clone(),
            cwd: self.cwd.clone(),
            agent: self.agent.clone(),
            auth_mode: self.auth_mode.clone(),
            status: self.status.clone(),
            started_at: self.started_at.clone(),
            ended_at: self.ended_at.clone(),
            exit_code: self.exit_code,
            error_message: self.error_message.clone(),
            last_activity_at,
            message_count,
            last_message_preview,
            session_id: self.session_id.clone(),
            result_subtype: self.result_subtype.clone(),
            model: self.model.clone(),
            parent_run_id: self.parent_run_id.clone(),
            name: self.name.clone(),
            remote_host_name: self.remote_host_name.clone(),
            remote_cwd: self.remote_cwd.clone(),
            platform_id: self.platform_id.clone(),
            platform_base_url: self.platform_base_url.clone(),
            source: self.source.clone(),
            cli_import_watermark: self.cli_import_watermark.clone(),
            cli_session_path: self.cli_session_path.clone(),
            cli_usage_incomplete: self.cli_usage_incomplete,
            no_session_persistence: self.no_session_persistence,
            execution_path: self.resolved_execution_path(),
            conversation_ref: self.resolved_conversation_ref(),
            run_surface: self.run_surface.clone(),
            folder_id: self.folder_id.clone(),
            deleted_at: self.deleted_at.clone(),
            archived_at: self.archived_at.clone(),
            creation_mode: self.creation_mode.clone(),
            worktree_path: self.worktree_path.clone(),
            worktree_branch: self.worktree_branch.clone(),
            parent_cwd: self.parent_cwd.clone(),
            scheduled_task_id: self.scheduled_task_id.clone(),
            scheduled_task_run_id: self.scheduled_task_run_id.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
