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

pub async fn update_claude_cli() -> Result<UpdateCliResult, String> {
    let claude_path = crate::agent::claude_stream::which_binary("claude");

    let is_npm_install = claude_path
        .as_deref()
        .map(|p| p.contains("node_modules"))
        .unwrap_or(false);

    if !is_npm_install {
        match run_claude_native_update().await {
            Ok(result) if result.success => return Ok(result),
            Ok(result) => {
                log::warn!(
                    "[diagnostics] claude update failed (will fall back to npm): exit_code stderr={}",
                    result.stderr
                );
            }
            Err(e) => {
                log::warn!(
                    "[diagnostics] claude update spawn failed (will fall back to npm): {}",
                    e
                );
            }
        }
    }

    run_npm_global_install("@anthropic-ai/claude-code").await
}

/// Run `claude update` (the official Anthropic installer's self-update).
/// Captures stdout/stderr and surfaces a structured `UpdateCliResult`.
async fn run_claude_native_update() -> Result<UpdateCliResult, String> {
    let aug_path = crate::agent::claude_stream::augmented_path();
    let claude =
        crate::agent::claude_stream::which_binary("claude").unwrap_or_else(|| "claude".to_string());

    log::info!(
        "[diagnostics] invoking `{} update` (official installer)",
        claude
    );

    let claude_owned = claude.clone();
    let aug_path_owned = aug_path.clone();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(&claude_owned)
            .arg("update")
            .env("PATH", &aug_path_owned)
            .hide_console()
            .output()
    })
    .await
    .map_err(|e| format!("claude update task failed: {}", e))?;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let success = out.status.success();
            log::info!(
                "[diagnostics] claude update: success={}, exit={:?}, stdout_len={}, stderr_len={}",
                success,
                out.status.code(),
                stdout.len(),
                stderr.len()
            );
            if !success {
                log::warn!("[diagnostics] claude update stderr: {}", stderr);
            }
            Ok(UpdateCliResult {
                success,
                stdout,
                stderr,
            })
        }
        Err(e) => {
            log::warn!("[diagnostics] claude update spawn failed: {}", e);
            Err(format!("Failed to spawn claude: {}", e))
        }
    }
}

/// One-click update for Codex CLI. Runs `npm install -g @openai/codex`.
#[tauri::command]
pub async fn update_codex_cli() -> Result<UpdateCliResult, String> {
    run_npm_global_install("@openai/codex").await
}

/// One-click update for MiMo Code. Runs `npm install -g @mimo-ai/cli`.
#[tauri::command]
pub async fn update_mimo_cli() -> Result<UpdateCliResult, String> {
    run_npm_global_install("@mimo-ai/cli").await
}

/// One-click update for CC-Switch. Multi-source dispatch:
/// 1. Detect current install method via `cli_update::detect_ccswitch()`.
/// 2. If installed via Homebrew Cask (macOS): `brew upgrade --cask cc-switch`.
/// 3. Otherwise: fetch the latest GitHub release, pick the platform-matching
///    asset, download it, and install via the appropriate channel
///    (DMG hdiutil on macOS, `.deb` dpkg on Debian, AppImage on portable
///    Linux, MSI on Windows).
/// 4. If the tool isn't installed at all, the same GitHub release flow
///    performs the first-time install — the user gets a true one-click
///    experience regardless of the channel.
#[tauri::command]
pub async fn update_ccswitch() -> Result<UpdateCliResult, String> {
    use crate::agent::cli_update::{
        detect_ccswitch, get_github_latest_release, install_from_release, pick_release_asset,
        CliInstallMethod,
    };

    let info = detect_ccswitch();
    log::info!(
        "[diagnostics] update_ccswitch: detected found={} method={:?} version={:?} path={:?}",
        info.found,
        info.method,
        info.version,
        info.install_path
    );

    // (1) Brew-installed copy has its own fast path.
    if info.found && info.method == CliInstallMethod::BrewCask {
        #[cfg(target_os = "macos")]
        {
            return run_cask_upgrade("cc-switch", "cc-switch").await;
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err(
                "Brew Cask install detected but we're not on macOS — please use the GitHub release"
                    .to_string(),
            );
        }
    }

    // (2) GitHub release auto-install covers DMG, .deb, AppImage, MSI, and
    //     first-time installs.
    let release = get_github_latest_release("farion1231", "cc-switch")
        .await
        .map_err(|e| {
            format!(
                "Failed to fetch CC-Switch release info from GitHub: {} \
                 (you can update manually at https://github.com/farion1231/cc-switch/releases/latest)",
                e
            )
        })?;
    let asset = pick_release_asset(&release).ok_or_else(|| {
        format!(
            "No CC-Switch release asset matches this platform ({}-{}). \
             Download manually at https://github.com/farion1231/cc-switch/releases/tag/{}",
            std::env::consts::OS,
            std::env::consts::ARCH,
            release.tag_name
        )
    })?;

    // (3) Pick the install method. If we already detected one (Dmg on macOS,
    //     Deb on Debian, etc.), honor it; otherwise fall back to the asset
    //     filename extension so first-time installs work without detection.
    let method = if info.found {
        info.method
    } else {
        install_method_for_asset(&asset.name)
    };

    let install_path = install_from_release(asset, method, "CC-Switch")
        .await
        .map_err(|e| {
            format!(
                "CC-Switch download succeeded but install failed: {}. \
                 You can install manually from {}",
                e, asset.browser_download_url
            )
        })?;

    Ok(UpdateCliResult {
        success: true,
        stdout: format!(
            "Installed CC-Switch {} to {}",
            release.tag_name, install_path
        ),
        stderr: String::new(),
    })
}

/// Choose an install method for a freshly downloaded release asset. Used
/// when `detect_ccswitch` reports `found = false` (first-time install).
/// Matches on the asset filename extension — DMG / .deb / .AppImage / .msi.
fn install_method_for_asset(asset_name: &str) -> CliInstallMethod {
    let lower = asset_name.to_lowercase();
    if lower.ends_with(".dmg") {
        CliInstallMethod::Dmg
    } else if lower.ends_with(".deb") {
        CliInstallMethod::Deb
    } else if lower.ends_with(".rpm") {
        CliInstallMethod::Rpm
    } else if lower.ends_with(".appimage") {
        CliInstallMethod::AppImage
    } else if lower.ends_with(".msi") {
        CliInstallMethod::Msi
    } else {
        CliInstallMethod::Unknown
    }
}

/// Unified dispatcher: route by tool_id so the UI only needs one command.
/// Mirrors the per-tool commands above for callers that prefer a single entry point.
#[tauri::command]
pub async fn run_cli_update(tool_id: String) -> Result<UpdateCliResult, String> {
    match tool_id.as_str() {
        "claude-code" | "claude" => update_claude_cli().await,
        "codex" => update_codex_cli().await,
        "mimo" | "mimocode" => update_mimo_cli().await,
        "ccswitch" | "cc-switch" => update_ccswitch().await,
        other => Err(format!(
            "Unknown tool_id '{}'; expected one of: claude-code, codex, mimo, ccswitch",
            other
        )),
    }
}

/// Shared npm-install helper used by the per-tool update commands above.
/// Locates `npm` cross-platform (preferring `.cmd`/`.exe` on Windows to avoid
/// error 193 from bare `npm`), runs `npm install -g <pkg>`, and returns the
/// captured output. On a non-zero exit, surfaces stderr in the error message.
async fn run_npm_global_install(pkg: &str) -> Result<UpdateCliResult, String> {
    let aug_path = crate::agent::claude_stream::augmented_path();

    let npm = cfg!(windows)
        .then(|| crate::agent::claude_stream::which_binary("npm.cmd"))
        .flatten()
        .or_else(|| crate::agent::claude_stream::which_binary("npm"))
        .unwrap_or_else(|| "npm".to_string());

    log::info!("[diagnostics] npm install -g {} (via {})", pkg, npm);

    let pkg_owned = pkg.to_string();
    let npm_owned = npm.clone();
    let aug_path_clone = aug_path.clone();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(&npm_owned)
            .args(["install", "-g", &pkg_owned])
            .env("PATH", &aug_path_clone)
            .hide_console()
            .output()
    })
    .await
    .map_err(|e| format!("update task failed: {}", e))?;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let success = out.status.success();
            log::info!(
                "[diagnostics] npm install -g {}: success={}, exit={:?}, stdout_len={}, stderr_len={}",
                pkg,
                success,
                out.status.code(),
                stdout.len(),
                stderr.len()
            );
            if !success {
                log::warn!("[diagnostics] npm install -g {} stderr: {}", pkg, stderr);
            }
            Ok(UpdateCliResult {
                success,
                stdout,
                stderr,
            })
        }
        Err(e) => {
            log::warn!("[diagnostics] npm install -g {} spawn failed: {}", pkg, e);
            Err(format!("Failed to spawn npm: {}", e))
        }
    }
}

/// macOS-only Homebrew cask upgrade. Falls back to `brew install --cask` if the
/// cask isn't installed yet (covers first-run "一键安装" flows).
#[cfg(target_os = "macos")]
async fn run_cask_upgrade(cask: &str, log_label: &str) -> Result<UpdateCliResult, String> {
    let aug_path = crate::agent::claude_stream::augmented_path();

    // Try `brew upgrade --cask` first; if it exits non-zero (cask not installed),
    // fall back to `brew install --cask` so users can hit "一键安装" without a separate path.
    let cask_owned = cask.to_string();
    let log_label_owned = log_label.to_string();
    let aug_path_owned = aug_path.clone();
    let output = tokio::task::spawn_blocking(move || {
        let upgrade = Command::new("brew")
            .args(["upgrade", "--cask", &cask_owned])
            .env("PATH", &aug_path_owned)
            .hide_console()
            .output();
        match upgrade {
            Ok(out) if out.status.success() => Ok(out),
            Ok(out) => {
                log::warn!(
                    "[diagnostics] brew upgrade --cask {} not installed; falling back to brew install: exit={:?}",
                    log_label_owned,
                    out.status.code()
                );
                Command::new("brew")
                    .args(["install", "--cask", &cask_owned])
                    .env("PATH", &aug_path)
                    .hide_console()
                    .output()
            }
            Err(e) => Err(e),
        }
    })
    .await
    .map_err(|e| format!("brew task failed: {}", e))?;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let success = out.status.success();
            log::info!(
                "[diagnostics] brew cask {}: success={}, exit={:?}, stdout_len={}, stderr_len={}",
                log_label,
                success,
                out.status.code(),
                stdout.len(),
                stderr.len()
            );
            if !success {
                log::warn!("[diagnostics] brew cask {} stderr: {}", log_label, stderr);
            }
            Ok(UpdateCliResult {
                success,
                stdout,
                stderr,
            })
        }
        Err(e) => {
            log::warn!("[diagnostics] brew cask {} spawn failed: {}", log_label, e);
            Err(format!("Failed to spawn brew: {}", e))
        }
    }
}

#[tauri::command]
