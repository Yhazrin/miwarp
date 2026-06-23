//! Background loop: periodically discover and sync CLI-imported sessions.

use crate::storage::cli_sessions::{self, CliSessionSummary, DiscoverResult};
use crate::storage::events::EventWriter;
use crate::storage::settings;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

const TICK_SECS: u64 = 30;
const MIN_INTERVAL_MINUTES: u32 = 1;
const MAX_INTERVAL_MINUTES: u32 = 120;
const STARTUP_DELAY_SECS: u64 = 120;
const MAX_SYNC_PER_PASS: usize = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAutoSyncSummary {
    pub synced_runs: u32,
    pub failed_runs: u32,
    pub imported: u32,
    pub total_new_events: u64,
}

impl CliAutoSyncSummary {
    fn has_changes(&self) -> bool {
        self.synced_runs > 0 || self.imported > 0 || self.total_new_events > 0
    }
}

struct LoopState {
    started_at: Instant,
    last_pass: Option<Instant>,
}

pub fn start_cli_auto_sync_loop(
    app: AppHandle,
    cancel: CancellationToken,
    event_writer: Arc<EventWriter>,
) {
    let state = Arc::new(Mutex::new(LoopState {
        started_at: Instant::now(),
        last_pass: None,
    }));
    tauri::async_runtime::spawn(async move {
        log::info!("[cli_auto_sync] loop started");
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    log::info!("[cli_auto_sync] loop cancelled");
                    break;
                }
                _ = tokio::time::sleep(Duration::from_secs(TICK_SECS)) => {
                    tick(&app, &event_writer, &state).await;
                }
            }
        }
    });
}

async fn tick(app: &AppHandle, event_writer: &Arc<EventWriter>, state: &Arc<Mutex<LoopState>>) {
    let user = settings::load().user;
    if !user.cli_auto_sync_enabled {
        return;
    }

    let interval_mins = user
        .cli_auto_sync_interval_minutes
        .clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
    let interval = Duration::from_secs(interval_mins as u64 * 60);

    {
        let mut st = state.lock().expect("cli_auto_sync state lock");
        let loop_age = st.started_at.elapsed();
        let since_last_pass = st.last_pass.map(|last| last.elapsed());
        if !pass_interval_ready(
            loop_age,
            since_last_pass,
            interval,
            Duration::from_secs(STARTUP_DELAY_SECS),
        ) {
            return;
        }
        st.last_pass = Some(Instant::now());
    }

    let import_new = user.cli_auto_sync_import_new;
    let writer = event_writer.clone();
    let summary = match tokio::task::spawn_blocking(move || run_sync_pass(writer, import_new)).await
    {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            log::warn!("[cli_auto_sync] pass failed: {e}");
            return;
        }
        Err(e) => {
            log::warn!("[cli_auto_sync] spawn_blocking failed: {e}");
            return;
        }
    };

    if summary.has_changes() {
        log::info!(
            "[cli_auto_sync] synced={} imported={} new_events={} failed={}",
            summary.synced_runs,
            summary.imported,
            summary.total_new_events,
            summary.failed_runs
        );
        let _ = app.emit("ocv:cli-auto-sync", &summary);
    }
}

/// Whether the auto-sync loop should run a pass now.
fn pass_interval_ready(
    loop_age: Duration,
    since_last_pass: Option<Duration>,
    interval: Duration,
    startup_delay: Duration,
) -> bool {
    match since_last_pass {
        None => loop_age >= startup_delay,
        Some(elapsed) => elapsed >= interval,
    }
}

/// Select up to `max` sessions that need work, newest source mtime first.
fn select_sessions_for_pass<'a>(
    sessions: impl IntoIterator<Item = &'a CliSessionSummary>,
    import_new: bool,
    max: usize,
) -> Vec<&'a CliSessionSummary> {
    let work: Vec<(&CliSessionSummary, u128)> = sessions
        .into_iter()
        .filter_map(|session| {
            let mtime_ns = cli_sessions::source_file_mtime_ns(&session.file_path).unwrap_or(0);
            if session.already_imported {
                let run_id = session.existing_run_id.as_deref()?;
                let needs_sync = cli_sessions::session_has_pending_sync(run_id).unwrap_or(true);
                if needs_sync {
                    Some((session, mtime_ns))
                } else {
                    None
                }
            } else if import_new {
                Some((session, mtime_ns))
            } else {
                None
            }
        })
        .collect();

    prioritize_work_by_mtime(work, max)
}

/// Sort work items by mtime descending and cap at `max` (pure, testable).
fn prioritize_work_by_mtime<T>(mut work: Vec<(T, u128)>, max: usize) -> Vec<T> {
    work.sort_by_key(|(_, mtime)| std::cmp::Reverse(*mtime));
    work.truncate(max);
    work.into_iter().map(|(item, _)| item).collect()
}

fn run_sync_pass(
    event_writer: Arc<EventWriter>,
    import_new: bool,
) -> Result<CliAutoSyncSummary, String> {
    let discover: DiscoverResult = cli_sessions::discover_sessions("/")?;
    let mut summary = CliAutoSyncSummary {
        synced_runs: 0,
        failed_runs: 0,
        imported: 0,
        total_new_events: 0,
    };

    let candidates: Vec<_> = if import_new {
        discover.sessions.iter().collect()
    } else {
        discover
            .sessions
            .iter()
            .filter(|s| s.already_imported)
            .collect()
    };

    if candidates.is_empty() {
        return Ok(summary);
    }

    let to_process = select_sessions_for_pass(candidates, import_new, MAX_SYNC_PER_PASS);

    for session in to_process {
        if session.already_imported {
            let Some(run_id) = session.existing_run_id.as_deref() else {
                continue;
            };
            match cli_sessions::sync_session(run_id, event_writer.clone()) {
                Ok(result) => {
                    if result.new_events > 0 {
                        summary.synced_runs += 1;
                        summary.total_new_events += result.new_events;
                    }
                }
                Err(e) => {
                    summary.failed_runs += 1;
                    log::debug!(
                        "[cli_auto_sync] sync failed run_id={} session_id={}: {e}",
                        run_id,
                        session.session_id
                    );
                }
            }
            continue;
        }

        if !import_new {
            continue;
        }

        match cli_sessions::import_session(&session.session_id, &session.cwd, event_writer.clone())
        {
            Ok(result) => {
                summary.imported += 1;
                summary.total_new_events += result.events_imported;
            }
            Err(e) => {
                summary.failed_runs += 1;
                log::debug!(
                    "[cli_auto_sync] import failed session_id={}: {e}",
                    session.session_id
                );
            }
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pass_interval_ready_first_delay() {
        let interval = Duration::from_secs(300);
        let startup = Duration::from_secs(120);

        assert!(!pass_interval_ready(
            Duration::from_secs(30),
            None,
            interval,
            startup
        ));
        assert!(!pass_interval_ready(
            Duration::from_secs(119),
            None,
            interval,
            startup
        ));
        assert!(pass_interval_ready(
            Duration::from_secs(120),
            None,
            interval,
            startup
        ));
        assert!(pass_interval_ready(
            Duration::from_secs(200),
            None,
            interval,
            startup
        ));
    }

    #[test]
    fn test_pass_interval_ready_subsequent_interval() {
        let interval = Duration::from_secs(300);
        let startup = Duration::from_secs(120);

        assert!(!pass_interval_ready(
            Duration::from_secs(1000),
            Some(Duration::from_secs(100)),
            interval,
            startup
        ));
        assert!(pass_interval_ready(
            Duration::from_secs(1000),
            Some(Duration::from_secs(300)),
            interval,
            startup
        ));
    }

    fn sample_session(
        session_id: &str,
        already_imported: bool,
        run_id: Option<&str>,
        file_path: &str,
    ) -> CliSessionSummary {
        CliSessionSummary {
            session_id: session_id.to_string(),
            cwd: "/proj".to_string(),
            first_prompt: String::new(),
            started_at: String::new(),
            last_activity_at: String::new(),
            message_count: 0,
            model: None,
            cli_version: None,
            file_size: 0,
            file_path: file_path.to_string(),
            has_subagents: false,
            already_imported,
            existing_run_id: run_id.map(str::to_string),
        }
    }

    #[test]
    fn test_prioritize_work_by_mtime_order_and_cap() {
        let items = vec![
            ("old", 100_u128),
            ("newest", 900),
            ("mid", 500),
            ("also_old", 200),
            ("second", 800),
            ("third", 700),
        ];
        let picked = prioritize_work_by_mtime(items, 5);
        assert_eq!(picked, vec!["newest", "second", "third", "mid", "also_old"]);
    }

    #[test]
    fn test_select_sessions_respects_max() {
        let sessions = [
            sample_session("a", false, None, "/tmp/a.jsonl"),
            sample_session("b", false, None, "/tmp/b.jsonl"),
            sample_session("c", false, None, "/tmp/c.jsonl"),
            sample_session("d", false, None, "/tmp/d.jsonl"),
            sample_session("e", false, None, "/tmp/e.jsonl"),
            sample_session("f", false, None, "/tmp/f.jsonl"),
        ];

        let selected = select_sessions_for_pass(sessions.iter(), true, 5);
        assert_eq!(selected.len(), 5);
    }

    #[test]
    fn test_select_sessions_skips_imported_without_run_id() {
        let sessions = [sample_session("orphan", true, None, "/tmp/orphan.jsonl")];
        let selected = select_sessions_for_pass(sessions.iter(), false, 5);
        assert!(selected.is_empty());
    }

    #[test]
    fn test_select_sessions_import_new_disabled() {
        let sessions = [sample_session("new", false, None, "/tmp/new.jsonl")];
        let selected = select_sessions_for_pass(sessions.iter(), false, 5);
        assert!(selected.is_empty());
    }
}
