use crate::storage;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const PRODUCT_BOOTSTRAP_VERSION: u32 = 1;

const MANIFEST_JSON: &str = include_str!("../../../src/lib/skills/builtin/manifest.json");
const APPEND_SYSTEM_PROMPT: &str =
    include_str!("../../../src/lib/skills/builtin/miwarp-append-system-prompt.txt");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProductBootstrapStatus {
    pub version: u32,
    pub target_version: u32,
    pub skills_installed: Vec<String>,
    pub append_prompt_applied: bool,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
struct ProductBootstrapState {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    skills_installed: Vec<String>,
    #[serde(default)]
    append_prompt_applied: bool,
    #[serde(default)]
    completed_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestSkill {
    name: String,
    description: String,
}

#[derive(Debug, Clone, Deserialize)]
struct BuiltinManifest {
    version: u32,
    skills: Vec<ManifestSkill>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapRunResult {
    pub skills_installed: Vec<String>,
    pub append_prompt_applied: bool,
    pub skipped: bool,
}

fn manifest() -> Result<BuiltinManifest, String> {
    serde_json::from_str(MANIFEST_JSON).map_err(|e| format!("Invalid builtin manifest: {e}"))
}

/// Names of every skill shipped by MiWarp itself (parsed from the embedded
/// builtin manifest). Used by the `get_skill_summary` IPC to distinguish
/// shipped skills from user-installed ones without round-tripping the full
/// skill list to the frontend.
pub fn builtin_skill_names() -> Vec<String> {
    manifest()
        .map(|m| m.skills.into_iter().map(|s| s.name).collect())
        .unwrap_or_default()
}

fn state_path() -> PathBuf {
    storage::data_dir().join("product-bootstrap.json")
}

fn load_state_at(path: &Path) -> ProductBootstrapState {
    if !path.exists() {
        return ProductBootstrapState::default();
    }
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(e) => {
            log::warn!("[product_bootstrap] failed to read {}: {e}", path.display());
            ProductBootstrapState::default()
        }
    }
}

fn save_state_at(path: &Path, state: &ProductBootstrapState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create data dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| format!("Serialize failed: {e}"))?;
    storage::durable_io::write_atomic(path, json.as_bytes())
}

fn skill_content(name: &str) -> Option<&'static str> {
    match name {
        "schedule" => Some(include_str!("../../../src/lib/skills/builtin/schedule.md")),
        "consolidate-memory" => Some(include_str!(
            "../../../src/lib/skills/builtin/consolidate-memory.md"
        )),
        "setup-cowork" => Some(include_str!(
            "../../../src/lib/skills/builtin/setup-cowork.md"
        )),
        "visualize-data" => Some(include_str!(
            "../../../src/lib/skills/builtin/visualize-data.md"
        )),
        "mind-map" => Some(include_str!("../../../src/lib/skills/builtin/mind-map.md")),
        "architecture-diagram" => Some(include_str!(
            "../../../src/lib/skills/builtin/architecture-diagram.md"
        )),
        "project-status-dashboard" => Some(include_str!(
            "../../../src/lib/skills/builtin/project-status-dashboard.md"
        )),
        "decision-map" => Some(include_str!(
            "../../../src/lib/skills/builtin/decision-map.md"
        )),
        _ => None,
    }
}

fn seed_skills(
    manifest: &BuiltinManifest,
    state: &ProductBootstrapState,
) -> Result<Vec<String>, String> {
    let mut installed = Vec::new();
    for skill in &manifest.skills {
        if state.skills_installed.contains(&skill.name) {
            continue;
        }
        let base_dir = storage::plugins::resolve_skill_dir("user", "")?;
        let skill_dir = base_dir.join(&skill.name);
        if skill_dir.exists() {
            continue;
        }
        let content = skill_content(&skill.name)
            .ok_or_else(|| format!("Missing built-in skill content for '{}'", skill.name))?;
        storage::plugins::create_skill(&skill.name, &skill.description, content, "user", "")?;
        installed.push(skill.name.clone());
        log::info!(
            "[product_bootstrap] installed built-in skill '{}'",
            skill.name
        );
    }
    Ok(installed)
}

fn apply_default_append_prompt(state: &ProductBootstrapState) -> Result<bool, String> {
    if state.append_prompt_applied {
        return Ok(false);
    }

    let mut all = storage::settings::load();
    let changed = apply_default_append_prompt_to_settings(&mut all);
    if changed {
        storage::settings::save(&all).map_err(|e| format!("Failed to save settings: {e}"))?;
        log::info!("[product_bootstrap] applied default append_system_prompt for claude agent");
    }
    Ok(changed)
}

fn apply_default_append_prompt_to_settings(all: &mut crate::models::AllSettings) -> bool {
    let claude = all
        .agents
        .entry("claude".to_string())
        .or_insert_with(|| crate::models::AgentSettings::default_for("claude"));

    if claude.system_prompt.is_some() {
        return false;
    }
    if claude
        .append_system_prompt
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return false;
    }

    let prompt = APPEND_SYSTEM_PROMPT.trim();
    if prompt.is_empty() {
        return false;
    }

    claude.append_system_prompt = Some(prompt.to_string());
    claude.updated_at = crate::models::now_iso();
    true
}

pub fn get_status() -> Result<ProductBootstrapStatus, String> {
    let manifest = manifest()?;
    let state = load_state_at(&state_path());
    Ok(ProductBootstrapStatus {
        version: state.version,
        target_version: manifest.version.max(PRODUCT_BOOTSTRAP_VERSION),
        skills_installed: state.skills_installed,
        append_prompt_applied: state.append_prompt_applied,
        completed_at: state.completed_at,
    })
}

pub fn run_if_needed() -> Result<BootstrapRunResult, String> {
    run_bootstrap_at(&state_path(), false)
}

pub fn run_force() -> Result<BootstrapRunResult, String> {
    run_bootstrap_at(&state_path(), true)
}

fn run_bootstrap_at(state_path: &Path, force_skills: bool) -> Result<BootstrapRunResult, String> {
    let manifest = manifest()?;
    let target_version = manifest.version.max(PRODUCT_BOOTSTRAP_VERSION);
    let mut state = load_state_at(state_path);

    if !force_skills && state.version >= target_version {
        return Ok(BootstrapRunResult {
            skipped: true,
            ..Default::default()
        });
    }

    let mut result = BootstrapRunResult {
        skipped: false,
        ..Default::default()
    };

    if force_skills {
        state.skills_installed.clear();
    }

    result.skills_installed = seed_skills(&manifest, &state)?;
    result.append_prompt_applied = apply_default_append_prompt(&state)?;

    for name in &result.skills_installed {
        if !state.skills_installed.contains(name) {
            state.skills_installed.push(name.clone());
        }
    }
    if result.append_prompt_applied {
        state.append_prompt_applied = true;
    }
    state.version = target_version;
    state.completed_at = Some(crate::models::now_iso());
    save_state_at(state_path, &state)?;

    if !result.skills_installed.is_empty() || result.append_prompt_applied {
        log::info!(
            "[product_bootstrap] completed v{} (skills={}, append_prompt={})",
            target_version,
            result.skills_installed.len(),
            result.append_prompt_applied
        );
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_lists_all_builtin_skills_with_content() {
        let manifest = manifest().expect("manifest");
        assert_eq!(manifest.version, PRODUCT_BOOTSTRAP_VERSION);
        assert_eq!(manifest.skills.len(), 8);
        for skill in &manifest.skills {
            let content = skill_content(&skill.name).unwrap_or_else(|| {
                panic!("missing built-in content for '{}'", skill.name);
            });
            assert!(content.contains(&format!("name: {}", skill.name)));
        }
    }

    #[test]
    fn apply_default_append_prompt_skips_custom_prompt() {
        let mut settings = crate::models::AllSettings::default();
        settings
            .agents
            .get_mut("claude")
            .expect("claude agent")
            .append_system_prompt = Some("custom prompt".to_string());
        assert!(!apply_default_append_prompt_to_settings(&mut settings));
    }

    #[test]
    fn apply_default_append_prompt_sets_miwarp_style_once() {
        let mut settings = crate::models::AllSettings::default();
        assert!(apply_default_append_prompt_to_settings(&mut settings));
        let claude = settings.agents.get("claude").expect("claude agent");
        assert!(claude
            .append_system_prompt
            .as_ref()
            .is_some_and(|p| p.contains("MiWarp")));
        assert!(!apply_default_append_prompt_to_settings(&mut settings));
    }

    #[test]
    fn bootstrap_state_file_round_trips() {
        let temp = tempfile::tempdir().expect("tempdir");
        let state_path = temp.path().join("product-bootstrap.json");
        let state = ProductBootstrapState {
            version: PRODUCT_BOOTSTRAP_VERSION,
            skills_installed: vec!["mind-map".to_string()],
            append_prompt_applied: true,
            completed_at: Some("2026-06-25T00:00:00Z".to_string()),
        };
        save_state_at(&state_path, &state).expect("save state");
        let loaded = load_state_at(&state_path);
        assert_eq!(loaded, state);
    }
}
