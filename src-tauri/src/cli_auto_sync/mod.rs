//! Background loop: periodically discover and sync CLI-imported sessions.

use crate::storage::cli_sessions::{self, DiscoverResult};
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
    last_pass: Option<Instant>,
}

pub fn start_cli_auto_sync_loop(
    app: AppHandle,
    cancel: CancellationToken,
    event_writer: Arc<EventWriter>,
) {
    let state = Arc::new(Mutex::new(LoopState { last_pass: None }));
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
        if let Some(last) = st.last_pass {
            if last.elapsed() < interval {
                return;
            }
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

    for session in candidates {
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
