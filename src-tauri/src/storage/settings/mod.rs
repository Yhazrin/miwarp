// Submodules
pub mod core;
pub mod user;
pub mod agent;

// Re-exports for backward compatibility
pub use core::load;
pub use core::save;
pub use user::get_user_settings;
pub use user::save_web_server_config;
pub use user::set_web_server_enabled;
pub use user::save_web_server_partial_disable;
pub use user::reset_user_settings;
pub use user::apply_personal_profile_reset;
pub use user::reset_personal_profile;
pub use user::update_user_settings;
pub use agent::get_agent_settings;
pub use agent::update_agent_settings;

// Tests
#[cfg(test)]
mod tests;
