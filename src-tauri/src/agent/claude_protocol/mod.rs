// Submodules
pub mod types;
pub mod validation;
pub mod state;
pub mod map_event;
pub mod map_event_other;

// Re-exports for backward compatibility
pub use types::ParserStats;
pub use types::ValidationWarn;
pub use validation::validate_bus_event;
pub use validation::validate_strict;
pub use state::ProtocolState;

// Tests
#[cfg(test)]
mod tests;
