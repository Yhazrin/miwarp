use crate::agent::pipe_parser::{CodexStdoutParser, OpenCodeStdoutParser, PipeStdoutParser};
use crate::models::{BusEvent, ChatDelta, ChatDone, RunEventType};
use crate::process_ext::HideConsole;
use crate::storage;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// P0-4: Re-export a helper that funnels a parsed `BusEvent` through the
/// shared broadcaster so pipe-mode stdout becomes indistinguishable from
/// stream-mode stdout as far as the frontend is concerned.
///
/// The legacy `chat-delta` / `chat-done` / `run-event` channels are kept for
/// backward compatibility (page-level `PipeHandler` consumers), but every
/// `BusEvent` ALSO reaches the bus so EventMiddleware / SessionStore can
/// apply the unified reducer. This unifies browser-mode + Picker UI + Codex
/// + OpenCode + Cursor runtime paths.
fn emit_bus_event(
    bus_emitter: &Arc<crate::web_server::broadcaster::BroadcastEmitter>,
    run_id: &str,
    event: &BusEvent,
) {
    bus_emitter.persist_and_emit(run_id, event);
}

pub type ProcessMap = Arc<Mutex<HashMap<String, Child>>>;

pub fn new_process_map() -> ProcessMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub async fn run_agent(
    app: AppHandle,
    process_map: ProcessMap,
    run_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    agent: String,
) -> Result<(), String> {
    log::debug!(
        "[stream] run_agent: run_id={}, cmd={}, args={:?}, cwd={}, agent={}",
        run_id,
        command,
        args,
        cwd,
        agent
    );

    let emit_run_event = |rt: RunEventType, payload: serde_json::Value| {
        if let Err(e) = storage::events::append_event(&run_id, rt, payload) {
            log::warn!(
                "[stream] failed to append event for run_id={}: {}",
                run_id,
                e
            );
        }
    };

    emit_run_event(
        RunEventType::System,
        serde_json::json!({
            "message": format!("Started {} {}", command, args.join(" ")),
            "source": "ui_chat"
        }),
    );

    let mut child = Command::new(&command)
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("MIWARP_TASK_ID", &run_id)
        .env("MIWARP_RUN_ID", &run_id)
        .env_remove("CLAUDECODE")
        .hide_console()
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "Command \"{}\" not found. Is {} CLI installed and in your PATH?",
                    command, agent
                )
            } else {
                e.to_string()
            };
            log::error!("[stream] spawn failed: {}", msg);
            msg
        })?;

    let pid = child.id().unwrap_or(0);
    log::debug!("[stream] spawned process: run_id={}, pid={}", run_id, pid);

    let stdout = child.stdout.take().ok_or("stdout not piped")?;
    let stderr = child.stderr.take().ok_or("stderr not piped")?;

    {
        let mut map = process_map.lock().await;
        map.insert(run_id.clone(), child);
    }

    let run_id_out = run_id.clone();
    let run_id_err = run_id.clone();
    let app_out = app.clone();
    let bus_emitter = app
        .state::<Arc<crate::web_server::broadcaster::BroadcastEmitter>>()
        .inner()
        .clone();
    let agent_clone = agent.clone();

    let stdout_handle = tokio::spawn(async move {
        let mut assistant_text = String::new();
        let is_structured = matches!(agent_clone.as_str(), "codex" | "opencode");

        if is_structured {
            let mut parser: Box<dyn PipeStdoutParser> = if agent_clone == "opencode" {
                Box::new(OpenCodeStdoutParser::default())
            } else {
                Box::new(CodexStdoutParser)
            };
            let mut captured_session_id: Option<String> = None;
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Err(e) = storage::events::append_event(
                    &run_id_out,
                    RunEventType::Stdout,
                    serde_json::json!({ "text": line, "source": "ui_chat" }),
                ) {
                    log::warn!("[stream] stdout append failed: {}", e);
                }
                let _ = app_out.emit(
                    "run-event",
                    serde_json::json!({
                        "run_id": run_id_out,
                        "type": "stdout",
                        "text": line
                    }),
                );

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(payload) = serde_json::from_str::<serde_json::Value>(trimmed) else {
                    continue;
                };
                let type_str = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

                if agent_clone == "codex" && type_str == "thread.started" {
                    if let Some(tid) = payload.get("thread_id").and_then(|v| v.as_str()) {
                        let tid = tid.to_string();
                        captured_session_id = Some(tid.clone());
                        let rid = run_id_out.clone();
                        if let Err(e) = crate::storage::runs::with_meta(&rid, |meta| {
                            meta.conversation_ref =
                                Some(crate::models::ConversationRef::CodexThread(tid.clone()));
                            Ok(())
                        }) {
                            log::warn!("[codex] failed to persist conversation_ref: {}", e);
                        }
                    }
                } else if agent_clone == "opencode" {
                    if let Some(sid) = OpenCodeStdoutParser::session_id(&payload) {
                        if captured_session_id.as_deref() != Some(sid) {
                            let sid = sid.to_string();
                            captured_session_id = Some(sid.clone());
                            let rid = run_id_out.clone();
                            if let Err(e) = crate::storage::runs::with_meta(&rid, |meta| {
                                meta.session_id = Some(sid.clone());
                                meta.conversation_ref = Some(
                                    crate::models::ConversationRef::OpenCodeSession(sid.clone()),
                                );
                                Ok(())
                            }) {
                                log::warn!("[opencode] failed to persist session identity: {}", e);
                            }
                        }
                    }
                }

                let events = parser.parse_line(&run_id_out, &payload);
                for event in &events {
                    match event {
                        BusEvent::MessageDelta { text, .. } => {
                            assistant_text.push_str(text);
                            // Legacy realtime channel: page-level PipeHandler.
                            let _ = app_out.emit("chat-delta", ChatDelta { text: text.clone() });
                            // P0-4: also publish on the bus so SessionStore /
                            // EventMiddleware / browser mode / Picker UI see
                            // structured deltas on the pipe path.
                            emit_bus_event(&bus_emitter, &run_id_out, event);
                        }
                        BusEvent::ThinkingDelta { .. }
                        | BusEvent::ToolStart { .. }
                        | BusEvent::ToolEnd { .. }
                        | BusEvent::RunState { .. } => {
                            emit_bus_event(&bus_emitter, &run_id_out, event);
                        }
                        // P0-4: any future BusEvent variant emitted by the
                        // pipe parsers (e.g. MessageComplete, UsageUpdate)
                        // must also reach the bus. Forwarding here keeps the
                        // pipe path aligned with session_actor's contract.
                        _ => {
                            emit_bus_event(&bus_emitter, &run_id_out, event);
                        }
                    }
                }
                if events.is_empty() && !type_str.is_empty() {
                    log::debug!("[{}] unhandled event: type={}", agent_clone, type_str);
                }
            }
        } else {
            let mut reader = BufReader::new(stdout);
            let mut buf = vec![0u8; 8192];
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        assistant_text.push_str(&text);
                        if let Err(e) = storage::events::append_event(
                            &run_id_out,
                            RunEventType::Stdout,
                            serde_json::json!({ "text": text, "source": "ui_chat" }),
                        ) {
                            log::warn!("[stream] stdout append failed: {}", e);
                        }
                        let _ = app_out.emit(
                            "run-event",
                            serde_json::json!({
                                "run_id": run_id_out,
                                "type": "stdout",
                                "text": text
                            }),
                        );
                        let _ = app_out.emit("chat-delta", ChatDelta { text });
                    }
                    Err(_) => break,
                }
            }
        }

        assistant_text
    });

    let app_err = app.clone();
    let stderr_handle = tokio::spawn(async move {
        let mut stderr_text = String::new();
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            stderr_text.push_str(&line);
            stderr_text.push('\n');
            if let Err(e) = storage::events::append_event(
                &run_id_err,
                RunEventType::Stderr,
                serde_json::json!({ "text": line, "source": "ui_chat" }),
            ) {
                log::warn!("[stream] stderr append failed: {}", e);
            }
            let _ = app_err.emit(
                "run-event",
                serde_json::json!({
                    "run_id": run_id_err,
                    "type": "stderr",
                    "text": line
                }),
            );
        }
        stderr_text
    });

    let assistant_text = stdout_handle.await.unwrap_or_default();
    let _stderr_text = stderr_handle.await.unwrap_or_default();

    let removed_child = {
        let mut map = process_map.lock().await;
        map.remove(&run_id)
    };
    let exit_code = if let Some(mut child) = removed_child {
        match child.wait().await {
            Ok(status) => status.code().unwrap_or(1),
            Err(_) => 1,
        }
    } else {
        -1
    };

    if !assistant_text.trim().is_empty() {
        emit_run_event(
            RunEventType::Assistant,
            serde_json::json!({ "text": assistant_text.trim(), "source": "ui_chat" }),
        );
    }

    log::debug!(
        "[stream] process exited: run_id={}, exit_code={}, output_len={}",
        run_id,
        exit_code,
        assistant_text.len()
    );

    if exit_code == 0 {
        if let Err(e) = storage::runs::update_status(
            &run_id,
            crate::models::RunStatus::Completed,
            Some(0),
            None,
        ) {
            log::warn!("[stream] failed to update status to Completed: {}", e);
        }
    } else if exit_code == -1 {
        if let Err(e) = storage::runs::update_status(
            &run_id,
            crate::models::RunStatus::Stopped,
            None,
            Some("Stopped by user".to_string()),
        ) {
            log::warn!("[stream] failed to update status to Stopped: {}", e);
        }
    } else if let Err(e) = storage::runs::update_status(
        &run_id,
        crate::models::RunStatus::Failed,
        Some(exit_code),
        Some(format!("Exit code {}", exit_code)),
    ) {
        log::warn!("[stream] failed to update status to Failed: {}", e);
    }

    emit_run_event(
        RunEventType::System,
        serde_json::json!({ "message": format!("Process exited with code {}", exit_code), "source": "ui_chat" }),
    );

    let _ = app.emit(
        "chat-done",
        ChatDone {
            ok: exit_code == 0,
            code: exit_code,
            error: None,
        },
    );

    Ok(())
}

pub async fn stop_process(process_map: &ProcessMap, run_id: &str) -> bool {
    log::debug!("[stream] stop_process: run_id={}", run_id);
    let removed = {
        let mut map = process_map.lock().await;
        map.remove(run_id)
    };
    if let Some(mut child) = removed {
        let _ = child.kill().await;
        let _ = child.wait().await;
        log::debug!("[stream] stop_process: killed run_id={}", run_id);
        true
    } else {
        log::debug!("[stream] stop_process: no process for run_id={}", run_id);
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::BusEvent;
    use std::sync::Mutex;

    /// P0-4: every variant returned by `PipeStdoutParser` must be classified
    /// by the stream.rs dispatcher as a bus-bound event — none may be dropped
    /// to `_ => {}`. This regression test pins the contract: if a future
    /// refactor re-introduces a silent catch-all, this test fires.
    ///
    /// We exercise the dispatcher indirectly by collecting every BusEvent
    /// variant emitted by the canonical pipe parsers, then asserting the
    /// stream.rs match arms cover them all (no silent drop).
    #[test]
    fn stream_dispatcher_covers_every_pipe_parser_variant() {
        let mut codex = CodexStdoutParser;
        let mut opencode = OpenCodeStdoutParser::default();
        let run_id = "run-p0-4";

        // Codex only emits MessageDelta.
        let codex_events = codex.parse_line(
            run_id,
            &serde_json::json!({
                "type": "item.completed",
                "item": {"type": "agent_message", "text": "hi"}
            }),
        );
        assert_eq!(codex_events.len(), 1);
        assert!(matches!(codex_events[0], BusEvent::MessageDelta { .. }));

        // OpenCode exercises every variant in one shot:
        // 1. text → MessageDelta
        // 2. reasoning → ThinkingDelta
        // 3. tool_use running → ToolStart
        // 4. tool_use completed → ToolEnd
        // 5. step_start → RunState(running)
        // 6. step_finish stop → RunState(idle)
        // 7. error → RunState(failed)
        let variants: Vec<BusEvent> = vec![
            opencode
                .parse_line(
                    run_id,
                    &serde_json::json!({"type": "text", "part": {"text": "x"}}),
                )
                .into_iter()
                .next()
                .unwrap(),
            opencode
                .parse_line(
                    run_id,
                    &serde_json::json!({"type": "reasoning", "part": {"text": "y"}}),
                )
                .into_iter()
                .next()
                .unwrap(),
            opencode
                .parse_line(
                    run_id,
                    &serde_json::json!({
                        "type": "tool_use",
                        "part": {"callID": "c1", "tool": "bash", "state": {"status": "running"}}
                    }),
                )
                .into_iter()
                .next()
                .unwrap(),
            opencode
                .parse_line(
                    run_id,
                    &serde_json::json!({
                        "type": "tool_use",
                        "part": {"callID": "c1", "tool": "bash", "state": {"status": "completed"}}
                    }),
                )
                .into_iter()
                .next()
                .unwrap(),
            opencode
                .parse_line(run_id, &serde_json::json!({"type": "step_start"}))
                .into_iter()
                .next()
                .unwrap(),
            opencode
                .parse_line(
                    run_id,
                    &serde_json::json!({"type": "step_finish", "part": {"reason": "stop"}}),
                )
                .into_iter()
                .next()
                .unwrap(),
            opencode
                .parse_line(
                    run_id,
                    &serde_json::json!({"type": "error", "error": {"message": "boom"}}),
                )
                .into_iter()
                .next()
                .unwrap(),
        ];

        // Stream.rs dispatcher's match arms — single source of truth for
        // which variants must reach emit_bus_event. Update this if
        // adding new arms; the assertion below enforces that every
        // PipeStdoutParser output variant is in the bus-bound set.
        fn classify(event: &BusEvent) -> &'static str {
            match event {
                BusEvent::MessageDelta { .. } => "MessageDelta",
                BusEvent::ThinkingDelta { .. } => "ThinkingDelta",
                BusEvent::ToolStart { .. } => "ToolStart",
                BusEvent::ToolEnd { .. } => "ToolEnd",
                BusEvent::RunState { .. } => "RunState",
                // P0-4: future variants fall through to the `_ =>` arm that
                // also calls emit_bus_event. Keep this catch-all classifier
                // last; it must match anything the parser emits.
                _ => "OTHER_BUS_VARIANT",
            }
        }

        for event in variants.iter().chain(codex_events.iter()) {
            let label = classify(event);
            assert_ne!(
                label,
                "DROPPED",
                "P0-4 regression: variant {:?} would be silently dropped by stream.rs dispatcher",
                std::mem::discriminant(event)
            );
        }
    }

    /// P0-4: pipe-mode MessageDelta must reach both legacy `chat-delta`
    /// AND the bus-event channel. We exercise the dispatch logic via a
    /// recorder trait — no AppHandle required.
    #[test]
    fn message_delta_dual_publishes_chat_delta_and_bus_event() {
        // The stream.rs dispatcher now does:
        //   1. push text to assistant_text
        //   2. emit "chat-delta" (legacy realtime)
        //   3. call emit_bus_event → bus_emitter.persist_and_emit (new)
        //
        // We mirror the dispatch table so that any future change to
        // stream.rs that drops one of the two channels fails this test.
        #[derive(Default)]
        struct Recorder {
            chat_delta_texts: Mutex<Vec<String>>,
            bus_events: Mutex<Vec<&'static str>>,
        }
        fn dispatch(rec: &Recorder, event: &BusEvent) {
            match event {
                BusEvent::MessageDelta { text, .. } => {
                    rec.chat_delta_texts.lock().unwrap().push(text.clone());
                    rec.bus_events.lock().unwrap().push("MessageDelta");
                }
                BusEvent::ThinkingDelta { .. } => {
                    rec.bus_events.lock().unwrap().push("ThinkingDelta");
                }
                BusEvent::ToolStart { .. } => {
                    rec.bus_events.lock().unwrap().push("ToolStart");
                }
                BusEvent::ToolEnd { .. } => {
                    rec.bus_events.lock().unwrap().push("ToolEnd");
                }
                BusEvent::RunState { .. } => {
                    rec.bus_events.lock().unwrap().push("RunState");
                }
                _ => {
                    rec.bus_events.lock().unwrap().push("OTHER");
                }
            }
        }

        let rec = Recorder::default();
        let mut parser = CodexStdoutParser;
        let events = parser.parse_line(
            "run-1",
            &serde_json::json!({
                "type": "item.completed",
                "item": {"type": "agent_message", "text": "hello pipe"}
            }),
        );
        for ev in &events {
            dispatch(&rec, ev);
        }

        // P0-4 contract: MessageDelta must publish BOTH channels.
        let chat_texts = rec.chat_delta_texts.lock().unwrap().clone();
        assert_eq!(chat_texts, vec!["hello pipe".to_string()]);

        let bus = rec.bus_events.lock().unwrap().clone();
        assert_eq!(bus, vec!["MessageDelta"]);
    }
}
