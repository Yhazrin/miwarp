use super::super::adapter::{
    base_health, empty_commands, missing_binary_snapshot, resolve_binary, run_probe, RuntimeAdapter,
};
use super::super::state::{
    AuthState, CapabilityField, ModelInfo, ModelSource, ProviderInfo, RuntimeSnapshot,
};
use crate::agent::hub::{RuntimeCapabilities, RuntimeHealthState};
use crate::models::AgentRuntimeKind;

pub struct OpenCodeAdapter;

impl Default for OpenCodeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenCodeAdapter {
    pub fn new() -> Self {
        Self
    }

    fn binary(&self) -> Option<String> {
        resolve_binary(&["opencode"])
    }
}

impl RuntimeAdapter for OpenCodeAdapter {
    fn runtime_id(&self) -> &str {
        "opencode"
    }

    fn display_name(&self) -> &str {
        "OpenCode"
    }

    fn kind(&self) -> AgentRuntimeKind {
        AgentRuntimeKind::OpenCode
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
            supports_attachments: false,
            supports_images: false,
            supports_mcp: false,
            supports_skills: false,
            supports_remote_execution: false,
            supports_structured_events: true,
        }
    }

    fn config_paths(&self) -> Vec<std::path::PathBuf> {
        if let Ok(home) = std::env::var("HOME") {
            vec![std::path::PathBuf::from(home)
                .join(".config")
                .join("opencode")
                .join("config.json")]
        } else {
            vec![]
        }
    }

    fn probe(&self) -> RuntimeSnapshot {
        let Some(binary) = self.binary() else {
            return missing_binary_snapshot(
                self.runtime_id(),
                self.display_name(),
                "Install OpenCode CLI",
            );
        };
        let version = run_probe(&binary, &["--version"], 10_000)
            .ok()
            .and_then(|raw| super::super::adapter::parse_version_line(&raw));

        RuntimeSnapshot {
            runtime_id: self.runtime_id().to_string(),
            display_name: self.display_name().to_string(),
            installed: true,
            version,
            auth: AuthState::Unknown,
            config_path: self.config_paths().first().map(|p| p.display().to_string()),
            provider: None,
            current_model: None,
            default_model: None,
            model_source: ModelSource::Unknown,
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
        CapabilityField::unsupported("supports_provider_list")
    }

    fn list_models(&self) -> CapabilityField<Vec<ModelInfo>> {
        CapabilityField::unsupported("supports_model_list")
    }

    fn preview_config_change(
        &self,
        _patch: &serde_json::Value,
    ) -> Result<crate::agent::control_plane::config_transaction::ConfigTransactionPreview, String>
    {
        Err("OpenCode config transactions are not supported yet".to_string())
    }

    fn apply_config_change(
        &self,
        _patch: &serde_json::Value,
    ) -> Result<crate::agent::control_plane::config_transaction::ConfigTransactionResult, String>
    {
        Err("OpenCode config transactions are not supported yet".to_string())
    }
}
