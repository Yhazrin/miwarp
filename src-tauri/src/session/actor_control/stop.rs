//! Actor control: session start / stop / fork, get_cmd_tx, stop_actor, runtime status.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! Owns the lifecycle of a `SessionActor`: acquire `SpawnLocks` → resolve auth & remote
//! → spawn process → insert handle → send initial message.

use crate::agent::spawn_locks::SpawnLocks;
use crate::governor::ResourceGovernor;
use crate::models::{BusEvent, RunStatus};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use std::sync::Arc;

use super::reply::stop_actor;

/// Await an actor oneshot reply with a timeout.
/// Returns the inner `Result<T, String>` or a timeout/drop error.
pub(crate) async fn stop_session_impl(
    emitter: &Arc<BroadcastEmitter>,
    sessions: &crate::agent::adapter::ActorSessionMap,
    spawn_locks: &SpawnLocks,
    governor: &ResourceGovernor,
    run_id: String,
) -> Result<(), String> {
    let _guard = spawn_locks.acquire(&run_id).await;

    let was_active = stop_actor(sessions, &run_id).await?;
    if was_active {
        // Actor was active — emit stopped
        let event = BusEvent::RunState {
            run_id: run_id.clone(),
            state: "stopped".to_string(),
            exit_code: None,
            error: None,
        };
        emitter.persist_and_emit(&run_id, &event);
        storage::runs::update_status(&run_id, RunStatus::Stopped, None, None).ok();
    }

    // Resource Governor (110-S5): free the slot on user-initiated stop.
    governor.release_run(&run_id).await;
    Ok(())
}
