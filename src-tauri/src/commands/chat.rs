use crate::agent::spawn::build_agent_command;
use crate::agent::stream::{run_agent, ProcessMap};
use crate::models::{max_attachment_size, Attachment, BusEvent, RunEventType, RunStatus};
use crate::run_core::{ClientMessageState, TerminalReason};
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

    // P0-3 crash-aware dedupe (v1.1.0): the dedupe state is now a
    // three-state machine — `Prepared` / `Dispatched` / `Terminal`.
    //
    // * `None`           — never seen; proceed to stage 1 (record_prepared).
    // * `Prepared`       — a previous call crashed or timed out before
    //                      the spawn was confirmed. The chat command MUST
    //                      surface this as an ambiguous state to the
    //                      frontend so the user can decide retry-vs-resend.
    // * `Dispatched`     — a previous call successfully spawned the
    //                      child; idempotent re-send — return Ok(()).
    // * `Terminal(..)`   — the previous call reached a final state
    //                      (completed / user_stopped / spawn_failed).
    //                      Refuse to re-spawn; the caller should inspect
    //                      the reason and either surface the failure or
    //                      re-send with a new cid.
    //
    // If the journal cannot be read we fail closed with the typed
    // `JOURNAL_DEDUPE_UNAVAILABLE` prefix used by the actor path — this
    // keeps error contracts aligned across both execution paths.
    if let Some(ref cid) = client_message_id {
        match storage::run_journal::get_state(&run_id, cid) {
            Ok(Some(ClientMessageState::Prepared)) => {
                log::warn!(
                    "[chat] P0-3 ambiguous state for client_message_id={} (Prepared): the previous send was recorded but spawn was not confirmed; caller must decide retry or resend with a new cid",
                    cid
                );
                return Err(format!(
                    "{}: client_message_id={} is in ambiguous Prepared state — choose to retry or resend with a new id",
                    crate::run_core::JOURNAL_DEDUPE_UNAVAILABLE_PREFIX,
                    cid
                ));
            }
            Ok(Some(ClientMessageState::Dispatched)) => {
                log::debug!(
                    "[chat] dedupe: client_message_id={} durably dispatched; resolving as accepted",
                    cid
                );
                return Ok(());
            }
            Ok(Some(ClientMessageState::Terminal { reason })) => {
                let detail = match &reason {
                    TerminalReason::Completed => "completed",
                    TerminalReason::UserStopped => "user-stopped",
                    TerminalReason::SpawnFailed { message } => message.as_str(),
                };
                log::warn!(
                    "[chat] P0-3 terminal state for client_message_id={} reason={}: refusing to re-spawn; caller must resend with a new cid",
                    cid,
                    detail
                );
                return Err(format!(
                    "client_message_id={cid} reached terminal state ({detail}); resend with a new id"
                ));
            }
            Ok(None) => {
                log::debug!(
                    "[chat] P0-3 dedupe: client_message_id={} unseen; proceeding to record_prepared",
                    cid
                );
            }
            Err(error) => {
                let failure = format!(
                    "{}: cannot verify client_message_id={}: {}",
                    crate::run_core::JOURNAL_DEDUPE_UNAVAILABLE_PREFIX,
                    cid,
                    error
                );
                log::error!("[chat] durable dedupe unavailable: {}", failure);
                return Err(failure);
            }
        }
    }

    // P0-5: stop any in-flight pipe child for this run_id before spawning a
    // new one. Without this, rapid Send → Send → Send would queue N parallel
    // children racing on the same `run_id` and corrupting the event log. The
    // kill is best-effort with a short timeout so we never block the UI.
    {
        let pm = process_map.inner().clone();
        if crate::agent::stream::stop_process(&pm, &run_id).await {
            log::debug!(
                "[chat] stopped prior in-flight pipe child for run_id={} before new send",
                run_id
            );
        }
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

    // P0-3 crash-aware dedupe — stage one of three. We durably record
    // `Prepared` BEFORE attempting the spawn. If this call fails the
    // caller MUST NOT spawn — the previous P0-5 behaviour of "log a
    // warning then spawn anyway" left the ledger out of sync with the
    // spawn and was the root cause of the v1.1.0 retention regression.
    if let Some(ref cid) = client_message_id {
        if let Err(error) = storage::run_journal::record_prepared(&run_id, cid, Some(&message)) {
            log::error!(
                "[chat] P0-3 record_prepared failed for client_message_id={}: refusing to spawn",
                cid
            );
            return Err(format!(
                "{}: failed to record Prepared for client_message_id={}: {}",
                crate::run_core::JOURNAL_DEDUPE_UNAVAILABLE_PREFIX,
                cid,
                error
            ));
        }
    }

    // Spawn agent in background. Note: in this branch we transition the
    // journal from `Prepared` → `Dispatched` synchronously *before*
    // the tokio::spawn closure runs. The closure still owns the
    // terminal transition (Completed / SpawnFailed) so a panic inside
    // `run_agent` does not leak a `Prepared` row.
    let pm = process_map.inner().clone();
    let app_clone = app.clone();
    let agent_clone = run.agent.clone();
    let cwd = run.cwd.clone();
    let cid_for_dispatched = client_message_id.clone();
    let cid_for_terminal = client_message_id.clone();
    let run_id_for_dispatched = run_id.clone();
    let run_id_for_terminal = run_id.clone();

    // P0-3 stage two — promote `Prepared` → `Dispatched`. We do this
    // synchronously because by the time the tokio::spawn closure is
    // scheduled the spawn will already have succeeded (the closure
    // only owns the *terminal* transition once the child exits).
    //
    // If we crash between record_prepared and record_dispatched the
    // cid will stay `Prepared`, which is exactly the "ambiguous" state
    // we want retries to surface so the frontend never silently
    // double-spawns.
    if let Some(ref cid) = cid_for_dispatched {
        if let Err(error) = storage::run_journal::record_dispatched(&run_id_for_dispatched, cid) {
            // A failure here means the journal is degraded; surface
            // it as a typed error instead of silently swallowing.
            log::error!(
                "[chat] P0-3 record_dispatched failed for client_message_id={}: {}",
                cid,
                error
            );
            // Best-effort: also stamp Terminal(SpawnFailed) so the
            // cid cannot be confused as still-pending. We do not
            // return Ok here because we couldn't fully confirm the
            // transition — the caller will retry-or-resend.
            let _ = storage::run_journal::record_terminal(
                &run_id_for_dispatched,
                cid,
                TerminalReason::SpawnFailed {
                    message: format!("record_dispatched failed: {error}"),
                },
            );
            return Err(error);
        }
    }

    tokio::spawn(async move {
        match run_agent(
            app_clone.clone(),
            pm,
            run_id_for_terminal.clone(),
            command,
            args,
            cwd,
            agent_clone,
        )
        .await
        {
            Ok(()) => {
                if let Some(ref cid) = cid_for_terminal {
                    if let Err(error) = storage::run_journal::record_terminal(
                        &run_id_for_terminal,
                        cid,
                        TerminalReason::Completed,
                    ) {
                        log::warn!(
                            "[chat] P0-3 record_terminal(Completed) failed for client_message_id={}: {}",
                            cid,
                            error
                        );
                    }
                }
            }
            Err(e) => {
                // Spawn / runtime failure — stamp Terminal(SpawnFailed)
                // so a retry with the same cid refuses to re-spawn and
                // the frontend can render the explicit failure.
                if let Some(ref cid) = cid_for_terminal {
                    if let Err(term_err) = storage::run_journal::record_terminal(
                        &run_id_for_terminal,
                        cid,
                        TerminalReason::SpawnFailed { message: e.clone() },
                    ) {
                        log::warn!(
                            "[chat] P0-3 record_terminal(SpawnFailed) failed for client_message_id={}: {}",
                            cid,
                            term_err
                        );
                    }
                }
                if let Err(e2) = storage::runs::update_status(
                    &run_id_for_terminal,
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
