// Submodules
pub mod map_event;
pub mod map_event_other;
pub mod state;
pub mod types;
pub mod validation;

// Re-exports for backward compatibility — canonical types now live in `models::protocol_state`.
pub use crate::models::protocol_state::validate_bus_event;
pub use crate::models::protocol_state::ParserStats;
pub use crate::models::protocol_state::ProtocolState;
pub use crate::models::protocol_state::ValidationWarn;
#[cfg(test)]
pub use validation::validate_strict;

// Tests
#[cfg(test)]
mod tests;
