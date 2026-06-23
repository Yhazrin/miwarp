use super::*;
use crate::models::{RunMeta, RunStatus};
use crate::run_core::{
    init_snapshot, make_event, stage_for_run_status, RunActionStatus, RunIdempotencyClass,
    RunJournalEventKind, RunStage,
};
use std::fs;
use std::path::{Path, PathBuf};

fn temp_runs_root(test_name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "miwarp-run-journal-{test_name}-{}",
        uuid::Uuid::new_v4()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn sample_meta(id: &str, status: RunStatus) -> RunMeta {
    RunMeta {
        id: id.to_string(),
        prompt: "do something".to_string(),
        cwd: "/tmp".to_string(),
        agent: "claude".to_string(),
        auth_mode: "cli".to_string(),
        status,
        started_at: "2026-06-23T00:00:00Z".to_string(),
        ended_at: None,
        exit_code: None,
        error_message: None,
        session_id: None,
        result_subtype: None,
        model: None,
        parent_run_id: None,
        name: None,
        remote_host_name: None,
        remote_cwd: None,
        remote_host_snapshot: None,
        platform_id: None,
        platform_base_url: None,
        source: None,
        cli_import_watermark: None,
        cli_session_path: None,
        cli_usage_incomplete: None,
        folder_id: None,
        deleted_at: None,
        creation_mode: None,
        worktree_path: None,
        worktree_branch: None,
        parent_cwd: None,
        execution_path: None,
        no_session_persistence: false,
        conversation_ref: None,
        scheduled_task_id: None,
        scheduled_task_run_id: None,
        runtime_kind: None,
        protocol_kind: None,
    }
}

fn write_meta(runs_root: &Path, meta: &RunMeta) {
    let dir = runs_root.join(&meta.id);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("meta.json"),
        serde_json::to_string_pretty(meta).unwrap(),
    )
    .unwrap();
}

#[test]
fn legacy_lazy_init_from_run_meta() {
    let root = temp_runs_root("lazy-init");
    let meta = sample_meta("run-a", RunStatus::Idle);
    write_meta(&root, &meta);
    let run_dir = root.join("run-a");
    let snapshot = {
        let lock = super::lock_for("run-a");
        let _guard = lock.lock().unwrap();
        recover_pending(&run_dir, "run-a").unwrap();
        let stage = stage_for_run_status(meta.status.clone());
        let mut snapshot = init_snapshot("run-a", &meta.prompt, stage, "t0");
        let kind = RunJournalEventKind::Initialized {
            objective: meta.prompt.clone(),
            stage,
        };
        commit_mutation(&run_dir, &mut snapshot, kind, "t0".to_string()).unwrap();
        snapshot
    };
    assert_eq!(snapshot.run_id, "run-a");
    assert_eq!(snapshot.stage, RunStage::Waiting);
    assert!(journal_file(&run_dir).exists());
    assert!(events_file(&run_dir).exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn duplicate_accepted_message_no_op() {
    let root = temp_runs_root("dup-accept");
    let meta = sample_meta("run-b", RunStatus::Running);
    write_meta(&root, &meta);
    let run_dir = root.join("run-b");
    {
        let lock = super::lock_for("run-b");
        let _guard = lock.lock().unwrap();
        let stage = stage_for_run_status(meta.status.clone());
        let mut snapshot = init_snapshot("run-b", &meta.prompt, stage, "t0");
        commit_mutation(
            &run_dir,
            &mut snapshot,
            RunJournalEventKind::Initialized {
                objective: meta.prompt.clone(),
                stage,
            },
            "t0".to_string(),
        )
        .unwrap();
    }
    // Simulate storage calls without global runs::get_run
    record_accepted_message_in(&run_dir, "run-b", "cid-1", None).unwrap();
    let first = get_raw_in(&run_dir).unwrap();
    let revision = first.revision;
    let seq = first.last_journal_seq;
    record_accepted_message_in(&run_dir, "run-b", "cid-1", None).unwrap();
    let second = get_raw_in(&run_dir).unwrap();
    assert_eq!(second.revision, revision);
    assert_eq!(second.last_journal_seq, seq);
    let _ = fs::remove_dir_all(root);
}

fn record_accepted_message_in(
    run_dir: &Path,
    run_id: &str,
    client_message_id: &str,
    text_preview: Option<&str>,
) -> Result<(), String> {
    let lock = super::lock_for(run_id);
    let _guard = lock.lock().map_err(|e| format!("lock: {e}"))?;
    recover_pending(run_dir, run_id)?;
    let mut snapshot = get_raw_in(run_dir).ok_or_else(|| "missing snapshot".to_string())?;
    if journal_has_accepted_message(run_dir, &snapshot, client_message_id) {
        return Ok(());
    }
    let kind = RunJournalEventKind::UserMessageAccepted {
        client_message_id: client_message_id.to_string(),
        text_preview: text_preview.map(str::to_string),
    };
    commit_mutation(run_dir, &mut snapshot, kind, now_iso()).map(|_| ())
}

#[test]
fn wal_recovery_after_event_before_snapshot() {
    let root = temp_runs_root("wal-recover");
    let run_dir = root.join("run-c");
    fs::create_dir_all(&run_dir).unwrap();
    let mut snapshot = init_snapshot("run-c", "obj", RunStage::Starting, "t0");
    let event = make_event(
        &mut snapshot,
        "run-c",
        RunJournalEventKind::Initialized {
            objective: "obj".to_string(),
            stage: RunStage::Starting,
        },
        "t0".to_string(),
    );
    write_json_atomic(
        &pending_file(&run_dir),
        &PendingRunJournalMutation {
            snapshot: snapshot.clone(),
            event: event.clone(),
        },
    )
    .unwrap();
    append_event_idempotent(&run_dir, &event).unwrap();
    recover_pending(&run_dir, "run-c").unwrap();
    assert!(!pending_file(&run_dir).exists());
    assert!(get_raw_in(&run_dir).is_some());
    recover_pending(&run_dir, "run-c").unwrap();
    let _ = fs::remove_dir_all(root);
}

#[test]
fn bad_jsonl_tail_repaired() {
    let root = temp_runs_root("bad-tail");
    let run_dir = root.join("run-d");
    fs::create_dir_all(&run_dir).unwrap();
    let path = events_file(&run_dir);
    fs::write(&path, "{\"incomplete\":true\n").unwrap();
    repair_partial_tail(&path).unwrap();
    let content = fs::read_to_string(&path).unwrap();
    assert!(content.is_empty() || content.ends_with('\n'));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn restart_reconcile_read_only_safe_retry() {
    let root = temp_runs_root("reconcile-ro");
    let run_dir = root.join("run-e");
    fs::create_dir_all(&run_dir).unwrap();
    let mut snapshot = init_snapshot("run-e", "obj", RunStage::Executing, "t0");
    snapshot.actions.push(crate::run_core::RunActionRecord {
        action_id: "a1".to_string(),
        tool_name: "Read".to_string(),
        tool_use_id: "a1".to_string(),
        idempotency_class: RunIdempotencyClass::ReadOnly,
        status: RunActionStatus::Started,
        bus_seq_start: Some(1),
        started_at: "t0".to_string(),
        completed_at: None,
        error: None,
    });
    save_snapshot(&run_dir, &snapshot).unwrap();
    let meta = sample_meta("run-e", RunStatus::Stopped);
    write_meta(&root, &meta);

    let report = reconcile_in(&root);
    assert_eq!(report.restart_reconciled, 1);
    let updated = get_raw_in(&run_dir).unwrap();
    assert_eq!(updated.stage, RunStage::Stopped);
    assert_eq!(
        updated.recovery_assessment.kind,
        crate::run_core::RecoveryAssessmentKind::SafeRetry
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn restart_reconcile_non_idempotent_manual_confirmation() {
    let root = temp_runs_root("reconcile-ni");
    let run_dir = root.join("run-f");
    fs::create_dir_all(&run_dir).unwrap();
    let mut snapshot = init_snapshot("run-f", "obj", RunStage::Executing, "t0");
    snapshot.actions.push(crate::run_core::RunActionRecord {
        action_id: "bash-1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "bash-1".to_string(),
        idempotency_class: RunIdempotencyClass::NonIdempotent,
        status: RunActionStatus::Started,
        bus_seq_start: Some(1),
        started_at: "t0".to_string(),
        completed_at: None,
        error: None,
    });
    save_snapshot(&run_dir, &snapshot).unwrap();
    let meta = sample_meta("run-f", RunStatus::Stopped);
    write_meta(&root, &meta);

    let report = reconcile_in(&root);
    assert_eq!(report.restart_reconciled, 1);
    assert_eq!(report.marked_uncertain, 1);
    let updated = get_raw_in(&run_dir).unwrap();
    assert_eq!(
        updated.recovery_assessment.kind,
        crate::run_core::RecoveryAssessmentKind::ManualConfirmation
    );
    assert_eq!(updated.actions[0].status, RunActionStatus::Uncertain);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn accepted_message_history_survives_snapshot_eviction() {
    let root = temp_runs_root("accepted-history");
    let run_dir = root.join("run-history");
    fs::create_dir_all(&run_dir).unwrap();
    let mut snapshot = init_snapshot("run-history", "obj", RunStage::Executing, "t0");
    commit_mutation(
        &run_dir,
        &mut snapshot,
        RunJournalEventKind::Initialized {
            objective: "obj".to_string(),
            stage: RunStage::Executing,
        },
        "t0".to_string(),
    )
    .unwrap();
    record_accepted_message_in(&run_dir, "run-history", "old-cid", None).unwrap();

    let mut evicted = get_raw_in(&run_dir).unwrap();
    evicted.accepted_messages.clear();
    save_snapshot(&run_dir, &evicted).unwrap();
    assert!(journal_has_accepted_message(&run_dir, &evicted, "old-cid"));

    let revision = evicted.revision;
    let seq = evicted.last_journal_seq;
    record_accepted_message_in(&run_dir, "run-history", "old-cid", None).unwrap();
    let after = get_raw_in(&run_dir).unwrap();
    assert_eq!(after.revision, revision);
    assert_eq!(after.last_journal_seq, seq);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn wal_recovery_before_event_append_is_idempotent() {
    let root = temp_runs_root("wal-before-event");
    let run_dir = root.join("run-before");
    fs::create_dir_all(&run_dir).unwrap();
    let mut snapshot = init_snapshot("run-before", "obj", RunStage::Starting, "t0");
    let kind = RunJournalEventKind::Initialized {
        objective: "obj".to_string(),
        stage: RunStage::Starting,
    };
    let _ = apply_event(&mut snapshot, &kind, "t0").unwrap();
    let event = make_event(&mut snapshot, "run-before", kind, "t0".to_string());
    write_json_atomic(
        &pending_file(&run_dir),
        &PendingRunJournalMutation {
            snapshot: snapshot.clone(),
            event,
        },
    )
    .unwrap();

    recover_pending(&run_dir, "run-before").unwrap();
    recover_pending(&run_dir, "run-before").unwrap();
    assert!(!pending_file(&run_dir).exists());
    assert_eq!(list_events_raw(&events_file(&run_dir), 0).len(), 1);
    assert_eq!(get_raw_in(&run_dir).unwrap().revision, 1);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn run_id_validation_rejects_path_segments() {
    assert!(validate_run_id("run-123_ok").is_ok());
    assert!(validate_run_id("../escape").is_err());
    assert!(validate_run_id("nested/run").is_err());
    assert!(validate_run_id("").is_err());
}

#[test]
fn mixed_unfinished_actions_prioritize_manual_confirmation() {
    let root = temp_runs_root("reconcile-mixed");
    let run_dir = root.join("run-mixed");
    fs::create_dir_all(&run_dir).unwrap();
    let mut snapshot = init_snapshot("run-mixed", "obj", RunStage::Executing, "t0");
    for (action_id, class) in [
        ("bash-1", RunIdempotencyClass::NonIdempotent),
        ("read-1", RunIdempotencyClass::ReadOnly),
    ] {
        snapshot.actions.push(crate::run_core::RunActionRecord {
            action_id: action_id.to_string(),
            tool_name: action_id.to_string(),
            tool_use_id: action_id.to_string(),
            idempotency_class: class,
            status: RunActionStatus::Started,
            bus_seq_start: None,
            started_at: "t0".to_string(),
            completed_at: None,
            error: None,
        });
    }
    save_snapshot(&run_dir, &snapshot).unwrap();
    write_meta(&root, &sample_meta("run-mixed", RunStatus::Stopped));

    let report = reconcile_in(&root);
    assert_eq!(report.marked_uncertain, 1);
    let updated = get_raw_in(&run_dir).unwrap();
    assert_eq!(
        updated.recovery_assessment.kind,
        crate::run_core::RecoveryAssessmentKind::ManualConfirmation
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn corrupt_existing_journal_is_reported_impossible() {
    let root = temp_runs_root("corrupt-journal");
    let run_dir = root.join("run-corrupt");
    fs::create_dir_all(&run_dir).unwrap();
    fs::write(journal_file(&run_dir), "not-json").unwrap();
    write_meta(&root, &sample_meta("run-corrupt", RunStatus::Stopped));

    let report = reconcile_in(&root);
    assert_eq!(report.impossible_resume, 1);
    assert!(report
        .failures
        .iter()
        .any(|failure| failure.contains("corrupt or unreadable")));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn missing_meta_persists_impossible_resume_assessment() {
    let root = temp_runs_root("missing-meta");
    let run_dir = root.join("run-no-meta");
    fs::create_dir_all(&run_dir).unwrap();
    let snapshot = init_snapshot("run-no-meta", "obj", RunStage::Executing, "t0");
    save_snapshot(&run_dir, &snapshot).unwrap();

    let report = reconcile_in(&root);
    assert_eq!(report.impossible_resume, 1);
    assert_eq!(report.restart_reconciled, 1);
    let updated = get_raw_in(&run_dir).unwrap();
    assert_eq!(updated.stage, RunStage::Failed);
    assert_eq!(
        updated.recovery_assessment.kind,
        crate::run_core::RecoveryAssessmentKind::ImpossibleResume
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn corrupt_journal_is_never_treated_as_missing() {
    let root = temp_runs_root("corrupt-not-missing");
    let run_dir = root.join("run-corrupt-init");
    fs::create_dir_all(&run_dir).unwrap();
    fs::write(journal_file(&run_dir), "{broken").unwrap();

    let error = load_existing_journal(&run_dir, "run-corrupt-init").unwrap_err();
    assert!(error.contains("corrupt or unreadable"));
    assert_eq!(
        fs::read_to_string(journal_file(&run_dir)).unwrap(),
        "{broken"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn degraded_journal_allows_known_acceptance_but_blocks_unknown_ids() {
    let root = temp_runs_root("degraded-dedupe");
    let run_dir = root.join("run-degraded");
    fs::create_dir_all(&run_dir).unwrap();
    let mut snapshot = init_snapshot("run-degraded", "obj", RunStage::Executing, "t0");
    commit_mutation(
        &run_dir,
        &mut snapshot,
        RunJournalEventKind::Initialized {
            objective: "obj".to_string(),
            stage: RunStage::Executing,
        },
        "t0".to_string(),
    )
    .unwrap();
    record_accepted_message_in(&run_dir, "run-degraded", "known-cid", None).unwrap();

    let mut degraded = get_raw_in(&run_dir).unwrap();
    degraded.journal_degraded = true;
    degraded.recovery_assessment.reason = "ambiguous acceptance".to_string();
    save_snapshot(&run_dir, &degraded).unwrap();

    assert!(message_acceptance_status(&run_dir, &degraded, "known-cid").unwrap());
    let error = message_acceptance_status(&run_dir, &degraded, "unknown-cid").unwrap_err();
    assert!(error.contains("journal is degraded"));
    let _ = fs::remove_dir_all(root);
}
