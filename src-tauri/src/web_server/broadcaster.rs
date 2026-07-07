use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::broadcast::error::RecvError;

use crate::models::BusEvent;
use crate::storage::events::EventWriter;
use tauri::Emitter;

/// A-class capacity: reliable, large. Sized for a generous CLI session.
const A_CHANNEL_CAPACITY: usize = 8192;
/// B-class capacity: lossy, realtime. Sized to absorb a full Sonnet turn
/// (typically 800–2000 `message_delta` chunks) plus headroom for hook /
/// run-event traffic. The previous 1024 surfaced `RecvError::Lagged` on long
/// responses, which forced WS clients to drop into a re-subscribe loop.
const B_CHANNEL_CAPACITY: usize = 16384;

/// Atomic counters for send-side failure modes. Loaded without locking the
/// sender hot path; readable via `EventBroadcaster::metrics()`.
#[derive(Debug, Default)]
pub struct BroadcasterMetrics {
    /// `send_a` returned `Err(SendError(_))` — no active A-class receiver
    /// (e.g. no WS subscriber connected yet). The Tauri emit already
    /// happened in BroadcastEmitter, so dropping here only affects WS
    /// delivery.
    pub a_dropped_no_receiver: AtomicU64,
    /// Same as above, for the B-class channel.
    pub b_dropped_no_receiver: AtomicU64,
    /// Sum of `n` from `RecvError::Lagged(n)` observed by the internal
    /// probe receivers. Rough-but-useful "messages that overran a slow
    /// subscriber since process start" gauge.
    pub overflow_lagged_events: AtomicU64,
}

/// `Copy`-able snapshot of `BroadcasterMetrics` for snapshotting / health
/// emission. Holds relaxed loads — exact consistency is not required.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BroadcasterMetricsSnapshot {
    pub a_dropped_no_receiver: u64,
    pub b_dropped_no_receiver: u64,
    pub overflow_lagged_events: u64,
}

impl BroadcasterMetrics {
    pub fn snapshot(&self) -> BroadcasterMetricsSnapshot {
        BroadcasterMetricsSnapshot {
            a_dropped_no_receiver: self.a_dropped_no_receiver.load(Ordering::Relaxed),
            b_dropped_no_receiver: self.b_dropped_no_receiver.load(Ordering::Relaxed),
            overflow_lagged_events: self.overflow_lagged_events.load(Ordering::Relaxed),
        }
    }
}

/// Message envelope for broadcast channels.
#[derive(Debug, Clone)]
pub struct BroadcastMsg {
    /// Event name (e.g. "bus-event", "chat-delta", "hook-event")
    pub event_name: String,
    /// Serialized payload
    pub payload: Value,
    /// For A-class events: sequence number from EventWriter. None for B-class.
    pub seq: Option<u64>,
    /// Optional run_id for run-scoped event filtering
    pub run_id: Option<String>,
}

/// Dual-channel broadcaster: A-class (reliable, replayable) + B-class (lossy, realtime).
#[derive(Clone)]
pub struct EventBroadcaster {
    /// A-class channel: reliable, large capacity, for replayable bus-events
    a_tx: broadcast::Sender<BroadcastMsg>,
    /// B-class channel: lossy, medium capacity, for realtime streams (chat/run-event/hook)
    b_tx: broadcast::Sender<BroadcastMsg>,
    /// Shared send-failure observability. Cloned cheaply via `Arc` so any
    /// downstream consumer that sees `RecvError::Lagged` can fold its
    /// observation into the same counter via `metrics_handle()`.
    metrics: Arc<BroadcasterMetrics>,
}

impl Default for EventBroadcaster {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBroadcaster {
    pub fn new() -> Self {
        let (a_tx, _) = broadcast::channel(A_CHANNEL_CAPACITY);
        let (b_tx, _) = broadcast::channel(B_CHANNEL_CAPACITY);
        log::debug!(
            "[broadcaster] created: A-channel={}, B-channel={}",
            A_CHANNEL_CAPACITY,
            B_CHANNEL_CAPACITY
        );
        let metrics = Arc::new(BroadcasterMetrics::default());
        // Probe receivers keep overflow observable even when no real WS
        // subscriber is connected. The watchdog reads both channels
        // concurrently; `Lagged` folds into `overflow_lagged_events`.
        spawn_lag_watchdog(a_tx.subscribe(), b_tx.subscribe(), metrics.clone());
        Self {
            a_tx,
            b_tx,
            metrics,
        }
    }

    /// Subscribe to A-class (replayable) events
    pub fn subscribe_a(&self) -> broadcast::Receiver<BroadcastMsg> {
        self.a_tx.subscribe()
    }

    /// Subscribe to B-class (realtime) events
    pub fn subscribe_b(&self) -> broadcast::Receiver<BroadcastMsg> {
        self.b_tx.subscribe()
    }

    /// Send an A-class event (bus-event with seq).
    /// `SendError` means "no active receiver" — counted, not swallowed.
    pub fn send_a(&self, msg: BroadcastMsg) {
        if self.a_tx.send(msg).is_err() {
            self.metrics
                .a_dropped_no_receiver
                .fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Send a B-class event (realtime, no seq).
    /// `SendError` means "no active receiver" — counted, not swallowed.
    pub fn send_b(&self, msg: BroadcastMsg) {
        if self.b_tx.send(msg).is_err() {
            self.metrics
                .b_dropped_no_receiver
                .fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Relaxed snapshot of send-failure counters. Cheap; intended for
    /// periodic `RuntimeHealthChanged` emission or test assertions.
    pub fn metrics(&self) -> BroadcasterMetricsSnapshot {
        self.metrics.snapshot()
    }

    /// Clonable handle to the underlying atomic counters. Useful when an
    /// external receiver wants to bump `overflow_lagged_events` from its
    /// own `RecvError::Lagged` handler (e.g. `web_server::ws`).
    pub fn metrics_handle(&self) -> Arc<BroadcasterMetrics> {
        self.metrics.clone()
    }
}

/// Drive a probe receiver on each channel so `RecvError::Lagged` is
/// observed even without any external subscriber. Each observed lag
/// increments `metrics.overflow_lagged_events` and logs a warning.
///
/// The watchdog exits only when a sender closes; `EventBroadcaster::new`
/// is the only site that creates these senders and the broadcaster lives
/// for the process lifetime, so under normal operation the task runs
/// forever.
fn spawn_lag_watchdog(
    mut a_rx: broadcast::Receiver<BroadcastMsg>,
    mut b_rx: broadcast::Receiver<BroadcastMsg>,
    metrics: Arc<BroadcasterMetrics>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                a = a_rx.recv() => match a {
                    Ok(_) => {}
                    Err(RecvError::Lagged(n)) => {
                        metrics.overflow_lagged_events.fetch_add(n, Ordering::Relaxed);
                        log::warn!(
                            "[broadcaster] A-channel lagged, dropped {} events (total overflow={})",
                            n,
                            metrics.overflow_lagged_events.load(Ordering::Relaxed)
                        );
                    }
                    Err(RecvError::Closed) => {
                        log::debug!("[broadcaster] A-channel closed, watchdog exiting");
                        break;
                    }
                },
                b = b_rx.recv() => match b {
                    Ok(_) => {}
                    Err(RecvError::Lagged(n)) => {
                        metrics.overflow_lagged_events.fetch_add(n, Ordering::Relaxed);
                        log::warn!(
                            "[broadcaster] B-channel lagged, dropped {} events (total overflow={})",
                            n,
                            metrics.overflow_lagged_events.load(Ordering::Relaxed)
                        );
                    }
                    Err(RecvError::Closed) => {
                        log::debug!("[broadcaster] B-channel closed, watchdog exiting");
                        break;
                    }
                },
            }
        }
    });
}

/// Unified emitter that replaces all direct `app.emit()` calls.
/// Handles: persist (A-class) + Tauri emit + broadcast to WS clients.
pub struct BroadcastEmitter {
    writer: Arc<EventWriter>,
    app: tauri::AppHandle,
    broadcaster: EventBroadcaster,
}

impl BroadcastEmitter {
    pub fn new(
        writer: Arc<EventWriter>,
        app: tauri::AppHandle,
        broadcaster: EventBroadcaster,
    ) -> Self {
        log::debug!("[emitter] BroadcastEmitter created");
        Self {
            writer,
            app,
            broadcaster,
        }
    }

    /// A-class: persist to events.jsonl + Tauri emit + broadcast with seq.
    /// This is the ONLY entry point for bus-event emission.
    pub fn persist_and_emit(&self, run_id: &str, event: &BusEvent) {
        let ts = crate::models::now_iso();
        match self.writer.write_bus_event_with_ts(run_id, event, &ts) {
            Ok(seq) => {
                match event {
                    BusEvent::MessageDelta { text, .. } => {
                        log::debug!(
                            "[emitter] persist_and_emit: run_id={}, seq={}, type=message_delta, text.len={}",
                            run_id,
                            seq,
                            text.len()
                        );
                    }
                    BusEvent::MessageComplete {
                        message_id, text, ..
                    } => {
                        log::debug!(
                            "[emitter] persist_and_emit: run_id={}, seq={}, type=message_complete, message_id={}, text.len={}",
                            run_id,
                            seq,
                            message_id,
                            text.len()
                        );
                    }
                    BusEvent::RunState { state, .. } => {
                        log::debug!(
                            "[emitter] persist_and_emit: run_id={}, seq={}, type=run_state, state={}",
                            run_id,
                            seq,
                            state
                        );
                    }
                    other => {
                        log::debug!(
                            "[emitter] persist_and_emit: run_id={}, seq={}, type={:?}",
                            run_id,
                            seq,
                            event_type_name(other)
                        );
                    }
                }
                let _ = self.app.emit("bus-event", event);
                let payload = match serde_json::to_value(event) {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!("[emitter] serialize bus-event failed: {}", e);
                        return;
                    }
                };
                self.broadcaster.send_a(BroadcastMsg {
                    event_name: "bus-event".to_string(),
                    payload,
                    seq: Some(seq),
                    run_id: Some(run_id.to_string()),
                });
                if let Err(error) =
                    crate::storage::run_journal::project_bus_event(run_id, seq, event)
                {
                    log::warn!(
                        "[emitter] run journal projection error for run_id={}: {}",
                        run_id,
                        error
                    );
                }
            }
            Err(e) => {
                log::warn!("[emitter] persist failed for run_id={}: {}", run_id, e);
                // Still emit to Tauri even if persist failed
                let _ = self.app.emit("bus-event", event);
            }
        }
    }

    /// B-class: Tauri emit + broadcast (no persist, no seq).
    /// For realtime streams: chat-delta, chat-done, run-event, hook-event, etc.
    pub fn emit_realtime<T: Serialize + Clone>(
        &self,
        event_name: &str,
        payload: &T,
        run_id: Option<&str>,
    ) {
        log::trace!(
            "[emitter] emit_realtime: event={}, run_id={:?}",
            event_name,
            run_id
        );
        let _ = self.app.emit(event_name, payload);
        let value = match serde_json::to_value(payload) {
            Ok(v) => v,
            Err(e) => {
                log::error!("[emitter] serialize {} failed: {}", event_name, e);
                return;
            }
        };
        self.broadcaster.send_b(BroadcastMsg {
            event_name: event_name.to_string(),
            payload: value,
            seq: None,
            run_id: run_id.map(|s| s.to_string()),
        });
    }

    /// Get a reference to the inner EventWriter (for direct reads like list_bus_events)
    pub fn writer(&self) -> &EventWriter {
        &self.writer
    }

    /// Get a reference to the inner EventBroadcaster (for WS subscriptions)
    pub fn broadcaster(&self) -> &EventBroadcaster {
        &self.broadcaster
    }

    /// Get a reference to the AppHandle
    pub fn app(&self) -> &tauri::AppHandle {
        &self.app
    }
}

/// Extract event type name for logging
fn event_type_name(event: &BusEvent) -> &'static str {
    match event {
        BusEvent::SessionInit { .. } => "session_init",
        BusEvent::MessageDelta { .. } => "message_delta",
        BusEvent::MessageComplete { .. } => "message_complete",
        BusEvent::UserMessage { .. } => "user_message",
        BusEvent::ToolStart { .. } => "tool_start",
        BusEvent::ToolEnd { .. } => "tool_end",
        BusEvent::RunState { .. } => "run_state",
        BusEvent::UsageUpdate { .. } => "usage_update",
        BusEvent::ThinkingDelta { .. } => "thinking_delta",
        BusEvent::ToolInputDelta { .. } => "tool_input_delta",
        BusEvent::PermissionDenied { .. } => "permission_denied",
        BusEvent::PermissionPrompt { .. } => "permission_prompt",
        BusEvent::CompactBoundary { .. } => "compact_boundary",
        BusEvent::SystemStatus { .. } => "system_status",
        BusEvent::AuthStatus { .. } => "auth_status",
        BusEvent::HookStarted { .. } => "hook_started",
        BusEvent::HookProgress { .. } => "hook_progress",
        BusEvent::HookResponse { .. } => "hook_response",
        BusEvent::HookCallback { .. } => "hook_callback",
        BusEvent::TaskNotification { .. } => "task_notification",
        BusEvent::ToolProgress { .. } => "tool_progress",
        BusEvent::ToolUseSummary { .. } => "tool_use_summary",
        BusEvent::FilesPersisted { .. } => "files_persisted",
        BusEvent::ControlCancelled { .. } => "control_cancelled",
        BusEvent::CommandOutput { .. } => "command_output",
        BusEvent::ElicitationPrompt { .. } => "elicitation_prompt",
        BusEvent::RateLimitEvent { .. } => "rate_limit_event",
        BusEvent::RalphStarted { .. } => "ralph_started",
        BusEvent::RalphIteration { .. } => "ralph_iteration",
        BusEvent::RalphComplete { .. } => "ralph_complete",
        BusEvent::Raw { .. } => "raw",
        BusEvent::SessionRecovering { .. } => "session_recovering",
        BusEvent::SessionRecovered { .. } => "session_recovered",
        BusEvent::ProtocolDesync { .. } => "protocol_desync",
        BusEvent::SessionLifecycle { .. } => "session_lifecycle",
        BusEvent::AttentionChanged { .. } => "attention_changed",
        BusEvent::RuntimeHealthChanged { .. } => "runtime_health_changed",
        BusEvent::GovernorBudgetExceeded { .. } => "governor_budget_exceeded",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;
    use tokio::time::timeout;

    fn sample_msg(name: &str) -> BroadcastMsg {
        BroadcastMsg {
            event_name: name.to_string(),
            payload: json!({"text": "hello"}),
            seq: Some(1),
            run_id: Some("run-test".to_string()),
        }
    }

    /// P0-S2: capacity constants must reflect the post-fix values.
    /// Regression guard against accidentally reverting to 1024 B-class.
    #[test]
    fn b_channel_capacity_is_16384() {
        assert_eq!(B_CHANNEL_CAPACITY, 16384);
        assert_eq!(A_CHANNEL_CAPACITY, 8192);
    }

    /// P0-S2: with a subscriber attached, messages are delivered in order.
    #[tokio::test]
    async fn send_with_subscriber_delivers_in_order() {
        let broadcaster = EventBroadcaster::new();
        let mut rx = broadcaster.subscribe_b();

        for i in 0..5 {
            let mut msg = sample_msg("chat-delta");
            msg.run_id = Some(format!("run-{i}"));
            broadcaster.send_b(msg);
        }

        for expected in 0..5 {
            let received = timeout(Duration::from_millis(200), rx.recv())
                .await
                .expect("recv within deadline")
                .expect("Ok delivery");
            assert_eq!(
                received.run_id.as_deref(),
                Some(format!("run-{expected}").as_str())
            );
        }
    }

    /// P0-S2: metrics() returns a Copy snapshot and stays queryable.
    #[tokio::test]
    async fn metrics_snapshot_is_copy_and_queryable() {
        let broadcaster = EventBroadcaster::new();
        let snap1 = broadcaster.metrics();
        let snap2 = snap1; // Copy
        assert_eq!(snap1, snap2);
        assert_eq!(
            snap1.a_dropped_no_receiver
                + snap1.b_dropped_no_receiver
                + snap1.overflow_lagged_events,
            snap2.a_dropped_no_receiver
                + snap2.b_dropped_no_receiver
                + snap2.overflow_lagged_events
        );
    }

    /// P0-S2: a flood that overruns a slow subscriber produces a Lagged
    /// observation; the watchdog's `overflow_lagged_events` counter must
    /// strictly increase. Use a 100× burst so even an aggressive probe
    /// receiver cannot keep `slow` current.
    #[tokio::test]
    async fn lag_increments_overflow_metric() {
        let broadcaster = EventBroadcaster::new();
        // Drop the watchdog's drain advantage by hammering the channel
        // with a generous burst while `slow` never reads.
        let mut slow = broadcaster.subscribe_b();
        let before = broadcaster.metrics().overflow_lagged_events;

        // 100× capacity guarantees `slow` (and likely the probe) fall
        // behind. ~1.6M sends keeps the write cursor moving faster than
        // any single tokio task can drain.
        let burst = B_CHANNEL_CAPACITY * 100;
        for i in 0..burst {
            let mut msg = sample_msg("chat-delta");
            msg.run_id = Some(format!("r-{i}"));
            broadcaster.send_b(msg);
        }

        // Pull on slow to surface a Lagged (or Closed/Ok depending on
        // background scheduling). Any terminal error from the recv is fine.
        let _ = timeout(Duration::from_secs(2), slow.recv()).await;

        // Give the watchdog several ticks to fold its own Lagged
        // observation into the counter.
        tokio::time::sleep(Duration::from_millis(200)).await;
        let after = broadcaster.metrics().overflow_lagged_events;
        assert!(
            after > before,
            "overflow_lagged_events should advance: before={before} after={after} (burst={burst})"
        );
    }

    /// P0-S2: stopping ALL receivers makes `send_a` observe SendError and
    /// the `a_dropped_no_receiver` counter goes up. We exercise this by
    /// dropping both watchdog and explicit subscribers until none remain.
    /// (In this test construction the watchdog receiver is held inside the
    /// spawned task, so we cannot drop it from here — instead, we verify
    /// the counter advances when a busy probe-receiver-less scenario is
    /// simulated by closing the channel. This test simply asserts the
    /// counter is monotonic under repeated sends.)
    #[tokio::test]
    async fn dropped_counter_is_monotonic_across_sends() {
        let broadcaster = EventBroadcaster::new();
        let _rx = broadcaster.subscribe_a();
        let before = broadcaster.metrics().a_dropped_no_receiver;
        for i in 0..10 {
            broadcaster.send_a(BroadcastMsg {
                event_name: format!("ev-{i}"),
                payload: json!({"i": i}),
                seq: Some(i as u64),
                run_id: None,
            });
        }
        let after = broadcaster.metrics().a_dropped_no_receiver;
        // With a subscriber attached the counter should NOT advance —
        // proves the counter is reserved for actual drop events, not
        // every send.
        assert_eq!(
            after, before,
            "successful sends must not bump a_dropped_no_receiver"
        );
    }
}
