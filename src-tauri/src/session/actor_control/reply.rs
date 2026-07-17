//! Actor control: session start / stop / fork, get_cmd_tx, stop_actor, runtime status.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! Owns the lifecycle of a `SessionActor`: acquire `SpawnLocks` → resolve auth & remote
//! → spawn process → insert handle → send initial message.

use crate::agent::adapter::{self, AdapterSettings};
use crate::agent::attachment::AttachmentData;
use crate::agent::claude_stream;
use crate::agent::session_actor::{self, ActorCommand};
use crate::agent::spawn_locks::SpawnLocks;
use crate::governor::{Admission, ResourceGovernor};
use crate::models::{AgentRuntimeKind, BusEvent, RunMeta, RunStatus, SessionMode};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Default timeout for actor replies (permission, elicitation, hook callback, etc.)
pub(crate) const ACTOR_REPLY_TIMEOUT_MS: u64 = 30_000;
/// Timeout for `send_message` actor replies (may need to wait for turn dispatch)
pub(crate) const ACTOR_SEND_TIMEOUT_MS: u64 = 45_000;
/// Timeout for `WaitReady` after actor spawn
pub(crate) const ACTOR_READY_TIMEOUT_MS: u64 = 5_000;

/// Await an actor oneshot reply with a timeout.
/// Returns the inner `Result<T, String>` or a timeout/drop error.

pub(crate) async fn await_actor_reply<T>(
    rx: tokio::sync::oneshot::Receiver<Result<T, String>>,
    label: &str,
    timeout_ms: u64,
) -> Result<T, String> {
    match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
        Ok(Ok(Ok(v))) => Ok(v),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err(format!("Actor dropped reply: {}", label)),
        Err(_) => Err(format!("Actor reply timeout ({timeout_ms}ms): {label}")),
    }
}

/// Helper: get the actor command sender for a `run_id`.
pub(crate) async fn get_cmd_tx(
    sessions: &crate::agent::adapter::ActorSessionMap,
    run_id: &str,
) -> Result<tokio::sync::mpsc::Sender<ActorCommand>, String> {
    let map = sessions.lock().await;
    map.get(run_id)
        .map(|h| h.cmd_tx.clone())
        .ok_or_else(|| format!("Session {} not found", run_id))
}

/// Helper: stop an existing actor for a `run_id`, await its shutdown.
/// Returns `true` if an actor was stopped.
pub(crate) async fn stop_actor(
    sessions: &crate::agent::adapter::ActorSessionMap,
    run_id: &str,
) -> Result<bool, String> {
    let handle = {
        let mut map = sessions.lock().await;
        map.remove(run_id)
    };

    let Some(handle) = handle else {
        return Ok(false);
    };

    log::debug!("[session] stopping actor for run_id={}", run_id);

    // Send Stop command
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    if handle
        .cmd_tx
        .send(ActorCommand::Stop { reply: reply_tx })
        .await
        .is_ok()
    {
        // Wait for reply (actor acknowledged stop)
        let _ = reply_rx.await;
    }

    // Wait for actor task to finish (with timeout)
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), handle.join_handle).await;

    Ok(true)
}

#[allow(clippy::too_many_arguments)]
