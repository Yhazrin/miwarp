mod tests {
    use super::*;

    #[test]
    fn test_encode_cwd() {
        assert_eq!(encode_cwd("/Users/alice/project"), "-Users-alice-project");
        assert_eq!(encode_cwd("/"), "-");
        assert_eq!(encode_cwd("relative"), "relative");
        // Windows paths
        assert_eq!(
            encode_cwd("C:\\Users\\alice\\project"),
            "C:-Users-alice-project"
        );
        assert_eq!(
            encode_cwd("C:/Users/alice/project"),
            "C:-Users-alice-project"
        );
    }

    #[test]
    fn test_normalize_queue_operation() {
        let raw = json!({"type": "queue-operation", "data": {}});
        assert!(normalize_transcript_line(&raw).is_none());
    }

    #[test]
    fn test_normalize_file_history_snapshot() {
        let raw = json!({"type": "file-history-snapshot", "data": {}});
        assert!(normalize_transcript_line(&raw).is_none());
    }

    #[test]
    fn test_normalize_progress_to_system() {
        let raw = json!({
            "type": "progress",
            "data": {
                "type": "init",
                "model": "claude-opus-4-6",
                "cwd": "/test"
            },
            "uuid": "abc-123",
            "timestamp": "2026-02-24T12:00:00Z"
        });
        let normalized = normalize_transcript_line(&raw).unwrap();
        assert_eq!(normalized.get("type").unwrap().as_str().unwrap(), "system");
        assert_eq!(normalized.get("subtype").unwrap().as_str().unwrap(), "init");
        assert_eq!(
            normalized.get("model").unwrap().as_str().unwrap(),
            "claude-opus-4-6"
        );
        assert!(normalized.get("uuid").is_some());
        assert!(normalized.get("timestamp").is_some());
    }

    #[test]
    fn test_normalize_progress_hook_started() {
        let raw = json!({
            "type": "progress",
            "data": {
                "type": "hook_started",
                "hookEvent": "PreToolUse",
                "hookId": "h1",
                "hookName": "my-hook"
            }
        });
        let normalized = normalize_transcript_line(&raw).unwrap();
        assert_eq!(normalized.get("type").unwrap().as_str().unwrap(), "system");
        assert_eq!(
            normalized.get("subtype").unwrap().as_str().unwrap(),
            "hook_started"
        );
        assert_eq!(
            normalized.get("hook_event").unwrap().as_str().unwrap(),
            "PreToolUse"
        );
        assert_eq!(normalized.get("hook_id").unwrap().as_str().unwrap(), "h1");
        assert_eq!(
            normalized.get("hook_name").unwrap().as_str().unwrap(),
            "my-hook"
        );
    }

    #[test]
    fn test_normalize_assistant_parent_tool_use_id() {
        let raw = json!({
            "type": "assistant",
            "parentToolUseID": "tool-123",
            "message": {
                "id": "msg-1",
                "content": [{"type": "text", "text": "hello"}]
            }
        });
        let normalized = normalize_transcript_line(&raw).unwrap();
        assert_eq!(
            normalized
                .get("parent_tool_use_id")
                .unwrap()
                .as_str()
                .unwrap(),
            "tool-123"
        );
        assert!(normalized.get("parentToolUseID").is_none());
    }

    #[test]
    fn test_normalize_progress_session_id() {
        let raw = json!({
            "type": "progress",
            "sessionId": "ses-abc",
            "data": {
                "type": "init",
                "cwd": "/test"
            }
        });
        let normalized = normalize_transcript_line(&raw).unwrap();
        assert_eq!(
            normalized.get("session_id").unwrap().as_str().unwrap(),
            "ses-abc"
        );
    }

    #[test]
    fn test_normalize_unknown_type_passthrough() {
        let raw = json!({"type": "unknown_event", "data": 42});
        let normalized = normalize_transcript_line(&raw).unwrap();
        assert_eq!(
            normalized.get("type").unwrap().as_str().unwrap(),
            "unknown_event"
        );
    }

    #[test]
    fn test_normalize_user_event_tool_use_result() {
        let raw = json!({
            "type": "user",
            "toolUseResult": {
                "filePath": "src/main.rs",
                "structuredPatch": [{"oldStart": 551, "oldLines": 6, "newStart": 551, "newLines": 5, "lines": [" a", "-b", "+c"]}],
                "originalFile": "full file content here"
            },
            "parentToolUseID": "tu_abc"
        });
        let normalized = normalize_transcript_line(&raw).unwrap();
        // toolUseResult → tool_use_result
        let tur = normalized
            .get("tool_use_result")
            .expect("tool_use_result missing");
        assert!(tur.get("structuredPatch").is_some());
        assert_eq!(
            tur.get("structuredPatch").unwrap()[0]
                .get("oldStart")
                .unwrap()
                .as_i64()
                .unwrap(),
            551
        );
        // parentToolUseID → parent_tool_use_id
        assert_eq!(
            normalized
                .get("parent_tool_use_id")
                .unwrap()
                .as_str()
                .unwrap(),
            "tu_abc"
        );
    }

    #[test]
    fn test_is_real_user_prompt() {
        // Real prompt
        let real = json!({
            "type": "user",
            "message": {"content": "Fix the login bug"}
        });
        assert!(TranscriptImporter::is_real_user_prompt(&real));

        // Command output
        let cmd = json!({
            "type": "user",
            "message": {"content": "<local-command-stdout>output</local-command-stdout>"}
        });
        assert!(!TranscriptImporter::is_real_user_prompt(&cmd));

        // Meta
        let meta = json!({
            "type": "user",
            "isMeta": true,
            "message": {"content": "something"}
        });
        assert!(!TranscriptImporter::is_real_user_prompt(&meta));

        // Slash command
        let slash = json!({
            "type": "user",
            "message": {"content": "<command-name>/cost</command-name>"}
        });
        assert!(!TranscriptImporter::is_real_user_prompt(&slash));

        // Task notification
        let task_notif = json!({
            "type": "user",
            "message": {"content": "<task-notification>\n<task-id>t1</task-id>\n<status>completed</status>\n</task-notification>"}
        });
        assert!(!TranscriptImporter::is_real_user_prompt(&task_notif));

        // Array content (not a real prompt)
        let array = json!({
            "type": "user",
            "message": {"content": [{"type": "tool_result"}]}
        });
        assert!(!TranscriptImporter::is_real_user_prompt(&array));
    }

    #[test]
    fn test_is_first_prompt_text() {
        // Real user prompts → true
        assert!(shared::is_first_prompt_text("Hello, help me fix a bug"));
        assert!(shared::is_first_prompt_text("Implement a new feature"));

        // Command output → false
        assert!(!shared::is_first_prompt_text(
            "<local-command-stdout>$ ls\nfile.txt</local-command-stdout>"
        ));

        // Slash command → false
        assert!(!shared::is_first_prompt_text(
            "<command-name>/cost</command-name>"
        ));

        // Task notification → false
        assert!(!shared::is_first_prompt_text(
            "<task-notification>\n<task-id>t1</task-id>\n<status>completed</status>\n</task-notification>"
        ));

        // Only open tag without close → true (user discussing XML, not a real notification)
        assert!(shared::is_first_prompt_text(
            "The <task-notification> tag is used for..."
        ));
    }

    #[test]
    fn test_source_key_uuid_priority() {
        let raw = json!({
            "type": "user",
            "uuid": "abc-def-123",
            "timestamp": "2026-01-01T00:00:00Z"
        });
        let key = shared::line_key(&raw, 100, "raw line");
        assert_eq!(key, "abc-def-123");
    }

    #[test]
    fn test_source_key_timestamp_fallback() {
        let raw = json!({
            "type": "user",
            "timestamp": "2026-01-01T00:00:00Z"
        });
        let key = shared::line_key(&raw, 100, "raw line");
        assert!(key.starts_with("v1:2026-01-01T00:00:00Z:user:"));
    }

    #[test]
    fn test_source_key_offset_fallback() {
        let raw = json!({"type": "user"});
        let key = shared::line_key(&raw, 42, "raw line");
        assert!(key.starts_with("v1:42:user:"));
    }

    #[test]
    fn test_event_key_format() {
        let ek = shared::event_key("abc-def", "tool_end", 1);
        assert_eq!(ek, "v1:abc-def#tool_end#1");
    }

    #[test]
    fn test_is_replayable() {
        let replayable = BusEvent::UserMessage {
            run_id: "r".into(),
            text: "hi".into(),
            uuid: None,
        };
        assert!(is_replayable(&replayable));

        let not_replayable = BusEvent::Raw {
            run_id: "r".into(),
            source: "test".into(),
            data: json!({}),
        };
        assert!(!is_replayable(&not_replayable));
    }

    /// Verify normalize_transcript_line preserves user message uuid field
    #[test]
    fn test_normalize_user_preserves_uuid() {
        let raw = json!({
            "type": "user",
            "uuid": "test-uuid-abc",
            "message": { "role": "user", "content": "hello" }
        });
        let normalized = normalize_transcript_line(&raw).unwrap();
        assert_eq!(normalized["uuid"], "test-uuid-abc");
        assert_eq!(normalized["type"], "user");
    }

    /// Verify old user messages without uuid still parse correctly
    #[test]
    fn test_normalize_user_without_uuid() {
        let raw = json!({
            "type": "user",
            "message": { "role": "user", "content": "hello" }
        });
        let normalized = normalize_transcript_line(&raw).unwrap();
        assert!(normalized.get("uuid").is_none());
    }

    /// BusEvent::UserMessage with uuid serializes/deserializes correctly
    #[test]
    fn test_user_message_with_uuid_serde() {
        let ev = BusEvent::UserMessage {
            run_id: "r".into(),
            text: "hi".into(),
            uuid: Some("test-uuid-123".into()),
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["uuid"], "test-uuid-123");

        let back: BusEvent = serde_json::from_value(json).unwrap();
        match back {
            BusEvent::UserMessage { uuid, .. } => {
                assert_eq!(uuid.as_deref(), Some("test-uuid-123"))
            }
            _ => panic!("expected UserMessage"),
        }
    }

    /// BusEvent::UserMessage without uuid deserializes (backward compat with old events.jsonl)
    #[test]
    fn test_user_message_without_uuid_serde() {
        let json = json!({ "type": "user_message", "run_id": "r", "text": "hi" });
        let ev: BusEvent = serde_json::from_value(json).unwrap();
        match ev {
            BusEvent::UserMessage { uuid, .. } => assert!(uuid.is_none()),
            _ => panic!("expected UserMessage"),
        }
    }

    // ── Cache tests ──

    #[test]
    fn test_imported_cache_invalidate() {
        // Isolate: ensure clean state
        invalidate_imported_cache();

        // First call: cache miss → rebuild
        let idx1 = build_imported_index_cached(Duration::from_secs(60));
        // Second call within TTL: cache hit (same result)
        let idx2 = build_imported_index_cached(Duration::from_secs(60));
        assert_eq!(idx1.len(), idx2.len());

        // Invalidate → next call rebuilds
        invalidate_imported_cache();
        let idx3 = build_imported_index_cached(Duration::from_secs(60));
        // Should still be same content (no actual imports changed), but was rebuilt
        assert_eq!(idx1.len(), idx3.len());

        // Cleanup
        invalidate_imported_cache();
    }

    #[test]
    fn test_imported_cache_expired() {
        invalidate_imported_cache();

        // Build with 0ms TTL → always expires
        let _idx = build_imported_index_cached(Duration::from_millis(0));
        // Wait a tiny bit
        std::thread::sleep(Duration::from_millis(1));
        // Next call should be a miss (expired)
        let _idx2 = build_imported_index_cached(Duration::from_millis(0));
        // No panic = success (we can't easily distinguish hit vs miss without mocking,
        // but the code path is exercised)

        invalidate_imported_cache();
    }

    #[test]
    fn test_discover_result_serialization() {
        let result = DiscoverResult {
            sessions: vec![],
            total: 42,
            truncated: true,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["total"], 42);
        assert_eq!(json["truncated"], true);
        assert!(json["sessions"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_watermark_indicates_pending_sync_no_change() {
        let wm = ImportWatermark {
            offset: 1000,
            mtime_ns: 500,
            file_size: 1000,
            last_uuid: None,
        };
        assert!(!watermark_indicates_pending_sync(&wm, 1000, 500));
        assert!(!watermark_indicates_pending_sync(&wm, 1000, 600));
    }

    #[test]
    fn test_watermark_indicates_pending_sync_append() {
        let wm = ImportWatermark {
            offset: 1000,
            mtime_ns: 500,
            file_size: 1000,
            last_uuid: None,
        };
        assert!(watermark_indicates_pending_sync(&wm, 1500, 600));
    }

    #[test]
    fn test_watermark_indicates_pending_sync_reconcile() {
        let wm = ImportWatermark {
            offset: 1000,
            mtime_ns: 500,
            file_size: 1000,
            last_uuid: None,
        };
        // Shrunk or mtime rolled back → reconcile path
        assert!(watermark_indicates_pending_sync(&wm, 800, 500));
        assert!(watermark_indicates_pending_sync(&wm, 1000, 400));
    }
}
