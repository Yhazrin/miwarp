//! Observer trait and concrete implementation for the diagnostics ring buffer.
//!
//! Components (session actor, send coordinator, permission coordinator,
//! config transactions) call into the observer to emit breadcrumb events.
//! The observer writes into the `DiagnosticRingBuffer` which enforces
//! capacity and redaction.

use super::ring_buffer::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticRingBuffer, DiagnosticSeverity, DEFAULT_RING_CAP,
};

/// Trait for emitting diagnostic events. Decouples callers from
/// the concrete ring buffer so tests can inject a mock.
#[async_trait::async_trait]
pub trait DiagnosticObserver: Send + Sync {
    /// Record a diagnostic breadcrumb.
    async fn record(&self, event: DiagnosticEvent);
    /// Snapshot all buffered events.
    async fn snapshot(&self) -> Vec<DiagnosticEvent>;
    /// Snapshot with time range filter (inclusive).
    async fn snapshot_range(
        &self,
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<DiagnosticEvent>;
    /// Count of events currently stored.
    async fn len(&self) -> usize;
    /// Returns `true` if the buffer holds no events.
    async fn is_empty(&self) -> bool;
    /// Capacity of the ring buffer.
    fn capacity(&self) -> usize;
    /// Empty the buffer.
    async fn clear(&self);
}

/// Concrete observer backed by `DiagnosticRingBuffer`.
/// Stored as `Arc<DiagnosticObserverImpl>` in Tauri managed state.
pub struct DiagnosticObserverImpl {
    buffer: DiagnosticRingBuffer,
}

impl DiagnosticObserverImpl {
    pub fn new(capacity: usize) -> Self {
        Self {
            buffer: DiagnosticRingBuffer::new(capacity),
        }
    }

    /// Default capacity for the app-wide observer.
    pub fn default_capacity() -> usize {
        DEFAULT_RING_CAP
    }
}

#[async_trait::async_trait]
impl DiagnosticObserver for DiagnosticObserverImpl {
    async fn record(&self, event: DiagnosticEvent) {
        self.buffer.push(event).await;
    }

    async fn snapshot(&self) -> Vec<DiagnosticEvent> {
        self.buffer.snapshot().await
    }

    async fn snapshot_range(
        &self,
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<DiagnosticEvent> {
        let all = self.buffer.snapshot().await;
        all.into_iter()
            .filter(|e| {
                if let Some(from) = from_ms {
                    if e.timestamp_ms < from {
                        return false;
                    }
                }
                if let Some(to) = to_ms {
                    if e.timestamp_ms > to {
                        return false;
                    }
                }
                true
            })
            .collect()
    }

    async fn len(&self) -> usize {
        self.buffer.len().await
    }

    async fn is_empty(&self) -> bool {
        self.buffer.is_empty().await
    }

    fn capacity(&self) -> usize {
        self.buffer.capacity()
    }

    async fn clear(&self) {
        self.buffer.clear().await;
    }
}

// ── Helper for building events ──

/// Shorthand to build and record a diagnostic event via the observer.
pub async fn record_event(
    observer: &dyn DiagnosticObserver,
    category: DiagnosticCategory,
    severity: DiagnosticSeverity,
    phase: impl Into<String>,
    metadata: impl Into<String>,
) {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    observer
        .record(DiagnosticEvent {
            timestamp_ms: now_ms,
            category,
            severity,
            run_id: None,
            session_id: None,
            runtime_id: None,
            connection_generation: None,
            client_message_id: None,
            permission_request_id: None,
            phase: phase.into(),
            error_code: None,
            retryable: false,
            duration_ms: None,
            metadata: metadata.into(),
        })
        .await;
}

/// Build a full diagnostic event with all optional fields for recording.
pub fn make_event(
    category: DiagnosticCategory,
    severity: DiagnosticSeverity,
    phase: impl Into<String>,
    metadata: impl Into<String>,
) -> DiagnosticEvent {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    DiagnosticEvent {
        timestamp_ms: now_ms,
        category,
        severity,
        run_id: None,
        session_id: None,
        runtime_id: None,
        connection_generation: None,
        client_message_id: None,
        permission_request_id: None,
        phase: phase.into(),
        error_code: None,
        retryable: false,
        duration_ms: None,
        metadata: metadata.into(),
    }
}

// ── Mock observer for tests ──

/// A mock observer that records all events into a Vec for test assertions.
#[cfg(test)]
pub struct MockObserver {
    events: std::sync::Mutex<Vec<DiagnosticEvent>>,
}

#[cfg(test)]
impl Default for MockObserver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl MockObserver {
    pub fn new() -> Self {
        Self {
            events: std::sync::Mutex::new(Vec::new()),
        }
    }
    pub fn collected(&self) -> Vec<DiagnosticEvent> {
        self.events.lock().unwrap().clone()
    }
}

#[cfg(test)]
#[async_trait::async_trait]
impl DiagnosticObserver for MockObserver {
    async fn record(&self, event: DiagnosticEvent) {
        self.events.lock().unwrap().push(event);
    }
    async fn snapshot(&self) -> Vec<DiagnosticEvent> {
        self.events.lock().unwrap().clone()
    }
    async fn snapshot_range(
        &self,
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<DiagnosticEvent> {
        let all = self.events.lock().unwrap().clone();
        all.into_iter()
            .filter(|e| {
                if let Some(from) = from_ms {
                    if e.timestamp_ms < from {
                        return false;
                    }
                }
                if let Some(to) = to_ms {
                    if e.timestamp_ms > to {
                        return false;
                    }
                }
                true
            })
            .collect()
    }
    async fn len(&self) -> usize {
        self.events.lock().unwrap().len()
    }
    async fn is_empty(&self) -> bool {
        self.events.lock().unwrap().is_empty()
    }
    fn capacity(&self) -> usize {
        usize::MAX
    }
    async fn clear(&self) {
        self.events.lock().unwrap().clear();
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn observer_records_and_snapshots() {
        let obs = DiagnosticObserverImpl::new(10);
        record_event(
            &obs,
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Info,
            "test",
            "hello",
        )
        .await;
        assert_eq!(obs.len().await, 1);
        let snap = obs.snapshot().await;
        assert_eq!(snap[0].metadata, "hello");
        assert_eq!(snap[0].category, DiagnosticCategory::Recovery);
    }

    #[tokio::test]
    async fn observer_time_range_filter() {
        let obs = DiagnosticObserverImpl::new(100);
        for i in 0..5u64 {
            let mut ev = make_event(
                DiagnosticCategory::ActorLifecycle,
                DiagnosticSeverity::Info,
                "tick",
                format!("ev{i}"),
            );
            ev.timestamp_ms = 1000 + i * 100;
            obs.record(ev).await;
        }
        let filtered = obs.snapshot_range(Some(1100), Some(1300)).await;
        assert_eq!(filtered.len(), 3);
        assert_eq!(filtered[0].metadata, "ev1");
        assert_eq!(filtered[2].metadata, "ev3");
    }

    #[tokio::test]
    async fn observer_clear() {
        let obs = DiagnosticObserverImpl::new(10);
        record_event(
            &obs,
            DiagnosticCategory::Spawn,
            DiagnosticSeverity::Warn,
            "phase",
            "data",
        )
        .await;
        assert_eq!(obs.len().await, 1);
        obs.clear().await;
        assert_eq!(obs.len().await, 0);
    }

    #[tokio::test]
    async fn mock_observer_records() {
        let mock = MockObserver::new();
        mock.record(make_event(
            DiagnosticCategory::Connection,
            DiagnosticSeverity::Error,
            "disconnect",
            "ws closed",
        ))
        .await;
        let collected = mock.collected();
        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].metadata, "ws closed");
    }

    #[tokio::test]
    async fn mock_observer_time_range() {
        let mock = MockObserver::new();
        for i in 0..3u64 {
            let mut ev = make_event(
                DiagnosticCategory::SendTx,
                DiagnosticSeverity::Info,
                "send",
                format!("m{i}"),
            );
            ev.timestamp_ms = 100 + i * 50;
            mock.record(ev).await;
        }
        let filtered = mock.snapshot_range(Some(150), Some(200)).await;
        assert_eq!(filtered.len(), 2); // 150, 200
    }

    #[test]
    fn make_event_fields() {
        let ev = make_event(
            DiagnosticCategory::PermissionTx,
            DiagnosticSeverity::Warn,
            "denied",
            "tool blocked",
        );
        assert_eq!(ev.category, DiagnosticCategory::PermissionTx);
        assert_eq!(ev.severity, DiagnosticSeverity::Warn);
        assert_eq!(ev.phase, "denied");
        assert_eq!(ev.metadata, "tool blocked");
        assert!(ev.run_id.is_none());
        assert!(ev.error_code.is_none());
    }
}
