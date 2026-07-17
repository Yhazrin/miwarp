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

pub fn check_ssh_key() -> Result<SshKeyInfo, String> {
    let candidates = [("~/.ssh/id_ed25519", "ed25519"), ("~/.ssh/id_rsa", "rsa")];

    #[cfg(unix)]
    let ssh_copy_id_available = crate::agent::claude_stream::which_binary("ssh-copy-id").is_some();
    #[cfg(not(unix))]
    let ssh_copy_id_available = false;

    log::debug!(
        "[diagnostics] check_ssh_key: ssh_copy_id_available={}",
        ssh_copy_id_available
    );

    // First pass: find a complete pair (private + pub both exist)
    for (tilde_path, key_type) in &candidates {
        let expanded = expand_local_tilde(tilde_path);
        let pub_expanded = format!("{}.pub", expanded);
        let priv_exists = std::path::Path::new(&expanded).is_file();
        let pub_exists = std::path::Path::new(&pub_expanded).is_file();

        log::debug!(
            "[diagnostics] check_ssh_key: {} priv={} pub={}",
            tilde_path,
            priv_exists,
            pub_exists
        );

        if priv_exists && pub_exists {
            return Ok(SshKeyInfo {
                key_path: tilde_path.to_string(),
                key_path_expanded: expanded,
                pub_key_path: format!("{}.pub", tilde_path),
                key_type: key_type.to_string(),
                exists: true,
                pub_exists: true,
                ssh_copy_id_available,
            });
        }
    }

    // Second pass: report first partial match (private exists but pub missing)
    for (tilde_path, key_type) in &candidates {
        let expanded = expand_local_tilde(tilde_path);
        let priv_exists = std::path::Path::new(&expanded).is_file();

        if priv_exists {
            return Ok(SshKeyInfo {
                key_path: tilde_path.to_string(),
                key_path_expanded: expanded,
                pub_key_path: format!("{}.pub", tilde_path),
                key_type: key_type.to_string(),
                exists: true,
                pub_exists: false,
                ssh_copy_id_available,
            });
        }
    }

    // Nothing found at all
    Ok(SshKeyInfo {
        key_path: "~/.ssh/id_ed25519".into(),
        key_path_expanded: expand_local_tilde("~/.ssh/id_ed25519"),
        pub_key_path: "~/.ssh/id_ed25519.pub".into(),
        key_type: "ed25519".into(),
        exists: false,
        pub_exists: false,
        ssh_copy_id_available,
    })
}

/// Generate an ed25519 SSH key pair. Fails if key already exists.
/// Returns SshKeyInfo for the newly created key.
#[tauri::command]
pub fn generate_ssh_key() -> Result<SshKeyInfo, String> {
    if crate::agent::claude_stream::which_binary("ssh-keygen").is_none() {
        return Err(ssh_not_found_msg("ssh-keygen"));
    }

    let ssh_dir = expand_local_tilde("~/.ssh");
    let key_path = expand_local_tilde("~/.ssh/id_ed25519");

    // Check if key already exists
    if std::path::Path::new(&key_path).is_file() {
        return Err("Key already exists at ~/.ssh/id_ed25519".into());
    }

    // Ensure ~/.ssh directory exists with correct permissions
    std::fs::create_dir_all(&ssh_dir).map_err(|e| format!("Failed to create ~/.ssh: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to set ~/.ssh permissions: {}", e))?;
    }

    // Get hostname for comment
    let hostname = Command::new("hostname")
        .hide_console()
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "localhost".into());

    let comment = format!("miwarp@{}", hostname);
    let aug_path = augmented_path();

    log::debug!(
        "[diagnostics] generate_ssh_key: path={}, comment={}",
        key_path,
        comment
    );

    let output = Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-N", "", "-C", &comment, "-f", &key_path])
        .env("PATH", &aug_path)
        .hide_console()
        .output()
        .map_err(|e| format!("Failed to run ssh-keygen: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ssh-keygen failed: {}", stderr));
    }

    log::debug!("[diagnostics] generate_ssh_key: success");

    // Return fresh check result
    check_ssh_key()
}

#[tauri::command]
