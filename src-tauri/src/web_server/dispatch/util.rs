use serde_json::{json, Value};
use std::time::Instant;

use crate::agent::attachment::AttachmentData;
use crate::agent::session_actor::ActorCommand;
use crate::models::SessionMode;
use crate::storage;
use crate::web_server::state::AppState;

/// Dispatch a JSON-RPC method call to the corresponding command handler.
/// Returns Ok(result_value) or Err(error_string).

fn extract_str(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| format!("missing required param: {}", key))
}

fn extract_u64(params: &Value, key: &str) -> Result<u64, String> {
    params
        .get(key)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("missing required param: {}", key))
}

/// Normalize top-level camelCase keys to snake_case.
/// Does NOT recurse into nested objects (preserving CLI protocol payloads).
fn normalize_top_level_keys(params: Value) -> Value {
    match params {
        Value::Object(map) => {
            let normalized: serde_json::Map<String, Value> = map
                .into_iter()
                .map(|(k, v)| (camel_to_snake(&k), v))
                .collect();
            Value::Object(normalized)
        }
        other => other,
    }
}

// ── Inline _impl functions for State-dependent commands ──

/// stop_run logic extracted from commands::runs::stop_run
async fn stop_run_impl(id: String, state: &AppState) -> Result<bool, String> {
    use crate::agent::session_actor::ActorCommand;
    use crate::models::RunStatus;

    log::debug!("[dispatch] stop_run_impl: id={}", id);

    // Try actor session first
    let actor_stopped = {
        let handle = {
            let mut map = state.sessions.lock().await;
            map.remove(&id)
        };
        if let Some(handle) = handle {
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            if handle
                .cmd_tx
                .send(ActorCommand::Stop { reply: reply_tx })
                .await
                .is_ok()
            {
                let _ = reply_rx.await;
            }
            let _ =
                tokio::time::timeout(std::time::Duration::from_secs(5), handle.join_handle).await;
            true
        } else {
            false
        }
    };

    if actor_stopped {
        if let Err(e) = crate::storage::runs::update_status(
            &id,
            RunStatus::Stopped,
            None,
            Some("Stopped by user".to_string()),
        ) {
            log::warn!("[dispatch] stop_run: failed to update status: {}", e);
        }
        return Ok(true);
    }

    // Fall through to pipe mode (Codex)
    crate::agent::stream::stop_process(&state.process_map, &id).await;
    if let Err(e) = crate::storage::runs::update_status(
        &id,
        RunStatus::Stopped,
        None,
        Some("Stopped by user".to_string()),
    ) {
        log::warn!("[dispatch] stop_run: failed to update status: {}", e);
    }
    Ok(true)
}

/// Convert a camelCase string to snake_case
fn camel_to_snake(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + 4);
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('_');
            }
            result.push(c.to_ascii_lowercase());
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
