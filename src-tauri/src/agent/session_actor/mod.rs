// Submodules
pub mod event;
pub mod handlers;
pub mod io;
pub mod process;
pub mod state_machine;
pub mod types;
pub mod util;

// Re-exports for backward compatibility
pub use process::spawn_actor;
pub use process::spawn_actor_with_runtime;
pub use types::ActorCommand;
pub use types::ActorStopReason;
pub use types::RalphCancelResult;
pub use types::SessionActorHandle;
#[cfg(test)]
pub(crate) use types::StopSource;

#[cfg(test)]
pub(crate) use crate::agent::turn_engine::ACCEPTED_CLIENT_MESSAGE_IDS_CAP;
#[cfg(test)]
pub(crate) use event::{is_accepted, record_accepted_client_message_id};
pub use util::build_user_payload;
#[cfg(test)]
pub(crate) use util::{is_protocol_noise, strip_ansi};

// Tests
#[cfg(test)]
mod tests;
