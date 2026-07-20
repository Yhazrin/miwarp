//! CLI session discovery, normalization, import, and incremental sync.
//!
//! Reads Claude CLI transcript files (~/.claude/projects/*/*.jsonl) and converts
//! them into MiWarp run format (~/.miwarp/runs/{run-id}/).

use crate::models::protocol_state::{validate_bus_event, ProtocolState};
use crate::models::BusEvent;
use crate::storage::events::{is_replayable, EventWriter};
use crate::storage::shared;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

// ── Types ────────────────────────────────────────────────────────────

pub fn encode_cwd(cwd: &str) -> String {
    cwd.replace(['/', '\\'], "-")
}

/// Validate that a path is within ~/.claude/projects/ (path traversal guard).
pub(super) fn validate_cli_path(path: &Path) -> Result<(), String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("canonicalize failed: {}", e))?;
    let projects_dir = shared::claude_projects_dir().ok_or("cannot determine home dir")?;
    if let Ok(canonical_projects) = projects_dir.canonicalize() {
        if !canonical.starts_with(&canonical_projects) {
            return Err(format!(
                "path {:?} is outside ~/.claude/projects/",
                canonical
            ));
        }
    }
    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err("file is not .jsonl".to_string());
    }
    Ok(())
}

/// Path to import-index.jsonl for a run.
pub(super) fn import_index_path(run_id: &str) -> PathBuf {
    super::super::run_dir(run_id).join("import-index.jsonl")
}

/// Load source_key set from an import-index file for dedup.
pub(super) fn load_import_skip_set(index_path: &Path) -> HashSet<String> {
    let mut skip_set = HashSet::new();
    if let Ok(content) = fs::read_to_string(index_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                if let Some(key) = val.get("source_key").and_then(|v| v.as_str()) {
                    skip_set.insert(key.to_string());
                }
            }
        }
    }
    skip_set
}

// ── Schema Normalization ──────────────────────────────────────────

/// Convert a CLI transcript line to stream-json format for map_event().
pub fn normalize_transcript_line(raw: &Value) -> Option<Value> {
    let event_type = raw.get("type")?.as_str()?;
    match event_type {
        "queue-operation" | "file-history-snapshot" => None,

        "progress" => {
            let data = raw.get("data")?;
            let mut out = serde_json::Map::new();

            // type → "system", data.type → subtype
            out.insert("type".into(), json!("system"));
            if let Some(sub) = data.get("type").and_then(|v| v.as_str()) {
                out.insert("subtype".into(), json!(sub));
            }

            // camelCase→snake_case field promotion from data
            let renames = &[
                ("hookEvent", "hook_event"),
                ("hookId", "hook_id"),
                ("hookName", "hook_name"),
                ("outcome", "outcome"),
                ("stdout", "stdout"),
                ("stderr", "stderr"),
                ("exitCode", "exit_code"),
                ("command", "command"),
                ("output", "output"),
                ("exitStatus", "exit_status"),
            ];
            for (src, dst) in renames {
                if let Some(v) = data.get(*src) {
                    out.insert((*dst).into(), v.clone());
                }
            }

            // Pass through unmapped data fields
            if let Some(obj) = data.as_object() {
                for (k, v) in obj {
                    if k == "type" || renames.iter().any(|(s, _)| s == k) {
                        continue;
                    }
                    out.insert(k.clone(), v.clone());
                }
            }

            // Top-level camelCase→snake_case
            let top_renames: &[(&str, &str)] = &[
                ("toolUseID", "hook_id"),
                ("parentToolUseID", "parent_tool_use_id"),
                ("sessionId", "session_id"),
            ];
            for (src, dst) in top_renames {
                if !out.contains_key(*dst) {
                    if let Some(v) = raw.get(*src) {
                        out.insert((*dst).into(), v.clone());
                    }
                }
            }

            // Preserve top-level uuid/timestamp
            if let Some(u) = raw.get("uuid") {
                out.insert("uuid".into(), u.clone());
            }
            if let Some(t) = raw.get("timestamp") {
                out.insert("timestamp".into(), t.clone());
            }

            Some(Value::Object(out))
        }

        "user" | "assistant" | "system" | "result" => {
            let mut out = raw.as_object()?.clone();
            // Top-level camelCase→snake_case
            let top_renames: &[(&str, &str)] = &[
                ("parentToolUseID", "parent_tool_use_id"),
                ("sessionId", "session_id"),
                ("toolUseResult", "tool_use_result"),
            ];
            for (src, dst) in top_renames {
                if let Some(v) = out.remove(*src) {
                    out.insert((*dst).into(), v);
                }
            }
            Some(Value::Object(out))
        }

        // Unknown types: pass through
        _ => Some(raw.clone()),
    }
}

// ── TranscriptImporter ──────────────────────────────────────────────

/// Shared line processing for import and sync.
pub(super) struct TranscriptImporter {
    run_id: String,
    protocol: ProtocolState,
    event_writer: std::sync::Arc<EventWriter>,
    pub(super) turn_counter: u32,
    pending_usage: Option<Value>, // Current turn's assistant.message.usage candidate
    has_usage_update_this_turn: bool, // Whether current turn already has a UsageUpdate
    pending_model: Option<String>, // Model from last assistant message
    pub(super) skipped_subtypes: HashMap<String, u64>,
    pub(super) events_imported: u64,
    pub(super) events_skipped: u64,
    pub(super) usage_incomplete: bool,
    last_user_is_command: bool, // Last user line was a slash command
    pub(super) known_usage_turns: HashSet<u64>, // Turns that already have usage_update in events.jsonl
}

impl TranscriptImporter {
    pub(super) fn new(run_id: String, writer: std::sync::Arc<EventWriter>) -> Self {
        Self {
            run_id,
            protocol: ProtocolState::new(false),
            event_writer: writer,
            turn_counter: 0,
            pending_usage: None,
            has_usage_update_this_turn: false,
            pending_model: None,
            skipped_subtypes: HashMap::new(),
            events_imported: 0,
            events_skipped: 0,
            usage_incomplete: false,
            last_user_is_command: false,
            known_usage_turns: HashSet::new(),
        }
    }

    /// Check if a user line is a real user prompt (not a command/metadata).
    pub(super) fn is_real_user_prompt(normalized: &Value) -> bool {
        let message = normalized.get("message").unwrap_or(normalized);
        if let Some(is_meta) = normalized.get("isMeta").and_then(|v| v.as_bool()) {
            if is_meta {
                return false;
            }
        }
        if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
            if text.starts_with("<local-command-stdout>") {
                return false;
            }
            if text.contains("<local-command-caveat>") {
                return false;
            }
            if text.contains("<command-name>") {
                return false;
            }
            if text.contains("<task-notification>") && text.contains("</task-notification>") {
                return false;
            }
            return true;
        }
        false
    }

    /// Produce a candidate UsageUpdate for the current turn (if needed).
    /// Returns None if already covered by map_event, known_usage_turns, or no data.
    fn flush_turn_usage(&mut self) -> Option<BusEvent> {
        if self.has_usage_update_this_turn {
            return None;
        }
        if self.known_usage_turns.contains(&(self.turn_counter as u64)) {
            log::debug!(
                "[cli_sessions] usage skip (known): turn={}",
                self.turn_counter
            );
            return None;
        }
        if let Some(ref usage) = self.pending_usage {
            let input_tokens = usage
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let output_tokens = usage
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cache_read = usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64());
            let cache_write = usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64());

            let model = self.pending_model.as_deref().unwrap_or("unknown");
            let cost = crate::pricing::estimate_cost(
                model,
                input_tokens,
                output_tokens,
                cache_read.unwrap_or(0),
                cache_write.unwrap_or(0),
            );

            log::debug!(
                "[cli_sessions] usage synthesized: turn={}, cost={:.6}",
                self.turn_counter,
                cost
            );

            Some(BusEvent::UsageUpdate {
                run_id: self.run_id.clone(),
                input_tokens,
                output_tokens,
                cache_read_tokens: cache_read,
                cache_write_tokens: cache_write,
                total_cost_usd: cost,
                turn_index: Some(self.turn_counter),
                model_usage: None,
                context_window_used_percentage: None,
                context_window_remaining_percentage: None,
                duration_api_ms: None,
                duration_ms: None,
                num_turns: None,
                stop_reason: None,
                service_tier: None,
                speed: None,
                web_fetch_requests: None,
                cache_creation_5m: None,
                cache_creation_1h: None,
            })
        } else {
            self.usage_incomplete = true;
            log::debug!(
                "[cli_sessions] usage incomplete: turn={}",
                self.turn_counter
            );
            None
        }
    }

    /// Process a single transcript line — two-phase: produce candidates, then write/skip.
    pub(super) fn process_line(
        &mut self,
        raw_line: &str,
        raw_json: &Value,
        byte_offset: u64,
        index_writer: &mut BufWriter<File>,
        skip_set: Option<&HashSet<String>>,
    ) -> Result<(), String> {
        let raw_trim = raw_line.trim();
        let lk = shared::line_key(raw_json, byte_offset, raw_trim);

        let normalized = match normalize_transcript_line(raw_json) {
            Some(n) => n,
            None => {
                log::trace!("[cli_sessions] normalize: skipped (queue-op/file-history)");
                return Ok(());
            }
        };

        let norm_type = normalized
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let ts = shared::extract_timestamp(raw_json)
            .or_else(|| shared::extract_timestamp(&normalized))
            .unwrap_or_default();

        // Track event counts per type for event_key generation
        let mut event_counts: HashMap<String, usize> = HashMap::new();

        // ── Phase 1: Produce candidate events ──

        let mut candidates: Vec<BusEvent> = Vec::new();
        // Handle user messages — synthesize UserMessage
        if norm_type == "user" {
            // Reset command flag on every user line (fix: sticky flag)
            self.last_user_is_command = false;

            if Self::is_real_user_prompt(&normalized) {
                // Flush usage candidate for previous turn (goes through unified write pipeline)
                if self.turn_counter > 0 {
                    if let Some(usage_ev) = self.flush_turn_usage() {
                        candidates.push(usage_ev);
                    }
                }
                self.turn_counter += 1;
                self.pending_usage = None;
                self.has_usage_update_this_turn = false;
                self.pending_model = None;

                let message = normalized.get("message").unwrap_or(&normalized);
                if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                    candidates.push(BusEvent::UserMessage {
                        run_id: self.run_id.clone(),
                        text: text.to_string(),
                        uuid: normalized
                            .get("uuid")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    });
                }
            } else {
                // Check if this is a slash command (for command_output filtering)
                let message = normalized.get("message").unwrap_or(&normalized);
                if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                    self.last_user_is_command = text.contains("<command-name>");
                }
            }
        }

        // Track assistant message usage for synthesis
        if norm_type == "assistant" {
            let message = normalized.get("message").unwrap_or(&normalized);
            if let Some(usage) = message.get("usage") {
                self.pending_usage = Some(usage.clone());
            }
            if let Some(model) = message.get("model").and_then(|v| v.as_str()) {
                self.pending_model = Some(model.to_string());
            }
        }

        // Run through map_event
        let mapped = self.protocol.map_event(&self.run_id, &normalized);

        // Check for UsageUpdate and validate before extending candidates
        for ev in mapped {
            if matches!(&ev, BusEvent::UsageUpdate { .. }) {
                self.has_usage_update_this_turn = true;
            }
            if let Some(warn) = validate_bus_event(&ev) {
                log::debug!(
                    "[cli_sessions] invalid event dropped: {}.{}: {}",
                    warn.event_type,
                    warn.field,
                    warn.detail
                );
                self.protocol.stats.invalid_tool_count += 1;
                continue;
            }
            candidates.push(ev);
        }

        // ── Phase 2: Filter and write ──

        for event in candidates {
            let tag = shared::bus_event_tag(&event);

            // Replayable filter
            if !is_replayable(&event) {
                self.events_skipped += 1;
                *self.skipped_subtypes.entry(tag.clone()).or_insert(0) += 1;
                continue;
            }

            // command_output content filter
            if let BusEvent::CommandOutput { ref content, .. } = event {
                if content.contains("## Context Usage")
                    || content.contains("## Session Cost")
                    || self.last_user_is_command
                {
                    self.events_skipped += 1;
                    *self
                        .skipped_subtypes
                        .entry("command_output_filtered".to_string())
                        .or_insert(0) += 1;
                    continue;
                }
            }

            let n = event_counts.entry(tag.clone()).or_insert(0);
            let ek = shared::event_key(&lk, &tag, *n);
            *n += 1;

            // Skip-set check (reconcile mode)
            if let Some(ss) = skip_set {
                if ss.contains(&ek) {
                    continue;
                }
            }

            // Write event
            let seq = self
                .event_writer
                .write_bus_event_with_ts(&self.run_id, &event, &ts)?;

            // Write index entry
            writeln!(
                index_writer,
                "{}",
                json!({"source_key": ek, "imported_seq": seq})
            )
            .map_err(|e| format!("write index: {}", e))?;

            self.events_imported += 1;
        }

        Ok(())
    }

    /// Warmup mode: update ProtocolState and turn tracking without writing events.
    pub(super) fn warmup_line(&mut self, raw_json: &Value) -> Result<(), String> {
        let normalized = match normalize_transcript_line(raw_json) {
            Some(n) => n,
            None => return Ok(()),
        };

        let norm_type = normalized
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Track turns and command flag (must mirror process_line logic)
        if norm_type == "user" {
            self.last_user_is_command = false;
            if Self::is_real_user_prompt(&normalized) {
                // Check previous turn's usage completeness before advancing
                if self.turn_counter > 0
                    && !self.has_usage_update_this_turn
                    && self.pending_usage.is_none()
                {
                    self.usage_incomplete = true;
                }
                self.turn_counter += 1;
                self.pending_usage = None;
                self.has_usage_update_this_turn = false;
                self.pending_model = None;
            } else {
                let message = normalized.get("message").unwrap_or(&normalized);
                if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                    self.last_user_is_command = text.contains("<command-name>");
                }
            }
        }

        // Track assistant usage
        if norm_type == "assistant" {
            let message = normalized.get("message").unwrap_or(&normalized);
            if let Some(usage) = message.get("usage") {
                self.pending_usage = Some(usage.clone());
            }
            if let Some(model) = message.get("model").and_then(|v| v.as_str()) {
                self.pending_model = Some(model.to_string());
            }
        }

        // Run map_event for state tracking
        let mapped = self.protocol.map_event(&self.run_id, &normalized);
        for ev in &mapped {
            if matches!(ev, BusEvent::UsageUpdate { .. }) {
                self.has_usage_update_this_turn = true;
            }
            if let Some(warn) = validate_bus_event(ev) {
                log::debug!(
                    "[cli_sessions] invalid event dropped (v2): {}.{}: {}",
                    warn.event_type,
                    warn.field,
                    warn.detail
                );
                self.protocol.stats.invalid_tool_count += 1;
            }
        }

        Ok(())
    }

    /// Finalize — flush usage for the last turn via unified write pipeline.
    pub(super) fn finalize(
        &mut self,
        ts: &str,
        index_writer: &mut BufWriter<File>,
        skip_set: Option<&HashSet<String>>,
    ) -> Result<(), String> {
        if self.turn_counter > 0 {
            if let Some(event) = self.flush_turn_usage() {
                let lk = format!("v1:finalize:{}", self.turn_counter);
                let tag = shared::bus_event_tag(&event);
                let ek = shared::event_key(&lk, &tag, 0);

                // Skip-set check (reconcile mode)
                if let Some(ss) = skip_set {
                    if ss.contains(&ek) {
                        return Ok(());
                    }
                }

                let seq = self
                    .event_writer
                    .write_bus_event_with_ts(&self.run_id, &event, ts)?;
                writeln!(
                    index_writer,
                    "{}",
                    json!({"source_key": ek, "imported_seq": seq})
                )
                .map_err(|e| format!("write index: {}", e))?;
                self.events_imported += 1;
            }
        }
        Ok(())
    }
}

/// Scan existing events.jsonl for usage_update turn indices.
/// Used by sync/reconcile to avoid re-synthesizing usage for known turns.
pub(super) fn load_known_usage_turns(run_id: &str) -> HashSet<u64> {
    let events_path = super::super::run_dir(run_id).join("events.jsonl");
    let mut turns = HashSet::new();
    let Ok(content) = fs::read_to_string(&events_path) else {
        return turns;
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Quick substring check before parsing
        if !trimmed.contains("\"usage_update\"") {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
            let event = val.get("event").unwrap_or(&val);
            if event.get("type").and_then(|v| v.as_str()) == Some("usage_update") {
                if let Some(ti) = event.get("turn_index").and_then(|v| v.as_u64()) {
                    turns.insert(ti);
                }
            }
        }
    }
    log::debug!(
        "[cli_sessions] loaded {} known usage turns for run {}",
        turns.len(),
        run_id
    );
    turns
}

// ── Imported-index cache ─────────────────────────────────────────────

use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::time::{Duration, Instant};

type ImportedIndex = HashMap<(String, String), String>;
type CacheEntry = (ImportedIndex, Instant);

static IMPORTED_CACHE: Lazy<Mutex<Option<CacheEntry>>> = Lazy::new(|| Mutex::new(None));

pub(super) fn build_imported_index_cached(max_age: Duration) -> ImportedIndex {
    // Short lock: check cache hit
    {
        let cache = IMPORTED_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((ref index, ref ts)) = *cache {
            if ts.elapsed() < max_age {
                log::debug!(
                    "[cli_sessions] imported-index cache hit ({} entries, age {:?})",
                    index.len(),
                    ts.elapsed()
                );
                return index.clone();
            }
        }
    } // Release lock

    // Rebuild outside lock (slow I/O)
    log::debug!("[cli_sessions] imported-index cache miss, rebuilding");
    let index = super::discover::build_imported_index();

    // Short lock: write back
    {
        let mut cache = IMPORTED_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        *cache = Some((index.clone(), Instant::now()));
    }
    log::debug!(
        "[cli_sessions] imported-index rebuilt ({} entries)",
        index.len()
    );
    index
}

pub(super) fn invalidate_imported_cache_inner() {
    *IMPORTED_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
