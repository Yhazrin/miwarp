use super::super::adapter::{base_health, empty_commands, missing_binary_snapshot, RuntimeAdapter};
use super::super::state::{
    AuthState, CapabilityField, ModelInfo, ModelSource, ProviderInfo, RuntimeSnapshot,
};
use crate::agent::hub::{RuntimeCapabilities, RuntimeHealthState};
use crate::agent::runtime::{detect_mimo_version, resolve_mimo_binary};
use crate::models::AgentRuntimeKind;

pub struct MimoAdapter;

impl Default for MimoAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl MimoAdapter {
    pub fn new() -> Self {
        Self
    }

    fn binary(&self) -> String {
        resolve_mimo_binary()
    }
}

impl RuntimeAdapter for MimoAdapter {
    fn runtime_id(&self) -> &str {
        "mimo-code"
    }

    fn display_name(&self) -> &str {
        "MiMo Code"
    }

    fn kind(&self) -> AgentRuntimeKind {
        AgentRuntimeKind::MiMoCode
    }

    fn capabilities(&self) -> RuntimeCapabilities {
        RuntimeCapabilities {
            supports_streaming: true,
            supports_resume: true,
            supports_fork: false,
            supports_permission_requests: true,
            supports_tool_calls: true,
            supports_usage: true,
            supports_thinking: false,
            supports_attachments: true,
            supports_images: true,
            supports_mcp: true,
            supports_skills: true,
            supports_remote_execution: false,
            supports_structured_events: true,
        }
    }

    fn config_paths(&self) -> Vec<std::path::PathBuf> {
        if let Ok(home) = std::env::var("HOME") {
            vec![std::path::PathBuf::from(home)
                .join(".mimocode")
                .join("settings.json")]
        } else {
            vec![]
        }
    }

    fn probe(&self) -> RuntimeSnapshot {
        let binary = self.binary();
        let installed = detect_mimo_version(&binary).is_some();
        if !installed {
            return missing_binary_snapshot(
                self.runtime_id(),
                self.display_name(),
                "Install MiMo CLI to ~/.mimocode/bin/mimo or PATH",
            );
        }
        let version = detect_mimo_version(&binary);
        RuntimeSnapshot {
            runtime_id: self.runtime_id().to_string(),
            display_name: self.display_name().to_string(),
            installed: true,
            version,
            auth: AuthState::Unknown,
            config_path: self.config_paths().first().map(|p| p.display().to_string()),
            provider: Some("mimo".to_string()),
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
        CapabilityField::Supported {
            value: vec![ProviderInfo {
                id: "mimo".to_string(),
                display_name: "MiMo".to_string(),
                is_current: true,
            }],
        }
    }

    fn list_models(&self) -> CapabilityField<Vec<ModelInfo>> {
        CapabilityField::unsupported("supports_model_list")
    }

    fn preview_config_change(
        &self,
        _patch: &serde_json::Value,
    ) -> Result<crate::agent::control_plane::config_transaction::ConfigTransactionPreview, String>
    {
        Err("MiMo config transactions are not supported yet".to_string())
    }

    fn apply_config_change(
        &self,
        _patch: &serde_json::Value,
    ) -> Result<crate::agent::control_plane::config_transaction::ConfigTransactionResult, String>
    {
        Err("MiMo config transactions are not supported yet".to_string())
    }
}
