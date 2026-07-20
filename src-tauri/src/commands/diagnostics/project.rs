use crate::models::ProjectInitStatus;

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

pub fn check_project_init(cwd: String) -> Result<ProjectInitStatus, String> {
    log::debug!("[diagnostics] check_project_init: cwd={}", cwd);
    let root = std::path::Path::new(&cwd);
    if !root.is_dir() {
        return Ok(ProjectInitStatus {
            cwd,
            has_claude_md: false,
        });
    }
    // Canonicalize path (resolve symlinks + normalize case)
    let canonical = std::fs::canonicalize(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| cwd.clone());
    let has_claude_md = root.join("CLAUDE.md").is_file();
    log::debug!(
        "[diagnostics] check_project_init: canonical={}, has_claude_md={}",
        canonical,
        has_claude_md
    );
    Ok(ProjectInitStatus {
        cwd: canonical,
        has_claude_md,
    })
}

// ── run_diagnostics: comprehensive system check ──

pub(super) const ENV_VAR_LIMITS: &[(&str, u64, u64)] = &[
    ("BASH_MAX_OUTPUT_LENGTH", 1, 1_000_000),
    ("TASK_MAX_OUTPUT_LENGTH", 1, 1_000_000),
    ("CLAUDE_CODE_MAX_OUTPUT_TOKENS", 1, 128_000),
];
