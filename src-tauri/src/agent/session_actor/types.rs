//! Session Actor — single owner of a Claude CLI session's entire lifecycle.
//!
//! One actor per run_id. All session mutations (send, control, stop) go through
//! the actor's mailbox (bounded mpsc channel), guaranteeing sequential execution
//! without external locks. The actor owns the process, stdin, stdout/stderr readers,
//! protocol state, and RunState emission — eliminating the cross-system coordination
//! that previously caused race conditions.

use crate::agent::adapter::ActorSessionMap;
use crate::agent::attachment::AttachmentData;
use crate::agent::claude_protocol::{validate_bus_event, ProtocolState};
use crate::agent::notify::notify_if_background;
use crate::agent::recovery::{CrashReason, RecoveryState};
use crate::agent::runtime_recovery::{
    classify_active_turn_eof, emit_session_lifecycle, on_actor_exit, ActorRecoveryBootstrap,
    ActorRecoverySnapshot, PendingRecoveryMessage, RecoveryRegistry,
};
use crate::agent::turn_engine::{
    apply_activity_reset, ActiveTurn, TurnOrigin, TurnPhase, UserTurnKind, UserTurnTicket,
    ACCEPTED_CLIENT_MESSAGE_IDS_CAP, PROTOCOL_DESYNC_THRESHOLD, PROTOCOL_DESYNC_WINDOW_SECS,
    QUARANTINE_DEADLINE, QUEUED_USER_CAP, STOP_ESCALATION_KILL, TICK_INTERVAL, USER_HARD_TIMEOUT,
    USER_SOFT_TIMEOUT,
};
use crate::models::{
    max_attachment_size, now_iso, AgentRuntimeKind, BusEvent, RalphCompleteReason, RunStatus,
    ALLOWED_DOC_TYPES, ALLOWED_IMAGE_TYPES,
};
use crate::storage;
use crate::storage::runs;
use crate::storage::shared;
use crate::web_server::broadcaster::BroadcastEmitter;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;

pub struct RalphCancelResult {
    pub iteration: u32,
    pub immediate: bool,
}

/// Tracks a pending interactive control request (permission, hook, elicitation)
/// that was forwarded to the frontend and is waiting for user response.
/// Used for diagnosing hard-timeout causes.
#[derive(Debug)]
struct PendingInteractiveRequest {
    request_id: String,
    /// "can_use_tool" | "hook_callback" | "elicitation"
    subtype: String,
    /// tool_name / hook event / server name
    detail: String,
    received_at: Instant,
}

// ── Public types ──

// `AttachmentData` lives in `crate::agent::attachment` (leaf module) so
// `session_actor` and `runtime_recovery` can both depend on it without
// creating an import cycle.

/// Commands sent to the actor via its mailbox.
pub enum ActorCommand {
    SendMessage {
        text: String,
        attachments: Vec<AttachmentData>,
        reply: oneshot::Sender<Result<(), String>>,
        /// v1.0.9: optional client-side idempotency token.
        client_message_id: Option<String>,
    },
    /// Two-phase control: actor writes stdin + registers waiter → returns (request_id, response_rx).
    /// Caller awaits response_rx outside the actor to avoid deadlocking the select! loop.
    SendControl {
        request: Value,
        reply: oneshot::Sender<Result<(String, oneshot::Receiver<Value>), String>>,
    },
    Stop {
        /// P0-6: the actor returns `ActorStopReason::UserRequested` on
        /// success so callers (IPC layer, recovery registry) can
        /// distinguish user intent from infrastructure failures without
        /// re-deriving the cause from flags after the fact.
        reply: oneshot::Sender<Result<ActorStopReason, String>>,
    },
    /// Inline permission response: write control_response back to CLI stdin.
    /// Used with `--permission-prompt-tool stdio` (Phase 2).
    RespondPermission {
        request_id: String,
        response: Value,
        tool_name: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Cancel a pending control_request (top-level message type, not a control_request subtype).
    CancelControlRequest {
        request_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Hook callback response: write control_response back to CLI stdin.
    RespondHookCallback {
        request_id: String,
        response: Value,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// MCP elicitation response: write control_response back to CLI stdin.
    RespondElicitation {
        request_id: String,
        response: Value,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Start a Ralph loop (auto-iterate same prompt until completion).
    StartRalphLoop {
        prompt: String,
        max_iterations: u32,
        completion_promise: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Cancel an active Ralph loop.
    CancelRalphLoop {
        reply: oneshot::Sender<Result<RalphCancelResult, String>>,
    },
    /// Wait until the CLI has produced its first output (proving it's alive and initialized).
    /// Used after spawning a resume actor to replace fixed sleeps.
    WaitReady {
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// One-shot title generation: spawn `claude --print` tied to the actor's
    /// own process tree (kill_on_drop on the spawned Child ensures the title
    /// process is cleaned up when the actor is dropped or the run is stopped).
    /// The spawned process is a sibling of the long-lived `claude` session
    /// (it is NOT a child of the long-lived `claude` process) — but because
    /// it is owned by the actor task, it dies with the actor. The reply
    /// carries the normalized title on success.
    GenerateTitle {
        prompt: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
}

/// External handle held in SessionMap. Provides the channel sender + metadata.
pub struct SessionActorHandle {
    pub cmd_tx: mpsc::Sender<ActorCommand>,
    pub run_id: String,
    /// Identity tag — shared Arc with the actor. cleanup uses Arc::ptr_eq to
    /// verify the map entry is still "us" (not a replacement actor).
    pub tag: Arc<()>,
    pub join_handle: tokio::task::JoinHandle<()>,
    /// Fires when the actor exits (normal or abnormal). Callers can await this
    /// to know when it's safe to spawn a replacement.
    pub shutdown_rx: oneshot::Receiver<()>,
}

/// Reason the actor loop exited. Propagated through the `Stop` reply
/// channel and the recovery snapshot so callers (cleanup, recovery
/// registry, IPC handlers) can distinguish user intent from infrastructure
/// failures without re-deriving the cause from flags.
///
/// `UserRequested` = explicit stop via IPC (`ActorCommand::Stop`) — the
/// CLI child process was reaped because the user asked for it.
///
/// `Cancelled` = the actor's parent cancellation token fired (app exit /
/// server shutdown). Treat the same as user-stopped for state-machine
/// purposes, but the recovery registry skips re-spawn.
///
/// `StreamEof` = natural EOF (no user intent). For natural EOF the
/// protocol layer already emitted a terminal `RunState` (`idle` /
/// `failed`) — `cleanup` does not need to emit a second one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorStopReason {
    UserRequested,
    Cancelled,
    StreamEof,
}

/// Internal source of a stop request. `request_stop` accepts this so the
/// actor records *which* path called it and can produce a typed
/// `ActorStopReason` for the reply / recovery snapshot / `cleanup`.
///
/// Distinct from `ActorStopReason` (the public-facing return type) so
/// internal callers don't have to construct a public DTO just to stop
/// the actor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StopSource {
    /// Explicit `ActorCommand::Stop` from the IPC layer — user click.
    User,
    /// External cancellation token (app exit / server shutdown).
    Cancel,
    /// Natural stdout EOF (no user intent). The actor itself stamps
    /// this in `handle_eof` when it observes EOF without having been
    /// asked to stop.
    Eof,
}

impl StopSource {
    fn reason(self) -> ActorStopReason {
        match self {
            StopSource::User => ActorStopReason::UserRequested,
            StopSource::Cancel => ActorStopReason::Cancelled,
            StopSource::Eof => ActorStopReason::StreamEof,
        }
    }
}

// ── Actor internals ──

/// The actor's private state. Runs in a single tokio task.
