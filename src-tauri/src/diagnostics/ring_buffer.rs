//! v1.0.9 Runtime Diagnostics — bounded ring buffer + redaction.
//!
//! This is the source of truth for what the diagnostics center
//! captures and how it redacts. The Observer trait in
//! `src-tauri/src/observability/observer.rs` (added in a follow-up
//! commit) is what the recovery state machine and the runtime hub
//! call into. This module only stores the events.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Default cap for the per-category ring buffer. 1000 events
/// covers ~5 minutes of high-frequency activity (3 events/sec)
/// before the oldest is evicted. Configurable in the constructor
/// for tests and the per-project settings UI.
pub const DEFAULT_RING_CAP: usize = 1000;

// ── DiagnosticEvent ──

/// A single diagnostic event. The `metadata` field is the only
/// free-form string bucket; everything else is typed. The
/// `Redactor` strips sensitive substrings from `metadata` at
/// write time so the ring buffer and any export never contain
/// them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DiagnosticEvent {
    pub timestamp_ms: u64,
    pub category: DiagnosticCategory,
    pub severity: DiagnosticSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_request_id: Option<String>,
    /// Free-form phase label, e.g. "submitting → queued",
    /// "lifecycle: ready", "spawning".
    pub phase: String,
    /// Typed error code, when severity >= Warn. Mirrors the
    /// variants in `RuntimeError` / `RuntimeHubError` /
    /// `PermissionError`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Free-form string bucket. The redactor runs at write time
    /// and again at export time; the API accepts whatever the
    /// caller has, but the stored value is post-redaction.
    pub metadata: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCategory {
    SendTx,
    PermissionTx,
    Recovery,
    ActorLifecycle,
    RuntimeHealth,
    Connection,
    Spawn,
    ExternalOp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSeverity {
    Info,
    Warn,
    Error,
}

// ── Redactor ──

/// What to do with the part of the input that follows the
/// matched pattern. Without this, "Bearer " would only redact
/// the literal "Bearer " string, leaving the actual token
/// (`eyJabc.def.ghi`) in the output. The trailing consume
/// keeps the whole sensitive value out of the buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedactionTrailing {
    /// Consume nothing more — just the pattern itself.
    None,
    /// Consume ASCII alphanumeric + dash + underscore (typical
    /// API key body, e.g. `sk-abcdef12345_def`).
    KeyBody,
    /// Consume non-whitespace (typical header value, e.g.
    /// `Bearer eyJabc.def.ghi` → "Bearer " + token).
    NonWhitespace,
    /// Consume everything to the end of the line / log entry
    /// (e.g. `[prompt] the actual prompt text…`).
    ToEnd,
}

/// Pattern + description for sensitive substrings. The
/// `Redactor` is constructed with a fixed list at startup;
/// callers cannot add patterns at runtime (avoiding accidental
/// redaction holes).
#[derive(Debug, Clone)]
pub struct RedactionRule {
    pub pattern: &'static str,
    pub reason: &'static str,
    pub trailing: RedactionTrailing,
}

/// Default redaction rule set. The pattern list is a deliberate
/// frozen contract — adding a rule is a CLI / settings change,
/// not a code path. The list covers the most common leaks from
/// the legacy logging system plus the v1.0.9 contract:
/// - API keys (sk-…, claude-…, anthropic-…)
/// - Bearer / Authorization headers (whole value, not just prefix)
/// - prompt text markers (the legacy "[prompt]" prefix)
/// - file body markers (whole body)
/// - terminal output dumps (whole dump)
pub fn default_rules() -> Vec<RedactionRule> {
    vec![
        RedactionRule {
            pattern: "sk-",
            reason: "openai key prefix",
            trailing: RedactionTrailing::KeyBody,
        },
        RedactionRule {
            pattern: "claude-",
            reason: "claude key prefix",
            trailing: RedactionTrailing::KeyBody,
        },
        RedactionRule {
            pattern: "anthropic-",
            reason: "anthropic key prefix",
            trailing: RedactionTrailing::KeyBody,
        },
        RedactionRule {
            pattern: "Bearer ",
            reason: "bearer token",
            trailing: RedactionTrailing::NonWhitespace,
        },
        RedactionRule {
            pattern: "Authorization:",
            reason: "authorization header",
            trailing: RedactionTrailing::ToEnd,
        },
        RedactionRule {
            pattern: "[prompt]",
            reason: "prompt text marker",
            trailing: RedactionTrailing::ToEnd,
        },
        RedactionRule {
            pattern: "[file-body]",
            reason: "file body marker",
            trailing: RedactionTrailing::ToEnd,
        },
        RedactionRule {
            pattern: "[terminal-output]",
            reason: "terminal output marker",
            trailing: RedactionTrailing::ToEnd,
        },
    ]
}

#[derive(Debug, Clone)]
pub struct Redactor {
    rules: Arc<Vec<RedactionRule>>,
}

impl Default for Redactor {
    fn default() -> Self {
        Self::new(default_rules())
    }
}

impl Redactor {
    pub fn new(rules: Vec<RedactionRule>) -> Self {
        Self {
            rules: Arc::new(rules),
        }
    }

    /// Returns the input with every rule pattern substring
    /// (plus its trailing value) replaced by
    /// `[REDACTED:<reason>]`. Case-sensitive; the legacy log
    /// format is upper-case in places, so callers should pass
    /// the original-cased string.
    pub fn redact(&self, input: &str) -> String {
        let mut out = input.to_string();
        for rule in self.rules.iter() {
            while let Some(pos) = out.find(rule.pattern) {
                let value_end = match rule.trailing {
                    RedactionTrailing::None => pos + rule.pattern.len(),
                    RedactionTrailing::KeyBody => {
                        let mut end = pos + rule.pattern.len();
                        for (i, b) in out[pos + rule.pattern.len()..].bytes().enumerate() {
                            if b.is_ascii_alphanumeric() || b == b'_' || b == b'-' {
                                end = pos + rule.pattern.len() + i + 1;
                            } else {
                                break;
                            }
                        }
                        end
                    }
                    RedactionTrailing::NonWhitespace => {
                        let mut end = pos + rule.pattern.len();
                        for (i, b) in out[pos + rule.pattern.len()..].bytes().enumerate() {
                            if !b.is_ascii_whitespace() {
                                end = pos + rule.pattern.len() + i + 1;
                            } else {
                                break;
                            }
                        }
                        end
                    }
                    RedactionTrailing::ToEnd => out.len(),
                };
                out.replace_range(pos..value_end, &format!("[REDACTED:{}]", rule.reason));
            }
        }
        out
    }

    /// Returns `true` if any rule pattern is present in `input`.
    /// Used by tests and by the export manifest to assert
    /// redaction actually happened.
    pub fn would_redact(&self, input: &str) -> bool {
        self.rules.iter().any(|r| input.contains(r.pattern))
    }
}

// ── Ring buffer ──

/// Bounded ring buffer of `DiagnosticEvent`. Per-category;
/// `push` evicts the oldest when at cap. The implementation
/// uses `VecDeque` for O(1) push-back and O(1) pop-front. The
/// `Mutex` is `tokio::sync::Mutex` so writes from async code
/// (Observer callbacks) and reads from Tauri commands can both
/// hold it without `Send` issues.
pub struct DiagnosticRingBuffer {
    capacity: usize,
    events: Mutex<VecDeque<DiagnosticEvent>>,
    redactor: Redactor,
}

impl DiagnosticRingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            events: Mutex::new(VecDeque::with_capacity(capacity)),
            redactor: Redactor::default(),
        }
    }

    /// Push a new event, redacting `metadata` first. If the
    /// buffer is at cap, the oldest event is evicted.
    pub async fn push(&self, mut event: DiagnosticEvent) {
        event.metadata = self.redactor.redact(&event.metadata);
        let mut guard = self.events.lock().await;
        if guard.len() >= self.capacity {
            guard.pop_front();
        }
        guard.push_back(event);
    }

    /// Snapshot the current buffer. The returned `Vec` is a
    /// plain copy; callers may iterate freely without holding
    /// the lock.
    pub async fn snapshot(&self) -> Vec<DiagnosticEvent> {
        self.events.lock().await.iter().cloned().collect()
    }

    /// Count of events currently stored.
    pub async fn len(&self) -> usize {
        self.events.lock().await.len()
    }

    /// Returns `true` when the buffer holds no events.
    pub async fn is_empty(&self) -> bool {
        self.events.lock().await.is_empty()
    }

    /// Capacity. Used by tests and by the UI to show "ring
    /// buffer at 73%".
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Empty the buffer. Used by the `diagnostics_clear`
    /// command and on dispose.
    pub async fn clear(&self) {
        self.events.lock().await.clear();
    }

    /// Replace the redactor's rule set. Provided so tests can
    /// inject their own patterns; production code should not
    /// call this.
    #[cfg(test)]
    pub fn with_redactor(mut self, redactor: Redactor) -> Self {
        self.redactor = redactor;
        self
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    fn event_with_metadata(meta: &str) -> DiagnosticEvent {
        DiagnosticEvent {
            timestamp_ms: 0,
            category: DiagnosticCategory::SendTx,
            severity: DiagnosticSeverity::Info,
            run_id: Some("run-1".to_string()),
            session_id: None,
            runtime_id: Some("claude-code".to_string()),
            connection_generation: Some(1),
            client_message_id: Some("cmsg-1".to_string()),
            permission_request_id: None,
            phase: "submitting".to_string(),
            error_code: None,
            retryable: false,
            duration_ms: None,
            metadata: meta.to_string(),
        }
    }

    #[test]
    fn redactor_strips_openai_key_prefix() {
        let r = Redactor::default();
        let out = r.redact("user token sk-abcdef12345 leaked");
        assert!(!out.contains("sk-abcdef12345"));
        assert!(out.contains("[REDACTED:openai key prefix]"));
    }

    #[test]
    fn redactor_strips_bearer_token() {
        let r = Redactor::default();
        let out = r.redact("auth: Bearer eyJabc.def.ghi");
        assert!(!out.contains("eyJabc"));
        assert!(out.contains("[REDACTED:bearer token]"));
    }

    #[test]
    fn redactor_strips_authorization_header() {
        let r = Redactor::default();
        let out = r.redact("headers: Authorization: Basic dXNlcjpwYXNz");
        assert!(!out.contains("dXNlcjpwYXNz"));
        assert!(out.contains("[REDACTED:authorization header]"));
    }

    #[test]
    fn redactor_strips_prompt_marker() {
        let r = Redactor::default();
        let out = r.redact("[prompt] what is the meaning of life");
        assert!(!out.contains("meaning of life"));
        assert!(out.contains("[REDACTED:prompt text marker]"));
    }

    #[test]
    fn redactor_strips_file_body_marker() {
        let r = Redactor::default();
        let out = r.redact("[file-body] <huge binary blob>");
        assert!(!out.contains("<huge"));
        assert!(out.contains("[REDACTED:file body marker]"));
    }

    #[test]
    fn redactor_strips_terminal_output_marker() {
        let r = Redactor::default();
        let out = r.redact("[terminal-output] some big ANSI blob");
        assert!(!out.contains("ANSI"));
        assert!(out.contains("[REDACTED:terminal output marker]"));
    }

    #[test]
    fn redactor_replaces_all_occurrences() {
        let r = Redactor::default();
        let out = r.redact("first sk-aaa and second sk-bbb");
        assert!(!out.contains("sk-aaa"));
        assert!(!out.contains("sk-bbb"));
        assert_eq!(out.matches("[REDACTED:openai key prefix]").count(), 2);
    }

    #[test]
    fn would_redact_returns_true_when_pattern_present() {
        let r = Redactor::default();
        assert!(r.would_redact("got key sk-abc"));
        assert!(!r.would_redact("harmless message"));
    }

    #[tokio::test]
    async fn ring_buffer_enforces_capacity() {
        let buf = DiagnosticRingBuffer::new(100);
        for i in 0..250 {
            buf.push(event_with_metadata(&format!("event {i}"))).await;
        }
        assert_eq!(buf.len().await, 100);
        // The oldest 150 events were evicted; only events 150..250 remain.
        let snap = buf.snapshot().await;
        assert_eq!(snap[0].metadata, "event 150");
        assert_eq!(snap[99].metadata, "event 249");
    }

    #[tokio::test]
    async fn ring_buffer_redacts_at_push_time() {
        let buf = DiagnosticRingBuffer::new(10);
        buf.push(event_with_metadata("key sk-secret123 here")).await;
        let snap = buf.snapshot().await;
        assert!(!snap[0].metadata.contains("sk-secret123"));
        assert!(snap[0].metadata.contains("[REDACTED:"));
    }

    #[tokio::test]
    async fn ring_buffer_clear_empties() {
        let buf = DiagnosticRingBuffer::new(10);
        buf.push(event_with_metadata("one")).await;
        buf.push(event_with_metadata("two")).await;
        assert_eq!(buf.len().await, 2);
        buf.clear().await;
        assert_eq!(buf.len().await, 0);
    }

    #[tokio::test]
    async fn ring_buffer_capacity_default_is_1000() {
        let buf = DiagnosticRingBuffer::new(DEFAULT_RING_CAP);
        assert_eq!(buf.capacity(), 1000);
    }

    #[tokio::test]
    async fn ring_buffer_push_at_cap_evicts_oldest() {
        let buf = DiagnosticRingBuffer::new(2);
        buf.push(event_with_metadata("a")).await;
        buf.push(event_with_metadata("b")).await;
        buf.push(event_with_metadata("c")).await;
        let snap = buf.snapshot().await;
        assert_eq!(snap.len(), 2);
        assert_eq!(snap[0].metadata, "b");
        assert_eq!(snap[1].metadata, "c");
    }

    #[test]
    fn default_rules_include_all_required_categories() {
        let rules = default_rules();
        let patterns: Vec<&str> = rules.iter().map(|r| r.pattern).collect();
        // API keys
        assert!(patterns.contains(&"sk-"));
        assert!(patterns.contains(&"claude-"));
        // Headers
        assert!(patterns.contains(&"Bearer "));
        assert!(patterns.contains(&"Authorization:"));
        // v1.0.9 markers
        assert!(patterns.contains(&"[prompt]"));
        assert!(patterns.contains(&"[file-body]"));
        assert!(patterns.contains(&"[terminal-output]"));
    }

    #[test]
    fn diagnostic_event_serializes_optional_fields() {
        let e = event_with_metadata("plain metadata");
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"category\":\"send_tx\""));
        assert!(json.contains("\"severity\":\"info\""));
        assert!(json.contains("\"metadata\":\"plain metadata\""));
        // Optional fields that are None are skipped.
        assert!(!json.contains("permission_request_id"));
        assert!(!json.contains("error_code"));
    }

    #[test]
    fn redactor_does_not_match_when_pattern_absent() {
        let r = Redactor::default();
        let out = r.redact("harmless log line without secrets");
        assert_eq!(out, "harmless log line without secrets");
    }
}
