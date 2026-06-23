use super::*;

fn fixed_now() -> &'static str {
    "2026-01-01T00:00:00.000Z"
}

#[test]
fn task_status_serialization_roundtrip() {
    for status in [
        TaskStatus::Draft,
        TaskStatus::Ready,
        TaskStatus::Running,
        TaskStatus::NeedsAttention,
        TaskStatus::Verifying,
        TaskStatus::Review,
        TaskStatus::Done,
        TaskStatus::Failed,
        TaskStatus::Archived,
    ] {
        let json = serde_json::to_string(&status).unwrap();
        let back: TaskStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status, back, "roundtrip failed for {json}");
    }
}

#[test]
fn task_status_snake_case_payload() {
    assert_eq!(
        serde_json::to_string(&TaskStatus::NeedsAttention).unwrap(),
        "\"needs_attention\""
    );
    assert_eq!(
        serde_json::to_string(&TaskStatus::Archived).unwrap(),
        "\"archived\""
    );
}

#[test]
fn task_record_new_initializes_draft() {
    let t = TaskRecord::new(
        "t1",
        "Refactor planner",
        "Long description",
        Some("alice".into()),
        TaskPriority::High,
        fixed_now(),
    );
    assert_eq!(t.id, "t1");
    assert_eq!(t.status, TaskStatus::Draft);
    assert_eq!(t.priority, TaskPriority::High);
    assert_eq!(t.owner.as_deref(), Some("alice"));
    assert!(t.run_links.is_empty());
    assert!(t.artifact_links.is_empty());
    assert_eq!(t.created_at, fixed_now());
    assert_eq!(t.updated_at, fixed_now());
    assert!(t.started_at.is_none());
    assert!(t.completed_at.is_none());
}

#[test]
fn link_run_dedups_by_run_id() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    let link1 = TaskRunLink {
        run_id: "r1".into(),
        role: TaskRunRole::Primary,
        linked_at: fixed_now().into(),
    };
    assert!(t.link_run(link1.clone(), fixed_now()));
    // second link for same run id — different role, still deduped
    let link2 = TaskRunLink {
        run_id: "r1".into(),
        role: TaskRunRole::Worktree,
        linked_at: fixed_now().into(),
    };
    assert!(!t.link_run(link2, fixed_now()));
    assert_eq!(t.run_links.len(), 1);
    // original role preserved (first wins)
    assert_eq!(t.run_links[0].role, TaskRunRole::Primary);

    // different run id is added
    let link3 = TaskRunLink {
        run_id: "r2".into(),
        role: TaskRunRole::Verification,
        linked_at: fixed_now().into(),
    };
    assert!(t.link_run(link3, fixed_now()));
    assert_eq!(t.run_links.len(), 2);
}

#[test]
fn unlink_run_removes_match() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    t.link_run(
        TaskRunLink {
            run_id: "r1".into(),
            role: TaskRunRole::Primary,
            linked_at: fixed_now().into(),
        },
        fixed_now(),
    );
    t.link_run(
        TaskRunLink {
            run_id: "r2".into(),
            role: TaskRunRole::Worktree,
            linked_at: fixed_now().into(),
        },
        fixed_now(),
    );
    assert!(t.unlink_run("r1", fixed_now()));
    assert!(!t.unlink_run("r1", fixed_now()));
    assert_eq!(t.run_links.len(), 1);
    assert_eq!(t.run_links[0].run_id, "r2");
}

#[test]
fn link_artifact_dedups_by_artifact_id() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    assert!(t.link_artifact(
        TaskArtifactLink {
            artifact_id: "a1".into(),
            kind: "diff".into(),
            run_id: Some("r1".into()),
            content_hash: Some("sha256:abc".into()),
            linked_at: fixed_now().into(),
        },
        fixed_now(),
    ));
    assert!(!t.link_artifact(
        TaskArtifactLink {
            artifact_id: "a1".into(),
            kind: "patch".into(),
            run_id: Some("r2".into()),
            content_hash: None,
            linked_at: fixed_now().into(),
        },
        fixed_now(),
    ));
    assert!(t.link_artifact(
        TaskArtifactLink {
            artifact_id: "a2".into(),
            kind: "log".into(),
            run_id: None,
            content_hash: None,
            linked_at: fixed_now().into(),
        },
        fixed_now(),
    ));
    assert_eq!(t.artifact_links.len(), 2);
}

#[test]
fn transition_legal_path() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    t.transition(TaskStatus::Ready, "2026-01-02T00:00:00.000Z")
        .unwrap();
    assert_eq!(t.status, TaskStatus::Ready);
    assert_eq!(t.updated_at, "2026-01-02T00:00:00.000Z");

    t.transition(TaskStatus::Running, "2026-01-03T00:00:00.000Z")
        .unwrap();
    assert_eq!(t.status, TaskStatus::Running);
    // started_at recorded the first time we hit Running
    assert_eq!(t.started_at.as_deref(), Some("2026-01-03T00:00:00.000Z"));

    t.transition(TaskStatus::Verifying, "2026-01-04T00:00:00.000Z")
        .unwrap();
    t.transition(TaskStatus::Review, "2026-01-05T00:00:00.000Z")
        .unwrap();
    t.transition(TaskStatus::Done, "2026-01-06T00:00:00.000Z")
        .unwrap();
    assert_eq!(t.status, TaskStatus::Done);
    assert_eq!(t.completed_at.as_deref(), Some("2026-01-06T00:00:00.000Z"));
}

#[test]
fn transition_self_is_rejected() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    t.transition(TaskStatus::Ready, fixed_now()).unwrap();
    let err = t.transition(TaskStatus::Ready, fixed_now()).unwrap_err();
    assert!(err.contains("Illegal"), "got: {err}");
}

#[test]
fn transition_archived_cannot_run() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    t.transition(TaskStatus::Ready, fixed_now()).unwrap();
    t.transition(TaskStatus::Archived, fixed_now()).unwrap();
    // Archived is the only truly terminal state — no outgoing edges
    for to in [
        TaskStatus::Draft,
        TaskStatus::Ready,
        TaskStatus::Running,
        TaskStatus::NeedsAttention,
        TaskStatus::Verifying,
        TaskStatus::Review,
        TaskStatus::Done,
        TaskStatus::Failed,
    ] {
        let err = t.transition(to, fixed_now()).unwrap_err();
        assert!(
            err.contains("Illegal") && err.contains("archived"),
            "expected archived->{to} rejected, got: {err}"
        );
    }
    assert!(t.status.is_terminal());
}

#[test]
fn transition_done_cannot_go_back_to_running() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    t.transition(TaskStatus::Ready, fixed_now()).unwrap();
    t.transition(TaskStatus::Running, fixed_now()).unwrap();
    t.transition(TaskStatus::Verifying, fixed_now()).unwrap();
    t.transition(TaskStatus::Review, fixed_now()).unwrap();
    t.transition(TaskStatus::Done, fixed_now()).unwrap();
    // Done -> Archived is allowed; Done -> Running is not
    assert!(t.transition(TaskStatus::Running, fixed_now()).is_err());
    assert!(t.transition(TaskStatus::Archived, fixed_now()).is_ok());
}

#[test]
fn transition_failed_can_be_revived() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    t.transition(TaskStatus::Ready, fixed_now()).unwrap();
    t.transition(TaskStatus::Running, fixed_now()).unwrap();
    t.transition(TaskStatus::Failed, "2026-02-01T00:00:00.000Z")
        .unwrap();
    assert_eq!(t.completed_at.as_deref(), Some("2026-02-01T00:00:00.000Z"));
    // Revive -> Ready clears completed_at so downstream doesn't see stale data
    t.transition(TaskStatus::Ready, "2026-02-02T00:00:00.000Z")
        .unwrap();
    assert_eq!(t.status, TaskStatus::Ready);
    assert!(t.completed_at.is_none());
}

#[test]
fn transition_running_to_done_skips_intermediate() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    t.transition(TaskStatus::Ready, fixed_now()).unwrap();
    t.transition(TaskStatus::Running, fixed_now()).unwrap();
    // Running -> Done is not in the legal set, must go through Verifying/Review
    assert!(t.transition(TaskStatus::Done, fixed_now()).is_err());
}

#[test]
fn task_record_json_roundtrip_preserves_invariants() {
    let mut t = TaskRecord::new(
        "t1",
        "title",
        "desc",
        Some("bob".into()),
        TaskPriority::High,
        fixed_now(),
    );
    t.link_run(
        TaskRunLink {
            run_id: "r1".into(),
            role: TaskRunRole::Primary,
            linked_at: fixed_now().into(),
        },
        fixed_now(),
    );
    t.link_artifact(
        TaskArtifactLink {
            artifact_id: "a1".into(),
            kind: "diff".into(),
            run_id: Some("r1".into()),
            content_hash: Some("sha256:abc".into()),
            linked_at: fixed_now().into(),
        },
        fixed_now(),
    );
    t.tags = vec!["backend".into(), "v1.1.0".into()];
    t.transition(TaskStatus::Ready, fixed_now()).unwrap();

    let json = serde_json::to_string(&t).unwrap();
    let back: TaskRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(t, back);
}

#[test]
fn worktree_and_changed_files_update_timestamps() {
    let mut t = TaskRecord::new("t1", "title", "", None, TaskPriority::Medium, fixed_now());
    t.set_worktree(
        "/tmp/miwarp-task",
        "feat/task-core",
        "2026-01-02T00:00:00.000Z",
    );
    assert_eq!(t.worktree_path.as_deref(), Some("/tmp/miwarp-task"));
    assert_eq!(t.worktree_branch.as_deref(), Some("feat/task-core"));
    assert_eq!(t.updated_at, "2026-01-02T00:00:00.000Z");

    assert!(t.track_changed_file("src-tauri/src/task_core.rs", "2026-01-03T00:00:00.000Z",));
    assert!(!t.track_changed_file("src-tauri/src/task_core.rs", "2026-01-04T00:00:00.000Z",));
    assert_eq!(t.changed_files, vec!["src-tauri/src/task_core.rs"]);
    assert_eq!(t.updated_at, "2026-01-03T00:00:00.000Z");
}
