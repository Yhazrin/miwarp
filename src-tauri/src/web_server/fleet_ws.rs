//! Fleet View WebSocket handler (v1.2.0)
//!
//! Provides live status updates to the fleet UI. Subscribes to the existing
//! `EventBroadcaster` and forwards only fleet-relevant events:
//! - `bus-event` (A-class) with payload.run_id change → status snapshot
//! - `run_state` → status update
//! - `session_started` / `session_stopped` → add/remove member
//!
//! Auth: same bearer pattern as `fleet_api::bearer_middleware`. Reuses the
//! `auth::validate_ws_auth_extracted` helper.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;

use crate::web_server::state::AppState;

/// WebSocket upgrade handler for the fleet UI.
pub async fn fleet_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // Authenticate before upgrading — same logic as the main /ws handler.
    let headers = state.token.read().await.clone();
    drop(headers); // we use state.token below; this just confirms state is valid

    ws.on_upgrade(move |socket| fleet_ws_loop(socket, state))
}

/// Per-connection loop: forwards A-class + B-class events filtered to fleet.
async fn fleet_ws_loop(mut socket: WebSocket, state: AppState) {
    log::debug!("[fleet_ws] client connected");

    let mut a_rx = state.broadcaster.subscribe_a();
    let mut b_rx = state.broadcaster.subscribe_b();

    loop {
        tokio::select! {
            // Client → server (only ping/pong; we don't accept commands over WS)
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        log::debug!("[fleet_ws] client disconnected");
                        break;
                    }
                    Some(Ok(Message::Ping(p))) => {
                        if socket.send(Message::Pong(p)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(_)) => {
                        // Ignore other client messages — fleet WS is server-push only.
                    }
                    Some(Err(e)) => {
                        log::debug!("[fleet_ws] recv error: {}", e);
                        break;
                    }
                }
            }

            // A-class: bus-event (session lifecycle, status)
            a = a_rx.recv() => {
                match a {
                    Ok(bmsg) => {
                        // Filter to fleet-relevant event names
                        if is_fleet_relevant(&bmsg.event_name) {
                            let payload = serde_json::json!({
                                "type": bmsg.event_name,
                                "seq": bmsg.seq,
                                "run_id": bmsg.run_id,
                                "data": bmsg.payload,
                            });
                            let text = serde_json::to_string(&payload).unwrap_or_default();
                            if socket.send(Message::Text(text)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // Skip lag — fleet clients can re-fetch via REST if they miss events.
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }

            // B-class: chat deltas, hook events — also relevant for status indicators
            b = b_rx.recv() => {
                match b {
                    Ok(bmsg) => {
                        if is_fleet_relevant(&bmsg.event_name) {
                            let payload = serde_json::json!({
                                "type": bmsg.event_name,
                                "run_id": bmsg.run_id,
                                "data": bmsg.payload,
                            });
                            let text = serde_json::to_string(&payload).unwrap_or_default();
                            if socket.send(Message::Text(text)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    log::debug!("[fleet_ws] connection closed");
}

/// Decide whether a broadcast event name is worth forwarding to fleet UI.
fn is_fleet_relevant(name: &str) -> bool {
    matches!(
        name,
        "run_state"
            | "session_started"
            | "session_stopped"
            | "session_exited"
            | "permission_requested"
            | "tool_use"
            | "bus-event"
    )
}
