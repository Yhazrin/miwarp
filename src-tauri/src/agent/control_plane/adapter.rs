//! RuntimeAdapter trait — unified probe surface for all CLI runtimes.

use crate::agent::control_plane::config_transaction::{
    apply_transaction, preview_transaction, ConfigTransactionPreview, ConfigTransactionResult,
};
use crate::agent::control_plane::state::{
    AuthState, CapabilityField, ModelInfo, ModelSource, ProviderInfo, RuntimeSkillInfo,
    RuntimeSnapshot,
};
use crate::agent::hub::{
    RuntimeCapabilities, RuntimeDiagnosis, RuntimeHealth, RuntimeHealthState, RuntimeHubError,
};
use crate::models::{AgentRuntimeKind, CliCommand, McpServerInfo};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub trait RuntimeAdapter: Send + Sync {
    fn runtime_id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn kind(&self) -> AgentRuntimeKind;
    fn capabilities(&self) -> RuntimeCapabilities;
    fn config_paths(&self) -> Vec<PathBuf>;
    fn probe(&self) -> RuntimeSnapshot;
    fn list_providers(&self) -> CapabilityField<Vec<ProviderInfo>>;
    fn list_models(&self) -> CapabilityField<Vec<ModelInfo>>;
    fn preview_config_change(&self, patch: &Value) -> Result<ConfigTransactionPreview, String>;
    fn apply_config_change(&self, patch: &Value) -> Result<ConfigTransactionResult, String>;
    fn update_cli(&self) -> Result<String, String> {
        Err(format!("update unsupported for {}", self.runtime_id()))
    }
}

pub fn resolve_binary(candidates: &[&str]) -> Option<String> {
    for name in candidates {
        if let Some(path) = crate::agent::claude_stream::which_binary(name) {
            return Some(path);
        }
    }
    None
}

pub fn run_probe(binary: &str, args: &[&str], timeout_ms: u64) -> Result<String, String> {
    let aug_path = crate::agent::claude_stream::augmented_path();
    let output = std::process::Command::new(binary)
        .args(args)
        .env("PATH", &aug_path)
        .output()
        .map_err(|e| format!("spawn {}: {}", binary, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{} {:?} failed: {}", binary, args, stderr.trim()));
    }
    let _ = timeout_ms;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn parse_version_line(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(
        trimmed
            .find(' ')
            .map(|i| trimmed[..i].to_string())
            .unwrap_or_else(|| trimmed.to_string()),
    )
}

pub fn base_health(runtime_id: &str, state: RuntimeHealthState) -> RuntimeHealth {
    RuntimeHealth {
        runtime_id: runtime_id.to_string(),
        state,
        last_diagnosis: None,
        last_healthy_at_ms: None,
        consecutive_failures: 0,
        connection_generation: 0,
        last_error: None,
    }
}

pub fn missing_binary_snapshot(
    runtime_id: &str,
    display_name: &str,
    hint: &str,
) -> RuntimeSnapshot {
    RuntimeSnapshot {
        runtime_id: runtime_id.to_string(),
        display_name: display_name.to_string(),
        installed: false,
        version: None,
        auth: AuthState::Unknown,
        config_path: None,
        provider: None,
        current_model: None,
        default_model: None,
        model_source: ModelSource::Unknown,
        fetched_at_ms: super::state::now_ms(),
        stale: false,
        commands: CapabilityField::unsupported("supports_tool_calls"),
        mcp: CapabilityField::unsupported("supports_mcp"),
        skills: CapabilityField::unsupported("supports_skills"),
        health: RuntimeHealth {
            runtime_id: runtime_id.to_string(),
            state: RuntimeHealthState::Unrecoverable,
            last_diagnosis: Some(RuntimeDiagnosis {
                category: crate::agent::hub::DiagnosisCategory::BinaryNotFound,
                severity: crate::agent::hub::DiagnosisSeverity::Error,
                title_key: "runtime_diagnosis_binary_not_found_title".to_string(),
                body_key: "runtime_diagnosis_binary_not_found_body".to_string(),
                fix_action: Some(crate::agent::hub::FixAction::InstallGuide),
                retryable: true,
            }),
            last_healthy_at_ms: None,
            consecutive_failures: 1,
            connection_generation: 0,
            last_error: Some(RuntimeHubError::BinaryNotFound {
                runtime_id: runtime_id.to_string(),
                hint: hint.to_string(),
            }),
        },
        diagnosis: None,
        binary_path: None,
    }
}

pub fn apply_config_for_path<F, P>(
    runtime_id: &str,
    config_path: &Path,
    patch: &Value,
    validate: F,
    probe: P,
) -> Result<ConfigTransactionResult, String>
where
    F: FnOnce(&Value) -> Result<(), String>,
    P: FnOnce() -> Result<(), String>,
{
    apply_transaction(runtime_id, config_path, patch, validate, probe)
}

pub fn preview_config_for_path(
    runtime_id: &str,
    config_path: &Path,
    patch: &Value,
) -> Result<ConfigTransactionPreview, String> {
    preview_transaction(runtime_id, config_path, patch)
}

pub fn empty_commands() -> CapabilityField<Vec<CliCommand>> {
    CapabilityField::Supported { value: vec![] }
}

pub fn empty_mcp() -> CapabilityField<Vec<McpServerInfo>> {
    CapabilityField::Supported { value: vec![] }
}

pub fn empty_skills() -> CapabilityField<Vec<RuntimeSkillInfo>> {
    CapabilityField::Supported { value: vec![] }
}
