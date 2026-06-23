use super::*;

pub fn reconcile_after_restart() -> RunJournalReconcileReport {
    reconcile_in(&crate::storage::runs_dir())
}

pub(super) fn reconcile_in(runs_root: &Path) -> RunJournalReconcileReport {
    let mut report = RunJournalReconcileReport::default();
    let entries = match fs::read_dir(runs_root) {
        Ok(entries) => entries,
        Err(_) => return report,
    };

    'runs: for entry in entries.flatten() {
        let run_dir = entry.path();
        if !run_dir.is_dir() {
            continue;
        }
        let Some(run_id) = run_dir.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        report.scanned += 1;
        if let Err(error) = validate_run_id(run_id) {
            report.impossible_resume += 1;
            report
                .failures
                .push(format!("Run directory {run_id:?} is unsafe: {error}"));
            continue;
        }
        let lock = lock_for(run_id);
        let Ok(_guard) = lock.lock() else {
            report.failures.push(format!("Run {run_id}: lock poisoned"));
            continue;
        };
        if pending_file(&run_dir).exists() {
            match recover_pending(&run_dir, run_id) {
                Ok(()) => report.recovered_pending_mutations += 1,
                Err(error) => {
                    report.failures.push(format!("Run {run_id}: {error}"));
                    report.impossible_resume += 1;
                    continue;
                }
            }
        }

        let journal_exists = journal_file(&run_dir).exists();
        let Some(mut snapshot) = get_raw_in(&run_dir) else {
            if journal_exists {
                report.impossible_resume += 1;
                report.failures.push(format!(
                    "Run {run_id}: run-journal.json exists but is corrupt or unreadable"
                ));
            } else {
                // Legacy run without a journal remains lazily migratable.
                report.unchanged += 1;
            }
            continue;
        };

        if !snapshot.stage.is_active() {
            report.unchanged += 1;
            continue;
        }

        let meta_path = run_dir.join("meta.json");
        let meta = match fs::read_to_string(&meta_path)
            .ok()
            .and_then(|content| serde_json::from_str::<RunMeta>(&content).ok())
        {
            Some(meta) => meta,
            None => {
                let reason = "active journal but meta.json is missing or corrupt".to_string();
                let kind = RunJournalEventKind::RestartReconciled {
                    from_stage: snapshot.stage,
                    to_stage: RunStage::Failed,
                    assessment: RecoveryAssessmentKind::ImpossibleResume,
                    reason: reason.clone(),
                };
                match commit_mutation(&run_dir, &mut snapshot, kind, now_iso()) {
                    Ok(ApplyOutcome::Changed) => report.restart_reconciled += 1,
                    Ok(ApplyOutcome::NoOp) => report.unchanged += 1,
                    Err(error) => report.failures.push(format!(
                        "Run {run_id}: failed to persist impossible resume: {error}"
                    )),
                }
                report.impossible_resume += 1;
                report.failures.push(format!("Run {run_id}: {reason}"));
                continue;
            }
        };

        let live = matches!(
            meta.status,
            RunStatus::Running | RunStatus::Idle | RunStatus::Pending
        );
        if live {
            report.unchanged += 1;
            continue;
        }

        let mut marked_uncertain = 0u32;
        let uncertain_action_ids: Vec<String> = snapshot
            .actions
            .iter()
            .filter(|action| {
                action.status == crate::run_core::RunActionStatus::Started
                    && matches!(
                        action.idempotency_class,
                        crate::run_core::RunIdempotencyClass::NonIdempotent
                    )
            })
            .map(|action| action.action_id.clone())
            .collect();

        let has_unfinished_non_idempotent = snapshot.actions.iter().any(|action| {
            action.status == crate::run_core::RunActionStatus::Started
                && action.idempotency_class == crate::run_core::RunIdempotencyClass::NonIdempotent
        });
        let has_unfinished_retryable = snapshot.actions.iter().any(|action| {
            action.status == crate::run_core::RunActionStatus::Started
                && matches!(
                    action.idempotency_class,
                    crate::run_core::RunIdempotencyClass::ReadOnly
                        | crate::run_core::RunIdempotencyClass::IdempotentWrite
                )
        });
        let assessment = if has_unfinished_non_idempotent {
            RecoveryAssessmentKind::ManualConfirmation
        } else if has_unfinished_retryable {
            RecoveryAssessmentKind::SafeRetry
        } else {
            RecoveryAssessmentKind::NoAction
        };

        for action_id in uncertain_action_ids {
            let kind = RunJournalEventKind::ActionMarkedUncertain {
                action_id,
                reason: "unfinished non-idempotent action after restart".to_string(),
            };
            match commit_mutation(&run_dir, &mut snapshot, kind, now_iso()) {
                Ok(ApplyOutcome::Changed) => marked_uncertain += 1,
                Ok(ApplyOutcome::NoOp) => {}
                Err(error) => {
                    report.impossible_resume += 1;
                    report.failures.push(format!(
                        "Run {run_id}: failed to mark action uncertain: {error}"
                    ));
                    continue 'runs;
                }
            }
        }

        let to_stage = match meta.status {
            RunStatus::Failed => RunStage::Failed,
            RunStatus::Stopped => RunStage::Stopped,
            RunStatus::Completed => RunStage::Completed,
            _ => RunStage::Waiting,
        };
        let from_stage = snapshot.stage;
        let reason = format!(
            "restart reconcile: run status is {:?}, journal stage was {}",
            meta.status, from_stage
        );
        let kind = RunJournalEventKind::RestartReconciled {
            from_stage,
            to_stage,
            assessment,
            reason: reason.clone(),
        };
        match commit_mutation(&run_dir, &mut snapshot, kind, now_iso()) {
            Ok(ApplyOutcome::Changed) => {
                report.restart_reconciled += 1;
                report.marked_uncertain += marked_uncertain;
            }
            Ok(ApplyOutcome::NoOp) => report.unchanged += 1,
            Err(error) => report.failures.push(format!("Run {run_id}: {error}")),
        }
    }

    report
}
