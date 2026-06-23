use super::*;
use crate::task_core::{TaskPriority, TaskRunLink, TaskRunRole, TaskStatus};
use std::fs::OpenOptions;
use std::io::Write;
use tempfile::TempDir;

fn make_task(id: &str) -> TaskRecord {
    TaskRecord::new(
        id,
        "test task",
        "test description",
        Some("tester".into()),
        TaskPriority::Medium,
        "2026-01-01T00:00:00.000Z",
    )
}

#[test]
fn old_snapshot_without_revision_fields_is_compatible() {
    let task = make_task("legacy");
    let mut value = serde_json::to_value(task).unwrap();
    let object = value.as_object_mut().unwrap();
    object.remove("revision");
    object.remove("last_event_seq");
    let parsed: TaskRecord = serde_json::from_value(value).unwrap();
    assert_eq!(parsed.revision, 0);
    assert_eq!(parsed.last_event_seq, 0);
}

#[test]
fn create_and_mutations_use_monotonic_revision_and_sequence() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let mut task = make_task("monotonic");
    let created = create_in(root, &mut task, TaskEventSource::User).unwrap();
    assert_eq!(created.revision, 1);
    assert_eq!(created.last_event_seq, 1);

    let (_, updated) = mutate_in(root, "monotonic", TaskEventSource::User, |task| {
        let from = task.status;
        task.transition(TaskStatus::Ready, "2026-01-01T00:00:01.000Z")?;
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::StatusTransition {
                from,
                to: TaskStatus::Ready,
            },
        ))
    })
    .unwrap();
    assert_eq!(updated.revision, 2);
    assert_eq!(updated.last_event_seq, 2);
    let events = list_events_in(root, "monotonic", 0).unwrap();
    assert_eq!(
        events.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![1, 2]
    );
}

#[test]
fn duplicate_link_is_a_noop() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let mut task = make_task("dedup");
    create_in(root, &mut task, TaskEventSource::User).unwrap();
    let link = TaskRunLink {
        run_id: "run-1".into(),
        role: TaskRunRole::Primary,
        linked_at: "2026-01-01T00:00:01.000Z".into(),
    };
    let (_, first) = mutate_in(root, "dedup", TaskEventSource::Runtime, |task| {
        assert!(task.link_run(link.clone(), "2026-01-01T00:00:01.000Z"));
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::RunLinked {
                run_id: link.run_id.clone(),
                role: link.role.clone(),
            },
        ))
    })
    .unwrap();
    let (_, second) = mutate_in(root, "dedup", TaskEventSource::Runtime, |task| {
        let added = task.link_run(link.clone(), "2026-01-01T00:00:02.000Z");
        Ok(if added {
            TaskMutation::changed(
                added,
                TaskEventKind::RunLinked {
                    run_id: link.run_id.clone(),
                    role: link.role.clone(),
                },
            )
        } else {
            TaskMutation::unchanged(added)
        })
    })
    .unwrap();
    assert_eq!(first.revision, second.revision);
    assert_eq!(list_events_in(root, "dedup", 0).unwrap().len(), 2);
}

fn pending_fixture(id: &str) -> PendingTaskMutation {
    let mut task = make_task(id);
    task.revision = 1;
    task.last_event_seq = 1;
    task.status = TaskStatus::Ready;
    task.updated_at = "2026-01-01T00:00:01.000Z".into();
    PendingTaskMutation {
        snapshot: task,
        event: TaskEvent {
            id: "event-1".into(),
            task_id: id.into(),
            seq: 1,
            source: TaskEventSource::System,
            event: TaskEventKind::StatusTransition {
                from: TaskStatus::Draft,
                to: TaskStatus::Ready,
            },
            timestamp: "2026-01-01T00:00:01.000Z".into(),
        },
    }
}

#[test]
fn recovery_completes_pending_before_event_append() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let pending = pending_fixture("recover-a");
    write_json_atomic(&pending_file(root, "recover-a"), &pending).unwrap();
    recover_pending_in(root, "recover-a").unwrap();
    assert_eq!(get_raw_in(root, "recover-a").unwrap().revision, 1);
    assert_eq!(list_events_raw(&events_file(root, "recover-a"), 0).len(), 1);
    assert!(!pending_file(root, "recover-a").exists());
}

#[test]
fn recovery_completes_when_event_exists_but_snapshot_does_not() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let pending = pending_fixture("recover-b");
    write_json_atomic(&pending_file(root, "recover-b"), &pending).unwrap();
    append_event_idempotent(root, &pending.event).unwrap();
    recover_pending_in(root, "recover-b").unwrap();
    assert_eq!(
        get_raw_in(root, "recover-b").unwrap().status,
        TaskStatus::Ready
    );
    assert_eq!(list_events_raw(&events_file(root, "recover-b"), 0).len(), 1);
    recover_pending_in(root, "recover-b").unwrap();
    assert_eq!(list_events_raw(&events_file(root, "recover-b"), 0).len(), 1);
}

#[test]
fn invalid_jsonl_tail_is_repaired_before_append() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let first = pending_fixture("tail").event;
    append_event_idempotent(root, &first).unwrap();
    let path = events_file(root, "tail");
    let mut file = OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(b"{\"partial\":").unwrap();

    let mut second = first.clone();
    second.id = "event-2".into();
    second.seq = 2;
    append_event_idempotent(root, &second).unwrap();
    let events = list_events_raw(&path, 0);
    assert_eq!(events.len(), 2);
    assert_eq!(events[1].seq, 2);
}

#[test]
fn duplicate_task_id_is_rejected() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let mut first = make_task("duplicate");
    create_in(root, &mut first, TaskEventSource::User).unwrap();
    let mut second = make_task("duplicate");
    let error = create_in(root, &mut second, TaskEventSource::User).unwrap_err();
    assert!(error.contains("already exists"));
}

fn make_running_task_with_run(root: &Path, id: &str, run_id: &str) {
    let mut task = make_task(id);
    create_in(root, &mut task, TaskEventSource::User).unwrap();
    mutate_in(root, id, TaskEventSource::User, |task| {
        let from = task.status;
        task.transition(TaskStatus::Ready, "2026-01-01T00:00:01.000Z")?;
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::StatusTransition {
                from,
                to: TaskStatus::Ready,
            },
        ))
    })
    .unwrap();
    mutate_in(root, id, TaskEventSource::User, |task| {
        let from = task.status;
        task.transition(TaskStatus::Running, "2026-01-01T00:00:02.000Z")?;
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::StatusTransition {
                from,
                to: TaskStatus::Running,
            },
        ))
    })
    .unwrap();
    mutate_in(root, id, TaskEventSource::Runtime, |task| {
        task.link_run(
            TaskRunLink {
                run_id: run_id.into(),
                role: TaskRunRole::Primary,
                linked_at: "2026-01-01T00:00:03.000Z".into(),
            },
            "2026-01-01T00:00:03.000Z",
        );
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::RunLinked {
                run_id: run_id.into(),
                role: TaskRunRole::Primary,
            },
        ))
    })
    .unwrap();
}

#[test]
fn restart_reconcile_moves_orphaned_active_task_to_attention() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    make_running_task_with_run(root, "restart-task", "stopped-run");

    let report = reconcile_in(root, |_| Some(RunStatus::Stopped));

    assert_eq!(report.moved_to_needs_attention, 1);
    assert!(report.failures.is_empty());
    assert_eq!(
        get_raw_in(root, "restart-task").unwrap().status,
        TaskStatus::NeedsAttention
    );
    let events = list_events_in(root, "restart-task", 0).unwrap();
    assert!(matches!(
        events.last().map(|event| &event.event),
        Some(TaskEventKind::RestartReconciled { .. })
    ));
}

#[test]
fn restart_reconcile_preserves_task_with_live_run() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    make_running_task_with_run(root, "live-task", "live-run");
    let before = get_raw_in(root, "live-task").unwrap();

    let report = reconcile_in(root, |_| Some(RunStatus::Running));

    let after = get_raw_in(root, "live-task").unwrap();
    assert_eq!(report.unchanged, 1);
    assert_eq!(after.status, TaskStatus::Running);
    assert_eq!(after.revision, before.revision);
}

#[test]
fn list_sorts_and_skips_unparseable_tasks() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let mut old = make_task("old");
    old.updated_at = "2026-01-01T00:00:00.000Z".into();
    save_to(root, &old).unwrap();
    let mut new = make_task("new");
    new.updated_at = "2026-02-01T00:00:00.000Z".into();
    save_to(root, &new).unwrap();
    fs::create_dir_all(task_dir(root, "bad")).unwrap();
    fs::write(task_file(root, "bad"), "not-json").unwrap();
    let tasks = list_in(root);
    assert_eq!(
        tasks
            .iter()
            .map(|task| task.id.as_str())
            .collect::<Vec<_>>(),
        vec!["new", "old"]
    );
}

#[test]
fn delete_is_idempotent_and_ids_reject_path_segments() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    let mut task = make_task("delete-me");
    create_in(root, &mut task, TaskEventSource::User).unwrap();
    delete_in(root, "delete-me").unwrap();
    delete_in(root, "delete-me").unwrap();
    assert!(validate_task_id("task-123_ok").is_ok());
    assert!(validate_task_id("../task").is_err());
    assert!(validate_task_id("nested/task").is_err());
}
