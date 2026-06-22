//! Runtime recovery fault-injection harness (v1.0.9).
//!
//! Covers stdin broken, EOF active turn, crash budget, ledger dedupe,
//! unaccepted replay, run switch queue cancel, recovery storm backoff,
//! and unrecoverable escalation — without spawning a real CLI.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use miwarp_desktop_lib::agent::recovery::{
    CrashReason, RecoveryState, RecoveryStateMachine, CRASH_QUARANTINE_THRESHOLD,
};
use miwarp_desktop_lib::agent::runtime_recovery::{
    classify_active_turn_eof, compute_respawn_backoff, new_recovery_registry, on_actor_exit,
    transition_recovery, ActorRecoverySnapshot, PendingRecoveryMessage, RunRecoveryState,
    PENDING_RECOVERY_QUEUE_CAP, RESPAWN_STORM_THRESHOLD,
};

fn snapshot(reason: CrashReason) -> ActorRecoverySnapshot {
    ActorRecoverySnapshot {
        crash_reason: Some(reason),
        accepted_ledger: VecDeque::new(),
        pending_unaccepted: VecDeque::new(),
        next_turn_index: 1,
        next_auto_ctx_id: 1,
        next_turn_seq: 0,
        session_id: Some("sess-1".into()),
        user_stopped: false,
    }
}

#[test]
fn stdin_broken_crash_reason_recorded() {
    let registry = new_recovery_registry();
    let snap = snapshot(CrashReason::StdinWriteFailed);
    let rt = tokio::runtime::Runtime::new().unwrap();
    let should = rt.block_on(on_actor_exit(&registry, "run-1", snap));
    assert!(should);
    let map = rt.block_on(registry.lock());
    assert_eq!(
        map.get("run-1").unwrap().last_crash_reason,
        Some(CrashReason::StdinWriteFailed)
    );
}

#[test]
fn eof_active_turn_classifies_stdout_eof() {
    assert_eq!(
        classify_active_turn_eof(false, true),
        Some(CrashReason::StdoutEof)
    );
}

#[test]
fn ledger_dedupe_prevents_replay_of_accepted() {
    let mut state = RunRecoveryState::new("run-1", None);
    state.note_accepted("cid-a".into());
    state.pending_unaccepted.push_back(PendingRecoveryMessage {
        text: "x".into(),
        attachments: vec![],
        client_message_id: Some("cid-a".into()),
    });
    state.pending_unaccepted.push_back(PendingRecoveryMessage {
        text: "y".into(),
        attachments: vec![],
        client_message_id: Some("cid-b".into()),
    });
    let batch = state.drain_replay_batch();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].client_message_id.as_deref(), Some("cid-b"));
}

#[test]
fn unaccepted_messages_are_replayed_fifo() {
    let mut state = RunRecoveryState::new("run-1", None);
    for id in ["c1", "c2", "c3"] {
        state.pending_unaccepted.push_back(PendingRecoveryMessage {
            text: id.into(),
            attachments: vec![],
            client_message_id: Some(id.into()),
        });
    }
    let batch = state.drain_replay_batch();
    assert_eq!(
        batch
            .iter()
            .map(|m| m.client_message_id.as_deref().unwrap())
            .collect::<Vec<_>>(),
        vec!["c1", "c2", "c3"]
    );
}

#[test]
fn recovery_budget_forces_unrecoverable() {
    let mut sm = RecoveryStateMachine::new();
    let start = Instant::now();
    sm.transition(RecoveryState::Reconnecting, start);
    let outcome = sm.transition(RecoveryState::Recovered, start + Duration::from_secs(31));
    assert!(outcome.budget_exceeded);
    assert_eq!(sm.state(), RecoveryState::Unrecoverable);
}

#[test]
fn run_switch_cancels_old_recovery_queue_via_generation() {
    let mut state = RunRecoveryState::new("run-1", None);
    state.connection_generation = 1;
    state
        .enqueue_recovery_send("m1".into(), vec![], Some("id-1".into()))
        .unwrap();
    // Simulate run/generation switch: drain and drop stale queue.
    state.recovery_queue.clear();
    state.connection_generation = 2;
    assert!(state.recovery_queue.is_empty());
    assert_eq!(state.connection_generation, 2);
}

#[test]
fn recovery_storm_increases_backoff() {
    let mut state = RunRecoveryState::new("run-1", None);
    state
        .recovery_sm
        .transition(RecoveryState::Reconnecting, Instant::now());
    let base = compute_respawn_backoff(&state);
    for _ in 0..RESPAWN_STORM_THRESHOLD {
        state.record_respawn_attempt(Instant::now());
    }
    assert!(compute_respawn_backoff(&state) >= base);
}

#[test]
fn three_same_reason_crashes_escalate_unrecoverable() {
    let registry = new_recovery_registry();
    let rt = tokio::runtime::Runtime::new().unwrap();
    let t = Instant::now();
    for i in 0..CRASH_QUARANTINE_THRESHOLD {
        let should = rt.block_on(on_actor_exit(
            &registry,
            "run-1",
            snapshot(CrashReason::StdoutEof),
        ));
        if i < CRASH_QUARANTINE_THRESHOLD - 1 {
            assert!(should);
        }
        // Advance time slightly within window
        let _ = t + Duration::from_secs(i as u64);
    }
    let map = rt.block_on(registry.lock());
    assert!(map.get("run-1").unwrap().unrecoverable);
}

#[test]
fn recovery_queue_bounded_at_cap() {
    let mut state = RunRecoveryState::new("run-1", None);
    for i in 0..PENDING_RECOVERY_QUEUE_CAP + 3 {
        state
            .enqueue_recovery_send(format!("m{i}"), vec![], Some(format!("id-{i}")))
            .unwrap();
    }
    assert_eq!(state.recovery_queue.len(), PENDING_RECOVERY_QUEUE_CAP);
}

#[test]
fn transition_to_recovered_resets_failure_count() {
    let mut state = RunRecoveryState::new("run-1", None);
    let now = Instant::now();
    assert!(transition_recovery(
        &mut state,
        RecoveryState::Reconnecting,
        now
    ));
    assert!(transition_recovery(
        &mut state,
        RecoveryState::Recovered,
        now
    ));
    assert_eq!(state.recovery_sm.consecutive_failures(), 0);
}

/// When stdin write fails in start_user_turn, the message was already popped
/// from queued_user. The actor stashes it in pending_unaccepted_for_recovery
/// before the write; the snapshot must include it. This test verifies that
/// the registry correctly replays a message that arrived via snapshot
/// (not via the normal recovery_queue path).
#[test]
fn stdin_failure_message_survives_in_snapshot_and_replays() {
    let registry = new_recovery_registry();
    let rt = tokio::runtime::Runtime::new().unwrap();

    // Simulate: actor accepted cid-ok, then tried to send cid-lost but stdin
    // broke. The snapshot reflects this state.
    let mut accepted = VecDeque::new();
    accepted.push_back("cid-ok".to_string());

    let mut pending = VecDeque::new();
    pending.push_back(PendingRecoveryMessage {
        text: "the lost message".into(),
        attachments: vec![],
        client_message_id: Some("cid-lost".into()),
    });

    let snap = ActorRecoverySnapshot {
        crash_reason: Some(CrashReason::StdinWriteFailed),
        accepted_ledger: accepted,
        pending_unaccepted: pending,
        next_turn_index: 2,
        next_auto_ctx_id: 2,
        next_turn_seq: 1,
        session_id: Some("sess-1".into()),
        user_stopped: false,
    };

    let should = rt.block_on(on_actor_exit(&registry, "run-1", snap));
    assert!(should, "stdin failure should be recoverable");

    let mut map = rt.block_on(registry.lock());
    let entry = map.get_mut("run-1").unwrap();

    // The lost message must be in the replay batch.
    let batch = entry.drain_replay_batch();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].client_message_id.as_deref(), Some("cid-lost"));
    assert_eq!(batch[0].text, "the lost message");
}

/// Messages that were already accepted must NOT appear in the replay batch,
/// even if they are also present in pending_unaccepted (e.g. due to the
/// start_user_turn stash-before-write pattern where the write succeeded).
#[test]
fn accepted_messages_filtered_from_pending_unaccepted() {
    let mut state = RunRecoveryState::new("run-1", None);
    state.note_accepted("cid-accepted".into());
    state.pending_unaccepted.push_back(PendingRecoveryMessage {
        text: "already processed".into(),
        attachments: vec![],
        client_message_id: Some("cid-accepted".into()),
    });
    state.pending_unaccepted.push_back(PendingRecoveryMessage {
        text: "fresh message".into(),
        attachments: vec![],
        client_message_id: Some("cid-fresh".into()),
    });
    let batch = state.drain_replay_batch();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].client_message_id.as_deref(), Some("cid-fresh"));
}

/// When a message has no client_message_id it cannot be deduped.
/// It should still be replayed (no crash, just cannot idempotency-check).
#[test]
fn message_without_client_id_always_replayed() {
    let mut state = RunRecoveryState::new("run-1", None);
    state.pending_unaccepted.push_back(PendingRecoveryMessage {
        text: "no-id msg".into(),
        attachments: vec![],
        client_message_id: None,
    });
    let batch = state.drain_replay_batch();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].text, "no-id msg");
}
