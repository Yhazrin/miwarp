use super::super::adapter::{
    apply_config_for_path, base_health, empty_commands, missing_binary_snapshot,
    preview_config_for_path, resolve_binary, run_probe, RuntimeAdapter,
};
use super::super::state::{
    AuthState, CapabilityField, ModelInfo, ModelSource, ProviderInfo, RuntimeSnapshot,
};
use crate::agent::hub::{RuntimeCapabilities, RuntimeHealthState};
use crate::models::AgentRuntimeKind;
use crate::storage::teams::claude_home_dir;
use serde_json::Value;
use std::path::PathBuf;

pub struct ClaudeAdapter;

impl Default for ClaudeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeAdapter {
    pub fn new() -> Self {
        Self
    }

    fn binary(&self) -> Option<String> {
        resolve_binary(&["claude"])
    }

    fn config_path(&self) -> PathBuf {
        claude_home_dir().join("settings.json")
    }
}

impl RuntimeAdapter for ClaudeAdapter {
    fn runtime_id(&self) -> &str {
        "claude-code"
    }

    fn display_name(&self) -> &str {
        "Claude Code"
    }

    fn kind(&self) -> AgentRuntimeKind {
        AgentRuntimeKind::ClaudeCode
    }

    fn capabilities(&self) -> RuntimeCapabilities {
        RuntimeCapabilities {
            supports_streaming: true,
            supports_resume: true,
            supports_fork: true,
            supports_permission_requests: true,
            supports_tool_calls: true,
            supports_usage: true,
            supports_thinking: true,
            supports_attachments: true,
            supports_images: true,
            supports_mcp: true,
            supports_skills: true,
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
                "Install Claude Code: npm install -g @anthropic-ai/claude-code",
            );
        };
        let version = run_probe(&binary, &["--version"], 10_000)
            .ok()
            .and_then(|raw| super::super::adapter::parse_version_line(&raw));

        let config_path = self.config_path();
        let config: Value = crate::storage::cli_config::load_cli_config();
        let current_model = config
            .get("model")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let auth = if std::env::var("ANTHROPIC_API_KEY").is_ok()
            || config.get("apiKey").and_then(|v| v.as_str()).is_some()
        {
            AuthState::Authenticated
        } else {
            AuthState::Missing
        };

        RuntimeSnapshot {
            runtime_id: self.runtime_id().to_string(),
            display_name: self.display_name().to_string(),
            installed: true,
            version,
            auth,
            config_path: Some(config_path.display().to_string()),
            provider: Some("anthropic-direct".to_string()),
            current_model: current_model.clone(),
            default_model: current_model,
            model_source: ModelSource::Config,
            fetched_at_ms: super::super::state::now_ms(),
            stale: false,
            commands: empty_commands(),
            mcp: CapabilityField::unsupported("supports_mcp"),
            skills: CapabilityField::unsupported("supports_skills"),
            health: base_health(self.runtime_id(), RuntimeHealthState::Ready),
            diagnosis: None,
            binary_path: Some(binary),
        }
    }

    fn list_providers(&self) -> CapabilityField<Vec<ProviderInfo>> {
        CapabilityField::Supported {
            value: vec![ProviderInfo {
                id: "anthropic-direct".to_string(),
                display_name: "Anthropic Direct".to_string(),
                is_current: true,
            }],
        }
    }

    fn list_models(&self) -> CapabilityField<Vec<ModelInfo>> {
        CapabilityField::Supported { value: vec![] }
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
            .ok_or_else(|| "claude binary not found".to_string())?;
        apply_config_for_path(
            self.runtime_id(),
            &self.config_path(),
            patch,
            |_| Ok(()),
            move || run_probe(&binary, &["--version"], 10_000).map(|_| ()),
        )
    }

    fn update_cli(&self) -> Result<String, String> {
        Ok("Use diagnostics update_claude_cli".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_capabilities_complete() {
        let adapter = ClaudeAdapter::new();
        assert!(adapter.capabilities().supports_streaming);
        assert!(adapter.capabilities().supports_permission_requests);
    }
}
