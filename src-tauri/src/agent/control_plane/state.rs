//! Runtime snapshot types for the control plane wire format.

use crate::agent::hub::{RuntimeDiagnosis, RuntimeHealth};
use crate::models::{CliCommand, McpServerInfo};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelSource {
    Config,
    Env,
    ProviderDefault,
    SessionOverride,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthState {
    Unknown,
    Authenticated,
    Missing,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSkillInfo {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CapabilityField<T> {
    Supported { value: T },
    Unsupported { capability: String },
}

impl<T> CapabilityField<T> {
    pub fn unsupported(capability: &'static str) -> Self {
        Self::Unsupported {
            capability: capability.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub runtime_id: String,
    pub display_name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub auth: AuthState,
    pub config_path: Option<String>,
    pub provider: Option<String>,
    pub current_model: Option<String>,
    pub default_model: Option<String>,
    pub model_source: ModelSource,
    pub fetched_at_ms: u64,
    pub stale: bool,
    pub commands: CapabilityField<Vec<CliCommand>>,
    pub mcp: CapabilityField<Vec<McpServerInfo>>,
    pub skills: CapabilityField<Vec<RuntimeSkillInfo>>,
    pub health: RuntimeHealth,
    pub diagnosis: Option<RuntimeDiagnosis>,
    pub binary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub display_name: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub is_current: bool,
    pub is_default: bool,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
