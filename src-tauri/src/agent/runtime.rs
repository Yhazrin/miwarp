//! Runtime abstraction layer for agent backends.
//!
//! Provides `RuntimeConfig` — a unified configuration for spawning any agent
//! runtime (ClaudeCode, MiMoCode, Codex). The actual process spawning and
//! protocol parsing remain in their respective modules; this layer only
//! centralizes the "what to spawn" decision.

use crate::models::{AgentRuntimeKind, RuntimeProtocolKind};
use std::path::PathBuf;

/// Resolved configuration for spawning an agent runtime.
/// Built from RunMeta + settings; consumed by spawn functions.
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    /// Which agent runtime to use.
    pub kind: AgentRuntimeKind,
    /// Communication protocol.
    pub protocol: RuntimeProtocolKind,
    /// Binary path (resolved from settings or auto-detected).
    pub binary: String,
    /// Working directory.
    pub cwd: PathBuf,
    /// CLI arguments (excluding the binary itself).
    pub args: Vec<String>,
    /// Extra environment variables to inject.
    pub env: std::collections::HashMap<String, String>,
}

impl RuntimeConfig {
    /// Build a RuntimeConfig for ClaudeCode.
    pub fn claude_code(
        cwd: PathBuf,
        args: Vec<String>,
        env: std::collections::HashMap<String, String>,
    ) -> Self {
        Self {
            kind: AgentRuntimeKind::ClaudeCode,
            protocol: RuntimeProtocolKind::StreamJson,
            binary: "claude".to_string(),
            cwd,
            args,
            env,
        }
    }

    /// Build a RuntimeConfig for MiMoCode.
    pub fn mimo_code(
        cwd: PathBuf,
        binary: String,
        args: Vec<String>,
        env: std::collections::HashMap<String, String>,
    ) -> Self {
        Self {
            kind: AgentRuntimeKind::MiMoCode,
            protocol: RuntimeProtocolKind::StreamJson,
            binary,
            cwd,
            args,
            env,
        }
    }

    /// Build a RuntimeConfig for Codex.
    pub fn codex(
        cwd: PathBuf,
        args: Vec<String>,
        env: std::collections::HashMap<String, String>,
    ) -> Self {
        Self {
            kind: AgentRuntimeKind::Codex,
            protocol: RuntimeProtocolKind::Pipe,
            binary: "codex".to_string(),
            cwd,
            args,
            env,
        }
    }

    /// Resolve the binary path for a given runtime kind.
    pub fn resolve_binary(kind: &AgentRuntimeKind) -> String {
        match kind {
            AgentRuntimeKind::ClaudeCode => "claude".to_string(),
            AgentRuntimeKind::MiMoCode => resolve_mimo_binary(),
            AgentRuntimeKind::Codex => "codex".to_string(),
        }
    }
}

/// Detect the mimo binary path.
/// Checks common locations in order:
/// 1. `mimo` on PATH
/// 2. `~/.mimocode/bin/mimo`
/// 3. `/opt/homebrew/bin/mimo`
fn resolve_mimo_binary() -> String {
    // Check PATH first
    if let Ok(output) = std::process::Command::new("which").arg("mimo").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return path;
            }
        }
    }

    // Check ~/.mimocode/bin/mimo
    if let Ok(home) = std::env::var("HOME") {
        let mimo_path = PathBuf::from(home).join(".mimocode/bin/mimo");
        if mimo_path.exists() {
            return mimo_path.to_string_lossy().to_string();
        }
    }

    // Check /opt/homebrew/bin/mimo (macOS ARM)
    let brew_path = PathBuf::from("/opt/homebrew/bin/mimo");
    if brew_path.exists() {
        return brew_path.to_string_lossy().to_string();
    }

    // Fallback: assume it's on PATH
    "mimo".to_string()
}

/// Detect mimo version by running `mimo --version`.
pub fn detect_mimo_version(binary: &str) -> Option<String> {
    std::process::Command::new(binary)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

/// Check if mimo is available on this system.
pub fn is_mimo_available() -> bool {
    let binary = resolve_mimo_binary();
    std::process::Command::new(&binary)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
