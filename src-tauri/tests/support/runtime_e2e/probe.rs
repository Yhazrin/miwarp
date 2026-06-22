use super::constants::{DEFAULT_PROBE_TIMEOUT_SECS, ENV_PROBE_TIMEOUT_SECS, SKIPPED_ENVIRONMENT};
use super::redaction::redact_line;
use miwarp_desktop_lib::agent::claude_stream::{augmented_path, which_binary};
use miwarp_desktop_lib::agent::runtime::{detect_mimo_version, resolve_mimo_binary};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeState {
    BinaryMissing,
    Unauthenticated,
    Unsupported,
    Ready,
}

impl ProbeState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BinaryMissing => "binary_missing",
            Self::Unauthenticated => "unauthenticated",
            Self::Unsupported => "unsupported",
            Self::Ready => "ready",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProbeResult {
    pub runtime: String,
    pub state: ProbeState,
    pub binary: Option<String>,
    pub version: Option<String>,
    pub detail: String,
}

impl ProbeResult {
    pub fn skipped(&self) -> bool {
        self.state != ProbeState::Ready
    }

    pub fn skip_reason(&self) -> Option<&'static str> {
        if self.skipped() {
            Some(SKIPPED_ENVIRONMENT)
        } else {
            None
        }
    }
}

pub fn probe_timeout() -> Duration {
    std::env::var(ENV_PROBE_TIMEOUT_SECS)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(DEFAULT_PROBE_TIMEOUT_SECS))
}

pub fn probe_runtime(runtime: &str) -> ProbeResult {
    if !super::constants::STARTABLE_RUNTIMES.contains(&runtime) {
        return ProbeResult {
            runtime: runtime.to_string(),
            state: ProbeState::Unsupported,
            binary: None,
            version: None,
            detail: "runtime is not startable in v1.0.9 phase-1 harness".into(),
        };
    }

    match runtime {
        "claude" => probe_claude(),
        "codex" => probe_codex(),
        "mimo" => probe_mimo(),
        "opencode" => probe_opencode(),
        _ => ProbeResult {
            runtime: runtime.to_string(),
            state: ProbeState::Unsupported,
            binary: None,
            version: None,
            detail: "unknown runtime id".into(),
        },
    }
}

fn probe_claude() -> ProbeResult {
    let binary = which_binary("claude").unwrap_or_else(|| "claude".into());
    if which_binary("claude").is_none() {
        return missing("claude", binary);
    }

    let version = claude_version(&binary);
    match claude_auth_status(&binary) {
        Ok(true) => ready("claude", binary, version, "auth status loggedIn=true"),
        Ok(false) => unauthenticated("claude", binary, version, "auth status loggedIn=false"),
        Err(detail) => unauthenticated("claude", binary, version, &detail),
    }
}

fn probe_codex() -> ProbeResult {
    let binary = which_binary("codex").unwrap_or_else(|| "codex".into());
    if which_binary("codex").is_none() {
        return missing("codex", binary);
    }

    let version = generic_version(&binary);
    match codex_auth_status(&binary) {
        Ok(true) => ready("codex", binary, version, "codex login status ok"),
        Ok(false) => unauthenticated("codex", binary, version, "codex not logged in"),
        Err(detail) => {
            if detail.contains("not found") || detail.contains("unknown") {
                // Older codex builds may not expose login status — fall back to binary+version only.
                ready(
                    "codex",
                    binary,
                    version,
                    "binary present; login status unavailable",
                )
            } else {
                unauthenticated("codex", binary, version, &detail)
            }
        }
    }
}

fn probe_mimo() -> ProbeResult {
    let binary = resolve_mimo_binary();
    if detect_mimo_version(&binary).is_none() {
        return missing("mimo", binary);
    }

    let version = detect_mimo_version(&binary);
    match mimo_has_credentials(&binary) {
        Ok(true) => ready(
            "mimo",
            binary,
            version,
            "providers list reports credentials",
        ),
        Ok(false) => unauthenticated("mimo", binary, version, "no configured credentials"),
        Err(detail) => unauthenticated("mimo", binary, version, &detail),
    }
}

fn probe_opencode() -> ProbeResult {
    let binary = which_binary("opencode").unwrap_or_else(|| "opencode".into());
    if which_binary("opencode").is_none() {
        return missing("opencode", binary);
    }

    let version = generic_version(&binary);
    match opencode_auth_status(&binary) {
        Ok(true) => ready("opencode", binary, version, "opencode auth probe ok"),
        Ok(false) => unauthenticated("opencode", binary, version, "opencode auth missing"),
        Err(detail) => {
            if detail.contains("unknown") || detail.contains("not found") {
                ready(
                    "opencode",
                    binary,
                    version,
                    "binary present; auth probe unavailable",
                )
            } else {
                unauthenticated("opencode", binary, version, &detail)
            }
        }
    }
}

fn missing(runtime: &str, binary: String) -> ProbeResult {
    ProbeResult {
        runtime: runtime.to_string(),
        state: ProbeState::BinaryMissing,
        binary: Some(binary),
        version: None,
        detail: "binary not found on PATH".into(),
    }
}

fn unauthenticated(
    runtime: &str,
    binary: String,
    version: Option<String>,
    detail: &str,
) -> ProbeResult {
    ProbeResult {
        runtime: runtime.to_string(),
        state: ProbeState::Unauthenticated,
        binary: Some(binary),
        version,
        detail: detail.to_string(),
    }
}

fn ready(runtime: &str, binary: String, version: Option<String>, detail: &str) -> ProbeResult {
    ProbeResult {
        runtime: runtime.to_string(),
        state: ProbeState::Ready,
        binary: Some(binary),
        version,
        detail: detail.to_string(),
    }
}

fn claude_version(binary: &str) -> Option<String> {
    let output = Command::new(binary)
        .arg("--version")
        .env("PATH", augmented_path())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Some(raw.split(" (").next().unwrap_or(&raw).to_string())
}

fn generic_version(binary: &str) -> Option<String> {
    let output = Command::new(binary)
        .arg("--version")
        .env("PATH", augmented_path())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

fn claude_auth_status(binary: &str) -> Result<bool, String> {
    let output = Command::new(binary)
        .args(["auth", "status"])
        .env("PATH", augmented_path())
        .env_remove("CLAUDECODE")
        .output()
        .map_err(|e| format!("spawn auth status failed: {e}"))?;

    let body = String::from_utf8_lossy(&output.stdout);
    let parsed: Value = serde_json::from_str(body.trim())
        .map_err(|_| "auth status output was not JSON".to_string())?;
    Ok(parsed
        .get("loggedIn")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

fn codex_auth_status(binary: &str) -> Result<bool, String> {
    let output = Command::new(binary)
        .args(["login", "status"])
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("spawn login status failed: {e}"))?;

    if !output.status.success() {
        let stderr = redact_line(&String::from_utf8_lossy(&output.stderr));
        return Err(format!(
            "login status exit={:?}: {stderr}",
            output.status.code()
        ));
    }

    let body = String::from_utf8_lossy(&output.stdout);
    let lower = body.to_lowercase();
    if lower.contains("logged in") || lower.contains("authenticated") {
        return Ok(true);
    }
    if lower.contains("not logged") || lower.contains("unauthenticated") {
        return Ok(false);
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(body.trim()) {
        if parsed
            .get("logged_in")
            .or_else(|| parsed.get("loggedIn"))
            .and_then(Value::as_bool)
            .is_some()
        {
            return Ok(parsed
                .get("logged_in")
                .or_else(|| parsed.get("loggedIn"))
                .and_then(Value::as_bool)
                .unwrap_or(false));
        }
    }

    Err("unable to parse codex login status".into())
}

fn mimo_has_credentials(binary: &str) -> Result<bool, String> {
    let output = Command::new(binary)
        .args(["providers", "list"])
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("spawn providers list failed: {e}"))?;

    if !output.status.success() {
        let stderr = redact_line(&String::from_utf8_lossy(&output.stderr));
        return Err(format!(
            "providers list exit={:?}: {stderr}",
            output.status.code()
        ));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_lowercase();
    Ok(body.contains("credential") || body.contains("auth.json"))
}

fn opencode_auth_status(binary: &str) -> Result<bool, String> {
    let output = Command::new(binary)
        .args(["auth", "list"])
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("spawn auth list failed: {e}"))?;

    if !output.status.success() {
        let stderr = redact_line(&String::from_utf8_lossy(&output.stderr));
        if stderr.contains("unknown") || stderr.contains("not found") {
            return Err("auth list command unavailable".into());
        }
        return Err(format!(
            "auth list exit={:?}: {stderr}",
            output.status.code()
        ));
    }

    let body = String::from_utf8_lossy(&output.stdout);
    Ok(!body.trim().is_empty())
}

/// Lightweight stream-json initialize probe for Claude (no user prompt).
pub fn claude_initialize_probe(binary: &str, timeout: Duration) -> Result<(), String> {
    let mut child = Command::new(binary)
        .args([
            "-p",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--verbose",
        ])
        .env("PATH", augmented_path())
        .env_remove("CLAUDECODE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        let init = serde_json::json!({
            "type": "control_request",
            "request_id": "miwarp_probe_init",
            "request": { "subtype": "initialize" }
        });
        let mut line = serde_json::to_string(&init).map_err(|e| e.to_string())?;
        line.push('\n');
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("stdin write failed: {e}"))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "stdout unavailable".to_string())?;
    let started = Instant::now();
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        if line.contains("control_response") || line.contains("\"subtype\":\"init\"") {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(());
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("initialize probe timed out".into());
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    Err("initialize probe ended without init event".into())
}

pub fn temp_workspace(prefix: &str) -> Result<PathBuf, String> {
    let dir = tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()
        .map_err(|e| format!("tempdir failed: {e}"))?;
    Ok(dir.keep())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_runtime_is_not_ready() {
        let result = probe_runtime("gemini");
        assert_eq!(result.state, ProbeState::Unsupported);
        assert_eq!(result.skip_reason(), Some(SKIPPED_ENVIRONMENT));
    }
}
