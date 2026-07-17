mod tests {
    use super::*;
    use serde_json::json;

    const RUN: &str = "run-test";

    // ══════════════════════════════════════════════════════════════════
    //  P1-4：覆盖 MiMo/CLI 已知事件类型，确保不被 unknown 分支吞掉
    // ══════════════════════════════════════════════════════════════════

    #[test]
    fn test_p1_4_tool_result_standalone_completes_tool() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        // 先发 tool_use running
        let running = json!({
            "type": "tool_use",
            "part": {
                "tool": "Read",
                "callID": "call-1",
                "state": {
                    "status": "running",
                    "time": {"start": 100},
                    "input": {"path": "/x"}
                }
            },
            "timestamp": 100
        });
        ps.map_event(RUN, &running);
        let standalone_result = json!({
            "type": "tool_result",
            "part": {
                "callID": "call-1",
                "status": "completed",
                "output": "file contents"
            }
        });
        let events = ps.map_event(RUN, &standalone_result);
        assert_eq!(events.len(), 1, "应该单独发 ToolEnd");
        match &events[0] {
            BusEvent::ToolEnd {
                tool_use_id,
                status,
                ..
            } => {
                assert_eq!(tool_use_id, "call-1");
                assert_eq!(status, "completed");
            }
            other => panic!("expected ToolEnd, got {:?}", other),
        }
    }

    #[test]
    fn test_p1_4_usage_event_emits_usage_update() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        let raw = json!({
            "type": "usage",
            "part": {
                "input": 100,
                "output": 50,
                "cache_read": 30,
                "cost": 0.0123
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::UsageUpdate {
                input_tokens,
                output_tokens,
                cache_read_tokens,
                total_cost_usd,
                ..
            } => {
                assert_eq!(*input_tokens, 100);
                assert_eq!(*output_tokens, 50);
                assert_eq!(*cache_read_tokens, Some(30));
                assert!((total_cost_usd - 0.0123).abs() < 1e-9);
            }
            other => panic!("expected UsageUpdate, got {:?}", other),
        }
    }

    #[test]
    fn test_p1_4_progress_event_classified() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        let raw = json!({
            "type": "progress",
            "message": "compacting context..."
        });
        let before = ps.stats.unknown_event_count;
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        assert_eq!(
            ps.stats.unknown_event_count, before,
            "progress 不应该进 unknown 分支"
        );
    }

    #[test]
    fn test_p1_4_retry_event_classified() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        let raw = json!({
            "type": "retry",
            "attempt": 2,
            "message": "rate limited"
        });
        let before = ps.stats.unknown_event_count;
        let _ = ps.map_event(RUN, &raw);
        assert_eq!(
            ps.stats.unknown_event_count, before,
            "retry 不应该进 unknown 分支"
        );
    }

    #[test]
    fn test_p1_4_init_event_emits_raw_without_unknown() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        let raw = json!({"type": "init", "model": "opus-4"});
        let before = ps.stats.unknown_event_count;
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        assert_eq!(ps.stats.unknown_event_count, before);
        assert!(matches!(&events[0], BusEvent::Raw { .. }));
    }

    // ══════════════════════════════════════════════════════════════════
    //  Group A: Golden tests — one per event type, locks current behavior
    // ══════════════════════════════════════════════════════════════════

    #[test]
    fn test_system_init_new_session() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "init",
            "model": "opus-4",
            "tools": [{"name": "Bash"}, {"name": "Read"}],
            "cwd": "/project",
            "session_id": "ses-1"
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2, "SessionInit + RunState(running)");
        match &events[0] {
            BusEvent::SessionInit {
                model,
                tools,
                cwd,
                session_id,
                ..
            } => {
                assert_eq!(model.as_deref(), Some("opus-4"));
                assert_eq!(tools, &vec!["Bash".to_string(), "Read".to_string()]);
                assert_eq!(cwd, "/project");
                assert_eq!(session_id.as_deref(), Some("ses-1"));
            }
            other => panic!("expected SessionInit, got {:?}", other),
        }
        match &events[1] {
            BusEvent::RunState { state, .. } => assert_eq!(state, "running"),
            other => panic!("expected RunState, got {:?}", other),
        }
    }

    #[test]
    fn test_system_init_resume_session() {
        let mut ps = ProtocolState::new(true); // resume
        let raw = json!({
            "type": "system",
            "subtype": "init",
            "model": "opus-4",
            "tools": [],
            "cwd": "/project",
            "session_id": "ses-2"
        });
        let events = ps.map_event(RUN, &raw);
        // Resume: SessionInit only, no RunState (start_session emits synthetic idle)
        assert_eq!(events.len(), 1, "resume: SessionInit only");
        assert!(matches!(&events[0], BusEvent::SessionInit { .. }));
    }

    #[test]
    fn test_system_init_second_call() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "init", "model": "opus-4", "tools": [], "cwd": "/"});
        let _first = ps.map_event(RUN, &raw);
        // Second call: SessionInit emitted but NO RunState (seen_first_init=true)
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], BusEvent::SessionInit { .. }));
    }

    #[test]
    fn test_system_compact_boundary() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "compact_boundary",
            "compact_metadata": {"trigger": "manual", "pre_tokens": 50000}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::CompactBoundary {
                trigger,
                pre_tokens,
                ..
            } => {
                assert_eq!(trigger, "manual");
                assert_eq!(*pre_tokens, Some(50000));
            }
            other => panic!("expected CompactBoundary, got {:?}", other),
        }
    }

    #[test]
    fn test_system_microcompact_boundary() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "microcompact_boundary"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::CompactBoundary {
                trigger,
                pre_tokens,
                ..
            } => {
                assert_eq!(trigger, "micro_auto");
                assert_eq!(*pre_tokens, None);
            }
            other => panic!("expected CompactBoundary, got {:?}", other),
        }
    }

    #[test]
    fn test_system_status() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "status", "status": "compacting"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::SystemStatus { status, .. } => {
                assert_eq!(status.as_deref(), Some("compacting"));
            }
            other => panic!("expected SystemStatus, got {:?}", other),
        }
    }

    #[test]
    fn test_system_status_with_context_window_percentages() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "status",
            "status": "running",
            "context_window": {
                "used_percentage": 42.5,
                "remaining_percentage": 57.5
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], BusEvent::SystemStatus { .. }));
        match &events[1] {
            BusEvent::UsageUpdate {
                input_tokens,
                output_tokens,
                context_window_used_percentage,
                context_window_remaining_percentage,
                ..
            } => {
                assert_eq!(*input_tokens, 0);
                assert_eq!(*output_tokens, 0);
                assert_eq!(*context_window_used_percentage, Some(42.5));
                assert_eq!(*context_window_remaining_percentage, Some(57.5));
            }
            other => panic!("expected UsageUpdate, got {:?}", other),
        }
    }

    #[test]
    fn test_system_hook_started() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "hook_started",
            "hook_event": "PreToolUse",
            "hook_id": "h1",
            "hook_name": "lint-check"
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::HookStarted {
                hook_event,
                hook_id,
                hook_name,
                ..
            } => {
                assert_eq!(hook_event, "PreToolUse");
                assert_eq!(hook_id, "h1");
                assert_eq!(hook_name.as_deref(), Some("lint-check"));
            }
            other => panic!("expected HookStarted, got {:?}", other),
        }
    }

    #[test]
    fn test_system_hook_progress() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "hook_progress", "hook_id": "h1"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::HookProgress { hook_id, .. } => assert_eq!(hook_id, "h1"),
            other => panic!("expected HookProgress, got {:?}", other),
        }
    }

    #[test]
    fn test_user_task_notification_xml() {
        let mut ps = ProtocolState::new(false);
        let xml = concat!(
            "<task-notification>\n",
            "<task-id>a9bb95555169d1db3</task-id>\n",
            "<tool-use-id>toolu_01KEqmg7q9uc7ZWouxEvYeHM</tool-use-id>\n",
            "<output-file>/tmp/tasks/a9bb9.output</output-file>\n",
            "<status>completed</status>\n",
            "<summary>Agent \"JSDoc for src/a.ts\" completed</summary>\n",
            "<result>PR: none — permission denied</result>\n",
            "</task-notification>"
        );
        let raw = json!({
            "type": "user",
            "message": { "content": xml }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::TaskNotification {
                task_id,
                status,
                data,
                ..
            } => {
                assert_eq!(task_id, "a9bb95555169d1db3");
                assert_eq!(status, "completed");
                assert_eq!(data["tool_use_id"], "toolu_01KEqmg7q9uc7ZWouxEvYeHM");
                assert_eq!(data["summary"], "Agent \"JSDoc for src/a.ts\" completed");
                assert_eq!(data["output_file"], "/tmp/tasks/a9bb9.output");
                assert_eq!(data["result"], "PR: none — permission denied");
            }
            other => panic!("expected TaskNotification, got {:?}", other),
        }
    }

    #[test]
    fn test_user_task_notification_xml_missing_task_id() {
        let mut ps = ProtocolState::new(false);
        let xml = concat!(
            "<task-notification>\n",
            "<status>completed</status>\n",
            "<summary>Agent completed</summary>\n",
            "</task-notification>"
        );
        let raw = json!({
            "type": "user",
            "message": { "content": xml }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(
            events.len(),
            0,
            "should not emit event when task-id is missing"
        );
    }

    #[test]
    fn test_user_task_notification_xml_missing_status() {
        let mut ps = ProtocolState::new(false);
        let xml = concat!(
            "<task-notification>\n",
            "<task-id>t1</task-id>\n",
            "<summary>Agent completed</summary>\n",
            "</task-notification>"
        );
        let raw = json!({
            "type": "user",
            "message": { "content": xml }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(
            events.len(),
            0,
            "should not emit event when status is missing"
        );
    }

    #[test]
    fn test_user_task_notification_xml_missing_optional_fields() {
        let mut ps = ProtocolState::new(false);
        let xml = concat!(
            "<task-notification>\n",
            "<task-id>t42</task-id>\n",
            "<status>running</status>\n",
            "</task-notification>"
        );
        let raw = json!({
            "type": "user",
            "message": { "content": xml }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::TaskNotification {
                task_id,
                status,
                data,
                ..
            } => {
                assert_eq!(task_id, "t42");
                assert_eq!(status, "running");
                assert!(
                    data["tool_use_id"].is_null(),
                    "missing optional field should be null, not empty string"
                );
                assert!(data["summary"].is_null());
                assert!(data["output_file"].is_null());
            }
            other => panic!("expected TaskNotification, got {:?}", other),
        }
    }

    #[test]
    fn test_system_hook_response() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "hook_response",
            "hook_id": "h1",
            "hook_event": "PreToolUse",
            "outcome": "approved",
            "hook_name": "lint-check",
            "stdout": "ok",
            "stderr": "",
            "exit_code": 0
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::HookResponse {
                hook_id,
                hook_event,
                outcome,
                hook_name,
                stdout,
                stderr,
                exit_code,
                ..
            } => {
                assert_eq!(hook_id, "h1");
                assert_eq!(hook_event, "PreToolUse");
                assert_eq!(outcome, "approved");
                assert_eq!(hook_name.as_deref(), Some("lint-check"));
                assert_eq!(stdout.as_deref(), Some("ok"));
                assert_eq!(stderr.as_deref(), Some(""));
                assert_eq!(*exit_code, Some(0));
            }
            other => panic!("expected HookResponse, got {:?}", other),
        }
    }

    #[test]
    fn test_system_task_notification() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "task_notification", "task_id": "t1", "status": "started"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::TaskNotification {
                task_id, status, ..
            } => {
                assert_eq!(task_id, "t1");
                assert_eq!(status, "started");
            }
            other => panic!("expected TaskNotification, got {:?}", other),
        }
    }

    #[test]
    fn test_system_files_persisted() {
        let mut ps = ProtocolState::new(false);
        let raw =
            json!({"type": "system", "subtype": "files_persisted", "files": ["a.rs", "b.rs"]});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::FilesPersisted { files, .. } => {
                assert_eq!(files.as_array().unwrap().len(), 2);
            }
            other => panic!("expected FilesPersisted, got {:?}", other),
        }
    }

    #[test]
    fn test_system_auth_status() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "auth_status",
            "isAuthenticating": true,
            "output": ["Logging in...", "Success"]
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::AuthStatus {
                is_authenticating,
                output,
                ..
            } => {
                assert!(*is_authenticating);
                assert_eq!(output, &vec!["Logging in...", "Success"]);
            }
            other => panic!("expected AuthStatus, got {:?}", other),
        }
    }

    #[test]
    fn test_content_block_start_tool() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "content_block_start",
            "content_block": {"type": "tool_use", "id": "tu-1", "name": "Bash"}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolStart {
                tool_use_id,
                tool_name,
                input,
                parent_tool_use_id,
                ..
            } => {
                assert_eq!(tool_use_id, "tu-1");
                assert_eq!(tool_name, "Bash");
                assert_eq!(*input, Value::Null);
                assert!(parent_tool_use_id.is_none());
            }
            other => panic!("expected ToolStart, got {:?}", other),
        }
        // Verify accumulator state
        assert!(ps.emitted_tool_ids.contains_key("tu-1"));
    }

    #[test]
    fn test_content_block_start_thinking() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "content_block_start",
            "content_block": {"type": "thinking", "thinking": "hmm let me think"}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ThinkingDelta { text, .. } => assert_eq!(text, "hmm let me think"),
            other => panic!("expected ThinkingDelta, got {:?}", other),
        }
    }

    #[test]
    fn test_content_block_start_thinking_empty() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "content_block_start",
            "content_block": {"type": "thinking", "thinking": ""}
        });
        let events = ps.map_event(RUN, &raw);
        assert!(events.is_empty(), "empty thinking text: no event emitted");
    }

    #[test]
    fn test_content_block_delta_text() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "content_block_delta",
            "delta": {"type": "text_delta", "text": "hello world"}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::MessageDelta { text, .. } => assert_eq!(text, "hello world"),
            other => panic!("expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn test_content_block_delta_thinking() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "content_block_delta",
            "delta": {"type": "thinking_delta", "thinking": "reasoning step"}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ThinkingDelta { text, .. } => assert_eq!(text, "reasoning step"),
            other => panic!("expected ThinkingDelta, got {:?}", other),
        }
    }

    #[test]
    fn test_content_block_delta_input_json() {
        let mut ps = ProtocolState::new(false);
        // First: start a tool so last_tool_use_id is set
        let start = json!({
            "type": "content_block_start",
            "content_block": {"type": "tool_use", "id": "tu-1", "name": "Bash"}
        });
        ps.map_event(RUN, &start);
        // Then: input_json_delta
        let raw = json!({
            "type": "content_block_delta",
            "delta": {"type": "input_json_delta", "partial_json": "{\"cmd\":"}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolInputDelta {
                tool_use_id,
                partial_json,
                ..
            } => {
                assert_eq!(tool_use_id, "tu-1");
                assert_eq!(partial_json, "{\"cmd\":");
            }
            other => panic!("expected ToolInputDelta, got {:?}", other),
        }
    }

    #[test]
    fn test_assistant_message_text_only() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "assistant",
            "message": {
                "id": "m1",
                "model": "opus-4",
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "Hello there!"}]
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::MessageComplete {
                message_id,
                text,
                model,
                stop_reason,
                ..
            } => {
                assert_eq!(message_id, "m1");
                assert_eq!(text, "Hello there!");
                assert_eq!(model.as_deref(), Some("opus-4"));
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
            }
            other => panic!("expected MessageComplete, got {:?}", other),
        }
    }

    #[test]
    fn test_assistant_message_with_tool() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "assistant",
            "message": {
                "id": "m1",
                "content": [
                    {"type": "text", "text": "Let me read that."},
                    {"type": "tool_use", "id": "tu-1", "name": "Read", "input": {"path": "/x"}}
                ]
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(
            events.len(),
            2,
            "ToolStart (during loop) + MessageComplete (after loop)"
        );
        // Note: ToolStart is emitted during content iteration, MessageComplete after
        match &events[0] {
            BusEvent::ToolStart {
                tool_use_id,
                tool_name,
                input,
                ..
            } => {
                assert_eq!(tool_use_id, "tu-1");
                assert_eq!(tool_name, "Read");
                assert_eq!(input.get("path").unwrap().as_str().unwrap(), "/x");
            }
            other => panic!("expected ToolStart, got {:?}", other),
        }
        match &events[1] {
            BusEvent::MessageComplete {
                message_id, text, ..
            } => {
                assert_eq!(message_id, "m1");
                assert_eq!(text, "Let me read that.");
            }
            other => panic!("expected MessageComplete, got {:?}", other),
        }
    }

    #[test]
    fn test_assistant_tool_dedup() {
        let mut ps = ProtocolState::new(false);
        // Step 1: tool already emitted via streaming content_block_start
        let start = json!({
            "type": "content_block_start",
            "content_block": {"type": "tool_use", "id": "tu-1", "name": "Bash"}
        });
        ps.map_event(RUN, &start);
        // Step 2: assistant message arrives with same tool
        let raw = json!({
            "type": "assistant",
            "message": {
                "id": "m1",
                "content": [
                    {"type": "text", "text": "Running."},
                    {"type": "tool_use", "id": "tu-1", "name": "Bash", "input": {"cmd": "ls"}}
                ]
            }
        });
        let events = ps.map_event(RUN, &raw);
        // Only MessageComplete emitted, ToolStart is deduped
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], BusEvent::MessageComplete { .. }));
    }

    #[test]
    fn test_user_tool_result() {
        let mut ps = ProtocolState::new(false);
        // Pre-register tool id→name
        ps.emitted_tool_ids
            .insert("tu-1".to_string(), "Bash".to_string());
        let raw = json!({
            "type": "user",
            "message": {
                "content": [
                    {"type": "tool_result", "tool_use_id": "tu-1", "content": "files listed ok"}
                ]
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolEnd {
                tool_use_id,
                tool_name,
                status,
                ..
            } => {
                assert_eq!(tool_use_id, "tu-1");
                assert_eq!(tool_name, "Bash");
                assert_eq!(status, "success");
            }
            other => panic!("expected ToolEnd, got {:?}", other),
        }
    }

    #[test]
    fn test_user_tool_result_error() {
        let mut ps = ProtocolState::new(false);
        ps.emitted_tool_ids
            .insert("tu-1".to_string(), "Bash".to_string());
        let raw = json!({
            "type": "user",
            "message": {
                "content": [
                    {"type": "tool_result", "tool_use_id": "tu-1", "content": "command failed", "is_error": true}
                ]
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolEnd { status, .. } => assert_eq!(status, "error"),
            other => panic!("expected ToolEnd, got {:?}", other),
        }
    }

    #[test]
    fn test_user_command_output() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "user",
            "message": {
                "content": "<local-command-stdout>cost info here</local-command-stdout>"
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::CommandOutput { content, .. } => assert_eq!(content, "cost info here"),
            other => panic!("expected CommandOutput, got {:?}", other),
        }
    }

    #[test]
    fn test_system_local_command_output() {
        let mut ps = ProtocolState::new(false);
        ps.set_pending_slash_command(Some("/context".to_string()));

        // CLI sends system/local_command_output with content
        let raw = json!({
            "type": "system",
            "subtype": "local_command_output",
            "content": "## Context Usage\n\n**Model:** opus"
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::CommandOutput { content, .. } => {
                assert!(content.contains("Context Usage"));
            }
            other => panic!("expected CommandOutput, got {:?}", other),
        }

        // Behavior assertion: subsequent result should NOT emit a fallback hint
        // because pending_slash_command was already cleared by local_command_output.
        let result = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "cost_usd": 0.001
        });
        let result_events = ps.map_event(RUN, &result);
        // Should be UsageUpdate + RunState(idle), no extra CommandOutput hint
        assert!(
            !result_events
                .iter()
                .any(|e| matches!(e, BusEvent::CommandOutput { .. })),
            "result should not emit fallback hint after local_command_output"
        );
    }

    #[test]
    fn test_system_local_command_output_empty_content_still_clears_pending() {
        let mut ps = ProtocolState::new(false);
        ps.set_pending_slash_command(Some("/context".to_string()));

        // CLI sends system/local_command_output with empty content (edge case)
        let raw = json!({
            "type": "system",
            "subtype": "local_command_output",
            "content": ""
        });
        let events = ps.map_event(RUN, &raw);
        // No CommandOutput emitted for empty content
        assert_eq!(events.len(), 0);

        // But pending_slash_command IS cleared → no fallback hint on result
        let result = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "cost_usd": 0.001
        });
        let result_events = ps.map_event(RUN, &result);
        assert!(
            !result_events
                .iter()
                .any(|e| matches!(e, BusEvent::CommandOutput { .. })),
            "empty local_command_output should still prevent fallback hint"
        );
    }

    #[test]
    fn test_result_success() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "cost_usd": 0.01
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2, "UsageUpdate + RunState(idle)");
        match &events[0] {
            BusEvent::UsageUpdate {
                input_tokens,
                output_tokens,
                total_cost_usd,
                ..
            } => {
                assert_eq!(*input_tokens, 100);
                assert_eq!(*output_tokens, 50);
                assert!(*total_cost_usd > 0.0);
            }
            other => panic!("expected UsageUpdate, got {:?}", other),
        }
        match &events[1] {
            BusEvent::RunState { state, error, .. } => {
                assert_eq!(state, "idle");
                assert!(error.is_none());
            }
            other => panic!("expected RunState, got {:?}", other),
        }
        assert!(
            !ps.got_result_event,
            "success doesn't set got_result_event (only error does)"
        );
    }

    #[test]
    fn test_result_error() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "error_max_turns",
            "error": "Max turns reached",
            "usage": {"input_tokens": 100, "output_tokens": 50}
        });
        let events = ps.map_event(RUN, &raw);
        // UsageUpdate + RunState(failed)
        assert!(events.len() >= 2);
        let run_state = events
            .iter()
            .find(|e| matches!(e, BusEvent::RunState { .. }))
            .unwrap();
        match run_state {
            BusEvent::RunState { state, error, .. } => {
                assert_eq!(state, "failed");
                assert_eq!(error.as_deref(), Some("Max turns reached"));
            }
            _ => unreachable!(),
        }
        assert!(ps.got_result_event);
        assert_eq!(ps.result_subtype.as_deref(), Some("error_max_turns"));
    }

    #[test]
    fn test_result_with_model_usage() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "modelUsage": {
                "opus-4": {
                    "inputTokens": 80,
                    "outputTokens": 40,
                    "cacheReadInputTokens": 0,
                    "cacheCreationInputTokens": 0,
                    "webSearchRequests": 0,
                    "costUSD": 0.005
                }
            }
        });
        let events = ps.map_event(RUN, &raw);
        let usage = events
            .iter()
            .find(|e| matches!(e, BusEvent::UsageUpdate { .. }))
            .unwrap();
        match usage {
            BusEvent::UsageUpdate { model_usage, .. } => {
                let mu = model_usage.as_ref().expect("should have model_usage");
                assert!(mu.contains_key("opus-4"));
                let entry = &mu["opus-4"];
                assert_eq!(entry.input_tokens, 80);
                assert_eq!(entry.output_tokens, 40);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_result_with_context_window_percentages() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "context_window": {
                "used_percentage": 42.5,
                "remaining_percentage": 57.5
            }
        });
        let events = ps.map_event(RUN, &raw);
        let usage = events
            .iter()
            .find(|e| matches!(e, BusEvent::UsageUpdate { .. }))
            .unwrap();
        match usage {
            BusEvent::UsageUpdate {
                context_window_used_percentage,
                context_window_remaining_percentage,
                ..
            } => {
                assert_eq!(*context_window_used_percentage, Some(42.5));
                assert_eq!(*context_window_remaining_percentage, Some(57.5));
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_result_permission_denials() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "permission_denials": [
                {"tool_name": "Bash", "tool_use_id": "tu-1", "tool_input": {"cmd": "rm -rf /"}}
            ]
        });
        let events = ps.map_event(RUN, &raw);
        let denials: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, BusEvent::PermissionDenied { .. }))
            .collect();
        assert_eq!(denials.len(), 1);
        match &denials[0] {
            BusEvent::PermissionDenied {
                tool_name,
                tool_use_id,
                ..
            } => {
                assert_eq!(tool_name, "Bash");
                assert_eq!(tool_use_id, "tu-1");
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_tool_progress() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "tool_progress",
            "tool_use_id": "tu-1",
            "elapsed_time_seconds": 3.5
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolProgress {
                tool_use_id,
                elapsed_time_seconds,
                ..
            } => {
                assert_eq!(tool_use_id, "tu-1");
                assert_eq!(*elapsed_time_seconds, Some(3.5));
            }
            other => panic!("expected ToolProgress, got {:?}", other),
        }
    }

    #[test]
    fn test_tool_use_summary() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "tool_use_summary",
            "tool_use_id": "tu-1",
            "summary": "Ran tests successfully",
            "preceding_tool_use_ids": ["tu-0"]
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolUseSummary {
                tool_use_id,
                summary,
                preceding_tool_use_ids,
                ..
            } => {
                assert_eq!(tool_use_id, "tu-1");
                assert_eq!(summary, "Ran tests successfully");
                assert_eq!(preceding_tool_use_ids, &vec!["tu-0".to_string()]);
            }
            other => panic!("expected ToolUseSummary, got {:?}", other),
        }
    }

    #[test]
    fn test_rate_limit_event() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "rate_limit_event",
            "rate_limit_info": {
                "status": "allowed_warning",
                "resetsAt": 1711900000.0,
                "rateLimitType": "five_hour",
                "utilization": 0.85
            },
            "uuid": "abc123",
            "session_id": "sess1"
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::RateLimitEvent {
                status,
                resets_at,
                rate_limit_type,
                utilization,
                ..
            } => {
                assert_eq!(status, "allowed_warning");
                assert!((resets_at.unwrap() - 1711900000.0).abs() < 0.1);
                assert_eq!(rate_limit_type.as_deref(), Some("five_hour"));
                assert!((utilization.unwrap() - 0.85).abs() < 0.01);
            }
            other => panic!("expected RateLimitEvent, got {:?}", other),
        }
        assert_eq!(
            ps.stats.unknown_event_count, 0,
            "rate_limit_event should NOT increment unknown counter"
        );
    }

    #[test]
    fn test_unknown_type_raw_fallback() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "new_feature_xyz", "data": {"hello": "world"}});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::Raw { source, data, .. } => {
                assert_eq!(source, "claude_new_feature_xyz");
                assert_eq!(data["type"].as_str().unwrap(), "new_feature_xyz");
            }
            other => panic!("expected Raw, got {:?}", other),
        }
        assert_eq!(
            ps.stats.unknown_event_count, 1,
            "unknown type should increment counter"
        );
    }

    #[test]
    fn test_empty_type_no_output() {
        let mut ps = ProtocolState::new(false);
        // type="" → fallback, but empty string is filtered → dropped_count
        let raw = json!({"type": "", "data": {}});
        let events = ps.map_event(RUN, &raw);
        assert!(events.is_empty(), "empty type should produce no events");
        assert_eq!(
            ps.stats.dropped_count, 1,
            "empty type increments dropped_count"
        );
    }

    #[test]
    fn test_no_type_field_no_output() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"data": {"stuff": true}});
        let events = ps.map_event(RUN, &raw);
        assert!(
            events.is_empty(),
            "missing type field should produce no events"
        );
    }

    #[test]
    fn test_content_block_stop_no_op() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "content_block_stop", "index": 0});
        let events = ps.map_event(RUN, &raw);
        assert!(events.is_empty(), "content_block_stop is a no-op");
    }

    #[test]
    fn test_message_stop_no_op() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "message_stop"});
        let events = ps.map_event(RUN, &raw);
        assert!(events.is_empty(), "message_stop is a no-op");
    }

    #[test]
    fn test_parent_tool_use_id_propagation() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "content_block_start",
            "parent_tool_use_id": "parent-task-1",
            "content_block": {"type": "tool_use", "id": "tu-sub", "name": "Bash"}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolStart {
                parent_tool_use_id, ..
            } => {
                assert_eq!(parent_tool_use_id.as_deref(), Some("parent-task-1"));
            }
            other => panic!("expected ToolStart, got {:?}", other),
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  Group B: Malformed field tests — lock current behavior for known defects
    // ══════════════════════════════════════════════════════════════════

    #[test]
    fn test_content_block_start_missing_id() {
        // content_block_start path has `if !tool_use_id.is_empty()` guard → safe
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "content_block_start",
            "content_block": {"type": "tool_use", "name": "Bash"}
        });
        let events = ps.map_event(RUN, &raw);
        assert!(
            events.is_empty(),
            "content_block_start with missing id: guarded, no output"
        );
    }

    #[test]
    fn test_content_block_start_no_content_block() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "content_block_start"});
        let events = ps.map_event(RUN, &raw);
        assert!(events.is_empty(), "no content_block field: no output");
    }

    #[test]
    fn test_assistant_tool_missing_id() {
        // assistant path has NO guard on tool_use_id — empty id leaks out
        // This test locks the CURRENT (defective) behavior
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "assistant",
            "message": {
                "id": "m1",
                "content": [{"type": "tool_use", "name": "Bash", "input": {}}]
            }
        });
        let events = ps.map_event(RUN, &raw);
        // ⚠️ Current behavior: ToolStart with empty tool_use_id leaks out (L584 has no guard)
        let tool_starts: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, BusEvent::ToolStart { .. }))
            .collect();
        assert_eq!(
            tool_starts.len(),
            1,
            "empty id tool_use leaks through assistant path"
        );
        match &tool_starts[0] {
            BusEvent::ToolStart { tool_use_id, .. } => {
                assert_eq!(
                    tool_use_id, "",
                    "tool_use_id is empty string (known defect)"
                );
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_assistant_no_content() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "assistant", "message": {}});
        let events = ps.map_event(RUN, &raw);
        assert!(
            events.is_empty(),
            "assistant with no content array: no output"
        );
    }

    #[test]
    fn test_result_no_usage() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "result", "subtype": "success"});
        let events = ps.map_event(RUN, &raw);
        // No usage → no UsageUpdate, just RunState(idle)
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::RunState { state, .. } => assert_eq!(state, "idle"),
            other => panic!("expected RunState, got {:?}", other),
        }
    }

    #[test]
    fn test_system_init_no_model() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "init", "tools": [], "cwd": "/"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2);
        match &events[0] {
            BusEvent::SessionInit { model, .. } => {
                assert!(model.is_none(), "model is None when missing")
            }
            other => panic!("expected SessionInit, got {:?}", other),
        }
    }

    #[test]
    fn test_mcp_server_missing_name() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "init",
            "tools": [],
            "cwd": "/",
            "mcp_servers": [{"status": "running"}]
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2);
        match &events[0] {
            BusEvent::SessionInit { mcp_servers, .. } => {
                assert!(
                    mcp_servers.is_empty(),
                    "MCP server without name is dropped by filter_map"
                );
            }
            other => panic!("expected SessionInit, got {:?}", other),
        }
        assert_eq!(
            ps.stats.parse_warn_count, 1,
            "dropped MCP server counted as parse_warn"
        );
    }

    #[test]
    fn test_system_unknown_subtype() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "brand_new_feature"});
        let events = ps.map_event(RUN, &raw);
        // Phase 2: unknown system subtype now emits Raw (forward compatibility)
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::Raw { source, .. } => {
                assert_eq!(source, "claude_system_brand_new_feature");
            }
            other => panic!("expected Raw, got {:?}", other),
        }
        assert_eq!(ps.stats.unknown_event_count, 1);
    }

    #[test]
    fn test_tool_progress_no_tool_id() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "tool_progress"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolProgress {
                tool_use_id,
                elapsed_time_seconds,
                ..
            } => {
                assert_eq!(tool_use_id, "", "⚠️ empty tool_use_id leaks through");
                assert_eq!(*elapsed_time_seconds, None);
            }
            other => panic!("expected ToolProgress, got {:?}", other),
        }
    }

    #[test]
    fn test_tool_use_summary_no_tool_id() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "tool_use_summary"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolUseSummary {
                tool_use_id,
                summary,
                ..
            } => {
                assert_eq!(tool_use_id, "", "⚠️ empty tool_use_id leaks through");
                assert_eq!(summary, "");
            }
            other => panic!("expected ToolUseSummary, got {:?}", other),
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  Phase 2 regression tests — guard validate_bus_event invariants
    // ══════════════════════════════════════════════════════════════════

    #[test]
    fn test_validate_never_drops_run_state() {
        // RunState must ALWAYS pass through validate, even with empty state.
        // Quarantine/turn state machine depends on these events.
        let ev = BusEvent::RunState {
            run_id: "r1".to_string(),
            state: "".to_string(),
            exit_code: None,
            error: None,
        };
        assert!(
            validate_bus_event(&ev).is_none(),
            "validate must NEVER drop RunState (even with empty state)"
        );

        // Normal states too
        for state in &["idle", "running", "failed", "completed"] {
            let ev = BusEvent::RunState {
                run_id: "r1".to_string(),
                state: state.to_string(),
                exit_code: None,
                error: None,
            };
            assert!(
                validate_bus_event(&ev).is_none(),
                "RunState({}) must pass",
                state
            );
        }
    }

    #[test]
    fn test_validate_drops_empty_tool_id() {
        // ToolStart with empty id should be flagged as invalid
        let ev = BusEvent::ToolStart {
            run_id: "r1".to_string(),
            tool_use_id: "".to_string(),
            tool_name: "Bash".to_string(),
            input: Value::Null,
            parent_tool_use_id: None,
        };
        let warn = validate_bus_event(&ev);
        assert!(
            warn.is_some(),
            "empty tool_use_id in ToolStart should be invalid"
        );
        assert_eq!(warn.unwrap().field, "tool_use_id");

        // ToolEnd with empty id
        let ev = BusEvent::ToolEnd {
            run_id: "r1".to_string(),
            tool_use_id: "".to_string(),
            tool_name: "Bash".to_string(),
            output: Value::Null,
            status: "success".to_string(),
            duration_ms: None,
            parent_tool_use_id: None,
            tool_use_result: None,
        };
        assert!(
            validate_bus_event(&ev).is_some(),
            "empty tool_use_id in ToolEnd should be invalid"
        );

        // Valid tool passes
        let ev = BusEvent::ToolStart {
            run_id: "r1".to_string(),
            tool_use_id: "tu-1".to_string(),
            tool_name: "Bash".to_string(),
            input: Value::Null,
            parent_tool_use_id: None,
        };
        assert!(
            validate_bus_event(&ev).is_none(),
            "valid ToolStart should pass"
        );
    }

    #[test]
    fn test_unknown_system_subtype_emits_raw() {
        // Phase 2: system unknown subtype now emits Raw + increments unknown_event_count
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "brand_new"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::Raw { source, .. } => {
                assert_eq!(source, "claude_system_brand_new");
            }
            other => panic!("expected Raw, got {:?}", other),
        }
        assert_eq!(
            ps.stats.unknown_event_count, 1,
            "unknown system subtype increments counter"
        );
    }

    // ══════════════════════════════════════════════════════════════════
    //  Group D: Strict mode — standard parse sequence through new_strict()
    // ══════════════════════════════════════════════════════════════════

    #[test]
    fn test_strict_standard_session() {
        // A complete session_init → tool → result sequence through strict parser.
        // validate_strict panics if any emitted event has invalid fields.
        let mut ps = ProtocolState::new_strict(false);

        // 1. system/init
        let events = ps.map_event(
            RUN,
            &json!({
                "type": "system", "subtype": "init",
                "model": "opus-4", "tools": [{"name": "Bash"}], "cwd": "/test"
            }),
        );
        assert!(!events.is_empty());
        for ev in &events {
            validate_strict(ev);
        }

        // 2. content_block_start (tool_use)
        let events = ps.map_event(
            RUN,
            &json!({
                "type": "content_block_start",
                "content_block": { "type": "tool_use", "id": "tu-1", "name": "Read" }
            }),
        );
        for ev in &events {
            validate_strict(ev);
        }

        // 3. content_block_delta (input_json)
        let events = ps.map_event(
            RUN,
            &json!({
                "type": "content_block_delta",
                "delta": { "type": "input_json_delta", "partial_json": "{\"path\":\"/a\"}" }
            }),
        );
        for ev in &events {
            validate_strict(ev);
        }

        // 4. assistant (message_complete + tool dedup)
        let events = ps.map_event(
            RUN,
            &json!({
                "type": "assistant",
                "message": {
                    "id": "msg-1",
                    "content": [
                        { "type": "text", "text": "Let me read." },
                        { "type": "tool_use", "id": "tu-1", "name": "Read",
                          "input": { "path": "/a" } }
                    ]
                }
            }),
        );
        for ev in &events {
            validate_strict(ev);
        }

        // 5. user (tool_result)
        let events = ps.map_event(
            RUN,
            &json!({
                "type": "user",
                "message": {
                    "content": [
                        { "type": "tool_result", "tool_use_id": "tu-1",
                          "content": "file contents" }
                    ]
                }
            }),
        );
        for ev in &events {
            validate_strict(ev);
        }

        // 6. result (success)
        let events = ps.map_event(
            RUN,
            &json!({
                "type": "result", "subtype": "success",
                "cost_usd": 0.01, "duration_ms": 1000,
                "usage": { "input_tokens": 100, "output_tokens": 20 }
            }),
        );
        for ev in &events {
            validate_strict(ev);
        }

        // Post-conditions: strict session has 0 unknown/invalid/dropped
        assert_eq!(ps.stats.unknown_event_count, 0);
        assert_eq!(ps.stats.invalid_tool_count, 0);
        assert_eq!(ps.stats.dropped_count, 0);
    }

    #[test]
    fn test_strict_resume_session() {
        // Resume session — init emits SessionInit only (session_actor emits synthetic idle)
        let mut ps = ProtocolState::new_strict(true);
        let events = ps.map_event(
            RUN,
            &json!({
                "type": "system", "subtype": "init",
                "model": "opus-4", "tools": [], "cwd": "/",
                "session_id": "sess-resume"
            }),
        );
        assert_eq!(events.len(), 1, "resume: SessionInit only");
        for ev in &events {
            validate_strict(ev);
        }
        assert!(matches!(&events[0], BusEvent::SessionInit { .. }));
        assert_eq!(ps.stats.unknown_event_count, 0);
    }

    #[test]
    fn test_strict_tool_progress_and_summary() {
        // tool_progress and tool_use_summary with valid ids pass strict
        let mut ps = ProtocolState::new_strict(false);
        let events = ps.map_event(
            RUN,
            &json!({
                "type": "tool_progress",
                "tool_use_id": "tu-1",
                "elapsed_time_seconds": 1.5
            }),
        );
        assert_eq!(events.len(), 1);
        for ev in &events {
            validate_strict(ev);
        }

        let events = ps.map_event(
            RUN,
            &json!({
                "type": "tool_use_summary",
                "tool_use_id": "tu-1",
                "summary": "Done"
            }),
        );
        assert_eq!(events.len(), 1);
        for ev in &events {
            validate_strict(ev);
        }
        assert_eq!(ps.stats.invalid_tool_count, 0);
    }

    // ── stream_event envelope unwrapping ──

    #[test]
    fn thinking_delta_inside_stream_event() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "thinking_delta", "thinking": "Let me think..." }
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        assert!(
            matches!(&events[0], BusEvent::ThinkingDelta { text, .. } if text == "Let me think...")
        );
    }

    #[test]
    fn message_delta_inside_stream_event() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": "Hello" }
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], BusEvent::MessageDelta { text, .. } if text == "Hello"));
    }

    #[test]
    fn stream_event_preserves_parent_tool_use_id() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": "sub" },
                "parent_tool_use_id": "tu-parent"
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::MessageDelta {
                parent_tool_use_id, ..
            } => {
                assert_eq!(parent_tool_use_id.as_deref(), Some("tu-parent"));
            }
            other => panic!("expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn malformed_stream_event_falls_to_raw() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "stream_event",
            "event": { "no_type_field": true }
        });
        let events = ps.map_event(RUN, &raw);
        // The outer stream_event has no matching branch → falls to Raw
        // (the malformed inner doesn't unwrap, so outer type "stream_event" is unknown)
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], BusEvent::Raw { .. }));
    }
}
