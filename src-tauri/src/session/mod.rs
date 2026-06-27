//! Session subsystem: auth, platform routing, remote context, process spawn, actor
//! control, interactive control, side question, ralph loop, runtime recovery.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! This module is the new home for the 9 domains. The legacy `commands::session`
//! module is a thin façade that re-exports the public Tauri command functions
//! to preserve the IPC contract.

pub mod actor_control;
pub mod auth_resolution;
pub mod interactive_control;
pub mod platform_routing;
pub mod process_spawn;
pub mod ralph_commands;
pub mod recovery_commands;
pub mod remote_context;
pub mod side_question;
