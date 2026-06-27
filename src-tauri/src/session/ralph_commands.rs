//! Ralph Loop: autonomous retry / continue commands routed through the SessionActor.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).

use crate::agent::adapter::ActorSessionMap;
use crate::agent::session_actor::{ActorCommand, RalphCancelResult};

use super::actor_control::{await_actor_reply, get_cmd_tx, ACTOR_REPLY_TIMEOUT_MS};

pub(crate) async fn start_ralph_loop_impl(
    sessions: &ActorSessionMap,
    run_id: String,
    prompt: String,
    max_iterations: u32,
    completion_promise: Option<String>,
) -> Result<(), String> {
    log::debug!(
        "[session] start_ralph_loop: run_id={}, prompt_len={}, max_iterations={}, promise={:?}",
        run_id,
        prompt.len(),
        max_iterations,
        completion_promise
    );

    let cmd_tx = get_cmd_tx(sessions, &run_id).await?;

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::StartRalphLoop {
            prompt,
            max_iterations,
            completion_promise,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Actor dead".to_string())?;

    await_actor_reply(reply_rx, "start_ralph_loop", ACTOR_REPLY_TIMEOUT_MS).await
}

pub(crate) async fn cancel_ralph_loop_impl(
    sessions: &ActorSessionMap,
    run_id: String,
) -> Result<RalphCancelResult, String> {
    log::debug!("[session] cancel_ralph_loop: run_id={}", run_id);

    let cmd_tx = get_cmd_tx(sessions, &run_id).await?;

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::CancelRalphLoop { reply: reply_tx })
        .await
        .map_err(|_| "Actor dead".to_string())?;

    await_actor_reply(reply_rx, "cancel_ralph_loop", ACTOR_REPLY_TIMEOUT_MS).await
}
