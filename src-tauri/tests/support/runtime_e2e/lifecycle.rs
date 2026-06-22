use super::constants::{DEFAULT_CANCEL_GRACE_MS, SMOKE_PROMPT};
use super::probe::ProbeResult;
use super::redaction::redact_line;
use miwarp_desktop_lib::agent::adapter::AdapterSettings;
use miwarp_desktop_lib::agent::claude_stream::augmented_path;
use miwarp_desktop_lib::agent::spawn::build_agent_command;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct LifecycleOutcome {
    pub runtime: String,
    pub cancel_killed: bool,
    pub timeout_detected: bool,
    pub detail: String,
}

pub fn run_cancel(
    probe: &ProbeResult,
    workspace: &Path,
    smoke_timeout: Duration,
) -> LifecycleOutcome {
    let runtime = probe.runtime.as_str();
    let binary = probe.binary.clone().unwrap_or_default();
    let settings = AdapterSettings {
        permission_mode: Some("bypassPermissions".to_string()),
        ..Default::default()
    };

    let args = match build_agent_command(runtime, SMOKE_PROMPT, &settings, true, None) {
        Ok((_, args)) => args,
        Err(err) => {
            return LifecycleOutcome {
                runtime: runtime.to_string(),
                cancel_killed: false,
                timeout_detected: false,
                detail: format!("build command failed: {err}"),
            };
        }
    };

    let mut child = match Command::new(&binary)
        .args(&args)
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PATH", augmented_path())
        .env_remove("CLAUDECODE")
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            return LifecycleOutcome {
                runtime: runtime.to_string(),
                cancel_killed: false,
                timeout_detected: false,
                detail: format!("spawn failed: {err}"),
            };
        }
    };

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            return LifecycleOutcome {
                runtime: runtime.to_string(),
                cancel_killed: false,
                timeout_detected: false,
                detail: "stdout unavailable".into(),
            };
        }
    };

    let reader = BufReader::new(stdout);
    let started = Instant::now();
    let mut saw_output = false;
    for line in reader.lines().map_while(Result::ok) {
        if !line.trim().is_empty() {
            saw_output = true;
            break;
        }
        if started.elapsed() > smoke_timeout {
            break;
        }
    }

    let kill_started = Instant::now();
    let kill_ok = child.kill().is_ok();
    let _ = child.wait();
    let cleanup_ms = kill_started.elapsed().as_millis() as u64;

    LifecycleOutcome {
        runtime: runtime.to_string(),
        cancel_killed: kill_ok && saw_output,
        timeout_detected: false,
        detail: format!(
            "saw_output={saw_output} kill_ok={kill_ok} cleanup_ms={cleanup_ms} grace_ms={DEFAULT_CANCEL_GRACE_MS}"
        ),
    }
}

pub fn run_timeout_harness() -> LifecycleOutcome {
    let mut child = match Command::new(if cfg!(windows) { "cmd" } else { "sleep" })
        .arg(if cfg!(windows) {
            "/C timeout /T 5"
        } else {
            "5"
        })
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            return LifecycleOutcome {
                runtime: "harness".into(),
                cancel_killed: false,
                timeout_detected: false,
                detail: format!("spawn sleep failed: {err}"),
            };
        }
    };

    let started = Instant::now();
    let budget = Duration::from_millis(50);
    loop {
        if let Ok(Some(_status)) = child.try_wait() {
            break;
        }
        if started.elapsed() >= budget {
            let _ = child.kill();
            let _ = child.wait();
            return LifecycleOutcome {
                runtime: "harness".into(),
                cancel_killed: true,
                timeout_detected: true,
                detail: "timeout wrapper killed long-running child".into(),
            };
        }
        thread::sleep(Duration::from_millis(5));
    }

    LifecycleOutcome {
        runtime: "harness".into(),
        cancel_killed: false,
        timeout_detected: false,
        detail: "sleep exited before timeout budget (unexpected)".into(),
    }
}

pub fn resume_session_id(smoke_session: &str) -> Option<String> {
    let trimmed = smoke_session.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn log_lifecycle(outcome: &LifecycleOutcome) {
    eprintln!(
        "[runtime-e2e] lifecycle runtime={} cancel={} timeout={} detail={}",
        outcome.runtime,
        outcome.cancel_killed,
        outcome.timeout_detected,
        redact_line(&outcome.detail)
    );
}
