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

pub fn spawn_actor(
    emitter: Arc<BroadcastEmitter>,
    sessions: ActorSessionMap,
    run_id: String,
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    is_resume: bool,
    cancel: CancellationToken,
    initial_turn_index: u32,
    initial_auto_ctx_id: u32,
    recovery_registry: Option<RecoveryRegistry>,
    recovery_bootstrap: Option<ActorRecoveryBootstrap>,
) -> SessionActorHandle {
    spawn_actor_with_runtime(
        emitter,
        sessions,
        run_id,
        child,
        stdin,
        stdout,
        stderr,
        is_resume,
        cancel,
        initial_turn_index,
        initial_auto_ctx_id,
        AgentRuntimeKind::ClaudeCode,
        recovery_registry,
        recovery_bootstrap,
    )
}

/// Spawn a new session actor with explicit runtime kind.
#[allow(clippy::too_many_arguments)]
pub fn spawn_actor_with_runtime(
    emitter: Arc<BroadcastEmitter>,
    sessions: ActorSessionMap,
    run_id: String,
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    is_resume: bool,
    cancel: CancellationToken,
    initial_turn_index: u32,
    initial_auto_ctx_id: u32,
    runtime_kind: AgentRuntimeKind,
    recovery_registry: Option<RecoveryRegistry>,
    recovery_bootstrap: Option<ActorRecoveryBootstrap>,
) -> SessionActorHandle {
    let tag = Arc::new(());
    let (cmd_tx, cmd_rx) = mpsc::channel::<ActorCommand>(64);
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (ready_tx, _ready_rx) = tokio::sync::watch::channel(false);
    drop(_ready_rx); // WaitReady commands create their own receivers from ready_tx
                     // P0-C4: stop-escalation channel. The actor starts with `None`
                     // (no escalation scheduled); `request_stop` allocates a fresh
                     // (tx, rx) pair each time and rotates the receiver into the
                     // struct so the main `select!` can poll it. The sender is moved
                     // into the spawned timer task — when the timer fires, the
                     // receiver unblocks and the actor calls `child.start_kill()`.

    let (
        accepted_client_message_ids,
        next_turn_index,
        next_auto_ctx_id,
        next_turn_seq,
        connection_generation,
        session_id,
    ) = if let Some(bootstrap) = recovery_bootstrap {
        (
            bootstrap.accepted_ledger,
            bootstrap.next_turn_index,
            bootstrap.next_auto_ctx_id,
            bootstrap.next_turn_seq,
            bootstrap.connection_generation,
            bootstrap.session_id,
        )
    } else {
        (
            VecDeque::new(),
            initial_turn_index,
            initial_auto_ctx_id,
            0,
            0,
            None,
        )
    };

    log::debug!(
        "[actor] spawn: run_id={}, is_resume={}, initial_turn_index={}, initial_auto_ctx_id={}",
        run_id,
        is_resume,
        initial_turn_index,
        initial_auto_ctx_id
    );

    let actor = SessionActor {
        emitter,
        sessions,
        run_id: run_id.clone(),
        tag: tag.clone(),
        protocol: ProtocolState::with_runtime(is_resume, runtime_kind),
        state: String::new(),
        stdin: Some(stdin),
        child: Some(child),
        cancel,
        pending_interrupt: false,
        control_waiters: HashMap::new(),
        shutdown_tx: Some(shutdown_tx),
        // Turn Transaction Engine
        active_turn: None,
        queued_user: VecDeque::new(),
        accepted_client_message_ids,
        next_turn_index,
        next_auto_ctx_id,
        next_turn_seq,
        quarantine_until_result: false,
        quarantine_deadline: None,
        interrupt_sent_for_quarantine: false,
        terminated: false,
        json_parse_fail_count: 0,
        parse_fail_window: Vec::new(),
        desync_emitted: false,
        ralph_loop: None,
        ralph_needs_dispatch: false,
        pending_interactive_request: None,
        ready_tx,
        recovery_registry,
        connection_generation,
        session_id,
        crash_reason: None,
        user_stopped: false,
        recoverable_exit: false,
        exit_code: None,
        pending_unaccepted_for_recovery: VecDeque::new(),
        last_stop_reason: None,
        stop_kill_rx: None,
    };

    let join_handle = tokio::spawn(async move {
        actor.run(cmd_rx, stdout, stderr).await;
    });

    SessionActorHandle {
        cmd_tx,
        run_id,
        tag,
        join_handle,
        shutdown_rx,
    }
}

// ── Actor main loop ──

