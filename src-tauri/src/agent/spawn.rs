use crate::agent::adapter::{self, AdapterSettings};
use crate::models::AgentRuntimeKind;

/// Build the command + args for a given agent (pipe-exec mode, not stream session)
pub fn build_agent_command(
    agent: &str,
    prompt: &str,
    settings: &AdapterSettings,
    print: bool,
    conversation_id: Option<&str>,
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

            if let Some(ref m) = settings.model {
                if !m.is_empty() {
                    args.push("--model".into());
                    args.push(m.clone());
                }
            }

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
        "opencode" => {
            let mut args: Vec<String> = vec![
                "run".to_string(),
                "--format".to_string(),
                "json".to_string(),
            ];
            if let Some(ref m) = settings.model {
                if !m.is_empty() {
                    args.push("--model".to_string());
                    args.push(m.clone());
                }
            }
            if matches!(
                settings.permission_mode.as_deref(),
                Some("bypassPermissions" | "auto")
            ) {
                args.push("--dangerously-skip-permissions".to_string());
            }
            if let Some(session_id) = conversation_id.filter(|id| !id.is_empty()) {
                args.push("--session".to_string());
                args.push(session_id.to_string());
            }
            if !prompt.is_empty() {
                args.push(prompt.to_string());
            }
            log::debug!("[spawn] opencode command: opencode {}", args.join(" "));
            Ok(("opencode".to_string(), args))
        }
        _ => Err(format!(
            "Unsupported agent: {}. Supported: claude, mimo, codex, opencode, cursor",
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

            if !is_new {
                if let Some(sid) = session_id {
                    args.push("--resume".into());
                    args.push(sid.into());
                }
            }

            args.extend(adapter::build_settings_args(settings, false));
            if settings.include_partial_messages {
                args.push("--include-partial-messages".into());
            }

            Ok(args)
        }
        AgentRuntimeKind::MiMoCode => {
            let mut args: Vec<String> = vec!["run".into(), "--format".into(), "json".into()];

            if !is_new {
                if let Some(sid) = session_id {
                    args.push("--session".into());
                    args.push(sid.into());
                }
            }

            if let Some(ref m) = settings.model {
                if !m.is_empty() {
                    args.push("--model".into());
                    args.push(m.clone());
                }
            }

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
        AgentRuntimeKind::Codex | AgentRuntimeKind::OpenCode => Err(format!(
            "{} does not support session_actor mode",
            runtime_kind
        )),
        AgentRuntimeKind::Cursor => Ok(
            crate::agent::control_plane::adapters::cursor::build_cursor_session_args(
                settings,
                if is_new { None } else { session_id },
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_new_turn_builds_json_command() {
        let settings = AdapterSettings {
            model: Some("anthropic/claude-sonnet-4".to_string()),
            permission_mode: Some("auto".to_string()),
            ..Default::default()
        };

        let (command, args) =
            build_agent_command("opencode", "hello", &settings, true, None).unwrap();

        assert_eq!(command, "opencode");
        assert_eq!(
            args,
            vec![
                "run",
                "--format",
                "json",
                "--model",
                "anthropic/claude-sonnet-4",
                "--dangerously-skip-permissions",
                "hello",
            ]
        );
    }

    #[test]
    fn opencode_resume_uses_persisted_session() {
        let settings = AdapterSettings::default();
        let (_, args) =
            build_agent_command("opencode", "continue", &settings, true, Some("ses_123")).unwrap();

        assert_eq!(
            args,
            vec![
                "run",
                "--format",
                "json",
                "--session",
                "ses_123",
                "continue"
            ]
        );
    }

    #[test]
    fn opencode_is_rejected_from_session_actor_path() {
        let error = build_session_args(
            &AgentRuntimeKind::OpenCode,
            &AdapterSettings::default(),
            None,
            true,
        )
        .unwrap_err();
        assert!(error.contains("does not support session_actor"));
    }
}
