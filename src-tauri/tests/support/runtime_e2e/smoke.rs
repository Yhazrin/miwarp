use super::constants::{
    DEFAULT_SMOKE_TIMEOUT_SECS, ENV_SMOKE_TIMEOUT_SECS, SMOKE_PROMPT, SMOKE_TOKEN,
};
use super::probe::ProbeResult;
use super::redaction::redact_line;
use miwarp_desktop_lib::agent::adapter::AdapterSettings;
use miwarp_desktop_lib::agent::claude_stream::augmented_path;
use miwarp_desktop_lib::agent::pipe_parser::PipeStdoutParser;
use miwarp_desktop_lib::agent::protocol::claude::ClaudeProtocolParser;
use miwarp_desktop_lib::agent::protocol::mimo::MimoProtocolParser;
use miwarp_desktop_lib::agent::protocol::{ParseResult, ProtocolParser};
use miwarp_desktop_lib::agent::spawn::build_agent_command;
use miwarp_desktop_lib::agent::{codex_parser, pipe_parser};
use miwarp_desktop_lib::models::BusEvent;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct SmokeOutcome {
    pub runtime: String,
    pub saw_init: bool,
    pub saw_text: bool,
    pub exit_code: Option<i32>,
    pub session_id: Option<String>,
    pub detail: String,
}

impl SmokeOutcome {
    pub fn success(&self) -> bool {
        self.saw_text && self.exit_code == Some(0)
    }
}

pub fn smoke_timeout() -> Duration {
    std::env::var(ENV_SMOKE_TIMEOUT_SECS)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(DEFAULT_SMOKE_TIMEOUT_SECS))
}

pub fn run_smoke(
    probe: &ProbeResult,
    workspace: &Path,
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let runtime = probe.runtime.as_str();
    let binary = probe
        .binary
        .clone()
        .ok_or_else(|| "probe missing binary path".to_string())?;

    match runtime {
        "claude" => run_claude_smoke(&binary, workspace, timeout),
        "codex" => run_pipe_smoke("codex", &binary, workspace, timeout),
        "mimo" => run_mimo_smoke(&binary, workspace, timeout),
        "opencode" => run_pipe_smoke("opencode", &binary, workspace, timeout),
        _ => Err(format!("unsupported smoke runtime: {runtime}")),
    }
}

pub fn run_resume_smoke(
    probe: &ProbeResult,
    workspace: &Path,
    session_id: &str,
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let runtime = probe.runtime.as_str();
    let binary = probe
        .binary
        .clone()
        .ok_or_else(|| "probe missing binary path".to_string())?;

    match runtime {
        "claude" => run_claude_resume_smoke(&binary, workspace, session_id, timeout),
        "mimo" => run_mimo_resume_smoke(&binary, workspace, session_id, timeout),
        "opencode" => run_opencode_resume_smoke(&binary, workspace, session_id, timeout),
        "codex" => Err("codex resume requires thread id; skipped unless captured".into()),
        _ => Err(format!("resume unsupported for runtime: {runtime}")),
    }
}

fn run_claude_smoke(
    binary: &str,
    workspace: &Path,
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--permission-mode".to_string(),
        "bypassPermissions".to_string(),
        "--max-turns".to_string(),
        "1".to_string(),
        SMOKE_PROMPT.to_string(),
    ];

    run_stream_smoke(
        "claude",
        binary,
        workspace,
        &args,
        timeout,
        |line, run_id, parser, outcome| {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                if value.get("type").and_then(Value::as_str) == Some("system")
                    && value.get("subtype").and_then(Value::as_str) == Some("init")
                {
                    outcome.saw_init = true;
                    outcome.session_id = value
                        .get("session_id")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
                if parse_has_token(&parser.parse_line(run_id, line)) {
                    outcome.saw_text = true;
                }
            }
        },
        || Box::new(ClaudeProtocolParser::new(false)),
    )
}

fn run_claude_resume_smoke(
    binary: &str,
    workspace: &Path,
    session_id: &str,
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--permission-mode".to_string(),
        "bypassPermissions".to_string(),
        "--resume".to_string(),
        session_id.to_string(),
        "--max-turns".to_string(),
        "1".to_string(),
        SMOKE_PROMPT.to_string(),
    ];

    run_stream_smoke(
        "claude",
        binary,
        workspace,
        &args,
        timeout,
        |line, run_id, parser, outcome| {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                if value.get("type").and_then(Value::as_str) == Some("system")
                    && value.get("subtype").and_then(Value::as_str) == Some("init")
                {
                    outcome.saw_init = true;
                }
                if parse_has_token(&parser.parse_line(run_id, line)) {
                    outcome.saw_text = true;
                }
            }
        },
        || Box::new(ClaudeProtocolParser::new(true)),
    )
}

fn run_mimo_smoke(
    binary: &str,
    workspace: &Path,
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let settings = AdapterSettings {
        permission_mode: Some("bypassPermissions".to_string()),
        ..Default::default()
    };
    let (_, mut args) = build_agent_command("mimo", SMOKE_PROMPT, &settings, true, None)
        .map_err(|e| e.to_string())?;
    args.insert(2, "--dir".into());
    args.insert(3, workspace.display().to_string());

    run_stream_smoke(
        "mimo",
        binary,
        workspace,
        &args,
        timeout,
        |line, run_id, parser, outcome| {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                if value.get("type").and_then(Value::as_str) == Some("step_start") {
                    outcome.saw_init = true;
                }
                outcome.session_id = value
                    .get("sessionID")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| outcome.session_id.clone());
                if parse_has_token(&parser.parse_line(run_id, line)) {
                    outcome.saw_text = true;
                }
            }
        },
        || Box::new(MimoProtocolParser::new()),
    )
}

fn run_mimo_resume_smoke(
    binary: &str,
    workspace: &Path,
    session_id: &str,
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let settings = AdapterSettings {
        permission_mode: Some("bypassPermissions".to_string()),
        ..Default::default()
    };
    let (_, mut args) = build_agent_command("mimo", SMOKE_PROMPT, &settings, true, None)
        .map_err(|e| e.to_string())?;
    args.insert(2, "--dir".into());
    args.insert(3, workspace.display().to_string());
    args.insert(4, "--session".into());
    args.insert(5, session_id.to_string());

    run_stream_smoke(
        "mimo",
        binary,
        workspace,
        &args,
        timeout,
        |line, run_id, parser, outcome| {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                if value.get("type").and_then(Value::as_str) == Some("step_start") {
                    outcome.saw_init = true;
                }
                if parse_has_token(&parser.parse_line(run_id, line)) {
                    outcome.saw_text = true;
                }
            }
        },
        || Box::new(MimoProtocolParser::new()),
    )
}

fn run_opencode_resume_smoke(
    binary: &str,
    workspace: &Path,
    session_id: &str,
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let settings = AdapterSettings {
        permission_mode: Some("bypassPermissions".to_string()),
        ..Default::default()
    };
    let (_, args) =
        build_agent_command("opencode", SMOKE_PROMPT, &settings, true, Some(session_id))
            .map_err(|e| e.to_string())?;
    run_pipe_smoke_with_args("opencode", binary, workspace, &args, timeout)
}

fn run_pipe_smoke(
    agent: &str,
    binary: &str,
    workspace: &Path,
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let settings = AdapterSettings {
        permission_mode: Some("bypassPermissions".to_string()),
        ..Default::default()
    };
    let (_, args) = build_agent_command(agent, SMOKE_PROMPT, &settings, true, None)
        .map_err(|e| e.to_string())?;
    run_pipe_smoke_with_args(agent, binary, workspace, &args, timeout)
}

fn run_pipe_smoke_with_args(
    agent: &str,
    binary: &str,
    workspace: &Path,
    args: &[String],
    timeout: Duration,
) -> Result<SmokeOutcome, String> {
    let mut child = Command::new(binary)
        .args(args)
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PATH", augmented_path())
        .env_remove("CLAUDECODE")
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout unavailable")?;
    let mut stderr_buf = Vec::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = std::io::Read::read_to_end(&mut stderr, &mut stderr_buf);
    }

    let started = Instant::now();
    let mut outcome = SmokeOutcome {
        runtime: agent.to_string(),
        saw_init: false,
        saw_text: false,
        exit_code: None,
        session_id: None,
        detail: String::new(),
    };

    let mut codex_parser = pipe_parser::CodexStdoutParser;
    let mut opencode_parser = pipe_parser::OpenCodeStdoutParser::default();
    let reader = BufReader::new(stdout);

    for line in reader.lines().map_while(Result::ok) {
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            outcome.detail = "smoke timed out".into();
            return Ok(outcome);
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            let type_str = value.get("type").and_then(Value::as_str).unwrap_or("");
            if type_str == "thread.started" || type_str == "step_start" || type_str == "system" {
                outcome.saw_init = true;
            }
            if agent == "opencode" {
                outcome.session_id = pipe_parser::OpenCodeStdoutParser::session_id(&value)
                    .map(str::to_string)
                    .or(outcome.session_id.clone());
            }
            if agent == "codex" && type_str == "thread.started" {
                outcome.session_id = value
                    .get("thread_id")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }

            let events = if agent == "codex" {
                codex_parser.parse_line("smoke", &value)
            } else {
                opencode_parser.parse_line("smoke", &value)
            };
            if events.iter().any(event_contains_token) {
                outcome.saw_text = true;
            }
            if codex_parser::extract_codex_delta(&value).is_some_and(|t| t.contains(SMOKE_TOKEN)) {
                outcome.saw_text = true;
            }
        }
        if trimmed.contains(SMOKE_TOKEN) {
            outcome.saw_text = true;
        }
    }

    let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
    outcome.exit_code = status.code();
    if !outcome.success() {
        let stderr = redact_line(&String::from_utf8_lossy(&stderr_buf));
        outcome.detail = format!(
            "init={} text={} exit={:?} stderr={}",
            outcome.saw_init,
            outcome.saw_text,
            outcome.exit_code,
            stderr.chars().take(240).collect::<String>()
        );
    }
    Ok(outcome)
}

fn run_stream_smoke<P, F>(
    runtime: &str,
    binary: &str,
    workspace: &Path,
    args: &[String],
    timeout: Duration,
    mut on_line: F,
    mut parser_factory: P,
) -> Result<SmokeOutcome, String>
where
    P: FnMut() -> Box<dyn ProtocolParser + Send>,
    F: FnMut(&str, &str, &mut Box<dyn ProtocolParser + Send>, &mut SmokeOutcome),
{
    let mut child = Command::new(binary)
        .args(args)
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PATH", augmented_path())
        .env_remove("CLAUDECODE")
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout unavailable")?;
    let mut stderr_buf = Vec::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = std::io::Read::read_to_end(&mut stderr, &mut stderr_buf);
    }

    let started = Instant::now();
    let mut outcome = SmokeOutcome {
        runtime: runtime.to_string(),
        saw_init: false,
        saw_text: false,
        exit_code: None,
        session_id: None,
        detail: String::new(),
    };

    let mut parser = parser_factory();
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            outcome.detail = "smoke timed out".into();
            return Ok(outcome);
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        on_line(trimmed, "smoke", &mut parser, &mut outcome);
        if trimmed.contains(SMOKE_TOKEN) {
            outcome.saw_text = true;
        }
    }

    let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
    outcome.exit_code = status.code();
    if !outcome.success() {
        let stderr = redact_line(&String::from_utf8_lossy(&stderr_buf));
        outcome.detail = format!(
            "init={} text={} exit={:?} stderr={}",
            outcome.saw_init,
            outcome.saw_text,
            outcome.exit_code,
            stderr.chars().take(240).collect::<String>()
        );
    }
    Ok(outcome)
}

fn parse_has_token(result: &ParseResult) -> bool {
    match result {
        ParseResult::Events(events) => events.iter().any(event_contains_token),
        _ => false,
    }
}

fn event_contains_token(event: &BusEvent) -> bool {
    match event {
        BusEvent::MessageDelta { text, .. } | BusEvent::MessageComplete { text, .. } => {
            text.contains(SMOKE_TOKEN)
        }
        _ => false,
    }
}
