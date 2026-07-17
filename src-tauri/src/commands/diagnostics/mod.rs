// Submodules
pub mod cli_update;
pub mod cli_check;
pub mod network;
pub mod project;
pub mod report;
pub mod ssh;
pub mod dist_tags;
pub mod utility;

// Re-exports for backward compatibility
pub use cli_check::DetectCliToolResult;
pub use project::check_project_init;
pub use ssh::check_ssh_key;
pub use ssh::generate_ssh_key;
pub use utility::get_data_directory;
pub use utility::log_debug_event;

// Tests
#[cfg(test)]
mod tests;
