//! Protocol abstraction for agent runtime communication.
//!
//! Each protocol implementation maps raw agent events to MiWarp `BusEvent`s.
//! The trait is object-safe so session_actor can use dynamic dispatch.

pub mod claude;
pub mod cursor;
pub mod mimo;

use crate::models::BusEvent;

/// Result of parsing a single raw event line from the agent.
#[derive(Debug)]
pub enum ParseResult {
    /// One or more BusEvents to emit.
    Events(Vec<BusEvent>),
    /// Raw line to log but not emit as a BusEvent.
    Raw(String),
    /// Event was parsed but intentionally skipped (e.g. heartbeat).
    Skip,
    /// Parse error — should be logged and counted.
    Error(String),
}

/// Protocol parser trait — implemented per agent runtime.
///
/// Lifetime: one instance per session. State accumulates across events
/// (tool tracking, JSON buffers, etc.).
pub trait ProtocolParser: Send {
    /// Parse a single raw line from the agent's stdout.
    ///
    /// # Arguments
    /// * `run_id` — MiWarp run ID for BusEvent construction
    /// * `line` — raw line from stdout (may be partial for multi-line JSON)
    ///
    /// # Returns
    /// `ParseResult` indicating how the line should be handled.
    fn parse_line(&mut self, run_id: &str, line: &str) -> ParseResult;

    /// Extract the session/conversation ID from the parsed events so far.
    /// Used to populate RunMeta.conversation_ref after first events arrive.
    fn conversation_id(&self) -> Option<String>;

    /// Extract the model name if detected from events.
    fn detected_model(&self) -> Option<String>;

    /// Reset parser state (e.g. on session resume).
    fn reset(&mut self);

    /// Return parser statistics for diagnostics.
    fn stats(&self) -> ParserStats;
}

/// Aggregate parser statistics.
#[derive(Debug, Clone, Default)]
pub struct ParserStats {
    pub lines_parsed: u64,
    pub events_emitted: u64,
    pub events_skipped: u64,
    pub parse_errors: u64,
    pub raw_lines: u64,
}
