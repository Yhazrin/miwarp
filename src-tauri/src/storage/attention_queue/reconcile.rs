use super::{
    apply_signals, apply_signals_scoped, ensure_initialized, get_raw_in, queue_file_exists,
    save_snapshot, with_lock, with_lock_recovery, AttentionSyncScope,
};
use crate::attention_core::init_snapshot;
use crate::attention_core::{
    allowed_actions_for, stable_key_impossible_resume, stable_key_journal_degraded,
    stable_key_manual_confirmation, stable_key_pending_approval, stable_key_task, AttentionKind,
    AttentionReconcileReport, AttentionSeverity, AttentionSignal,
};
use crate::run_core::{PendingApproval, RecoveryAssessmentKind, RunJournalSnapshot};
use crate::storage::{run_dir, runs, tasks};
use crate::task_core::{TaskRecord, TaskStatus};
use std::fs;
use std::path::Path;

const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;

fn task_id_for_run(tasks: &[TaskRecord], run_id: &str) -> Option<String> {
    let mut linked: Vec<&str> = tasks
        .iter()
        .filter(|task| task.run_links.iter().any(|link| link.run_id == run_id))
        .map(|task| task.id.as_str())
        .collect();
    linked.sort_unstable();
    linked.first().map(|id| (*id).to_string())
}

fn timestamp_revision(timestamp: &str, fallback: u64) -> u64 {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .and_then(|value| u64::try_from(value.timestamp_millis()).ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback.max(1))
}

pub fn journal_file_fingerprint(run_id: &str) -> u64 {
    let path = run_dir(run_id).join("run-journal.json");
    fs::metadata(&path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        // Milliseconds remain exactly representable by the TypeScript number
        // contract; nanoseconds would exceed JavaScript's safe integer range.
        .map(|duration| {
            u64::try_from(duration.as_millis())
                .unwrap_or(MAX_SAFE_JS_INTEGER)
                .min(MAX_SAFE_JS_INTEGER)
        })
        .filter(|value| *value > 0)
        .unwrap_or(1)
}

fn signal_from_task(task: &TaskRecord) -> Option<AttentionSignal> {
    if task.status != TaskStatus::NeedsAttention {
        return None;
    }
    let task_id = task.id.clone();
    Some(AttentionSignal {
        stable_key: stable_key_task(&task_id),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: task.title.clone(),
        summary: if task.objective.is_empty() {
            format!("Task {} needs operator attention", task.title)
        } else {
            task.objective.clone()
        },
        task_id: Some(task_id.clone()),
        run_id: task.run_links.first().map(|link| link.run_id.clone()),
        request_id: None,
        action_id: None,
        source_revision: task.revision,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some(&task_id)),
    })
}

fn signals_from_journal(
    run_id: &str,
    journal: &RunJournalSnapshot,
    task_id: Option<&str>,
) -> Vec<AttentionSignal> {
    let mut signals = Vec::new();
    let assessment_revision =
        timestamp_revision(&journal.recovery_assessment.assessed_at, journal.revision);

    for approval in &journal.pending_approvals {
        signals.push(signal_from_pending_approval(
            run_id,
            approval,
            timestamp_revision(&approval.raised_at, journal.revision),
            task_id,
        ));
    }

    match journal.recovery_assessment.kind {
        RecoveryAssessmentKind::ManualConfirmation => {
            signals.push(AttentionSignal {
                stable_key: stable_key_manual_confirmation(run_id),
                kind: AttentionKind::ManualConfirmation,
                severity: AttentionSeverity::Blocking,
                title: "Manual confirmation required".to_string(),
                summary: journal.recovery_assessment.reason.clone(),
                task_id: task_id.map(str::to_string),
                run_id: Some(run_id.to_string()),
                request_id: None,
                action_id: None,
                source_revision: assessment_revision,
                allowed_actions: allowed_actions_for(AttentionKind::ManualConfirmation, task_id),
            });
        }
        RecoveryAssessmentKind::ImpossibleResume => {
            signals.push(signal_from_impossible_resume(
                run_id,
                assessment_revision,
                &journal.recovery_assessment.reason,
                task_id,
            ));
        }
        RecoveryAssessmentKind::NoAction | RecoveryAssessmentKind::SafeRetry => {}
    }

    if journal.journal_degraded {
        signals.push(AttentionSignal {
            stable_key: stable_key_journal_degraded(run_id),
            kind: AttentionKind::JournalDegraded,
            severity: AttentionSeverity::Blocking,
            title: "Run journal degraded".to_string(),
            summary: journal.recovery_assessment.reason.clone(),
            task_id: task_id.map(str::to_string),
            run_id: Some(run_id.to_string()),
            request_id: None,
            action_id: None,
            source_revision: assessment_revision,
            allowed_actions: allowed_actions_for(AttentionKind::JournalDegraded, task_id),
        });
    }

    signals
}

fn signal_from_pending_approval(
    run_id: &str,
    approval: &PendingApproval,
    revision: u64,
    task_id: Option<&str>,
) -> AttentionSignal {
    AttentionSignal {
        stable_key: stable_key_pending_approval(run_id, &approval.request_id),
        kind: AttentionKind::PendingApproval,
        severity: AttentionSeverity::Blocking,
        title: format!("Approval required: {}", approval.tool_name),
        summary: format!(
            "Tool {} ({}) is waiting for operator acknowledgement",
            approval.tool_name, approval.tool_use_id
        ),
        task_id: task_id.map(str::to_string),
        run_id: Some(run_id.to_string()),
        request_id: Some(approval.request_id.clone()),
        action_id: Some(approval.action_id.clone()),
        source_revision: revision,
        allowed_actions: allowed_actions_for(AttentionKind::PendingApproval, task_id),
    }
}

fn signal_from_impossible_resume(
    run_id: &str,
    revision: u64,
    reason: &str,
    task_id: Option<&str>,
) -> AttentionSignal {
    AttentionSignal {
        stable_key: stable_key_impossible_resume(run_id),
        kind: AttentionKind::ImpossibleResume,
        severity: AttentionSeverity::Blocking,
        title: "Run cannot resume safely".to_string(),
        summary: reason.to_string(),
        task_id: task_id.map(str::to_string),
        run_id: Some(run_id.to_string()),
        request_id: None,
        action_id: None,
        source_revision: revision,
        allowed_actions: allowed_actions_for(AttentionKind::ImpossibleResume, task_id),
    }
}

fn signal_from_corrupt_journal(run_id: &str, task_id: Option<&str>) -> AttentionSignal {
    let revision = journal_file_fingerprint(run_id);
    signal_from_impossible_resume(
        run_id,
        revision,
        "Run journal exists but is corrupt or unreadable",
        task_id,
    )
}

pub fn collect_all_signals() -> Result<(Vec<AttentionSignal>, AttentionReconcileReport), String> {
    let tasks = tasks::list();
    let mut report = AttentionReconcileReport {
        scanned_tasks: tasks.len() as u32,
        ..AttentionReconcileReport::default()
    };

    let mut signals = Vec::new();
    for task in &tasks {
        if let Some(signal) = signal_from_task(task) {
            signals.push(signal);
        }
    }

    let run_metas = runs::list_all_run_metas();
    report.scanned_runs = run_metas.len() as u32;

    for meta in run_metas {
        let run_id = meta.id;
        let task_id = task_id_for_run(&tasks, &run_id);
        match crate::storage::run_journal::get_existing(&run_id) {
            Ok(Some(journal)) => {
                signals.extend(signals_from_journal(&run_id, &journal, task_id.as_deref()));
            }
            Ok(None) => {}
            Err(error) => {
                report.failures.push(format!("Run {run_id}: {error}"));
                if run_dir(&run_id).join("run-journal.json").exists() {
                    signals.push(signal_from_corrupt_journal(&run_id, task_id.as_deref()));
                }
            }
        }
    }

    Ok((signals, report))
}

pub fn collect_run_signals(run_id: &str) -> Result<Vec<AttentionSignal>, String> {
    let tasks = tasks::list();
    let task_id = task_id_for_run(&tasks, run_id);
    let mut signals = Vec::new();

    match crate::storage::run_journal::get_existing(run_id) {
        Ok(Some(journal)) => {
            signals.extend(signals_from_journal(run_id, &journal, task_id.as_deref()));
        }
        Ok(None) => {}
        Err(_) => {
            if run_dir(run_id).join("run-journal.json").exists() {
                signals.push(signal_from_corrupt_journal(run_id, task_id.as_deref()));
            }
        }
    }

    Ok(signals)
}

pub fn collect_task_signals(task_id: &str) -> Result<Vec<AttentionSignal>, String> {
    let task = tasks::get(task_id).ok_or_else(|| format!("Task {task_id} not found"))?;
    Ok(signal_from_task(&task).into_iter().collect())
}

pub fn reconcile() -> Result<AttentionReconcileReport, String> {
    // Source collection can touch every Task and Run journal. Keep that work
    // outside the global queue lock so acknowledgement and live sync remain
    // responsive and no cross-aggregate lock ordering is introduced.
    let (signals, report) = collect_all_signals()?;
    with_lock_recovery(|root, recovered_pending| {
        reconcile_collected(root, recovered_pending, &signals, report)
    })
}

fn reconcile_collected(
    root: &Path,
    recovered_pending: bool,
    signals: &[AttentionSignal],
    mut report: AttentionReconcileReport,
) -> Result<AttentionReconcileReport, String> {
    report.recovered_pending_mutations = u32::from(recovered_pending);

    let mut snapshot = if let Some(existing) = get_raw_in(root) {
        existing
    } else if queue_file_exists(root) {
        return Err("attention queue exists but is corrupt or unreadable".to_string());
    } else {
        let snapshot = init_snapshot(crate::models::now_iso());
        save_snapshot(root, &snapshot)?;
        snapshot
    };

    let apply_report = apply_signals(root, &mut snapshot, signals)?;
    report.raised += apply_report.raised;
    report.refreshed += apply_report.refreshed;
    report.reopened += apply_report.reopened;
    report.auto_resolved += apply_report.auto_resolved;
    Ok(report)
}

pub fn sync_run(run_id: &str) -> Result<(), String> {
    let signals = collect_run_signals(run_id)?;
    with_lock(|root| {
        let mut snapshot = ensure_initialized(root)?;
        let _ = apply_signals_scoped(
            root,
            &mut snapshot,
            &signals,
            AttentionSyncScope::Run(run_id),
        )?;
        Ok(())
    })
}

pub fn sync_task(task_id: &str) -> Result<(), String> {
    let signals = collect_task_signals(task_id)?;
    with_lock(|root| {
        let mut snapshot = ensure_initialized(root)?;
        let _ = apply_signals_scoped(
            root,
            &mut snapshot,
            &signals,
            AttentionSyncScope::Task(task_id),
        )?;
        Ok(())
    })
}
