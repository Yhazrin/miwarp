use super::constants::{
    ENV_ENABLE, ENV_PROBE_ONLY, ENV_RUNTIMES, SKIPPED_ENVIRONMENT, STARTABLE_RUNTIMES,
};
use super::lifecycle::{log_lifecycle, resume_session_id, run_cancel, run_timeout_harness};
use super::probe::{probe_runtime, probe_timeout, ProbeResult, ProbeState};
use super::redaction::redact_line;
use super::smoke::{run_resume_smoke, run_smoke, smoke_timeout, SmokeOutcome};

#[derive(Debug, Clone)]
pub struct RuntimeCaseReport {
    pub probe: ProbeResult,
    pub smoke: Option<SmokeOutcome>,
    pub resume: Option<SmokeOutcome>,
    pub cancel_ok: Option<bool>,
    pub skipped: bool,
    pub skip_label: Option<String>,
    pub failure: Option<String>,
}

#[derive(Debug)]
pub struct HarnessReport {
    pub enabled: bool,
    pub cases: Vec<RuntimeCaseReport>,
    pub timeout_harness_ok: bool,
}

pub fn enabled() -> bool {
    std::env::var(ENV_ENABLE)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn probe_only() -> bool {
    std::env::var(ENV_PROBE_ONLY)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn selected_runtimes() -> Vec<String> {
    if let Ok(raw) = std::env::var(ENV_RUNTIMES) {
        return raw
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect();
    }
    STARTABLE_RUNTIMES
        .iter()
        .map(|item| item.to_string())
        .collect()
}

pub fn run() -> HarnessReport {
    if !enabled() {
        return HarnessReport {
            enabled: false,
            cases: vec![],
            timeout_harness_ok: true,
        };
    }

    let smoke_timeout = smoke_timeout();
    let timeout_harness = run_timeout_harness();
    let timeout_harness_ok = timeout_harness.timeout_detected;

    let mut cases = Vec::new();
    for runtime in selected_runtimes() {
        let probe = probe_runtime(&runtime);
        log_probe(&probe);

        if probe.skipped() {
            cases.push(RuntimeCaseReport {
                probe,
                smoke: None,
                resume: None,
                cancel_ok: None,
                skipped: true,
                skip_label: Some(SKIPPED_ENVIRONMENT.to_string()),
                failure: None,
            });
            continue;
        }

        if probe_only() {
            cases.push(RuntimeCaseReport {
                probe,
                smoke: None,
                resume: None,
                cancel_ok: None,
                skipped: false,
                skip_label: None,
                failure: None,
            });
            continue;
        }

        let workspace =
            match super::probe::temp_workspace(&format!("miwarp-runtime-e2e-{runtime}-")) {
                Ok(path) => path,
                Err(err) => {
                    cases.push(RuntimeCaseReport {
                        probe,
                        smoke: None,
                        resume: None,
                        cancel_ok: None,
                        skipped: false,
                        skip_label: None,
                        failure: Some(err),
                    });
                    continue;
                }
            };

        let smoke = match run_smoke(&probe, &workspace, smoke_timeout) {
            Ok(outcome) => outcome,
            Err(err) => {
                cases.push(RuntimeCaseReport {
                    probe,
                    smoke: None,
                    resume: None,
                    cancel_ok: None,
                    skipped: false,
                    skip_label: None,
                    failure: Some(err),
                });
                let _ = std::fs::remove_dir_all(&workspace);
                continue;
            }
        };
        log_smoke(&smoke);

        let mut failure = None;
        if !smoke.success() {
            failure = Some(format!(
                "smoke failed: init={} text={} exit={:?} detail={}",
                smoke.saw_init,
                smoke.saw_text,
                smoke.exit_code,
                redact_line(&smoke.detail)
            ));
        }

        let cancel = run_cancel(&probe, &workspace, smoke_timeout);
        log_lifecycle(&cancel);
        let cancel_ok = Some(cancel.cancel_killed);

        let resume = if smoke.success() {
            if let Some(session_id) =
                resume_session_id(smoke.session_id.as_deref().unwrap_or_default())
            {
                match run_resume_smoke(&probe, &workspace, &session_id, smoke_timeout) {
                    Ok(outcome) => {
                        log_smoke(&outcome);
                        if !outcome.success() {
                            eprintln!(
                                "[runtime-e2e] resume warning runtime={} detail={}",
                                runtime,
                                redact_line(&outcome.detail)
                            );
                        }
                        Some(outcome)
                    }
                    Err(err) => {
                        eprintln!(
                            "[runtime-e2e] resume warning runtime={} detail={}",
                            runtime,
                            redact_line(&err)
                        );
                        None
                    }
                }
            } else {
                eprintln!(
                    "[runtime-e2e] resume skipped runtime={} reason=no_temp_session_id",
                    runtime
                );
                None
            }
        } else {
            None
        };

        cases.push(RuntimeCaseReport {
            probe,
            smoke: Some(smoke),
            resume,
            cancel_ok,
            skipped: false,
            skip_label: None,
            failure,
        });

        let _ = std::fs::remove_dir_all(&workspace);
    }

    HarnessReport {
        enabled: true,
        cases,
        timeout_harness_ok,
    }
}

pub fn print_report(report: &HarnessReport) {
    if !report.enabled {
        eprintln!("[runtime-e2e] disabled — set {ENV_ENABLE}=1 to run real runtime smoke/E2E");
        return;
    }

    eprintln!("[runtime-e2e] summary begin");
    eprintln!(
        "[runtime-e2e] timeout_harness_ok={}",
        report.timeout_harness_ok
    );
    for case in &report.cases {
        if case.skipped {
            eprintln!(
                "[runtime-e2e] runtime={} state={} result={} detail={}",
                case.probe.runtime,
                case.probe.state.as_str(),
                SKIPPED_ENVIRONMENT,
                redact_line(&case.probe.detail)
            );
            continue;
        }

        eprintln!(
            "[runtime-e2e] runtime={} state={} version={:?} binary={:?}",
            case.probe.runtime,
            case.probe.state.as_str(),
            case.probe.version,
            case.probe.binary.as_ref().map(|path| redact_line(path))
        );

        if let Some(smoke) = &case.smoke {
            eprintln!(
                "[runtime-e2e] smoke runtime={} init={} text={} exit={:?} session_id={}",
                smoke.runtime,
                smoke.saw_init,
                smoke.saw_text,
                smoke.exit_code,
                smoke
                    .session_id
                    .as_ref()
                    .map(|id| format!("{}…", &id[..id.len().min(8)]))
                    .unwrap_or_else(|| "none".into())
            );
        }

        if let Some(resume) = &case.resume {
            eprintln!(
                "[runtime-e2e] resume runtime={} ok={}",
                resume.runtime,
                resume.success()
            );
        }

        if let Some(cancel_ok) = case.cancel_ok {
            eprintln!(
                "[runtime-e2e] cancel runtime={} ok={}",
                case.probe.runtime, cancel_ok
            );
        }

        if let Some(failure) = &case.failure {
            eprintln!(
                "[runtime-e2e] failure runtime={} result={} detail={}",
                case.probe.runtime,
                case.skip_label.as_deref().unwrap_or("FAILED"),
                redact_line(failure)
            );
        }
    }
    eprintln!("[runtime-e2e] summary end");
}

pub fn assert_report(report: &HarnessReport) {
    if !report.enabled {
        return;
    }
    assert!(
        report.timeout_harness_ok,
        "timeout harness failed to kill long-running child"
    );

    for case in &report.cases {
        if case.skipped {
            continue;
        }
        if let Some(failure) = &case.failure {
            panic!(
                "runtime {} failed: {}",
                case.probe.runtime,
                redact_line(failure)
            );
        }
        if let Some(cancel_ok) = case.cancel_ok {
            assert!(
                cancel_ok,
                "cancel lifecycle failed for runtime {}",
                case.probe.runtime
            );
        }
    }
}

fn log_probe(probe: &ProbeResult) {
    eprintln!(
        "[runtime-e2e] probe runtime={} state={} version={:?} detail={}",
        probe.runtime,
        probe.state.as_str(),
        probe.version,
        redact_line(&probe.detail)
    );
    if probe.state == ProbeState::Ready {
        if let Some(binary) = &probe.binary {
            if probe.runtime == "claude" {
                if let Err(err) = super::probe::claude_initialize_probe(binary, probe_timeout()) {
                    eprintln!(
                        "[runtime-e2e] claude initialize probe warning: {}",
                        redact_line(&err)
                    );
                }
            }
        }
    }
}

fn log_smoke(outcome: &SmokeOutcome) {
    eprintln!(
        "[runtime-e2e] smoke runtime={} init={} text={} exit={:?} detail={}",
        outcome.runtime,
        outcome.saw_init,
        outcome.saw_text,
        outcome.exit_code,
        redact_line(&outcome.detail)
    );
}
