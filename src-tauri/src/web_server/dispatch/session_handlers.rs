use serde_json::{json, Value};

use crate::agent::attachment::AttachmentData;
use crate::agent::session_actor::ActorCommand;
use crate::models::SessionMode;
use crate::web_server::state::AppState;

use super::middleware::extract_str;

// ── Session management ──

pub async fn handle_session(
    method: &str,
    params: Value,
    state: &AppState,
) -> Result<Value, String> {
    match method {
        "start_session" => {
            let run_id = extract_str(&params, "run_id")?;
            let mode: Option<SessionMode> = params
                .get("mode")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let session_id = params
                .get("session_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let initial_message = params
                .get("initial_message")
                .and_then(|v| v.as_str())
                .map(String::from);
            let attachments: Option<Vec<AttachmentData>> = params
                .get("attachments")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let platform_id = params
                .get("platform_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let permission_mode_override = params
                .get("permission_mode_override")
                .and_then(|v| v.as_str())
                .map(String::from);
            let client_message_id: Option<String> = params
                .get("client_message_id")
                .and_then(|v| v.as_str().map(|s| s.to_string()));
            crate::commands::session::start_session_impl(
                &state.emitter,
                &state.sessions,
                &state.spawn_locks,
                &state.cancel_token,
                &state.recovery_registry,
                &state.governor,
                run_id,
                mode,
                session_id,
                initial_message,
                attachments,
                platform_id,
                permission_mode_override,
                client_message_id,
            )
            .await?;
            Ok(json!(true))
        }
        "send_session_message" => {
            let run_id = extract_str(&params, "run_id")?;
            let message = extract_str(&params, "message")?;
            let attachments: Vec<AttachmentData> = params
                .get("attachments")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let client_message_id: Option<String> = params
                .get("client_message_id")
                .and_then(|v| v.as_str().map(|s| s.to_string()));
            log::debug!(
                "[dispatch] send_session_message: run_id={}, msg_len={}, attachments={}, client_message_id={:?}",
                run_id,
                message.len(),
                attachments.len(),
                client_message_id,
            );
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::SendMessage {
                    text: message,
                    attachments,
                    reply: reply_tx,
                    client_message_id: None,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            Ok(json!(true))
        }
        "stop_session" => {
            let run_id = extract_str(&params, "run_id")?;
            crate::commands::session::stop_session_impl(
                &state.emitter,
                &state.sessions,
                &state.spawn_locks,
                &state.governor,
                run_id,
            )
            .await?;
            Ok(json!(true))
        }
        "send_session_control" => {
            let run_id = extract_str(&params, "run_id")?;
            let subtype = extract_str(&params, "subtype")?;
            let ctrl_params = params.get("params").cloned();
            log::debug!(
                "[dispatch] send_session_control: run_id={}, subtype={}",
                run_id,
                subtype
            );
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let mut request = json!({ "subtype": subtype });
            if let Some(p) = ctrl_params {
                if let Some(obj) = p.as_object() {
                    for (k, v) in obj {
                        request[k] = v.clone();
                    }
                }
            }
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::SendControl {
                    request,
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            let (request_id, response_rx) = reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            match tokio::time::timeout(std::time::Duration::from_secs(10), response_rx).await {
                Ok(Ok(response)) => {
                    log::debug!(
                        "[dispatch] control response received for req_id={}",
                        request_id
                    );
                    Ok(response)
                }
                Ok(Err(_)) => Err("Control response channel closed".to_string()),
                Err(_) => Err("Timeout waiting for control response".to_string()),
            }
        }
        "fork_session" => {
            let run_id = extract_str(&params, "run_id")?;
            let new_id = crate::commands::session::fork_session_impl(
                &state.emitter,
                &state.sessions,
                &state.spawn_locks,
                run_id,
            )
            .await?;
            Ok(json!(new_id))
        }
        "approve_session_tool" => {
            let run_id = extract_str(&params, "run_id")?;
            let tool_name = extract_str(&params, "tool_name")?;
            crate::commands::session::approve_session_tool_impl(
                &state.emitter,
                &state.sessions,
                &state.spawn_locks,
                &state.cancel_token,
                run_id,
                tool_name,
            )
            .await?;
            Ok(json!(true))
        }
        "respond_permission" => {
            let run_id = extract_str(&params, "run_id")?;
            let request_id = extract_str(&params, "request_id")?;
            let behavior = extract_str(&params, "behavior")?;
            let updated_permissions: Option<Vec<Value>> = params
                .get("updated_permissions")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let updated_input = params.get("updated_input").cloned();
            let deny_message = params
                .get("deny_message")
                .and_then(|v| v.as_str())
                .map(String::from);
            let interrupt = params.get("interrupt").and_then(|v| v.as_bool());
            let tool_name = params
                .get("tool_name")
                .and_then(|v| v.as_str())
                .map(String::from);
            log::debug!(
                "[dispatch] respond_permission: run_id={}, req_id={}, behavior={}",
                run_id,
                request_id,
                behavior
            );
            if behavior != "allow" && behavior != "deny" {
                return Err(format!(
                    r#"{{"code":"unknown","message":"invalid behavior: {behavior}","retryable":false}}"#
                ));
            }
            if let (Some(perms), Some(tool)) = (updated_permissions.as_ref(), tool_name.as_ref()) {
                let attempts_permanent = perms.iter().any(|p| {
                    p.get("type").and_then(|v| v.as_str()) == Some("addRules")
                        || p.get("destination").and_then(|v| v.as_str()) == Some("userSettings")
                });
                if attempts_permanent
                    && crate::agent::permission_error::is_permanent_allow_blocked(tool)
                {
                    log::warn!(
                        "[dispatch] respond_permission: permanent allow blocked for tool={}",
                        tool
                    );
                    return Err(crate::agent::permission_error::PermissionError::new(
                        crate::agent::permission_error::PermissionErrorCode::DangerToolBlocked,
                        format!("Permanent allow refused for {tool}"),
                        false,
                    )
                    .to_string());
                }
            }
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let mut response = if behavior == "allow" {
                let input_val = updated_input.unwrap_or_else(|| json!({}));
                json!({
                    "behavior": "allow",
                    "updatedInput": input_val,
                })
            } else {
                let msg = deny_message.unwrap_or_else(|| "User denied permission".to_string());
                let mut deny_obj = json!({
                    "behavior": "deny",
                    "message": msg,
                });
                if interrupt == Some(true) {
                    deny_obj["interrupt"] = json!(true);
                }
                deny_obj
            };
            if let Some(perms) = updated_permissions {
                if behavior == "allow" && !perms.is_empty() {
                    response["updatedPermissions"] = Value::Array(perms);
                }
            }
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::RespondPermission {
                    request_id,
                    response,
                    tool_name: tool_name.clone(),
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            let outcome = reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())?;
            outcome?;
            Ok(json!(true))
        }
        "respond_hook_callback" => {
            let run_id = extract_str(&params, "run_id")?;
            let request_id = extract_str(&params, "request_id")?;
            let decision = extract_str(&params, "decision")?;
            let updated_input = params.get("updated_input").cloned();
            log::debug!(
                "[dispatch] respond_hook_callback: run_id={}, req_id={}, decision={}, has_updated_input={}",
                run_id,
                request_id,
                decision,
                updated_input.is_some(),
            );
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let mut response = json!({ "decision": decision });
            if decision == "allow" {
                if let Some(input) = updated_input {
                    response["updatedInput"] = input;
                }
            }
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::RespondHookCallback {
                    request_id,
                    response,
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            Ok(json!(true))
        }
        "cancel_control_request" => {
            let run_id = extract_str(&params, "run_id")?;
            let request_id = extract_str(&params, "request_id")?;
            log::debug!(
                "[dispatch] cancel_control_request: run_id={}, req_id={}",
                run_id,
                request_id
            );
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::CancelControlRequest {
                    request_id,
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            Ok(json!(true))
        }
        "respond_elicitation" => {
            let run_id = extract_str(&params, "run_id")?;
            let request_id = extract_str(&params, "request_id")?;
            let action = extract_str(&params, "action")?;
            let content = params.get("content").cloned();
            log::debug!(
                "[dispatch] respond_elicitation: run_id={}, req_id={}, action={}",
                run_id,
                request_id,
                action
            );
            if !matches!(action.as_str(), "accept" | "decline" | "cancel") {
                return Err(format!("Invalid elicitation action: {}", action));
            }
            let response = match action.as_str() {
                "accept" => {
                    let c = content.unwrap_or(json!({}));
                    if !c.is_object() {
                        return Err("content must be a JSON object for accept".into());
                    }
                    json!({"action": "accept", "content": c})
                }
                other => json!({"action": other}),
            };
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::RespondElicitation {
                    request_id,
                    response,
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            Ok(json!(true))
        }

        _ => Err(format!("unknown {} method: {{}}", method)),
    }
}
