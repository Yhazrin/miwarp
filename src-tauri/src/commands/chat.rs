use crate::agent::spawn::build_agent_command;
use crate::agent::stream::{run_agent, ProcessMap};
use crate::models::{max_attachment_size, Attachment, BusEvent, RunEventType, RunStatus};
use crate::storage;
use serde_json::Value;
use std::fs;
use std::sync::Arc;
use tauri::{Emitter, Manager};

fn safe_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let truncated = if cleaned.len() > 120 {
        &cleaned[..120]
    } else {
        &cleaned
    };
    if truncated.is_empty() {
        "attachment.bin".to_string()
    } else {
        truncated.to_string()
    }
}

fn extension_for_mime(mime: &str) -> &str {
    if mime.starts_with("image/png") {
        return ".png";
    }
    if mime.starts_with("image/jpeg") {
        return ".jpg";
    }
    if mime.starts_with("image/webp") {
        return ".webp";
    }
    if mime.starts_with("image/gif") {
        return ".gif";
    }
    if mime.starts_with("application/pdf") {
        return ".pdf";
    }
    if mime.starts_with("text/markdown") {
        return ".md";
    }
    if mime.starts_with("text/plain") {
        return ".txt";
    }
    if mime.contains("json") {
        return ".json";
    }
    ""
}

#[tauri::command]
pub async fn send_chat_message(
    app: tauri::AppHandle,
    process_map: tauri::State<'_, ProcessMap>,
    run_id: String,
    message: String,
    attachments: Option<Vec<Attachment>>,
    model: Option<String>,
    client_message_id: Option<String>,
) -> Result<(), String> {
    log::debug!(
        "[chat] send_chat_message: run_id={}, msg_len={}, attachments={}, client_message_id={:?}",
        run_id,
        message.len(),
        attachments.as_ref().map_or(0, |a| a.len()),
        client_message_id,
    );
    let mut run =
        storage::runs::get_run(&run_id).ok_or_else(|| format!("Run {} not found", run_id))?;

    // Validate execution path — send_chat_message is the pipe_exec path
    let exec_path = run.resolved_execution_path();
    if exec_path != crate::models::ExecutionPath::PipeExec {
        return Err(format!(
            "send_chat_message requires execution_path=pipe_exec, got {:?} for run {}",
            exec_path, run_id
        ));
    }

    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("message is required".to_string());
    }

    // Handle attachments
    let attachments = attachments.unwrap_or_default();
    let mut attachment_paths: Vec<(String, String, String, u64)> = vec![]; // (path, name, type, size)

    if !attachments.is_empty() {
        let upload_dir = std::env::temp_dir().join("miwarp-uploads").join(&run_id);
        fs::create_dir_all(&upload_dir).map_err(|e| e.to_string())?;

        for att in attachments.iter().take(8) {
            if att.content_base64.is_empty() {
                continue;
            }
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&att.content_base64)
                .map_err(|e| e.to_string())?;
            if bytes.is_empty() {
                continue;
            }
            let limit = max_attachment_size(&att.mime_type) as usize;
            if bytes.len() > limit {
                log::warn!(
                    "[chat] skipping oversized attachment: {} ({} bytes > {} limit)",
                    att.name,
                    bytes.len(),
                    limit
                );
                continue;
            }

            let base = safe_filename(&att.name);
            let ext = extension_for_mime(&att.mime_type);
            let filename = format!(
                "{}-{}-{}{}",
                chrono::Utc::now().timestamp_millis(),
                &uuid::Uuid::new_v4().to_string()[..6],
                base,
                ext
            );
            let full_path = upload_dir.join(&filename);
            fs::write(&full_path, &bytes).map_err(|e| e.to_string())?;
            attachment_paths.push((
                full_path.to_string_lossy().to_string(),
                att.name.clone(),
                att.mime_type.clone(),
                att.size,
            ));
        }
    }

    // Build prompt with attachments
    let attachment_text = if !attachment_paths.is_empty() {
        let files: Vec<String> = attachment_paths
            .iter()
            .map(|(path, name, mime, size)| {
                format!("- {} ({}, {} bytes) => {}", name, mime, size, path)
            })
            .collect();
        format!(
            "\n\nAttached files:\n{}\nUse these local file paths directly when needed.",
            files.join("\n")
        )
    } else {
        String::new()
    };
    let full_prompt = format!("{}{}", message, attachment_text);

    // Add user event
    let att_json: Vec<serde_json::Value> = attachment_paths
        .iter()
        .map(|(path, name, mime, size)| {
            serde_json::json!({ "name": name, "type": mime, "size": size, "path": path })
        })
        .collect();

    if let Err(e) = storage::events::append_event(
        &run_id,
        RunEventType::User,
        serde_json::json!({
            "text": message,
            "source": "ui_chat",
            "attachments": att_json
        }),
    ) {
        log::warn!("[chat] failed to log user event: {}", e);
    }

    // Pipe mode (Codex)
    log::debug!(
        "[chat] spawning pipe mode: run_id={}, agent={}",
        run_id,
        run.agent
    );
    // Update run status to running
    if let Err(e) = storage::runs::update_status(&run_id, RunStatus::Running, None, None) {
        log::warn!("[chat] failed to update status to Running: {}", e);
    }

    // P0-4: mirror the session_actor contract — emit a starting RunState on
    // the bus before we spawn the child process, so browser-mode /
    // EventMiddleware / SessionStore observers see the same lifecycle
    // transitions as the stream-mode path. Without this, pipe-mode UI
    // would only learn the run started when the first delta arrives.
    let bus_emitter = app
        .state::<Arc<crate::web_server::broadcaster::BroadcastEmitter>>()
        .inner()
        .clone();
    bus_emitter.persist_and_emit(
        &run_id,
        &BusEvent::RunState {
            run_id: run_id.clone(),
            state: "starting".to_string(),
            exit_code: None,
            error: None,
        },
    );

    // Build unified adapter settings
    let agent_settings = storage::settings::get_agent_settings(&run.agent);
    let user_settings = storage::settings::get_user_settings();
    let mut adapter_settings =
        crate::agent::adapter::build_adapter_settings(&agent_settings, &user_settings, model);
    super::session::apply_project_desk_context(&mut adapter_settings, &mut run);

    // OpenCode resumes by starting a new turn process with the persisted session ID.
    let conversation_id = match run.resolved_conversation_ref() {
        Some(crate::models::ConversationRef::OpenCodeSession(id)) => Some(id),
        _ => None,
    };

    // Build command
    let (command, args) = build_agent_command(
        &run.agent,
        &full_prompt,
        &adapter_settings,
        true, // print mode
        conversation_id.as_deref(),
    )?;

    // Spawn agent in background
    let pm = process_map.inner().clone();
    let app_clone = app.clone();
    let run_id_clone = run_id.clone();
    let agent_clone = run.agent.clone();
    let cwd = run.cwd.clone();

    tokio::spawn(async move {
        if let Err(e) = run_agent(
            app_clone.clone(),
            pm,
            run_id_clone.clone(),
            command,
            args,
            cwd,
            agent_clone,
        )
        .await
        {
            if let Err(e2) = storage::runs::update_status(
                &run_id_clone,
                RunStatus::Failed,
                Some(1),
                Some(e.clone()),
            ) {
                log::warn!("[chat] failed to update status to Failed: {}", e2);
            }
            let _ = app_clone.emit(
                "chat-done",
                crate::models::ChatDone {
                    ok: false,
                    code: 1,
                    error: None,
                },
            );
        }
    });

    Ok(())
}

/// Look up the persisted `tool_use_result` payload for a specific tool call.
///
/// Frontend `InlineToolCard` lazily loads full content for tools whose result
/// was truncated at render time (`tool_use_result._truncated === true`). The
/// full content lives in the run's `events.jsonl` inside the latest matching
/// `tool_end` envelope. We deliberately skip non-`tool_end` rows and trust the
/// first non-null `tool_use_result` we find — the projector emits `tool_end`
/// exactly once per tool use, so re-walking the journal is idempotent.
///
/// Returns `Ok(None)` if the run or matching event does not exist; the
/// frontend treats that as a terminal "not found" state for the lazy loader.
#[tauri::command]
pub fn get_tool_result(run_id: String, tool_use_id: String) -> Result<Option<Value>, String> {
    log::debug!(
        "[chat] get_tool_result: run_id={}, tool_use_id={}",
        run_id,
        tool_use_id
    );

    // Reject obviously-invalid input up front. The frontend may pass a stub
    // id before a tool has actually been issued; surface that as an error so
    // we don't silently return None and confuse the lazy loader.
    if tool_use_id.trim().is_empty() {
        return Err("tool_use_id is required".to_string());
    }

    // Missing run / missing journal both collapse to `Ok(None)`: the
    // frontend `InlineToolCard` treats null as a terminal "not found" state
    // for the lazy loader, and a missing run is a perfectly valid reason
    // to render that state rather than propagate an error.
    if storage::runs::get_run(&run_id).is_none() {
        return Ok(None);
    }

    let path = storage::events::events_path(&run_id);
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        // Missing journal ⇒ tool was never persisted; not an error.
        Err(_) => return Ok(None),
    };

    // Walk from the most recent event backwards — if the same tool id was
    // re-emitted (e.g. after a CLI reconnect), the newest `tool_end` wins.
    // We only care about `tool_end` envelopes; other event types cannot
    // carry `tool_use_result`.
    for line in content.lines().rev() {
        let line = line.trim();
        if line.is_empty() || !line.contains("\"tool_end\"") {
            continue;
        }
        let Ok(envelope) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let event = match envelope.get("event") {
            Some(e) => e,
            None => continue,
        };
        if event.get("type").and_then(|t| t.as_str()) != Some("tool_end") {
            continue;
        }
        if event.get("tool_use_id").and_then(|t| t.as_str()) != Some(tool_use_id.as_str()) {
            continue;
        }
        if let Some(result) = event.get("tool_use_result") {
            if !result.is_null() {
                return Ok(Some(result.clone()));
            }
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_run_id() -> String {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("test-get-tool-result-{}-{}", std::process::id(), n)
    }

    fn write_events(run_id: &str, jsonl: &str) {
        let dir = storage::run_dir(run_id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("events.jsonl"), jsonl).unwrap();
        let meta = serde_json::json!({
            "id": run_id,
            "prompt": "test",
            "cwd": "/tmp",
            "agent": "claude",
            "status": "completed",
            "started_at": "2026-01-01T00:00:00Z",
        });
        std::fs::write(dir.join("meta.json"), meta.to_string()).unwrap();
    }

    fn cleanup(run_id: &str) {
        let _ = std::fs::remove_dir_all(storage::run_dir(run_id));
    }

    /// Happy path: a `tool_end` envelope with `tool_use_result` is returned.
    #[test]
    fn returns_tool_use_result_when_present() {
        let run_id = unique_run_id();
        let events = "{\"_bus\":true,\"seq\":1,\"event\":{\"type\":\"tool_start\",\"tool_use_id\":\"t1\",\"tool_name\":\"Bash\"}}\n\
                      {\"_bus\":true,\"seq\":2,\"event\":{\"type\":\"tool_end\",\"tool_use_id\":\"t1\",\"tool_name\":\"Bash\",\"output\":\"hello\",\"status\":\"completed\",\"tool_use_result\":{\"file_path\":\"/tmp/x\",\"_truncated\":true,\"text\":\"full output\"}}}\n";
        write_events(&run_id, events);
        let result = get_tool_result(run_id.clone(), "t1".to_string()).unwrap();
        cleanup(&run_id);
        let value = result.expect("result present");
        assert_eq!(
            value.get("file_path").and_then(|v| v.as_str()),
            Some("/tmp/x")
        );
        assert_eq!(
            value.get("_truncated").and_then(|v| v.as_bool()),
            Some(true)
        );
    }

    /// No matching `tool_end` ⇒ Ok(None) (frontend treats as terminal).
    #[test]
    fn returns_none_when_no_matching_event() {
        let run_id = unique_run_id();
        let events = "{\"_bus\":true,\"seq\":1,\"event\":{\"type\":\"tool_start\",\"tool_use_id\":\"t1\",\"tool_name\":\"Bash\"}}\n";
        write_events(&run_id, events);
        let result = get_tool_result(run_id.clone(), "t1".to_string()).unwrap();
        cleanup(&run_id);
        assert!(result.is_none());
    }

    /// Missing journal ⇒ Ok(None), not an error.
    #[test]
    fn returns_none_when_events_missing() {
        let run_id = unique_run_id();
        let result = get_tool_result(run_id.clone(), "t1".to_string()).unwrap();
        cleanup(&run_id);
        assert!(result.is_none());
    }

    /// Multiple `tool_end` envelopes for the same id (replay / reconnect):
    /// the most recent one wins.
    #[test]
    fn returns_latest_tool_end_when_duplicated() {
        let run_id = unique_run_id();
        let events = "{\"_bus\":true,\"seq\":1,\"event\":{\"type\":\"tool_end\",\"tool_use_id\":\"t1\",\"tool_name\":\"Bash\",\"output\":\"first\",\"status\":\"completed\",\"tool_use_result\":{\"v\":1}}}\n\
                      {\"_bus\":true,\"seq\":2,\"event\":{\"type\":\"tool_end\",\"tool_use_id\":\"t1\",\"tool_name\":\"Bash\",\"output\":\"second\",\"status\":\"completed\",\"tool_use_result\":{\"v\":2}}}\n";
        write_events(&run_id, events);
        let result = get_tool_result(run_id.clone(), "t1".to_string()).unwrap();
        cleanup(&run_id);
        let value = result.expect("result present");
        assert_eq!(value.get("v").and_then(|v| v.as_i64()), Some(2));
    }

    /// Different `tool_use_id`s coexist — we must match by exact id, not by
    /// accident returning the first tool_end we see.
    #[test]
    fn does_not_cross_match_tool_use_ids() {
        let run_id = unique_run_id();
        let events = "{\"_bus\":true,\"seq\":1,\"event\":{\"type\":\"tool_end\",\"tool_use_id\":\"tA\",\"tool_name\":\"Bash\",\"output\":\"a\",\"status\":\"completed\",\"tool_use_result\":{\"v\":\"A\"}}}\n\
                      {\"_bus\":true,\"seq\":2,\"event\":{\"type\":\"tool_end\",\"tool_use_id\":\"tB\",\"tool_name\":\"Bash\",\"output\":\"b\",\"status\":\"completed\",\"tool_use_result\":{\"v\":\"B\"}}}\n";
        write_events(&run_id, events);
        let a = get_tool_result(run_id.clone(), "tA".to_string()).unwrap();
        let b = get_tool_result(run_id.clone(), "tB".to_string()).unwrap();
        cleanup(&run_id);
        assert_eq!(a.unwrap().get("v").and_then(|v| v.as_str()), Some("A"));
        assert_eq!(b.unwrap().get("v").and_then(|v| v.as_str()), Some("B"));
    }

    /// Empty `tool_use_id` is rejected up front — caller bug, not a "not found".
    #[test]
    fn rejects_empty_tool_use_id() {
        let run_id = unique_run_id();
        let dir = storage::run_dir(&run_id);
        std::fs::create_dir_all(&dir).unwrap();
        let meta = serde_json::json!({
            "id": run_id,
            "prompt": "test",
            "cwd": "/tmp",
            "agent": "claude",
            "status": "completed",
            "started_at": "2026-01-01T00:00:00Z",
        });
        std::fs::write(dir.join("meta.json"), meta.to_string()).unwrap();
        let err = get_tool_result(run_id.clone(), "  ".to_string()).unwrap_err();
        cleanup(&run_id);
        assert!(err.contains("tool_use_id"), "got: {}", err);
    }
}
