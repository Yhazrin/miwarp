use crate::agent::adapter::{self, AdapterSettings};
use crate::models::AgentRuntimeKind;

/// Build the command + args for a given agent (pipe-exec mode, not stream session)
pub fn build_agent_command(
    agent: &str,
    prompt: &str,
    settings: &AdapterSettings,
    print: bool,
) -> Result<(String, Vec<String>), String> {
    log::debug!(
        "[spawn] build_agent_command: agent={}, print={}, model={:?}, perm={:?}, allowed={}, disallowed={}",
        agent, print, settings.model, settings.permission_mode, settings.allowed_tools.len(), settings.disallowed_tools.len()
    );
    match agent {
        "claude" => {
            let mut args: Vec<String> = vec![];
            if print {
                args.push("--print".to_string());
            }

            // Use shared helper for all settings flags
            args.extend(adapter::build_settings_args(settings, print));

            if !prompt.is_empty() {
                args.push(prompt.to_string());
            }
            log::debug!("[spawn] claude command: claude {}", args.join(" "));
            Ok(("claude".to_string(), args))
        }
        "mimo" | "mimocode" => {
            let mut args: Vec<String> = vec![
                "run".to_string(),
                "--format".to_string(),
                "json".to_string(),
            ];

            // Model
            if let Some(ref m) = settings.model {
                if !m.is_empty() {
                    args.push("--model".into());
                    args.push(m.clone());
                }
            }

            // Permission mode → MiMo equivalent
            if let Some(ref perm) = settings.permission_mode {
                match perm.as_str() {
                    "bypassPermissions" | "auto" => {
                        args.push("--dangerously-skip-permissions".into());
                    }
                    _ => {}
                }
            }

            if !prompt.is_empty() {
                args.push(prompt.to_string());
            }

            let binary =
                crate::agent::runtime::RuntimeConfig::resolve_binary(&AgentRuntimeKind::MiMoCode);
            log::debug!("[spawn] mimo command: {} {}", binary, args.join(" "));
            Ok((binary, args))
        }
        "codex" => {
            let mut args: Vec<String> = vec![
                "exec".to_string(),
                "--json".to_string(),
                "--skip-git-repo-check".to_string(),
            ];
            if let Some(ref m) = settings.model {
                if !m.is_empty() {
                    args.push("--model".to_string());
                    args.push(m.to_string());
                }
            }
            if !prompt.is_empty() {
                args.push(prompt.to_string());
            }
            log::debug!("[spawn] codex command: codex {}", args.join(" "));
            Ok(("codex".to_string(), args))
        }
        _ => Err(format!(
            "Unsupported agent: {}. Supported: claude, mimo, codex",
            agent
        )),
    }
}

/// Build CLI args for a session-mode spawn (stream-json or similar).
/// Used by session_actor and spawn_cli_process.
pub fn build_session_args(
    runtime_kind: &AgentRuntimeKind,
    settings: &AdapterSettings,
    session_id: Option<&str>,
    is_new: bool,
) -> Result<Vec<String>, String> {
    match runtime_kind {
        AgentRuntimeKind::ClaudeCode => {
            let mut args: Vec<String> = vec![
                "--output-format".into(),
                "stream-json".into(),
                "--input-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--permission-prompt-tool".into(),
                "stdio".into(),
            ];

            // Resume session
            if !is_new {
                if let Some(sid) = session_id {
                    args.push("--resume".into());
                    args.push(sid.into());
                }
            }

            // Settings flags
            args.extend(adapter::build_settings_args(settings, false));
            if settings.include_partial_messages {
                args.push("--include-partial-messages".into());
            }

            Ok(args)
        }
        AgentRuntimeKind::MiMoCode => {
            let mut args: Vec<String> = vec!["run".into(), "--format".into(), "json".into()];

            // Resume session
            if !is_new {
                if let Some(sid) = session_id {
                    args.push("--session".into());
                    args.push(sid.into());
                }
            }

            // Model
            if let Some(ref m) = settings.model {
                if !m.is_empty() {
                    args.push("--model".into());
                    args.push(m.clone());
                }
            }

            // Permission mode
            if let Some(ref perm) = settings.permission_mode {
                match perm.as_str() {
                    "bypassPermissions" | "auto" => {
                        args.push("--dangerously-skip-permissions".into());
                    }
                    _ => {}
                }
            }

            Ok(args)
        }
        AgentRuntimeKind::Codex => {
            // Codex doesn't use session_actor; this path shouldn't be reached.
            Err("Codex does not support session_actor mode".into())
        }
    }
}
