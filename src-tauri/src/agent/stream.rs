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

/// Legacy realtime payload used by the page-level `PipeHandler`. Kept as
/// a typed alias so the new dispatcher can stay decoupled from the
/// concrete `ChatDelta { text }` shape.
pub type LegacyChatDelta = crate::models::ChatDelta;

/// Result of dispatching a single `BusEvent` through the dispatcher.
///
/// The dispatcher is the SINGLE entry point that decides which `BusEvent`
/// variants reach which downstream sink. Returning a typed outcome lets
/// callers log dropped / unknown variants explicitly and lets tests pin the
/// exact contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchOutcome {
    /// Event was published through the bus sink only.
    Published,
    /// Event was published AND through the legacy `chat-delta` sink. Only
    /// `BusEvent::MessageDelta` triggers this dual-publish path; the legacy
    /// listener predates the bus channel and only knows how to render text
    /// deltas.
    DualPublished,
    /// The variant is not recognized by the dispatcher. **Never** drop
    /// silently — return this so the caller can log it and the test can pin
    /// the contract.
    UnknownVariant(String),
}

/// Sinks that the production dispatcher writes to. Both bus_event and
/// persist_emit are invoked for every recognized variant (the
/// `BroadcastEmitter::persist_and_emit` sink already covers "emit to Tauri
/// plus persist to events.jsonl plus broadcast to WS clients", so the
/// dispatcher invokes it once per event). The `legacy_chat_delta` sink is
/// only invoked for `BusEvent::MessageDelta` to keep back-compat with
/// page-level `PipeHandler` consumers; other variants would confuse that
/// listener.
pub struct DispatchSinks<'a> {
    pub on_legacy_chat_delta: &'a mut dyn FnMut(&LegacyChatDelta),
    pub on_bus_event: &'a mut dyn FnMut(&BusEvent),
    pub on_persist_emit: &'a mut dyn FnMut(&BusEvent),
}

/// Decide which sinks to invoke for a parsed `BusEvent` and drive them.
///
/// **Single source of truth** for the pipe-mode dispatch table. Both
/// `stdout_handle` (production) and the regression tests in this module
/// call this function — so any silent drop or stale match arm is a
/// compile / test failure, not a behavioural one.
#[allow(unreachable_patterns)]
pub fn dispatch_pipe_bus_event(event: &BusEvent, sinks: &mut DispatchSinks<'_>) -> DispatchOutcome {
    match event {
        BusEvent::MessageDelta { .. } => {
            // Dual-publish path: page-level PipeHandler + bus.
            if let BusEvent::MessageDelta { text, .. } = event {
                (sinks.on_legacy_chat_delta)(&LegacyChatDelta { text: text.clone() });
            }
            (sinks.on_bus_event)(event);
            (sinks.on_persist_emit)(event);
            DispatchOutcome::DualPublished
        }
        // All structured variants the pipe parsers can emit today. Adding
        // a new variant to `BusEvent` will cause a compile error here —
        // forcing the dispatcher to make an explicit per-variant decision
        // rather than silently funnelling it through the catch-all.
        BusEvent::ThinkingDelta { .. }
        | BusEvent::ToolStart { .. }
        | BusEvent::ToolEnd { .. }
        | BusEvent::RunState { .. }
        | BusEvent::MessageComplete { .. }
        | BusEvent::UserMessage { .. }
        | BusEvent::ToolInputDelta { .. }
        | BusEvent::ToolProgress { .. }
        | BusEvent::ToolUseSummary { .. }
        | BusEvent::CompactBoundary { .. }
        | BusEvent::FilesPersisted { .. }
        | BusEvent::SessionLifecycle { .. }
        | BusEvent::SessionRecovering { .. }
        | BusEvent::SessionRecovered { .. }
        | BusEvent::SessionInit { .. }
        | BusEvent::UsageUpdate { .. }
        | BusEvent::PermissionDenied { .. }
        | BusEvent::PermissionPrompt { .. }
        | BusEvent::ElicitationPrompt { .. }
        | BusEvent::HookStarted { .. }
        | BusEvent::HookProgress { .. }
        | BusEvent::HookResponse { .. }
        | BusEvent::HookCallback { .. }
        | BusEvent::TaskNotification { .. }
        | BusEvent::SystemStatus { .. }
        | BusEvent::AuthStatus { .. }
        | BusEvent::ControlCancelled { .. }
        | BusEvent::CommandOutput { .. }
        | BusEvent::RateLimitEvent { .. }
        | BusEvent::RalphStarted { .. }
        | BusEvent::RalphIteration { .. }
        | BusEvent::RalphComplete { .. }
        | BusEvent::ProtocolDesync { .. }
        | BusEvent::AttentionChanged { .. }
        | BusEvent::RuntimeHealthChanged { .. }
        | BusEvent::GovernorBudgetExceeded { .. }
        | BusEvent::Raw { .. } => {
            (sinks.on_bus_event)(event);
            (sinks.on_persist_emit)(event);
            DispatchOutcome::Published
        }
        // Exhaustiveness: every `BusEvent` variant above. If a future PR
        // adds a new variant, this catch-all will route it through the bus
        // and emit `UnknownVariant` so the caller can surface the regression
        // explicitly instead of silently dropping events.
        _ => DispatchOutcome::UnknownVariant(format!("{:?}", std::mem::discriminant(event))),
    }
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
                // Production dispatch table — every recognized variant is
                // funneled through `dispatch_pipe_bus_event`, which is the
                // same function the regression tests in this module exercise.
                // Any silent drop or stale match arm is therefore a test
                // failure as well as a runtime failure.
                //
                // P0-4 sinks: legacy `chat-delta` (page-level PipeHandler) +
                // Tauri `bus-event` (SessionStore / EventMiddleware) +
                // persist+emit (events.jsonl + WS broadcast).
                {
                    let app_out = app_out.clone();
                    let bus_emitter = bus_emitter.clone();
                    let run_id_out = run_id_out.clone();
                    let mut legacy_chat_delta = |delta: &LegacyChatDelta| {
                        let _ = app_out.emit("chat-delta", delta);
                    };
                    let mut bus_event = |ev: &BusEvent| {
                        let _ = app_out.emit("bus-event", ev);
                    };
                    let mut persist_emit = |ev: &BusEvent| {
                        bus_emitter.persist_and_emit(&run_id_out, ev);
                    };
                    let mut sinks = DispatchSinks {
                        on_legacy_chat_delta: &mut legacy_chat_delta,
                        on_bus_event: &mut bus_event,
                        on_persist_emit: &mut persist_emit,
                    };
                    for event in &events {
                        // Stream-local side effect: accumulate assistant text
                        // for the trailing RunStatus emission. Lives here
                        // (not inside dispatcher) so the dispatcher stays
                        // pure / sink-driven.
                        if let BusEvent::MessageDelta { text, .. } = event {
                            assistant_text.push_str(text);
                        }
                        let outcome = dispatch_pipe_bus_event(event, &mut sinks);
                        if let DispatchOutcome::UnknownVariant(name) = outcome {
                            log::warn!(
                                "[stream] dispatch_pipe_bus_event returned UnknownVariant for {}; \
                                 if a new BusEvent variant was added, \
                                 list it explicitly in dispatch_pipe_bus_event's match",
                                name
                            );
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
    use crate::agent::pipe_parser::{CodexStdoutParser, OpenCodeStdoutParser};
    use crate::models::BusEvent;
    use std::sync::Mutex;

    /// Spy sinks that capture every dispatch call. The spy is the **same**
    /// shape as the production `DispatchSinks` struct — i.e. it goes
    /// through the real `dispatch_pipe_bus_event` entry point. Any silent
    /// drop inside the production match table will manifest as missing
    /// entries in these Vecs.
    #[derive(Default)]
    struct SpySinks {
        legacy_chat_delta_texts: Mutex<Vec<String>>,
        bus_event_types: Mutex<Vec<&'static str>>,
        persist_emit_types: Mutex<Vec<&'static str>>,
    }

    impl SpySinks {
        fn run(&self, event: &BusEvent) -> DispatchOutcome {
            let mut legacy_cb = |delta: &LegacyChatDelta| {
                self.legacy_chat_delta_texts
                    .lock()
                    .unwrap()
                    .push(delta.text.clone());
            };
            let mut bus_cb = |ev: &BusEvent| {
                self.bus_event_types
                    .lock()
                    .unwrap()
                    .push(variant_label(ev));
            };
            let mut persist_cb = |ev: &BusEvent| {
                self.persist_emit_types
                    .lock()
                    .unwrap()
                    .push(variant_label(ev));
            };
            let mut sinks = DispatchSinks {
                on_legacy_chat_delta: &mut legacy_cb,
                on_bus_event: &mut bus_cb,
                on_persist_emit: &mut persist_cb,
            };
            dispatch_pipe_bus_event(event, &mut sinks)
        }
    }

    /// Stable string label for a `BusEvent` variant. Discriminant-based —
    /// survives field-name drift across refactors.
    fn variant_label(event: &BusEvent) -> &'static str {
        match event {
            BusEvent::SessionInit { .. } => "SessionInit",
            BusEvent::MessageDelta { .. } => "MessageDelta",
            BusEvent::MessageComplete { .. } => "MessageComplete",
            BusEvent::ToolStart { .. } => "ToolStart",
            BusEvent::ToolEnd { .. } => "ToolEnd",
            BusEvent::UserMessage { .. } => "UserMessage",
            BusEvent::RunState { .. } => "RunState",
            BusEvent::SessionLifecycle { .. } => "SessionLifecycle",
            BusEvent::UsageUpdate { .. } => "UsageUpdate",
            BusEvent::Raw { .. } => "Raw",
            BusEvent::PermissionDenied { .. } => "PermissionDenied",
            BusEvent::ThinkingDelta { .. } => "ThinkingDelta",
            BusEvent::ToolInputDelta { .. } => "ToolInputDelta",
            BusEvent::PermissionPrompt { .. } => "PermissionPrompt",
            BusEvent::CompactBoundary { .. } => "CompactBoundary",
            BusEvent::SystemStatus { .. } => "SystemStatus",
            BusEvent::HookStarted { .. } => "HookStarted",
            BusEvent::HookProgress { .. } => "HookProgress",
            BusEvent::HookResponse { .. } => "HookResponse",
            BusEvent::TaskNotification { .. } => "TaskNotification",
            BusEvent::FilesPersisted { .. } => "FilesPersisted",
            BusEvent::ToolProgress { .. } => "ToolProgress",
            BusEvent::ToolUseSummary { .. } => "ToolUseSummary",
            BusEvent::AuthStatus { .. } => "AuthStatus",
            BusEvent::HookCallback { .. } => "HookCallback",
            BusEvent::ControlCancelled { .. } => "ControlCancelled",
            BusEvent::CommandOutput { .. } => "CommandOutput",
            BusEvent::ElicitationPrompt { .. } => "ElicitationPrompt",
            BusEvent::RateLimitEvent { .. } => "RateLimitEvent",
            BusEvent::RalphStarted { .. } => "RalphStarted",
            BusEvent::RalphIteration { .. } => "RalphIteration",
            BusEvent::RalphComplete { .. } => "RalphComplete",
            BusEvent::SessionRecovering { .. } => "SessionRecovering",
            BusEvent::SessionRecovered { .. } => "SessionRecovered",
            BusEvent::ProtocolDesync { .. } => "ProtocolDesync",
            BusEvent::AttentionChanged { .. } => "AttentionChanged",
            BusEvent::RuntimeHealthChanged { .. } => "RuntimeHealthChanged",
            BusEvent::GovernorBudgetExceeded { .. } => "GovernorBudgetExceeded",
        }
    }

    /// Build one canonical `BusEvent` per variant for exhaustive
    /// dispatcher coverage. Default / empty values are fine — the
    /// dispatcher only checks the discriminant. Constructing each
    /// fixture via `serde_json::from_value` lets us avoid hand-rolling
    /// field initializers (which drift whenever `models::BusEvent` is
    /// refactored) and pins the wire-shape contract at the same time:
    /// if a field is renamed / removed, this list fails to deserialize.
    fn all_bus_event_variants() -> Vec<(&'static str, BusEvent)> {
        // Each fixture is a JSON object keyed by `type` so we can construct
        // a representative `BusEvent` per variant via the wire format. This
        // also pins the BusEvent serde contract: if a required field is
        // removed, this list fails to deserialize and the test fails before
        // runtime ever sees the regression.
        let parse = |label: &'static str, payload: serde_json::Value| -> (&'static str, BusEvent) {
            (
                label,
                serde_json::from_value::<BusEvent>(payload)
                    .unwrap_or_else(|e| panic!("failed to deserialize {label}: {e}")),
            )
        };
        let no_data = serde_json::json!({});
        let empty_arr = serde_json::json!([]);
        vec![
            parse(
                "SessionInit",
                serde_json::json!({
                    "type": "session_init",
                    "run_id": "r",
                    "tools": empty_arr,
                    "cwd": "/"
                }),
            ),
            parse(
                "MessageDelta",
                serde_json::json!({
                    "type": "message_delta",
                    "run_id": "r",
                    "text": "x"
                }),
            ),
            parse(
                "MessageComplete",
                serde_json::json!({
                    "type": "message_complete",
                    "run_id": "r",
                    "message_id": "m",
                    "text": "x"
                }),
            ),
            parse(
                "ToolStart",
                serde_json::json!({
                    "type": "tool_start",
                    "run_id": "r",
                    "tool_use_id": "t",
                    "tool_name": "Bash",
                    "input": no_data
                }),
            ),
            parse(
                "ToolEnd",
                serde_json::json!({
                    "type": "tool_end",
                    "run_id": "r",
                    "tool_use_id": "t",
                    "tool_name": "Bash",
                    "output": no_data,
                    "status": "ok"
                }),
            ),
            parse(
                "UserMessage",
                serde_json::json!({
                    "type": "user_message",
                    "run_id": "r",
                    "text": "x"
                }),
            ),
            parse(
                "RunState",
                serde_json::json!({
                    "type": "run_state",
                    "run_id": "r",
                    "state": "running"
                }),
            ),
            parse(
                "SessionLifecycle",
                serde_json::json!({
                    "type": "session_lifecycle",
                    "run_id": "r",
                    "phase": "ready",
                    "recovery_state": "healthy",
                    "timestamp_ms": 0
                }),
            ),
            parse(
                "UsageUpdate",
                serde_json::json!({
                    "type": "usage_update",
                    "run_id": "r",
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_cost_usd": 0.0
                }),
            ),
            parse(
                "Raw",
                serde_json::json!({
                    "type": "raw",
                    "run_id": "r",
                    "source": "test",
                    "data": no_data
                }),
            ),
            parse(
                "PermissionDenied",
                serde_json::json!({
                    "type": "permission_denied",
                    "run_id": "r",
                    "tool_name": "Bash",
                    "tool_use_id": "t",
                    "tool_input": no_data
                }),
            ),
            parse(
                "ThinkingDelta",
                serde_json::json!({
                    "type": "thinking_delta",
                    "run_id": "r",
                    "text": "x"
                }),
            ),
            parse(
                "ToolInputDelta",
                serde_json::json!({
                    "type": "tool_input_delta",
                    "run_id": "r",
                    "tool_use_id": "t",
                    "partial_json": "x"
                }),
            ),
            parse(
                "PermissionPrompt",
                serde_json::json!({
                    "type": "permission_prompt",
                    "run_id": "r",
                    "request_id": "p",
                    "tool_name": "Bash",
                    "tool_use_id": "t",
                    "tool_input": no_data,
                    "decision_reason": "d"
                }),
            ),
            parse(
                "CompactBoundary",
                serde_json::json!({
                    "type": "compact_boundary",
                    "run_id": "r",
                    "trigger": "auto"
                }),
            ),
            parse(
                "SystemStatus",
                serde_json::json!({
                    "type": "system_status",
                    "run_id": "r",
                    "status": "ok",
                    "data": no_data
                }),
            ),
            parse(
                "HookStarted",
                serde_json::json!({
                    "type": "hook_started",
                    "run_id": "r",
                    "hook_event": "PreToolUse",
                    "hook_id": "h",
                    "data": no_data
                }),
            ),
            parse(
                "HookProgress",
                serde_json::json!({
                    "type": "hook_progress",
                    "run_id": "r",
                    "hook_id": "h",
                    "data": no_data
                }),
            ),
            parse(
                "HookResponse",
                serde_json::json!({
                    "type": "hook_response",
                    "run_id": "r",
                    "hook_id": "h",
                    "hook_event": "PreToolUse",
                    "outcome": "allow",
                    "data": no_data
                }),
            ),
            parse(
                "TaskNotification",
                serde_json::json!({
                    "type": "task_notification",
                    "run_id": "r",
                    "task_id": "tk",
                    "status": "completed",
                    "data": no_data
                }),
            ),
            parse(
                "FilesPersisted",
                serde_json::json!({
                    "type": "files_persisted",
                    "run_id": "r",
                    "files": empty_arr,
                    "data": no_data
                }),
            ),
            parse(
                "ToolProgress",
                serde_json::json!({
                    "type": "tool_progress",
                    "run_id": "r",
                    "tool_use_id": "t",
                    "data": no_data
                }),
            ),
            parse(
                "ToolUseSummary",
                serde_json::json!({
                    "type": "tool_use_summary",
                    "run_id": "r",
                    "tool_use_id": "t",
                    "summary": "ok",
                    "preceding_tool_use_ids": empty_arr,
                    "data": no_data
                }),
            ),
            parse(
                "AuthStatus",
                serde_json::json!({
                    "type": "auth_status",
                    "run_id": "r",
                    "is_authenticating": true,
                    "output": empty_arr,
                    "data": no_data
                }),
            ),
            parse(
                "HookCallback",
                serde_json::json!({
                    "type": "hook_callback",
                    "run_id": "r",
                    "request_id": "c",
                    "hook_event": "PreToolUse",
                    "hook_id": "h",
                    "data": no_data
                }),
            ),
            parse(
                "ControlCancelled",
                serde_json::json!({
                    "type": "control_cancelled",
                    "run_id": "r",
                    "request_id": "c"
                }),
            ),
            parse(
                "CommandOutput",
                serde_json::json!({
                    "type": "command_output",
                    "run_id": "r",
                    "content": "x"
                }),
            ),
            parse(
                "ElicitationPrompt",
                serde_json::json!({
                    "type": "elicitation_prompt",
                    "run_id": "r",
                    "request_id": "e",
                    "mcp_server_name": "srv",
                    "message": "msg"
                }),
            ),
            parse(
                "RateLimitEvent",
                serde_json::json!({
                    "type": "rate_limit_event",
                    "run_id": "r",
                    "status": "rejected",
                    "data": no_data
                }),
            ),
            parse(
                "RalphStarted",
                serde_json::json!({
                    "type": "ralph_started",
                    "run_id": "r",
                    "prompt": "p",
                    "max_iterations": 1,
                    "started_at": "2024-01-01"
                }),
            ),
            parse(
                "RalphIteration",
                serde_json::json!({
                    "type": "ralph_iteration",
                    "run_id": "r",
                    "iteration": 1,
                    "max_iterations": 1
                }),
            ),
            parse(
                "RalphComplete",
                serde_json::json!({
                    "type": "ralph_complete",
                    "run_id": "r",
                    "reason": "completion_promise",
                    "iteration": 1
                }),
            ),
            parse(
                "SessionRecovering",
                serde_json::json!({
                    "type": "session_recovering",
                    "run_id": "r",
                    "reason": "x",
                    "deadline_ms": 0
                }),
            ),
            parse(
                "SessionRecovered",
                serde_json::json!({
                    "type": "session_recovered",
                    "run_id": "r",
                    "ok": true
                }),
            ),
            parse(
                "ProtocolDesync",
                serde_json::json!({
                    "type": "protocol_desync",
                    "run_id": "r",
                    "fail_count": 0,
                    "sample": ""
                }),
            ),
            parse(
                "AttentionChanged",
                serde_json::json!({
                    "type": "attention_changed",
                    "revision": 0,
                    "last_event_seq": 0,
                    "open_count": 0,
                    "acknowledged_count": 0,
                    "resolved_count": 0
                }),
            ),
            parse(
                "RuntimeHealthChanged",
                serde_json::json!({
                    "type": "runtime_health_changed",
                    "agent": "claude",
                    "health": "healthy",
                    "logged_in": true,
                    "timestamp_ms": 0
                }),
            ),
            parse(
                "GovernorBudgetExceeded",
                serde_json::json!({
                    "type": "governor_budget_exceeded",
                    "run_id": "r",
                    "budget_kind": "concurrent_runs",
                    "current_value": 0,
                    "limit_value": 1,
                    "timestamp_ms": 0
                }),
            ),
        ]
    }

    /// P0-4 hardening: drive `dispatch_pipe_bus_event` with one instance of
    /// every `BusEvent` variant and assert the spy sinks captured exactly
    /// the right combination. This is the **real** test of the
    /// production dispatcher — no shadow `classify` function. Any new
    /// variant that slips into the `_ =>` arm fails this test with a
    /// `UnknownVariant` outcome that the assertion below pins against.
    #[test]
    fn dispatch_pipe_bus_event_publishes_every_recognized_variant() {
        let variants = all_bus_event_variants();
        assert!(
            variants.len() >= 30,
            "expected the canonical BusEvent list to cover every variant; got {}",
            variants.len()
        );

        for (expected_label, event) in &variants {
            let spy = SpySinks::default();
            let outcome = spy.run(event);
            match outcome {
                DispatchOutcome::Published | DispatchOutcome::DualPublished => {}
                DispatchOutcome::UnknownVariant(name) => panic!(
                    "P0-4 regression: variant {:?} reported UnknownVariant({:?}) — \
                     either the variant was not added to `dispatch_pipe_bus_event` \
                     or it was added but the test list was not updated",
                    std::mem::discriminant(event),
                    name
                ),
            }

            let bus = spy.bus_event_types.lock().unwrap().clone();
            assert_eq!(
                bus,
                vec![*expected_label],
                "P0-4: variant {} expected one bus_event call, got {:?}",
                expected_label,
                bus
            );
            let persist = spy.persist_emit_types.lock().unwrap().clone();
            assert_eq!(
                persist,
                vec![*expected_label],
                "P0-4: variant {} expected one persist_emit call, got {:?}",
                expected_label,
                persist
            );

            let legacy = spy.legacy_chat_delta_texts.lock().unwrap().clone();
            if *expected_label == "MessageDelta" {
                // P0-4 contract: MessageDelta is the ONLY variant that dual-
                // publishes (legacy chat-delta + bus). Pin it here so a
                // future PR that drops the legacy back-compat channel
                // fails this test.
                assert_eq!(
                    legacy.len(),
                    1,
                    "MessageDelta must dual-publish through legacy chat-delta"
                );
                assert_eq!(
                    outcome,
                    DispatchOutcome::DualPublished,
                    "MessageDelta expected DualPublished, got {:?}",
                    outcome
                );
            } else {
                assert!(
                    legacy.is_empty(),
                    "P0-4: variant {} must NOT reach legacy chat-delta sink; got {:?}",
                    expected_label,
                    legacy
                );
                assert_eq!(
                    outcome,
                    DispatchOutcome::Published,
                    "variant {} expected Published, got {:?}",
                    expected_label,
                    outcome
                );
            }
        }
    }

    /// P0-4 hardening: `dispatch_pipe_bus_event` must never silently drop
    /// a recognized variant. Driving every variant through the real
    /// function and asserting the result is `Published` or
    /// `DualPublished` (never `UnknownVariant`) is what keeps the contract
    /// honest — there's no shadow classifier.
    #[test]
    fn dispatch_pipe_bus_event_never_silently_drops_recognized_variants() {
        for (_label, event) in all_bus_event_variants() {
            let spy = SpySinks::default();
            let outcome = spy.run(&event);
            match outcome {
                DispatchOutcome::Published | DispatchOutcome::DualPublished => {
                    // Good: at least one bus_event sink was called.
                    let bus = spy.bus_event_types.lock().unwrap();
                    assert!(
                        !bus.is_empty(),
                        "P0-4 regression: {:?} reported Published but no bus_event sink was called",
                        std::mem::discriminant(&event)
                    );
                }
                DispatchOutcome::UnknownVariant(name) => {
                    panic!(
                        "P0-4 regression: {:?} returned UnknownVariant({:?}); \
                         adding a new BusEvent variant requires updating both \
                         `dispatch_pipe_bus_event` and the `all_bus_event_variants` \
                         test list",
                        std::mem::discriminant(&event),
                        name
                    );
                }
            }
        }
    }

    /// P0-4 hardening: end-to-end check that `dispatch_pipe_bus_event` is
    /// wired into `stdout_handle`'s parser output. Drives every `BusEvent`
    /// variant the canonical pipe parsers can produce and asserts it
    /// reaches the bus sink.
    #[test]
    fn dispatch_pipe_bus_event_round_trips_through_parsers() {
        let mut codex = CodexStdoutParser;
        let mut opencode = OpenCodeStdoutParser::default();
        let run_id = "run-p0-4-roundtrip";

        let mut fixtures: Vec<(&'static str, serde_json::Value, &str)> = vec![
            (
                "codex/MessageDelta",
                serde_json::json!({
                    "type": "item.completed",
                    "item": {"type": "agent_message", "text": "hi"}
                }),
                "codex",
            ),
            (
                "opencode/MessageDelta",
                serde_json::json!({"type": "text", "part": {"text": "x"}}),
                "opencode",
            ),
            (
                "opencode/ThinkingDelta",
                serde_json::json!({"type": "reasoning", "part": {"text": "y"}}),
                "opencode",
            ),
            (
                "opencode/ToolStart",
                serde_json::json!({
                    "type": "tool_use",
                    "part": {"callID": "c1", "tool": "bash", "state": {"status": "running"}}
                }),
                "opencode",
            ),
            (
                "opencode/ToolEnd",
                serde_json::json!({
                    "type": "tool_use",
                    "part": {"callID": "c1", "tool": "bash", "state": {"status": "completed"}}
                }),
                "opencode",
            ),
            (
                "opencode/RunState_running",
                serde_json::json!({"type": "step_start"}),
                "opencode",
            ),
            (
                "opencode/RunState_idle",
                serde_json::json!({"type": "step_finish", "part": {"reason": "stop"}}),
                "opencode",
            ),
            (
                "opencode/RunState_failed",
                serde_json::json!({"type": "error", "error": {"message": "boom"}}),
                "opencode",
            ),
        ];

        for (label, payload, parser) in fixtures.drain(..) {
            let events = match parser {
                "codex" => codex.parse_line(run_id, &payload),
                "opencode" => opencode.parse_line(run_id, &payload),
                _ => unreachable!(),
            };
            assert!(
                !events.is_empty(),
                "fixture {label} should produce at least one BusEvent"
            );
            for event in &events {
                let spy = SpySinks::default();
                let outcome = spy.run(event);
                match outcome {
                    DispatchOutcome::Published | DispatchOutcome::DualPublished => {}
                    DispatchOutcome::UnknownVariant(name) => panic!(
                        "P0-4 regression: parser fixture {label} produced a variant \
                         the dispatcher doesn't recognize (UnknownVariant({name:?})): {:?}",
                        std::mem::discriminant(event)
                    ),
                }
                let bus = spy.bus_event_types.lock().unwrap().clone();
                assert!(
                    !bus.is_empty(),
                    "P0-4 regression: parser fixture {label} produced an event \
                     ({:?}) that did NOT reach the bus sink",
                    std::mem::discriminant(event)
                );
            }
        }
    }

    /// P0-4 hardening: pipe-mode MessageDelta must reach both legacy
    /// `chat-delta` AND the bus-event channel. Drives the **real**
    /// `dispatch_pipe_bus_event` function, not a shadow classifier.
    #[test]
    fn message_delta_dual_publishes_chat_delta_and_bus_event() {
        let spy = SpySinks::default();
        let mut parser = CodexStdoutParser;
        let events = parser.parse_line(
            "run-1",
            &serde_json::json!({
                "type": "item.completed",
                "item": {"type": "agent_message", "text": "hello pipe"}
            }),
        );
        assert_eq!(events.len(), 1);
        for ev in &events {
            let outcome = spy.run(ev);
            assert_eq!(outcome, DispatchOutcome::DualPublished);
        }

        // P0-4 contract: MessageDelta must publish BOTH channels.
        let chat_texts = spy.legacy_chat_delta_texts.lock().unwrap().clone();
        assert_eq!(chat_texts, vec!["hello pipe".to_string()]);

        let bus = spy.bus_event_types.lock().unwrap().clone();
        assert_eq!(bus, vec!["MessageDelta"]);

        let persist = spy.persist_emit_types.lock().unwrap().clone();
        assert_eq!(persist, vec!["MessageDelta"]);
    }
}
