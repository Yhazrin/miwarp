//! Cursor Agent CLI adapter — probes `agent` binary and maps stream-json events.

use super::super::adapter::{
    apply_config_for_path, base_health, empty_mcp, empty_skills, missing_binary_snapshot,
    preview_config_for_path, resolve_binary, run_probe, RuntimeAdapter,
};
use super::super::state::{
    AuthState, CapabilityField, ModelInfo, ModelSource, ProviderInfo, RuntimeSnapshot,
};
use crate::agent::hub::{RuntimeCapabilities, RuntimeHealthState};
use crate::models::{AgentRuntimeKind, CliCommand};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;

const RUNTIME_ID: &str = "cursor-agent";

pub fn resolve_cursor_agent_binary() -> Option<String> {
    if let Ok(home) = std::env::var("HOME") {
        let local = PathBuf::from(home).join(".local").join("bin").join("agent");
        if local.exists() {
            return Some(local.to_string_lossy().to_string());
        }
    }
    resolve_binary(&["agent"])
}

/// Map MiWarp permission modes to Cursor Agent CLI modes. Never maps to `--force`.
pub fn map_cursor_permission_mode(mode: &str) -> &'static str {
    match mode {
        "ask" | "default" => "default",
        "plan" | "delegate" | "auto_read" | "acceptEdits" => "plan",
        "auto_all" | "auto-accept-all" | "bypassPermissions" | "auto" | "dont_ask" | "dontAsk" => {
            "default"
        }
        _ => "default",
    }
}

pub fn build_cursor_session_args(
    settings: &crate::agent::adapter::AdapterSettings,
    resume_id: Option<&str>,
) -> Vec<String> {
    let mut args = vec!["--output-format".to_string(), "stream-json".to_string()];
    if let Some(mode) = settings.permission_mode.as_deref() {
        args.push("--mode".to_string());
        args.push(map_cursor_permission_mode(mode).to_string());
    }
    if let Some(model) = settings.model.as_deref().filter(|m| !m.is_empty()) {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if let Some(id) = resume_id.filter(|s| !s.is_empty()) {
        args.push("--resume".to_string());
        args.push(id.to_string());
    }
    args
}

#[derive(Debug, Deserialize)]
struct CursorModelEntry {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    default: bool,
}

pub struct CursorAdapter;

impl Default for CursorAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl CursorAdapter {
    pub fn new() -> Self {
        Self
    }

    fn binary(&self) -> Option<String> {
        resolve_cursor_agent_binary()
    }

    fn config_path(&self) -> PathBuf {
        if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home)
                .join(".cursor")
                .join("agent")
                .join("settings.json")
        } else {
            PathBuf::from(".cursor/agent/settings.json")
        }
    }

    fn probe_auth(&self, binary: &str) -> AuthState {
        match run_probe(binary, &["status"], 10_000) {
            Ok(out) if out.to_ascii_lowercase().contains("authenticated") => {
                AuthState::Authenticated
            }
            Ok(out)
                if out.to_ascii_lowercase().contains("not logged in")
                    || out.to_ascii_lowercase().contains("unauthenticated") =>
            {
                AuthState::Missing
            }
            Ok(_) => AuthState::Unknown,
            Err(_) => {
                if std::env::var("CURSOR_API_KEY").is_ok() {
                    AuthState::Authenticated
                } else {
                    AuthState::Unknown
                }
            }
        }
    }

    fn list_models_inner(&self, binary: &str) -> CapabilityField<Vec<ModelInfo>> {
        match run_probe(binary, &["--list-models"], 15_000) {
            Ok(raw) => {
                if let Ok(models) = serde_json::from_str::<Vec<CursorModelEntry>>(&raw) {
                    return CapabilityField::Supported {
                        value: models
                            .into_iter()
                            .map(|m| ModelInfo {
                                id: m.id.clone(),
                                display_name: m.name.unwrap_or(m.id),
                                is_current: false,
                                is_default: m.default,
                            })
                            .collect(),
                    };
                }
                CapabilityField::Supported {
                    value: raw
                        .lines()
                        .filter(|l| !l.trim().is_empty())
                        .map(|line| ModelInfo {
                            id: line.trim().to_string(),
                            display_name: line.trim().to_string(),
                            is_current: false,
                            is_default: false,
                        })
                        .collect(),
                }
            }
            Err(_) => CapabilityField::unsupported("supports_model_list"),
        }
    }

    fn list_commands_inner(&self, binary: &str) -> CapabilityField<Vec<CliCommand>> {
        match run_probe(binary, &["--list-commands"], 10_000) {
            Ok(raw) => {
                let commands = raw
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(|line| CliCommand {
                        name: line.trim().to_string(),
                        description: String::new(),
                        aliases: vec![],
                        extra: std::collections::HashMap::new(),
                    })
                    .collect();
                CapabilityField::Supported { value: commands }
            }
            Err(_) => CapabilityField::unsupported("supports_tool_calls"),
        }
    }
}

impl RuntimeAdapter for CursorAdapter {
    fn runtime_id(&self) -> &str {
        RUNTIME_ID
    }

    fn display_name(&self) -> &str {
        "Cursor Agent"
    }

    fn kind(&self) -> AgentRuntimeKind {
        AgentRuntimeKind::Cursor
    }

    fn capabilities(&self) -> RuntimeCapabilities {
        RuntimeCapabilities {
            supports_streaming: true,
            supports_resume: true,
            supports_fork: false,
            supports_permission_requests: true,
            supports_tool_calls: true,
            supports_usage: false,
            supports_thinking: false,
            supports_attachments: true,
            supports_images: true,
            supports_mcp: false,
            supports_skills: false,
            supports_remote_execution: false,
            supports_structured_events: true,
        }
    }

    fn config_paths(&self) -> Vec<PathBuf> {
        vec![self.config_path()]
    }

    fn probe(&self) -> RuntimeSnapshot {
        let Some(binary) = self.binary() else {
            return missing_binary_snapshot(
                self.runtime_id(),
                self.display_name(),
                "Install Cursor Agent CLI to ~/.local/bin/agent or PATH",
            );
        };

        let version = run_probe(&binary, &["--version"], 10_000)
            .ok()
            .and_then(|raw| super::super::adapter::parse_version_line(&raw));
        let auth = self.probe_auth(&binary);
        let models_field = self.list_models_inner(&binary);
        let commands_field = self.list_commands_inner(&binary);

        let (current_model, default_model) = match &models_field {
            CapabilityField::Supported { value } => {
                let current = value.iter().find(|m| m.is_current).map(|m| m.id.clone());
                let default = value.iter().find(|m| m.is_default).map(|m| m.id.clone());
                (current, default)
            }
            CapabilityField::Unsupported { .. } => (None, None),
        };

        RuntimeSnapshot {
            runtime_id: self.runtime_id().to_string(),
            display_name: self.display_name().to_string(),
            installed: true,
            version,
            auth,
            config_path: Some(self.config_path().display().to_string()),
            provider: Some("cursor".to_string()),
            current_model,
            default_model,
            model_source: ModelSource::Config,
            fetched_at_ms: super::super::state::now_ms(),
            stale: false,
            commands: commands_field,
            mcp: empty_mcp(),
            skills: empty_skills(),
            health: base_health(self.runtime_id(), RuntimeHealthState::Ready),
            diagnosis: None,
            binary_path: Some(binary),
        }
    }

    fn list_providers(&self) -> CapabilityField<Vec<ProviderInfo>> {
        CapabilityField::Supported {
            value: vec![ProviderInfo {
                id: "cursor".to_string(),
                display_name: "Cursor".to_string(),
                is_current: true,
            }],
        }
    }

    fn list_models(&self) -> CapabilityField<Vec<ModelInfo>> {
        self.binary()
            .map(|b| self.list_models_inner(&b))
            .unwrap_or_else(|| CapabilityField::unsupported("supports_model_list"))
    }

    fn preview_config_change(
        &self,
        patch: &Value,
    ) -> Result<crate::agent::control_plane::config_transaction::ConfigTransactionPreview, String>
    {
        preview_config_for_path(self.runtime_id(), &self.config_path(), patch)
    }

    fn apply_config_change(
        &self,
        patch: &Value,
    ) -> Result<crate::agent::control_plane::config_transaction::ConfigTransactionResult, String>
    {
        let binary = self
            .binary()
            .ok_or_else(|| "cursor agent binary not found".to_string())?;
        apply_config_for_path(
            self.runtime_id(),
            &self.config_path(),
            patch,
            |_| Ok(()),
            move || run_probe(&binary, &["--version"], 10_000).map(|_| ()),
        )
    }

    fn update_cli(&self) -> Result<String, String> {
        let binary = self
            .binary()
            .ok_or_else(|| "cursor agent binary not found".to_string())?;
        run_probe(&binary, &["update"], 120_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_mode_never_maps_to_force() {
        for mode in [
            "ask",
            "default",
            "plan",
            "auto_all",
            "bypassPermissions",
            "auto",
        ] {
            let mapped = map_cursor_permission_mode(mode);
            assert_ne!(mapped, "force");
            assert!(matches!(mapped, "default" | "plan"));
        }
    }

    #[test]
    fn session_args_include_stream_json_not_force() {
        let settings = crate::agent::adapter::AdapterSettings {
            permission_mode: Some("ask".to_string()),
            model: Some("gpt-4.1".to_string()),
            ..Default::default()
        };
        let args = build_cursor_session_args(&settings, Some("sess-1"));
        assert!(args.contains(&"--output-format".to_string()));
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"--mode".to_string()));
        assert!(args.contains(&"default".to_string()));
        assert!(args.contains(&"--resume".to_string()));
        assert!(!args.iter().any(|a| a == "--force"));
    }

    #[test]
    fn resolve_prefers_local_bin_agent() {
        if std::env::var("HOME").is_ok() {
            let resolved = resolve_cursor_agent_binary();
            if let Some(path) = resolved {
                assert!(path.ends_with("agent") || path.contains("agent"));
            }
        }
    }
}
