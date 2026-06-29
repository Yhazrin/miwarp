//! Durable Run Journal persistence — per-run WAL separate from chat replay.
//!
//! ```text
//! ~/.miwarp/runs/<run_id>/run-journal.json
//! ~/.miwarp/runs/<run_id>/run-journal-events.jsonl
//! ~/.miwarp/runs/<run_id>/run-journal-mutation.json
//! ```

use super::durable_io::{
    append_json_line, remove_file_durable, repair_jsonl_tail, write_json_atomic,
};
use crate::models::{now_iso, BusEvent, RunMeta, RunStatus};
use crate::run_core::projector::{finish_projection, plan_projection, ProjectOutcome};
use crate::run_core::{
    apply_event, init_snapshot, is_terminal_client_message, lookup_client_message_state,
    make_event, snapshot_has_accepted_message, stage_for_run_status, ApplyOutcome,
    ClientMessageState, RunJournalEvent, RunJournalEventKind, TerminalReason,
};
use crate::run_core::{
    RecoveryAssessmentKind, RunCheckpoint, RunJournalReconcileReport, RunJournalSnapshot, RunStage,
    AMBIGUOUS_ACCEPTANCE_PREFIX,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

static JOURNAL_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn validate_run_id(run_id: &str) -> Result<(), String> {
    let trimmed = run_id.trim();
    if trimmed.is_empty() {
        return Err("run_id is required".to_string());
    }
    if trimmed.len() > 128 {
        return Err("run_id is too long".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("run_id may only contain ASCII letters, numbers, '-' and '_'".to_string());
    }
    Ok(())
}

fn validate_client_message_id(client_message_id: &str) -> Result<(), String> {
    let trimmed = client_message_id.trim();
    if trimmed.is_empty() {
        return Err("client_message_id is required".to_string());
    }
    if trimmed.len() > 256 {
        return Err("client_message_id is too long".to_string());
    }
    Ok(())
}

fn lock_for(run_id: &str) -> Arc<Mutex<()>> {
    let mut map = JOURNAL_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    map.retain(|_, value| Arc::strong_count(value) > 1);
    map.entry(run_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingRunJournalMutation {
    snapshot: RunJournalSnapshot,
    event: RunJournalEvent,
}

fn journal_file(run_dir: &Path) -> PathBuf {
    run_dir.join("run-journal.json")
}

fn events_file(run_dir: &Path) -> PathBuf {
    run_dir.join("run-journal-events.jsonl")
}

fn pending_file(run_dir: &Path) -> PathBuf {
    run_dir.join("run-journal-mutation.json")
}

fn repair_partial_tail(path: &Path) -> Result<(), String> {
    repair_jsonl_tail::<RunJournalEvent>(path)
}

fn list_events_raw(path: &Path, since_seq: u64) -> Vec<RunJournalEvent> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let mut events: Vec<RunJournalEvent> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<RunJournalEvent>(line).ok())
        .filter(|event| event.seq > since_seq)
        .collect();
    events.sort_by_key(|event| event.seq);
    events.dedup_by_key(|event| event.seq);
    events
}

fn event_log_has_accepted_message(run_dir: &Path, client_message_id: &str) -> bool {
    list_events_raw(&events_file(run_dir), 0)
        .iter()
        .any(|event| {
            matches!(
                &event.event,
                RunJournalEventKind::UserMessageAccepted {
                    client_message_id: accepted_id,
                    ..
                } if accepted_id == client_message_id
            )
        })
}

/// Walk the journal event log and reduce all events that name the
/// given `client_message_id` to the most recent terminal state. This
/// is the *recovery* view used when the snapshot row is missing
/// (e.g. snapshot was reset) but the WAL still has the events.
fn event_log_state(run_dir: &Path, client_message_id: &str) -> Option<ClientMessageState> {
    let mut state: Option<ClientMessageState> = None;
    for event in list_events_raw(&events_file(run_dir), 0) {
        let cid_matches = match &event.event {
            RunJournalEventKind::UserMessagePrepared {
                client_message_id: candidate,
                ..
            }
            | RunJournalEventKind::UserMessageAccepted {
                client_message_id: candidate,
                ..
            }
            | RunJournalEventKind::UserMessageStateChanged {
                client_message_id: candidate,
                ..
            } => candidate == client_message_id,
            _ => false,
        };
        if !cid_matches {
            continue;
        }
        match &event.event {
            RunJournalEventKind::UserMessagePrepared { .. } => {
                state = Some(ClientMessageState::Prepared);
            }
            RunJournalEventKind::UserMessageAccepted { .. } => {
                state = Some(ClientMessageState::Dispatched);
            }
            RunJournalEventKind::UserMessageStateChanged { state: next, .. } => {
                state = Some(next.clone());
            }
            _ => {}
        }
    }
    state
}

fn lookup_state(
    run_dir: &Path,
    snapshot: &RunJournalSnapshot,
    client_message_id: &str,
) -> Option<ClientMessageState> {
    lookup_client_message_state(snapshot, client_message_id)
        .or_else(|| event_log_state(run_dir, client_message_id))
}

fn journal_has_accepted_message(
    run_dir: &Path,
    snapshot: &RunJournalSnapshot,
    client_message_id: &str,
) -> bool {
    snapshot_has_accepted_message(snapshot, client_message_id)
        || event_log_has_accepted_message(run_dir, client_message_id)
}

fn message_acceptance_status(
    run_dir: &Path,
    snapshot: &RunJournalSnapshot,
    client_message_id: &str,
) -> Result<bool, String> {
    if journal_has_accepted_message(run_dir, snapshot, client_message_id) {
        return Ok(true);
    }
    if snapshot.journal_degraded {
        return Err(format!(
            "run journal is degraded and cannot prove whether client_message_id={client_message_id} was accepted: {}",
            snapshot.recovery_assessment.reason
        ));
    }
    Ok(false)
}

fn append_event_idempotent(run_dir: &Path, event: &RunJournalEvent) -> Result<(), String> {
    let path = events_file(run_dir);
    if let Some(parent) = path.parent() {
        super::ensure_dir(parent).map_err(|e| e.to_string())?;
    }
    repair_partial_tail(&path)?;

    if let Some(existing) = list_events_raw(&path, event.seq.saturating_sub(1))
        .into_iter()
        .find(|candidate| candidate.seq == event.seq)
    {
        if existing == *event {
            return Ok(());
        }
        return Err(format!(
            "run {} journal sequence {} already belongs to another event",
            event.run_id, event.seq
        ));
    }

    append_json_line(&path, event)
}

fn remove_pending(run_dir: &Path) -> Result<(), String> {
    remove_file_durable(&pending_file(run_dir))
}

fn save_snapshot(run_dir: &Path, snapshot: &RunJournalSnapshot) -> Result<(), String> {
    write_json_atomic(&journal_file(run_dir), snapshot)
}

fn get_raw_in(run_dir: &Path) -> Option<RunJournalSnapshot> {
    let path = journal_file(run_dir);
    let content = fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<RunJournalSnapshot>(&content) {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            log::warn!("[run-journal] parse error {}: {}", path.display(), error);
            None
        }
    }
}

fn persist_pending(run_dir: &Path, pending: &PendingRunJournalMutation) -> Result<(), String> {
    write_json_atomic(&pending_file(run_dir), pending)?;
    append_event_idempotent(run_dir, &pending.event)?;
    save_snapshot(run_dir, &pending.snapshot)?;
    remove_pending(run_dir)
}

fn recover_pending(run_dir: &Path, run_id: &str) -> Result<(), String> {
    let path = pending_file(run_dir);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("read pending run journal mutation {}: {e}", path.display()))?;
    let pending: PendingRunJournalMutation = serde_json::from_str(&content)
        .map_err(|e| format!("parse pending run journal mutation {}: {e}", path.display()))?;
    if pending.snapshot.run_id != run_id || pending.event.run_id != run_id {
        return Err(format!(
            "pending mutation identity mismatch for run {run_id}"
        ));
    }

    append_event_idempotent(run_dir, &pending.event)?;
    let current = get_raw_in(run_dir);
    if current
        .as_ref()
        .is_none_or(|snapshot| snapshot.revision < pending.snapshot.revision)
    {
        save_snapshot(run_dir, &pending.snapshot)?;
    }
    remove_pending(run_dir)
}

fn run_dir_for(run_id: &str) -> PathBuf {
    super::run_dir(run_id)
}

fn with_lock<T, F>(run_id: &str, f: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String>,
{
    validate_run_id(run_id)?;
    let lock = lock_for(run_id);
    let _guard = lock.lock().map_err(|e| format!("run journal lock: {e}"))?;
    let run_dir = run_dir_for(run_id);
    recover_pending(&run_dir, run_id)?;
    f(&run_dir)
}

fn commit_mutation(
    run_dir: &Path,
    snapshot: &mut RunJournalSnapshot,
    kind: RunJournalEventKind,
    timestamp: String,
) -> Result<ApplyOutcome, String> {
    let mut working = snapshot.clone();
    let outcome = apply_event(&mut working, &kind, timestamp.clone())?;
    if outcome == ApplyOutcome::NoOp {
        return Ok(ApplyOutcome::NoOp);
    }
    let run_id = working.run_id.clone();
    let event = make_event(&mut working, &run_id, kind, timestamp);
    persist_pending(
        run_dir,
        &PendingRunJournalMutation {
            snapshot: working.clone(),
            event,
        },
    )?;
    *snapshot = working;
    Ok(ApplyOutcome::Changed)
}

fn load_existing_journal(
    run_dir: &Path,
    run_id: &str,
) -> Result<Option<RunJournalSnapshot>, String> {
    if let Some(snapshot) = get_raw_in(run_dir) {
        return Ok(Some(snapshot));
    }
    if journal_file(run_dir).exists() {
        return Err(format!(
            "run journal for {run_id} exists but is corrupt or unreadable"
        ));
    }
    Ok(None)
}

pub fn init_from_run_meta(meta: &RunMeta) -> Result<RunJournalSnapshot, String> {
    with_lock(&meta.id, |run_dir| {
        if let Some(existing) = load_existing_journal(run_dir, &meta.id)? {
            return Ok(existing);
        }
        let now = now_iso();
        let stage = stage_for_run_status(meta.status.clone());
        let mut snapshot = init_snapshot(&meta.id, &meta.prompt, stage, now.clone());
        let kind = RunJournalEventKind::Initialized {
            objective: meta.prompt.clone(),
            stage,
        };
        commit_mutation(run_dir, &mut snapshot, kind, now)?;
        Ok(snapshot)
    })
}

pub fn get_existing(run_id: &str) -> Result<Option<RunJournalSnapshot>, String> {
    validate_run_id(run_id)?;
    let lock = lock_for(run_id);
    let _guard = lock.lock().map_err(|e| format!("run journal lock: {e}"))?;
    let run_dir = run_dir_for(run_id);
    recover_pending(&run_dir, run_id)?;
    load_existing_journal(&run_dir, run_id)
}

pub fn get_or_init(run_id: &str) -> Result<RunJournalSnapshot, String> {
    with_lock(run_id, |run_dir| {
        if let Some(snapshot) = load_existing_journal(run_dir, run_id)? {
            return Ok(snapshot);
        }
        let meta = super::runs::get_run(run_id)
            .ok_or_else(|| format!("Run {run_id} not found for journal lazy init"))?;
        let now = now_iso();
        let stage = stage_for_run_status(meta.status.clone());
        let mut snapshot = init_snapshot(run_id, &meta.prompt, stage, now.clone());
        let kind = RunJournalEventKind::Initialized {
            objective: meta.prompt.clone(),
            stage,
        };
        commit_mutation(run_dir, &mut snapshot, kind, now)?;
        Ok(snapshot)
    })
}

pub fn list_events(run_id: &str, since_seq: u64) -> Result<Vec<RunJournalEvent>, String> {
    let _ = get_or_init(run_id)?;
    with_lock(run_id, |run_dir| {
        let path = events_file(run_dir);
        repair_partial_tail(&path)?;
        Ok(list_events_raw(&path, since_seq))
    })
}

pub fn is_message_accepted(run_id: &str, client_message_id: &str) -> Result<bool, String> {
    validate_client_message_id(client_message_id)?;
    // Legacy runs lazily acquire a journal before deduplication. A read or
    // recovery failure is returned to the caller so dispatch can fail closed.
    let _ = get_or_init(run_id)?;
    with_lock(run_id, |run_dir| {
        let snapshot = get_raw_in(run_dir)
            .ok_or_else(|| format!("run journal snapshot unavailable for {run_id}"))?;
        message_acceptance_status(run_dir, &snapshot, client_message_id)
    })
}

/// P0-3 crash-aware dedupe primitive.
///
/// Look up the lifecycle state of a `client_message_id`. Returns
/// `Ok(None)` when the cid has never been recorded; an `Err` when
/// the journal is degraded and a definitive answer cannot be given
/// (callers must fail-closed on degraded reads).
///
/// This is the single primitive the chat command uses to decide
/// idempotent retry vs. spawn — every other helper reduces to this
/// one.
pub fn get_state(
    run_id: &str,
    client_message_id: &str,
) -> Result<Option<ClientMessageState>, String> {
    validate_client_message_id(client_message_id)?;
    // The legacy `is_message_accepted` path calls `get_or_init` to
    // lazily upgrade pending runs. We mirror that contract here so
    // `commands::chat::send_chat_message` can call get_state before
    // any record_* mutation without an extra round-trip.
    let _ = get_or_init(run_id)?;
    let result = with_lock(
        run_id,
        |run_dir| -> Result<Option<ClientMessageState>, String> {
            let snapshot = get_raw_in(run_dir)
                .ok_or_else(|| format!("run journal snapshot unavailable for {run_id}"))?;
            if let Some(state) = lookup_state(run_dir, &snapshot, client_message_id) {
                return Ok(Some(state));
            }
            if snapshot.journal_degraded {
                return Err(format!(
                "run journal is degraded and cannot prove whether client_message_id={client_message_id} was accepted: {}",
                snapshot.recovery_assessment.reason
            ));
            }
            Ok(None)
        },
    );
    if let Err(error) = &result {
        log::debug!("[run-journal] get_state failed for run_id={run_id}: {error}");
    }
    result
}

/// P0-3 crash-aware acceptance — stage one of three.
///
/// Record that a user request was durably committed to the journal
/// *before* the dispatcher attempts to spawn the child process. A
/// successful return here means the cid is in the `Prepared` state
/// and the caller MUST follow up with either `record_dispatched` (on
/// successful spawn) or `record_terminal` (on spawn failure). Leaving
/// the cid in `Prepared` indefinitely is precisely the "ambiguous"
/// state we want the frontend to surface.
///
/// Caller-visible error mapping:
/// * `Err(...)` ⇒ the journal persistence failed and the caller
///   MUST NOT spawn. This is the only safe failure mode — the
///   pre-P0-3 behaviour of "log a warning then spawn anyway" left
///   the ledger out of sync with the spawn and was the root cause of
///   the v1.1.0 retention regression.
pub fn record_prepared(
    run_id: &str,
    client_message_id: &str,
    text_preview: Option<&str>,
) -> Result<(), String> {
    validate_client_message_id(client_message_id)?;
    let result = with_lock(run_id, |run_dir| -> Result<(), String> {
        let mut snapshot = get_raw_in(run_dir)
            .ok_or_else(|| format!("run journal missing for {run_id}; call get_or_init first"))?;
        if let Some(existing) = lookup_state(run_dir, &snapshot, client_message_id) {
            // The cid already has a recorded state — refuse to
            // overwrite. The chat command uses get_state() *first*
            // and treats `Dispatched` as a no-op and `Terminal` /
            // `Prepared` as a stop / ambiguous signal. Reaching here
            // means the caller violated that protocol; surface a
            // typed error so the bug is loud.
            return Err(format!(
                "record_prepared: client_message_id={client_message_id} already recorded as {:?}",
                existing
            ));
        }
        let kind = RunJournalEventKind::UserMessagePrepared {
            client_message_id: client_message_id.to_string(),
            text_preview: text_preview.map(str::to_string),
        };
        match commit_mutation(run_dir, &mut snapshot, kind, now_iso()) {
            Ok(ApplyOutcome::Changed) | Ok(ApplyOutcome::NoOp) => {
                log::info!(
                    "[run-journal] record_prepared: run_id={run_id} client_message_id={client_message_id}"
                );
                Ok(())
            }
            Err(error) => Err(format!(
                "record_prepared failed for client_message_id={client_message_id}: {error}"
            )),
        }
    });
    if let Err(error) = &result {
        log::error!("[run-journal] {error}");
    }
    result
}

/// P0-3 crash-aware acceptance — stage two of three.
///
/// Promote a `Prepared` row to `Dispatched` after the CLI child was
/// successfully spawned. Idempotent: if the row is already in
/// `Dispatched` (e.g. the WAL was replayed during recovery) this is
/// a no-op. Refuses to transition *out* of a terminal state — the
/// caller must inspect get_state before retrying.
pub fn record_dispatched(run_id: &str, client_message_id: &str) -> Result<(), String> {
    validate_client_message_id(client_message_id)?;
    let result = with_lock(run_id, |run_dir| -> Result<(), String> {
        let mut snapshot = get_raw_in(run_dir)
            .ok_or_else(|| format!("run journal missing for {run_id}; call get_or_init first"))?;
        let current = lookup_state(run_dir, &snapshot, client_message_id);
        match current {
            Some(ClientMessageState::Prepared) => {}
            Some(ClientMessageState::Dispatched) => return Ok(()),
            Some(ClientMessageState::Terminal { reason }) => {
                return Err(format!(
                    "record_dispatched: client_message_id={client_message_id} already terminal ({})",
                    reason.as_str()
                ));
            }
            None => {
                // Recovery path: journal lost the prepared row but
                // the spawn succeeded — backfill the row directly
                // in Dispatched so future retries see the idempotent
                // state. This prevents the worst failure where we
                // spawn a second child after a restart.
                log::warn!(
                    "[run-journal] record_dispatched: backfilling missing prepared row for client_message_id={client_message_id}"
                );
            }
        }
        let kind = RunJournalEventKind::UserMessageStateChanged {
            client_message_id: client_message_id.to_string(),
            preview: None,
            state: ClientMessageState::Dispatched,
        };
        match commit_mutation(run_dir, &mut snapshot, kind, now_iso()) {
            Ok(ApplyOutcome::Changed) | Ok(ApplyOutcome::NoOp) => {
                log::info!(
                    "[run-journal] record_dispatched: run_id={run_id} client_message_id={client_message_id}"
                );
                Ok(())
            }
            Err(error) => Err(format!(
                "record_dispatched failed for client_message_id={client_message_id}: {error}"
            )),
        }
    });
    if let Err(error) = &result {
        log::error!("[run-journal] {error}");
    }
    result
}

/// P0-3 crash-aware acceptance — stage three of three.
///
/// Move a previously-recorded cid into its `Terminal` state. Used in
/// three places:
///
/// 1. The dispatcher calls this with `SpawnFailed { message }`
///    immediately after the CLI child fails to launch. From here on,
///    retries with the same cid return `Err(...)` so the user knows
///    to resend with a new cid.
/// 2. The run completion path calls this with `Completed` after the
///    CLI exits cleanly.
/// 3. The user-stop path calls this with `UserStopped` so the
///    frontend can render the "you stopped this earlier" state.
///
/// Idempotent for repeated `Completed`/`UserStopped` terminal events.
pub fn record_terminal(
    run_id: &str,
    client_message_id: &str,
    reason: TerminalReason,
) -> Result<(), String> {
    validate_client_message_id(client_message_id)?;
    let reason_label = reason.as_str();
    let result = with_lock(run_id, |run_dir| -> Result<(), String> {
        let mut snapshot = get_raw_in(run_dir)
            .ok_or_else(|| format!("run journal missing for {run_id}; call get_or_init first"))?;
        let kind = RunJournalEventKind::UserMessageStateChanged {
            client_message_id: client_message_id.to_string(),
            preview: None,
            state: ClientMessageState::Terminal {
                reason: reason.clone(),
            },
        };
        match commit_mutation(run_dir, &mut snapshot, kind, now_iso()) {
            Ok(ApplyOutcome::Changed) | Ok(ApplyOutcome::NoOp) => {
                log::info!(
                    "[run-journal] record_terminal: run_id={run_id} client_message_id={client_message_id} reason={reason_label}"
                );
                Ok(())
            }
            Err(error) => Err(format!(
                "record_terminal failed for client_message_id={client_message_id}: {error}"
            )),
        }
    });
    if let Err(error) = &result {
        log::error!("[run-journal] {error}");
    }
    result
}

/// P0-3 deleted path — kept as a thin compat wrapper that delegates
/// to the new state machine. The actor path (`session_actor`) still
/// calls this; it has not been migrated to P0-3 yet.
///
/// New code MUST use `record_prepared` followed by
/// `record_dispatched` so retry semantics are crash-aware. Calling
/// the legacy `record_accepted_message` from a fresh code path will
/// be flagged in code review.
#[deprecated(
    since = "1.1.0",
    note = "P0-3: use record_prepared + record_dispatched for crash-aware dedupe"
)]
pub fn record_accepted_message(
    run_id: &str,
    client_message_id: &str,
    text_preview: Option<&str>,
) -> Result<(), String> {
    validate_client_message_id(client_message_id)?;
    with_lock(run_id, |run_dir| {
        let mut snapshot = get_raw_in(run_dir)
            .ok_or_else(|| format!("run journal missing for {run_id}; call get_or_init first"))?;
        if journal_has_accepted_message(run_dir, &snapshot, client_message_id) {
            return Ok(());
        }
        // Compat: legacy path was always invoked *after* spawn
        // confirmation, so we go straight to `UserMessageAccepted`
        // (which maps to Dispatched) and skip the Prepared stage.
        let kind = RunJournalEventKind::UserMessageAccepted {
            client_message_id: client_message_id.to_string(),
            text_preview: text_preview.map(str::to_string),
        };
        match commit_mutation(run_dir, &mut snapshot, kind, now_iso()) {
            Ok(ApplyOutcome::Changed) | Ok(ApplyOutcome::NoOp) => Ok(()),
            Err(error) => Err(format!(
                "{AMBIGUOUS_ACCEPTANCE_PREFIX}: stdin already delivered for client_message_id={client_message_id}; journal persistence failed: {error}"
            )),
        }
    })
}

/// Convenience helper that the chat command uses to decide whether a
/// cid has reached a terminal state without paying the
/// `Result<Option<...>>` tax. Returns `true` only when `get_state`
/// returned `Some(Terminal { .. })`.
pub fn is_terminal(run_id: &str, client_message_id: &str) -> bool {
    matches!(
        get_state(run_id, client_message_id),
        Ok(Some(ClientMessageState::Terminal { .. }))
    )
}

/// Helper that the chat command uses to detect the
/// dispatch-already-happened idempotency case without enumerating
/// every enum arm.
pub fn is_dispatched(run_id: &str, client_message_id: &str) -> bool {
    matches!(
        get_state(run_id, client_message_id),
        Ok(Some(ClientMessageState::Dispatched))
    )
}

/// Surface the `is_terminal_client_message` snapshot helper
/// alongside the journal API so callers don't need a direct
/// dependency on `run_core::apply`.
pub fn snapshot_is_terminal(snapshot: &RunJournalSnapshot, client_message_id: &str) -> bool {
    is_terminal_client_message(snapshot, client_message_id)
}

pub fn project_bus_event(run_id: &str, bus_seq: u64, event: &BusEvent) -> Result<(), String> {
    let result = get_or_init(run_id).and_then(|_| {
        with_lock(run_id, |run_dir| {
            let mut snapshot = match get_raw_in(run_dir) {
                Some(snapshot) => snapshot,
                None => return Ok(false),
            };
            let now = now_iso();
            let (outcome, kind) = plan_projection(&snapshot, bus_seq, event, &now)?;
            if outcome != ProjectOutcome::Applied {
                return Ok(false);
            }
            let Some(kind) = kind else {
                return Ok(false);
            };
            let apply_result = apply_event(&mut snapshot, &kind, now.clone())?;
            if apply_result == ApplyOutcome::NoOp {
                return Ok(false);
            }
            finish_projection(&mut snapshot, bus_seq);
            let journal_event = make_event(&mut snapshot, run_id, kind, now);
            persist_pending(
                run_dir,
                &PendingRunJournalMutation {
                    snapshot: snapshot.clone(),
                    event: journal_event,
                },
            )?;
            Ok(true)
        })
    });
    let projected = match result {
        Ok(projected) => projected,
        Err(error) => {
            log::warn!(
                "[run-journal] projection failed for run_id={run_id} bus_seq={bus_seq}: {error}"
            );
            let degradation = mark_degraded(run_id, &format!("projection failed: {error}"));
            return match degradation {
                Ok(()) => Err(error),
                Err(degraded_error) => Err(format!(
                    "{error}; additionally failed to mark journal degraded: {degraded_error}"
                )),
            };
        }
    };
    if projected {
        if let Err(error) = crate::storage::attention_queue::sync_run(run_id) {
            log::debug!("[attention-queue] sync_run after projection failed for {run_id}: {error}");
        }
    }
    Ok(())
}

pub fn create_checkpoint(run_id: &str, label: Option<String>) -> Result<RunCheckpoint, String> {
    let _ = get_or_init(run_id)?;
    with_lock(run_id, |run_dir| {
        let mut snapshot =
            get_raw_in(run_dir).ok_or_else(|| format!("run journal missing for {run_id}"))?;
        let now = now_iso();
        let cursor_seq = snapshot.recovery_cursor.cursor_seq.saturating_add(1);
        let checkpoint = RunCheckpoint {
            checkpoint_id: uuid::Uuid::new_v4().to_string(),
            cursor_seq,
            stage: snapshot.stage,
            plan_revision: snapshot.plan_revision,
            label,
            created_at: now.clone(),
        };
        let kind = RunJournalEventKind::CheckpointCreated {
            checkpoint: checkpoint.clone(),
        };
        commit_mutation(run_dir, &mut snapshot, kind, now)?;
        Ok(checkpoint)
    })
}

pub fn mark_degraded(run_id: &str, reason: &str) -> Result<(), String> {
    let _ = get_or_init(run_id)?;
    let result = with_lock(run_id, |run_dir| {
        let mut snapshot =
            get_raw_in(run_dir).ok_or_else(|| format!("run journal missing for {run_id}"))?;
        let kind = RunJournalEventKind::Degraded {
            reason: reason.to_string(),
        };
        match commit_mutation(run_dir, &mut snapshot, kind, now_iso())? {
            ApplyOutcome::Changed | ApplyOutcome::NoOp => Ok(()),
        }
    });
    if result.is_ok() {
        if let Err(error) = crate::storage::attention_queue::sync_run(run_id) {
            log::debug!(
                "[attention-queue] sync_run after mark_degraded failed for {run_id}: {error}"
            );
        }
    }
    result
}

mod reconcile;
pub use reconcile::reconcile_after_restart;
#[cfg(test)]
use reconcile::reconcile_in;

#[cfg(test)]
mod tests;
