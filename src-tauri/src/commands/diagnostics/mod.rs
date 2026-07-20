// Submodules
pub mod cli_check;
pub mod cli_update;
pub mod dist_tags;
pub mod network;
pub mod project;
pub mod report;
pub mod ssh;
pub mod utility;

// Re-export command modules wholesale so Tauri's generated `__cmd__*` symbols
// remain available at the historical `commands::diagnostics::*` paths.
pub use cli_check::*;
pub use cli_update::*;
pub use dist_tags::*;
pub use network::*;
pub use project::*;
pub use report::*;
pub use ssh::*;
pub use utility::*;

#[cfg(test)]
use cli_check::detect_proxy_inner;
#[cfg(test)]
use network::test_api_inner;
#[cfg(test)]
use report::{
    check_env_vars, scan_claude_md_files_at, validate_config_files_at, validate_keybindings_at,
    validate_mcp_configs_at,
};

// Tests
#[cfg(test)]
mod tests;
