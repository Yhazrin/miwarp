use crate::agent::attachment::AttachmentData;
use crate::models::{max_attachment_size, RunStatus, ALLOWED_DOC_TYPES, ALLOWED_IMAGE_TYPES};
use std::time::Instant;

/// Extract content from `<promise>...</promise>` tag in text.
pub(super) fn extract_promise_tag(text: &str) -> Option<&str> {
    let start = text.find("<promise>")?;
    let end = text.find("</promise>")?;
    if end <= start + 9 {
        return None;
    }
    Some(text[start + 9..end].trim())
}

/// P0-C3: classify a non-JSON stdout line as "noise" (CLI banner, debug
/// log, ANSI escape) vs. "real" parse failure (genuinely garbled JSON).
///
/// Returns `true` when the line is overwhelmingly likely to be decorative
/// output rather than a malformed protocol event. The actor still records
/// noise lines to the events log (so users can see them) but does NOT
/// increment the desync counter for them — otherwise a single startup
/// banner kills the run before the CLI has even emitted its first
/// `control_request`.
///
/// Heuristic (deliberately permissive — false negatives are safe, the
/// threshold catches those):
///   - Pure ANSI: after stripping all whitespace + escape sequences,
///     nothing remains.
///   - No structural markers: line contains no `{`, `[`, or `]`, AND
///     no digit (so a banner like "Welcome to Claude Code v1.2.3!"
///     still trips the noise filter on the version digit, but a banner
///     like "Loading..." with no digits, brackets, or braces counts as
///     noise and is filtered out).
///
/// `is_protocol_noise("debug: foo")` → true
/// `is_protocol_noise("\x1b[32mOK\x1b[0m")` → true (ANSI + no digit after strip)
/// `is_protocol_noise("\x1b[K")` → true (pure ANSI cursor sequence)
/// `is_protocol_noise("Welcome to Claude v1.2.3")` → false (has digit)
/// `is_protocol_noise("{\"foo\": }")` → false (has `{`)
pub(crate) fn is_protocol_noise(line: &str) -> bool {
    // Strip ANSI escapes FIRST. Otherwise bytes inside a CSI sequence
    // — `ESC [` (0x1b 0x5b) — would falsely match the `[` check
    // below, and digits inside CSI parameters would falsely look
    // like content digits. A line that's nothing but ANSI control
    // sequences (cursor moves, color resets, etc.) is overwhelmingly
    // likely to be decorative CLI output.
    let stripped = strip_ansi(line);
    let stripped_trimmed = stripped.trim();

    // Real protocol events always start with `{` or `[`. Check on
    // the stripped text so ANSI `[` (the 0x5b byte) doesn't trip
    // this check.
    if stripped_trimmed.starts_with('{')
        || stripped_trimmed.starts_with('[')
        || stripped_trimmed.starts_with(']')
    {
        return false;
    }
    // Also reject if any structural marker appears anywhere in the
    // stripped text (catches mid-line JSON fragments).
    if stripped_trimmed.contains('{')
        || stripped_trimmed.contains('[')
        || stripped_trimmed.contains(']')
    {
        return false;
    }

    // Pure-ANSI / pure-whitespace line: nothing left after escape
    // removal (or only whitespace). Catches cursor-positioning
    // sequences like `\x1b[K` (clear to EOL) that the CLI emits
    // during long streams.
    if stripped_trimmed.is_empty() {
        return true;
    }

    // Banner / status text without any digits is overwhelmingly likely
    // to be a CLI decoration ("Loading...", "Connected", "Ready",
    // a colored "OK"). Digit-bearing lines like version banners
    // ("v1.2.3") are kept because they could be truncated
    // timestamps or partial protocol events.
    let has_digit = stripped_trimmed.chars().any(|c| c.is_ascii_digit());
    if !has_digit {
        return true;
    }

    false
}

/// Strip ANSI CSI sequences (`ESC [ ... letter`) and a few common
/// single-character escapes. Used by `is_protocol_noise` to detect
/// pure-control output lines. Not a full VT100 parser — just enough
/// for the desync prefilter's needs.
pub(crate) fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() {
            match bytes[i + 1] {
                b'[' => {
                    // CSI: ESC [ ... (param/intermediate) ... final-byte (0x40-0x7E)
                    i += 2;
                    while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                        i += 1;
                    }
                    if i < bytes.len() {
                        i += 1; // consume final byte
                    }
                    continue;
                }
                b']' => {
                    // OSC: ESC ] ... BEL or ESC \
                    i += 2;
                    while i < bytes.len() && bytes[i] != 0x07 {
                        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                    if i < bytes.len() && bytes[i] == 0x07 {
                        i += 1;
                    }
                    continue;
                }
                _ => {
                    // Single-char escape: ESC X — drop the ESC, keep X
                    i += 1;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

// ── Ralph Loop types ──

#[derive(Debug, Clone, PartialEq)]
pub(super) enum RalphPhase {
    Running,
    WaitingRetry,
    PausedByUser { was: Box<RalphPhase> },
    CancelPending,
}

#[allow(dead_code)] // started_at is stored for potential future use
pub(super) struct RalphLoopState {
    pub(super) prompt: String,
    pub(super) phase: RalphPhase,
    pub(super) iteration: u32,
    pub(super) max_iterations: u32,
    pub(super) completion_promise: Option<String>,
    pub(super) started_at: String,
    pub(super) consecutive_failures: u32,
    pub(super) max_consecutive_failures: u32,
    pub(super) retry_after: Option<Instant>,
    pub(super) turn_toplevel_texts: Vec<String>,
}

pub(super) fn map_state_to_run_status(state: &str) -> Option<RunStatus> {
    match state {
        "spawning" | "running" => Some(RunStatus::Running),
        "completed" => Some(RunStatus::Completed),
        "failed" => Some(RunStatus::Failed),
        "stopped" => Some(RunStatus::Stopped),
        "idle" => Some(RunStatus::Idle),
        _ => None,
    }
}

/// Sanitize a filename: keep only safe characters, truncate to 120 chars.
pub(super) fn att_safe_filename(name: &str) -> String {
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

/// Map MIME type to file extension.
pub(super) fn att_extension(mime: &str) -> &str {
    if mime.starts_with("image/png") {
        ".png"
    } else if mime.starts_with("image/jpeg") {
        ".jpg"
    } else if mime.starts_with("image/webp") {
        ".webp"
    } else if mime.starts_with("image/gif") {
        ".gif"
    } else if mime.starts_with("application/pdf") {
        ".pdf"
    } else {
        ""
    }
}

/// Save an attachment to `~/.miwarp/runs/{run_id}/attachments/` and return the path.
/// Returns `None` on failure (non-fatal, logged as warning).
pub(super) fn save_attachment_to_disk(run_id: &str, att: &AttachmentData) -> Option<String> {
    let att_dir = crate::storage::run_dir(run_id).join("attachments");
    if let Err(e) = std::fs::create_dir_all(&att_dir) {
        log::warn!("[actor] failed to create attachments dir: {}", e);
        return None;
    }
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&att.content_base64)
        .map_err(|e| log::warn!("[actor] failed to decode attachment base64: {}", e))
        .ok()?;
    if bytes.is_empty() {
        return None;
    }
    let safe_name = att_safe_filename(&att.filename);
    let ext = att_extension(&att.media_type);
    let filename = format!(
        "{}-{}-{}{}",
        chrono::Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().to_string()[..6],
        safe_name,
        ext
    );
    let full_path = att_dir.join(&filename);
    if let Err(e) = std::fs::write(&full_path, &bytes) {
        log::warn!("[actor] failed to write attachment to disk: {}", e);
        return None;
    }
    let path_str = full_path.to_string_lossy().to_string();
    log::debug!("[actor] saved attachment to disk: {}", path_str);
    Some(path_str)
}

/// Build a stream-json `user` payload with optional multimodal attachments.
/// Shared between actor's `handle_send_message` and `session.rs` initial message paths.
/// When attachments are present, saves them to disk under the run directory and
/// includes file paths in the text block so the model can reference them later.
pub fn build_user_payload(
    text: &str,
    attachments: &[AttachmentData],
    run_id: &str,
) -> (serde_json::Value, String) {
    let content = if attachments.is_empty() {
        serde_json::json!(text)
    } else {
        let mut parts = Vec::new();
        let mut saved_paths: Vec<String> = Vec::new();
        for att in attachments {
            // Size check (base64 → raw bytes estimate: base64 len * 3/4)
            let raw_size = (att.content_base64.len() as u64) * 3 / 4;
            let limit = max_attachment_size(&att.media_type);
            if raw_size > limit {
                let limit_mb = limit / (1024 * 1024);
                log::warn!(
                    "[actor] skipping oversized attachment: {} ({:.1}MB > {}MB limit)",
                    att.filename,
                    raw_size as f64 / (1024.0 * 1024.0),
                    limit_mb
                );
                continue;
            }
            // Save to disk for later Read tool access
            if let Some(path) = save_attachment_to_disk(run_id, att) {
                saved_paths.push(path);
            }
            if ALLOWED_DOC_TYPES.contains(&att.media_type.as_str()) {
                parts.push(serde_json::json!({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": att.media_type,
                        "data": att.content_base64,
                    }
                }));
            } else if ALLOWED_IMAGE_TYPES.contains(&att.media_type.as_str()) {
                parts.push(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": att.media_type,
                        "data": att.content_base64,
                    }
                }));
            } else {
                log::warn!(
                    "[actor] skipping unsupported attachment type: {}",
                    att.media_type
                );
            }
        }
        // Augment text with saved file paths so the model can Read them later
        let augmented_text = if saved_paths.is_empty() {
            text.to_string()
        } else {
            let paths_list = saved_paths
                .iter()
                .map(|p| format!("- {}", p))
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "{}\n\n[Attached files saved at:\n{}\nUse these file paths with the Read tool if you need to access them later.]",
                text, paths_list
            )
        };
        parts.insert(
            0,
            serde_json::json!({ "type": "text", "text": augmented_text }),
        );
        serde_json::json!(parts)
    };

    let uuid = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "type": "user",
        "uuid": &uuid,
        "message": {
            "role": "user",
            "content": content,
        }
    });
    (payload, uuid)
}
