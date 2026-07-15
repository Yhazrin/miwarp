use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::web_server::auth;
use crate::web_server::dispatch;
use crate::web_server::state::AppState;

/// Max events to buffer during replay before triggering _full_reload
const REPLAY_BUFFER_CAPACITY: usize = 4096;
/// v1.0.6 / 3.5: WS envelope chunking.
/// `> WS_CHUNK_THRESHOLD` bytes triggers a chunk_begin / chunk{N} / chunk_end
/// triple correlated by a `msg_id`. The frontend reassembles before handing
/// the payload off to the reducer.
pub const WS_CHUNK_THRESHOLD: usize = 256 * 1024;
/// Maximum logical JSON envelope accepted by both backend and frontend.
pub const WS_MAX_MESSAGE_BYTES: usize = 10 * 1024 * 1024;
/// Per-chunk payload size (192KB leaves envelope headroom below the frame limit).
pub const WS_CHUNK_PAYLOAD: usize = 192 * 1024;
/// Maximum incoming WebSocket frame size. Logical messages may span frames.
pub const WS_MAX_FRAME_BYTES: usize = 1024 * 1024;

type WsSink = Arc<Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>;

#[derive(Deserialize, Default)]
pub struct WsQuery {
    token: Option<String>,
}

/// WebSocket upgrade handler with authentication.
/// Extracts auth info from headers (cookie) and query params (token) before upgrade.
pub async fn ws_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    let auth_subject = auth::authenticate_ws(&state, &headers, query.token.as_deref()).await;
    let Some(auth_subject) = auth_subject else {
        log::debug!("[ws] upgrade rejected: auth failed");
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    };
    log::debug!("[ws] upgrade accepted");
    ws.max_message_size(WS_MAX_MESSAGE_BYTES)
        .max_frame_size(WS_MAX_FRAME_BYTES)
        .on_upgrade(move |socket| handle_ws(socket, state, auth_subject))
}

/// Buffered event during replay — stored until replay completes so we can merge
#[derive(Debug, Clone)]
struct BufferedEvent {
    envelope: Value,
    seq: u64,
}

/// Per-connection WS session state
struct WsSession {
    /// run_id → last_seq checkpoint for each subscribed run
    subscriptions: HashMap<String, u64>,
    /// run_id → buffered events received during active replay
    replay_buffer: HashMap<String, Vec<BufferedEvent>>,
    /// run_id set currently being replayed (reentry guard)
    replaying: std::collections::HashSet<String>,
}

impl WsSession {
    fn new() -> Self {
        Self {
            subscriptions: HashMap::new(),
            replay_buffer: HashMap::new(),
            replaying: std::collections::HashSet::new(),
        }
    }
}

fn split_utf8_chunks(text: &str, max_bytes: usize) -> Result<Vec<&str>, String> {
    if max_bytes == 0 {
        return Err("chunk payload size must be greater than zero".to_string());
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + max_bytes).min(text.len());
        while end > start && !text.is_char_boundary(end) {
            end -= 1;
        }
        if end == start {
            return Err(format!(
                "chunk payload size {max_bytes} cannot contain the next UTF-8 scalar"
            ));
        }
        chunks.push(&text[start..end]);
        start = end;
    }
    Ok(chunks)
}

/// Send a JSON envelope over the WS sink, transparently chunking large payloads.
/// Chunk boundaries are always valid UTF-8 boundaries.
pub async fn send_envelope(ws_tx: &WsSink, envelope: &Value) -> Result<(), String> {
    let text = envelope.to_string();
    if text.len() > WS_MAX_MESSAGE_BYTES {
        return Err(format!(
            "ws envelope exceeds maximum size: {} > {} bytes",
            text.len(),
            WS_MAX_MESSAGE_BYTES
        ));
    }
    if text.len() <= WS_CHUNK_THRESHOLD {
        let mut guard = ws_tx.lock().await;
        guard
            .send(Message::Text(text))
            .await
            .map_err(|e| format!("ws send error: {e}"))?;
        return Ok(());
    }

    // Large envelope — split on valid UTF-8 boundaries. The frontend
    // reassembles by msg_id and verifies the declared byte size.
    let msg_id = uuid::Uuid::new_v4().to_string();
    let chunks = split_utf8_chunks(&text, WS_CHUNK_PAYLOAD)?;
    let total = chunks.len();

    // chunk_begin: empty body, but echo msg_id + total
    let begin = json!({
        "type": "chunk_begin",
        "msg_id": msg_id,
        "total": total,
        "size": text.len(),
    });
    {
        let mut guard = ws_tx.lock().await;
        guard
            .send(Message::Text(begin.to_string()))
            .await
            .map_err(|e| format!("ws send error: {e}"))?;
    }
    for (idx, chunk_text) in chunks.iter().enumerate() {
        let chunk = json!({
            "type": "chunk",
            "msg_id": msg_id,
            "idx": idx,
            "data": chunk_text,
        });
        let mut guard = ws_tx.lock().await;
        guard
            .send(Message::Text(chunk.to_string()))
            .await
            .map_err(|e| format!("ws send error: {e}"))?;
    }
    let end = json!({
        "type": "chunk_end",
        "msg_id": msg_id,
    });
    {
        let mut guard = ws_tx.lock().await;
        guard
            .send(Message::Text(end.to_string()))
            .await
            .map_err(|e| format!("ws send error: {e}"))?;
    }
    Ok(())
}

/// Send an RPC result response over WebSocket.
/// Oversized results are converted into a small string error so callers do not
/// wait until their request timeout with no explanation.
async fn send_result(ws_tx: &WsSink, id: &Option<String>, result: Value) {
    let resp = json!({"id": id, "result": result});
    if let Err(error) = send_envelope(ws_tx, &resp).await {
        log::warn!("[ws] failed to send RPC result id={id:?}: {error}");
        if error.contains("exceeds maximum size") {
            send_error(ws_tx, id, "response exceeds maximum websocket message size").await;
        }
    }
}

/// Send an RPC error response over WebSocket while preserving the existing
/// string error contract used by web, iOS and Android clients.
async fn send_error(ws_tx: &WsSink, id: &Option<String>, error: &str) {
    let resp = json!({"id": id, "error": error});
    if let Err(send_error) = send_envelope(ws_tx, &resp).await {
        log::warn!("[ws] failed to send RPC error id={id:?}: {send_error}");
    }
}

/// Handle a single WebSocket connection
async fn handle_ws(socket: WebSocket, state: AppState, auth_subject: auth::WsAuthSubject) {
    let (ws_tx, mut ws_rx) = socket.split();
    let session = Arc::new(Mutex::new(WsSession::new()));

    // Subscribe to broadcast channels
    let mut a_rx = state.broadcaster.subscribe_a();
    let mut b_rx = state.broadcaster.subscribe_b();

    // Shared write access for sending from multiple tasks
    let ws_tx: WsSink = Arc::new(Mutex::new(ws_tx));

    let ws_tx_a = ws_tx.clone();
    let ws_tx_b = ws_tx.clone();
    let session_a = session.clone();
    let session_b = session.clone();
    let state_for_read = state.clone();

    // Task: forward A-class broadcast events to WS client
    let a_forward = tokio::spawn(async move {
        loop {
            match a_rx.recv().await {
                Ok(msg) => {
                    let Some(run_id) = &msg.run_id else { continue };
                    let Some(seq) = msg.seq else { continue };

                    let mut sess = session_a.lock().await;

                    // Check if client is subscribed to this run
                    let Some(&checkpoint) = sess.subscriptions.get(run_id) else {
                        continue;
                    };

                    // If replay is in progress, buffer the event
                    if sess.replaying.contains(run_id) {
                        let buf = sess
                            .replay_buffer
                            .entry(run_id.clone())
                            .or_insert_with(Vec::new);
                        if buf.len() < REPLAY_BUFFER_CAPACITY {
                            let envelope = json!({
                                "event": msg.event_name,
                                "seq": seq,
                                "run_id": run_id,
                                "payload": msg.payload,
                            });
                            buf.push(BufferedEvent { envelope, seq });
                            log::trace!(
                                "[ws] a_forward: buffered event seq={} for run={} (replay in progress)",
                                seq,
                                run_id
                            );
                        } else {
                            log::warn!(
                                "[ws] a_forward: replay buffer overflow for run={}, will trigger _full_reload",
                                run_id
                            );
                            // Mark overflow — will be handled after replay completes
                        }
                        continue;
                    }

                    // Normal path: skip if already sent
                    if seq <= checkpoint {
                        continue;
                    }
                    drop(sess);

                    // Build envelope (include run_id for frontend checkpoint tracking)
                    let envelope = json!({
                        "event": msg.event_name,
                        "seq": seq,
                        "run_id": run_id,
                        "payload": msg.payload,
                    });

                    if send_envelope(&ws_tx_a, &envelope).await.is_err() {
                        break; // Client disconnected
                    }

                    // Update checkpoint
                    let mut sess = session_a.lock().await;
                    if let Some(cp) = sess.subscriptions.get_mut(run_id) {
                        *cp = (*cp).max(seq); // Monotonic update
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("[ws] A-channel lagged by {} events, triggering catchup", n);
                    // Catchup: replay from checkpoint for all subscribed runs
                    let mut sess = session_a.lock().await;
                    let subs: Vec<(String, u64)> = sess
                        .subscriptions
                        .iter()
                        .map(|(k, &v)| (k.clone(), v))
                        .collect();

                    // Mark only non-already-replaying runs (avoid conflicting replays)
                    let mut runs_to_replay = Vec::new();
                    for (run_id, last_seq) in &subs {
                        if !sess.replaying.contains(run_id.as_str()) {
                            sess.replaying.insert(run_id.clone());
                            sess.replay_buffer.entry(run_id.clone()).or_default();
                            runs_to_replay.push((run_id.clone(), *last_seq));
                        }
                    }
                    drop(sess);

                    for (run_id, last_seq) in &runs_to_replay {
                        if let Err(e) =
                            replay_events(&state_for_read, &ws_tx_a, &session_a, run_id, *last_seq)
                                .await
                        {
                            log::error!("[ws] catchup replay failed for run={}: {}", run_id, e);
                        }
                    }

                    // Flush buffers after replay
                    for (run_id, _) in &runs_to_replay {
                        if let Err(overflow) =
                            flush_replay_buffer(&ws_tx_a, &session_a, run_id).await
                        {
                            if overflow {
                                send_full_reload(&ws_tx_a, &session_a, run_id).await;
                            }
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Task: forward B-class broadcast events to WS client
    let b_forward = tokio::spawn(async move {
        loop {
            match b_rx.recv().await {
                Ok(msg) => {
                    // For run-scoped B events, check subscription
                    if let Some(run_id) = &msg.run_id {
                        let sess = session_b.lock().await;
                        if !sess.subscriptions.contains_key(run_id) {
                            continue; // Not subscribed
                        }
                        drop(sess);
                    }
                    // Global events (no run_id) are always sent

                    let envelope = json!({
                        "event": msg.event_name,
                        "payload": msg.payload,
                    });

                    if send_envelope(&ws_tx_b, &envelope).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    log::debug!("[ws] B-channel lagged by {} events (expected, skipping)", n);
                    // B-class lag is expected and harmless — just continue
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Task: read client messages and dispatch commands
    let ws_tx_cmd = ws_tx.clone();
    let session_cmd = session.clone();
    let state_cmd = state.clone();

    let cmd_loop = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    let text_str: &str = &text;
                    let parsed: Value = match serde_json::from_str(text_str) {
                        Ok(v) => v,
                        Err(e) => {
                            send_error(&ws_tx_cmd, &None, &format!("invalid JSON: {}", e)).await;
                            continue;
                        }
                    };

                    let id = parsed.get("id").and_then(|v| v.as_str()).map(String::from);
                    let method = parsed.get("method").and_then(|v| v.as_str()).unwrap_or("");
                    let params = parsed.get("params").cloned().unwrap_or(json!({}));

                    log::debug!("[ws] dispatch: method={}, id={:?}", method, id);

                    // Handle internal protocol methods
                    match method {
                        "_subscribe" => {
                            let run_id =
                                params.get("run_id").and_then(|v| v.as_str()).unwrap_or("");
                            let last_seq =
                                params.get("last_seq").and_then(|v| v.as_u64()).unwrap_or(0);

                            if run_id.is_empty() {
                                send_error(&ws_tx_cmd, &id, "run_id required").await;
                                continue;
                            }

                            log::debug!(
                                "[ws] _subscribe: run_id={}, last_seq={}",
                                run_id,
                                last_seq
                            );

                            // Register subscription + mark replay in progress
                            let (already_replaying, effective_seq) = {
                                let mut sess = session_cmd.lock().await;
                                let already = sess.replaying.contains(run_id);
                                // Monotonic checkpoint: don't regress
                                let old_seq = sess.subscriptions.get(run_id).copied().unwrap_or(0);
                                let effective_seq = old_seq.max(last_seq);
                                sess.subscriptions.insert(run_id.to_string(), effective_seq);
                                if !already {
                                    sess.replaying.insert(run_id.to_string());
                                    sess.replay_buffer.entry(run_id.to_string()).or_default();
                                }
                                (already, effective_seq)
                            };

                            // Reentry: another _subscribe for the same run is already replaying
                            if already_replaying {
                                log::debug!(
                                    "[ws] _subscribe: already replaying run={}, checkpoint updated",
                                    run_id
                                );
                                send_result(
                                    &ws_tx_cmd,
                                    &id,
                                    json!({"status": "already_replaying"}),
                                )
                                .await;
                                continue;
                            }

                            // Replay events since effective_seq (not last_seq — avoids re-sending)
                            if let Err(e) = replay_events(
                                &state_cmd,
                                &ws_tx_cmd,
                                &session_cmd,
                                run_id,
                                effective_seq,
                            )
                            .await
                            {
                                log::error!("[ws] replay failed for run={}: {}", run_id, e);
                                // Clean up replay state so run isn't stuck
                                let mut sess = session_cmd.lock().await;
                                sess.replay_buffer.remove(run_id);
                                sess.replaying.remove(run_id);
                                drop(sess);
                                send_error(&ws_tx_cmd, &id, "replay failed").await;
                                continue;
                            }

                            // Flush buffer after replay
                            match flush_replay_buffer(&ws_tx_cmd, &session_cmd, run_id).await {
                                Err(true) => {
                                    // Buffer overflow — send _full_reload
                                    send_full_reload(&ws_tx_cmd, &session_cmd, run_id).await;
                                }
                                Err(false) => {
                                    log::error!(
                                        "[ws] flush_replay_buffer send error for run={}",
                                        run_id
                                    );
                                }
                                Ok(()) => {}
                            }

                            send_result(&ws_tx_cmd, &id, json!({"ok": true})).await;
                        }
                        "_unsubscribe" => {
                            let run_id =
                                params.get("run_id").and_then(|v| v.as_str()).unwrap_or("");

                            log::debug!("[ws] _unsubscribe: run_id={}", run_id);

                            let mut sess = session_cmd.lock().await;
                            sess.subscriptions.remove(run_id);
                            sess.replay_buffer.remove(run_id);
                            sess.replaying.remove(run_id);

                            send_result(&ws_tx_cmd, &id, json!({"ok": true})).await;
                        }
                        _ => {
                            // Dispatch to command handler
                            let result =
                                dispatch::dispatch_command(method, params, &state_cmd).await;

                            match result {
                                Ok(value) => send_result(&ws_tx_cmd, &id, value).await,
                                Err(err) => send_error(&ws_tx_cmd, &id, &err).await,
                            }
                        }
                    }
                }
                Message::Close(_) => {
                    log::debug!("[ws] client sent close frame");
                    break;
                }
                _ => {} // Ignore binary, ping, pong
            }
        }
    });

    // Extract session_id for heartbeat expiry checking
    let ws_session_id = match &auth_subject {
        auth::WsAuthSubject::Session(sid) => Some(sid.clone()),
        auth::WsAuthSubject::QueryToken => None,
    };

    // Task: periodic heartbeat + token rotation + session expiry check
    let state_hb = state.clone();
    let ws_tx_hb = ws_tx.clone();

    let heartbeat_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        let session_token_ver = state_hb
            .token_version
            .load(std::sync::atomic::Ordering::Relaxed);
        let mut shutdown_rx = state_hb.ws_shutdown.subscribe();
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    // Check token version mismatch
                    let current_ver = state_hb
                        .token_version
                        .load(std::sync::atomic::Ordering::Relaxed);
                    if current_ver != session_token_ver {
                        log::debug!("[ws] heartbeat: token_version mismatch, closing");
                        let _ = ws_tx_hb
                            .lock()
                            .await
                            .send(Message::Close(Some(
                                axum::extract::ws::CloseFrame {
                                    code: 4401,
                                    reason: "token_version_mismatch".into(),
                                },
                            )))
                            .await;
                        return;
                    }
                    // Check session expiry (cookie-auth connections only)
                    if let Some(ref sid) = ws_session_id {
                        let expired = {
                            let sessions = state_hb.http_sessions.lock().await;
                            sessions
                                .get(sid.as_str())
                                .map(|e| chrono::Utc::now() >= e.expires_at)
                                .unwrap_or(true)
                        };
                        if expired {
                            log::debug!("[ws] heartbeat: session expired, closing");
                            let _ = ws_tx_hb
                                .lock()
                                .await
                                .send(Message::Close(Some(
                                    axum::extract::ws::CloseFrame {
                                        code: 4401,
                                        reason: "session_expired".into(),
                                    },
                                )))
                                .await;
                            return;
                        }
                    }
                    // Send ping keepalive
                    let _ = ws_tx_hb.lock().await.send(Message::Ping(vec![])).await;
                }
                _ = shutdown_rx.recv() => {
                    log::debug!("[ws] token rotated, closing connection");
                    let _ = ws_tx_hb
                        .lock()
                        .await
                        .send(Message::Close(Some(
                            axum::extract::ws::CloseFrame {
                                code: 4401,
                                reason: "token_rotated".into(),
                            },
                        )))
                        .await;
                    return;
                }
            }
        }
    });

    // Wait for any task to finish (client disconnect or channel close)
    tokio::select! {
        _ = a_forward => {},
        _ = b_forward => {},
        _ = cmd_loop => {},
        _ = heartbeat_task => {
            log::debug!("[ws] heartbeat/shutdown triggered connection close");
        },
    }

    log::debug!("[ws] connection closed");
}

/// Flush the replay buffer for a run: send buffered events with seq > checkpoint,
/// update checkpoint monotonically, then clear replay state.
///
/// Returns Ok(()) on success, Err(true) on buffer overflow, Err(false) on send failure.
async fn flush_replay_buffer(
    ws_tx: &WsSink,
    session: &Arc<Mutex<WsSession>>,
    run_id: &str,
) -> Result<(), bool> {
    let mut total_flushed = 0u64;
    let mut max_seq = 0u64;

    // Loop: each iteration drains the buffer while `replaying` stays true.
    // a_forward keeps buffering new events during sends (no out-of-order risk).
    // When buffer is empty, we atomically clear `replaying` in the same lock — no window.
    // Converges fast: each iteration's buffer is smaller (typically 2-3 rounds max).
    loop {
        let (buffer, checkpoint) = {
            let mut sess = session.lock().await;
            let buffer = sess.replay_buffer.remove(run_id).unwrap_or_default();

            // Empty → atomically clear replaying + update checkpoint and exit
            if buffer.is_empty() {
                sess.replaying.remove(run_id);
                if max_seq > 0 {
                    if let Some(cp) = sess.subscriptions.get_mut(run_id) {
                        *cp = (*cp).max(max_seq);
                    }
                }
                break;
            }

            // Overflow → clear replaying and signal full_reload
            if buffer.len() >= REPLAY_BUFFER_CAPACITY {
                sess.replaying.remove(run_id);
                log::debug!(
                    "[ws] flush_replay_buffer: overflow for run={}, buffer_len={}",
                    run_id,
                    buffer.len()
                );
                return Err(true);
            }

            let checkpoint = sess.subscriptions.get(run_id).copied().unwrap_or(0);
            (buffer, checkpoint)
        };
        // replaying still true → a_forward continues buffering, no out-of-order

        let effective_checkpoint = checkpoint.max(max_seq);
        for event in &buffer {
            if event.seq <= effective_checkpoint {
                continue;
            }
            if send_envelope(ws_tx, &event.envelope).await.is_err() {
                let mut sess = session.lock().await;
                sess.replaying.remove(run_id);
                return Err(false);
            }
            max_seq = max_seq.max(event.seq);
            total_flushed += 1;
        }

        // Update checkpoint after this batch (before next iteration's lock)
        {
            let mut sess = session.lock().await;
            if let Some(cp) = sess.subscriptions.get_mut(run_id) {
                *cp = (*cp).max(max_seq);
            }
        }
    }

    if total_flushed > 0 {
        log::debug!(
            "[ws] flush_replay_buffer: run={}, flushed={} events, new_checkpoint={}",
            run_id,
            total_flushed,
            max_seq
        );
    }

    Ok(())
}

/// Send a _full_reload event to the client.
/// The client owns single-flight reload coalescing; the server must not suppress
/// a later overflow with a time-based cooldown because that would hide data loss.
async fn send_full_reload(ws_tx: &WsSink, _session: &Arc<Mutex<WsSession>>, run_id: &str) {
    let envelope = json!({
        "event": "_full_reload",
        "run_id": run_id,
    });
    log::debug!("[ws] sending _full_reload for run={}", run_id);
    let _ = send_envelope(ws_tx, &envelope).await;
}

/// Replay A-class events from events.jsonl since `last_seq` for a given run.
async fn replay_events(
    _state: &AppState,
    ws_tx: &WsSink,
    session: &Arc<Mutex<WsSession>>,
    run_id: &str,
    last_seq: u64,
) -> Result<(), String> {
    // list_bus_events already filters by since_seq > last_seq.
    // Run on a blocking thread to avoid stalling the tokio runtime on large files.
    let run_id_owned = run_id.to_string();
    let events = tokio::task::spawn_blocking(move || {
        crate::storage::events::list_bus_events(&run_id_owned, Some(last_seq))
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {}", e))?;

    let replayed = events.len();
    for event in &events {
        let seq = event.get("_seq").and_then(|v| v.as_u64()).unwrap_or(0);

        let envelope = json!({
            "event": "bus-event",
            "seq": seq,
            "run_id": run_id,
            "payload": event,
        });

        if send_envelope(ws_tx, &envelope).await.is_err() {
            return Err("WS send failed during replay".to_string());
        }

        // Update checkpoint (monotonic)
        if seq > 0 {
            let mut sess = session.lock().await;
            if let Some(cp) = sess.subscriptions.get_mut(run_id) {
                *cp = (*cp).max(seq);
            }
        }
    }

    log::debug!(
        "[ws] replay: run_id={}, from_seq={}, replayed={} events",
        run_id,
        last_seq,
        replayed
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{split_utf8_chunks, WS_CHUNK_PAYLOAD};

    #[test]
    fn utf8_chunks_round_trip_ascii() {
        let text = "abcdefghijklmnopqrstuvwxyz";
        let chunks = split_utf8_chunks(text, 7).expect("split should succeed");

        assert_eq!(chunks.concat(), text);
        assert!(chunks.iter().all(|chunk| chunk.len() <= 7));
    }

    #[test]
    fn utf8_chunks_never_split_multibyte_scalars() {
        let text = "ab你🙂cd界ef";
        let chunks = split_utf8_chunks(text, 5).expect("split should succeed");

        assert_eq!(chunks.concat(), text);
        assert!(chunks.iter().all(|chunk| chunk.len() <= 5));
        assert!(chunks
            .iter()
            .all(|chunk| chunk.is_char_boundary(chunk.len())));
    }

    #[test]
    fn utf8_chunks_handle_payload_boundary_next_to_emoji() {
        let prefix = "a".repeat(WS_CHUNK_PAYLOAD - 1);
        let text = format!("{prefix}🙂tail");
        let chunks = split_utf8_chunks(&text, WS_CHUNK_PAYLOAD).expect("split should succeed");

        assert_eq!(chunks.concat(), text);
        assert_eq!(chunks[0].len(), WS_CHUNK_PAYLOAD - 1);
        assert!(chunks.iter().all(|chunk| chunk.len() <= WS_CHUNK_PAYLOAD));
    }

    #[test]
    fn utf8_chunks_reject_zero_payload_size() {
        assert!(split_utf8_chunks("abc", 0).is_err());
    }

    #[test]
    fn utf8_chunks_reject_payload_smaller_than_next_scalar() {
        assert!(split_utf8_chunks("🙂", 3).is_err());
    }
}
