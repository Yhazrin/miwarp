//! P0-5 `send_chat_message` dedupe + in-flight stop contract tests.
//!
//! Companion to the P0-5 fix in `commands::chat::send_chat_message`. The
//! `send_chat_message` Tauri command is the **pipe_exec** entry point
//! (Codex / OpenCode). It is a one-shot child process with no actor
//! mailbox, so a naive implementation would:
//!
//! 1. Spawn a fresh child every time the user clicks Send twice on the
//!    same content (no `client_message_id` dedupe).
//! 2. Not stop the previous in-flight child before launching the new
//!    one, leaving N parallel children racing on the same `run_id`.
//! 3. Not durably record the accepted `client_message_id`, so a
//!    reconnect-retry after the child exited would re-spawn.
//!
//! The P0-5 fix in `src-tauri/src/commands/chat.rs` addresses all three
//! by leaning on the same durable accepted-ledger the actor path uses
//! (`storage::run_journal::{is_message_accepted, record_accepted_message}`)
//! and by calling `stream::stop_process` before re-spawning.
//!
//! This integration test pins the **storage-level contract** that the
//! chat command depends on. The actual `send_chat_message` Tauri command
//! requires a live `AppHandle` + `ProcessMap` state and is not exercised
//! end-to-end here; instead we assert that the dedupe primitives
//! themselves behave as the command assumes, and we assert the
//! `stop_process` contract on a no-op map entry (the happy path used
//! when no prior child is in flight).
//!
//! Run with:
//!   cargo test --test chat_pipe_dedupe --manifest-path src-tauri/Cargo.toml

use miwarp_desktop_lib::agent::stream::new_process_map;
use miwarp_desktop_lib::agent::stream::stop_process;
use miwarp_desktop_lib::run_core::JOURNAL_DEDUPE_UNAVAILABLE_PREFIX;
use miwarp_desktop_lib::storage::run_journal::{
    get_or_init, is_message_accepted, record_accepted_message,
};
use miwarp_desktop_lib::storage::runs::{create_run, get_run};
use miwarp_desktop_lib::storage::settings;

fn unique_run_id(label: &str) -> String {
    let stamp = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
    format!("p0-5-{label}-{stamp}")
}

fn ensure_user_settings_initialized() {
    // Test environment may not have a fully populated settings dir; the
    // dedupe primitives don't read settings, but creating a run does
    // call into storage. We swallow any error here — the test body
    // asserts on `create_run`'s Result directly.
    let _ = settings::get_user_settings();
}

#[test]
fn record_accepted_message_then_is_message_accepted_returns_true() {
    ensure_user_settings_initialized();
    let run_id = unique_run_id("dedupe-accept");
    create_run(
        &run_id,
        "P0-5 dedupe test prompt",
        "/tmp",
        "codex",
        miwarp_desktop_lib::models::RunStatus::Pending,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("create_run failed for dedupe test");

    // record_accepted_message requires the journal to be initialised first.
    // `send_chat_message` does this implicitly via is_message_accepted (which
    // calls get_or_init itself), so we mirror that warm-up here.
    get_or_init(&run_id).expect("get_or_init must succeed for dedupe test");

    let cid = "cid-test-001";
    record_accepted_message(&run_id, cid, Some("hello world"))
        .expect("first record_accepted_message must succeed");

    let accepted =
        is_message_accepted(&run_id, cid).expect("is_message_accepted must succeed after record");
    assert!(
        accepted,
        "is_message_accepted must return true after a successful record"
    );
}

#[test]
fn is_message_accepted_returns_false_for_unknown_id() {
    ensure_user_settings_initialized();
    let run_id = unique_run_id("dedupe-unknown");
    create_run(
        &run_id,
        "P0-5 dedupe unknown prompt",
        "/tmp",
        "codex",
        miwarp_desktop_lib::models::RunStatus::Pending,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("create_run failed for unknown-id test");

    let accepted = is_message_accepted(&run_id, "cid-never-seen")
        .expect("is_message_accepted must succeed for unknown id");
    assert!(
        !accepted,
        "is_message_accepted must return false for a cid that was never recorded"
    );
}

#[test]
fn record_accepted_message_is_idempotent() {
    ensure_user_settings_initialized();
    let run_id = unique_run_id("dedupe-idem");
    create_run(
        &run_id,
        "P0-5 dedupe idempotent prompt",
        "/tmp",
        "codex",
        miwarp_desktop_lib::models::RunStatus::Pending,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("create_run failed for idempotency test");

    get_or_init(&run_id).expect("get_or_init must succeed for idempotency test");

    let cid = "cid-test-idem-002";
    record_accepted_message(&run_id, cid, Some("first")).expect("first record");
    record_accepted_message(&run_id, cid, Some("second"))
        .expect("second record of same cid must be a no-op (idempotent)");

    let accepted = is_message_accepted(&run_id, cid)
        .expect("is_message_accepted must succeed after duplicate record");
    assert!(
        accepted,
        "idempotent record must leave the cid in the accepted state"
    );
}

#[test]
fn is_message_accepted_validates_client_message_id() {
    ensure_user_settings_initialized();
    let run_id = unique_run_id("dedupe-validation");
    create_run(
        &run_id,
        "P0-5 dedupe validation prompt",
        "/tmp",
        "codex",
        miwarp_desktop_lib::models::RunStatus::Pending,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("create_run failed for validation test");

    let empty = is_message_accepted(&run_id, "");
    assert!(
        empty.is_err(),
        "empty cid must be rejected at the journal layer"
    );

    let too_long = "x".repeat(300);
    let long_result = is_message_accepted(&run_id, &too_long);
    assert!(
        long_result.is_err(),
        "oversize cid must be rejected at the journal layer"
    );
}

#[test]
fn stop_process_returns_false_when_no_child_registered() {
    // Mirrors the P0-5 fix: when `send_chat_message` is called and
    // there is no in-flight pipe child for the run_id, `stop_process`
    // returns false and the command proceeds to spawn a fresh child.
    // The chat command treats this as a benign no-op (logs at debug).
    let pm = new_process_map();
    let run_id = unique_run_id("stop-noop");
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    let killed = rt.block_on(stop_process(&pm, &run_id));
    assert!(
        !killed,
        "stop_process on a fresh ProcessMap must return false (nothing to kill)"
    );
}

#[test]
fn journal_dedupe_unavailable_prefix_is_stable() {
    // The chat command's fail-closed error string embeds this prefix
    // verbatim. If it ever changes, every consumer of the typed error
    // (typed `JOURNAL_DEDUPE_UNAVAILABLE` check, log scrapers, frontend
    // toast mapper) breaks. Pin it here.
    assert_eq!(
        JOURNAL_DEDUPE_UNAVAILABLE_PREFIX,
        "JOURNAL_DEDUPE_UNAVAILABLE"
    );
}

#[test]
fn run_metadata_round_trips_after_dedupe() {
    // Belt-and-braces: after we record an acceptance, get_run still
    // resolves the run (i.e. we didn't accidentally invalidate the
    // run-journal file by writing to it). This catches regressions in
    // commit_mutation that would corrupt the snapshot.
    ensure_user_settings_initialized();
    let run_id = unique_run_id("dedupe-roundtrip");
    let prompt = "P0-5 round-trip prompt";
    create_run(
        &run_id,
        prompt,
        "/tmp",
        "codex",
        miwarp_desktop_lib::models::RunStatus::Pending,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("create_run must succeed for round-trip test");

    get_or_init(&run_id).expect("get_or_init must succeed for round-trip test");

    record_accepted_message(&run_id, "cid-roundtrip-001", Some("preview"))
        .expect("record_accepted_message must succeed");

    let meta = get_run(&run_id).expect("get_run must resolve after dedupe write");
    assert_eq!(meta.id, run_id, "run id must round-trip");
    assert_eq!(meta.prompt, prompt, "prompt must round-trip");
    assert_eq!(meta.agent, "codex", "agent must round-trip");
}
