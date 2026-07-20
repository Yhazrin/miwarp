// Submodules
mod agent;
mod core;
mod user;

// Re-exports for backward compatibility
pub use agent::get_agent_settings;
pub use agent::update_agent_settings;
pub use core::load;
pub use core::save;
pub(crate) use core::{get_provider_info, is_key_optional_platform};
pub use user::apply_personal_profile_reset;
pub use user::get_user_settings;
pub use user::reset_personal_profile;
pub use user::reset_user_settings;
pub use user::save_web_server_config;
pub use user::save_web_server_partial_disable;
pub use user::set_web_server_enabled;
pub use user::update_user_settings;

// Tests
#[cfg(test)]
mod tests;
