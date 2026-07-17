use crate::agent::claude_stream::augmented_path;
use crate::agent::cli_update::CliInstallMethod;
use crate::agent::ssh::{expand_local_tilde, shell_escape};
use crate::models::{
    ApiTestResult, AuthDiagnostics, ClaudeMdInfo, CliCheckResult, CliDiagnostics, CliDistTags,
    ConfigDiagnostics, ConfigIssue, DiagnosticsReport, LocalProxyStatus, ProjectDiagnostics,
    ProjectInitStatus, RemoteTestResult, ServicesDiagnostics, SshKeyInfo, SystemDiagnostics,
    UpdateCliResult,
};
use crate::process_ext::HideConsole;
use std::path::Path;
use std::process::Command;

/// One-click update for Claude Code. Claude Code ships via two channels that
/// don't share a single update path:
/// - Official installer (macOS/Linux: `~/.local/bin/claude` symlink to
///   `~/.local/share/claude/versions/<ver>`). The installer exposes a
///   `claude update` subcommand which we must use — running
///   `npm install -g @anthropic-ai/claude-code` only updates a parallel copy
///   under `node_modules`, leaving the user's actual `claude` binary stale.
/// - npm (`npm install -g @anthropic-ai/claude-code`).
///
/// We detect which one is in use by looking at the `which claude` path: if it
/// resolves inside a `node_modules` tree, the user is on the npm channel;
/// otherwise we assume the official installer and prefer `claude update`.
/// Falls back to npm if `claude update` itself fails (e.g. user has the
/// npm-global copy in PATH but also has the official installer shadowing it).
#[tauri::command]

pub fn get_data_directory() -> String {
    crate::storage::data_dir().to_string_lossy().into_owned()
}

/// Forward a debug event from the webview to the Rust stdout/log stream.
///
/// Used for real-time debugging of the Svelte input component: the frontend
/// has no way to surface per-keystroke diagnostic info except by writing
/// to the browser DevTools console, which the orchestrating Claude session
/// can't see. This command gives us a one-way pipe: Svelte `__dbg()` →
/// `invoke("log_debug_event", { tag, payload })` → `log::info!` →
/// stdout. Filter the running tauri dev output with
/// `grep '\[prompt-db\]'` to follow along.
#[tauri::command]
pub fn log_debug_event(tag: String, payload: String) {
    log::info!("[prompt-db] {} {}", tag, payload);
}
