//! Claude CLI stream-json protocol parser.
//!
//! Pure-function protocol mapping: raw JSON events → `Vec<BusEvent>`.
//! Encapsulates all accumulator state (tool tracking, JSON accumulation)
//! so callers only need `ProtocolState::new()` + `state.map_event(...)`.
//!
//! Also supports MiMo-Code JSON protocol via runtime_kind dispatch.

#[cfg(test)]
use crate::models::protocol_state::validate_bus_event;
#[cfg(test)]
use crate::models::BusEvent;

/// Strict wrapper — panics if validate returns Some. Only exists in test binary.
#[cfg(test)]
pub fn validate_strict(ev: &BusEvent) {
    if let Some(warn) = validate_bus_event(ev) {
        panic!(
            "[STRICT] invalid event: {}.{}: {}",
            warn.event_type, warn.field, warn.detail
        );
    }
}
