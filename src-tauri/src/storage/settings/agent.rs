use crate::models::{
    normalize_session_island_alignment, normalize_workspace_folder_sort_order, AgentSettings,
    AllSettings, UserSettings,
};
use std::fs;
use std::path::{Path, PathBuf};

fn settings_path() -> PathBuf {
    super::data_dir().join("settings.json")
}

/// Back up a corrupt settings file to `settings.json.corrupt.<timestamp>`.
/// Returns the backup path on success so the caller can log it.
fn backup_corrupt_file(path: &Path) -> Option<PathBuf> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let backup = path.with_extension(format!("json.corrupt.{ts}"));
    match fs::rename(path, &backup) {
        Ok(()) => {
            log::warn!(
                "[storage/settings] corrupt file backed up to {}",
                backup.display()
            );
            Some(backup)
        }
        Err(e) => {
            log::error!(
                "[storage/settings] failed to back up corrupt file {}: {}",
                path.display(),
                e
            );
            None
        }
    }
}

fn load_from_path(path: &Path) -> AllSettings {
    match fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<AllSettings>(&content) {
            Ok(mut settings) => {
                log::debug!("[storage/settings] loaded settings from {}", path.display());
                // Run one-time migrations on platform credentials
                if migrate_platform_credentials(&mut settings) {
                    log::info!("[storage/settings] migrated platform credentials, saving");
                    let _ = save_to_path(&settings, path);
                }
                if migrate_session_island_alignment(&mut settings) {
                    log::info!("[storage/settings] normalized session_island_alignment, saving");
                    let _ = save_to_path(&settings, path);
                }
                settings
            }
            Err(e) => {
                log::warn!(
                    "[storage/settings] failed to parse settings: {}; using defaults (original preserved)",
                    e
                );
                backup_corrupt_file(path);
                AllSettings::default()
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log::debug!("[storage/settings] settings file not found, using defaults");
            AllSettings::default()
        }
        Err(e) => {
            // IO error (permission denied, file locked, etc.) — do NOT overwrite
            // the existing file with defaults. Return defaults for in-memory use
            // only; the next explicit save() call will persist them atomically.
            log::warn!(
                "[storage/settings] failed to read settings: {}; using defaults (file preserved)",
                e
            );
            AllSettings::default()
        }
    }
}

fn save_to_path(settings: &AllSettings, path: &Path) -> Result<(), String> {
    log::debug!("[storage/settings] saving settings");
    super::durable_io::write_json_atomic(path, settings)
}


pub fn get_agent_settings(agent: &str) -> AgentSettings {
    log::debug!("[storage/settings] get_agent_settings: agent={}", agent);
    let all = load();
    all.agents
        .get(agent)
        .cloned()
        .unwrap_or_else(|| AgentSettings::default_for(agent))
}

/// Apply a JSON patch to AgentSettings (pure function, no I/O).
fn apply_agent_patch(settings: &mut AgentSettings, patch: &serde_json::Value) {
    if let Some(model) = patch.get("model") {
        settings.model = model.as_str().map(|s| s.to_string());
    }
    if let Some(tools) = patch.get("allowed_tools").and_then(|v| v.as_array()) {
        settings.allowed_tools = tools
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(wd) = patch.get("working_directory") {
        settings.working_directory = wd.as_str().map(|s| s.to_string());
    }
    if let Some(v) = patch.get("plan_mode") {
        settings.plan_mode = if v.is_null() { None } else { v.as_bool() };
    }
    if let Some(v) = patch.get("disallowed_tools") {
        settings.disallowed_tools = if v.is_null() {
            None
        } else {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
        };
    }
    if let Some(v) = patch.get("append_system_prompt") {
        settings.append_system_prompt = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("max_budget_usd") {
        settings.max_budget_usd = if v.is_null() { None } else { v.as_f64() };
    }
    if let Some(v) = patch.get("fallback_model") {
        settings.fallback_model = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("system_prompt") {
        settings.system_prompt = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("tool_set") {
        settings.tool_set = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("add_dirs") {
        settings.add_dirs = if v.is_null() {
            None
        } else {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
        };
    }
    if let Some(v) = patch.get("json_schema") {
        settings.json_schema = if v.is_null() { None } else { Some(v.clone()) };
    }
    if let Some(v) = patch.get("include_partial_messages") {
        settings.include_partial_messages = if v.is_null() { None } else { v.as_bool() };
    }
    if let Some(v) = patch.get("cli_debug") {
        settings.cli_debug = if v.is_null() {
            None
        } else {
            // Allow empty string (means "--debug" with no filter)
            v.as_str().map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("no_session_persistence") {
        settings.no_session_persistence = if v.is_null() { None } else { v.as_bool() };
    }
    if let Some(v) = patch.get("effort") {
        settings.effort = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
}

pub fn update_agent_settings(
    agent: &str,
    patch: serde_json::Value,
) -> Result<AgentSettings, String> {
    let mut all = load();
    let mut settings = all
        .agents
        .get(agent)
        .cloned()
        .unwrap_or_else(|| AgentSettings::default_for(agent));
    apply_agent_patch(&mut settings, &patch);
    settings.updated_at = crate::models::now_iso();
    all.agents.insert(agent.to_string(), settings.clone());
    save(&all)?;
    Ok(settings)
}

#[cfg(test)]
