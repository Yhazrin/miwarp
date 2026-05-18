//! Tauri commands for pluggable skill sources (Feishu MVP).
use crate::models::{
    InstallRemoteSkillResult, RemoteSkillCandidate, SkillSourceConfig, SkillSourceHealth,
    SkillSourceSyncResult, SkillSourceUpdateCheck,
};
use crate::skill_sources;
use crate::skill_sources::parser::SkillParserMode;

#[tauri::command]
pub fn list_skill_sources() -> Result<Vec<SkillSourceConfig>, String> {
    skill_sources::load_all_sources()
}

#[tauri::command]
pub fn create_skill_source(config: SkillSourceConfig) -> Result<SkillSourceConfig, String> {
    skill_sources::create_source(config)
}

#[tauri::command]
pub fn update_skill_source(
    id: String,
    patch: SkillSourceConfig,
) -> Result<SkillSourceConfig, String> {
    skill_sources::update_source(&id, patch)
}

#[tauri::command]
pub fn delete_skill_source(id: String) -> Result<(), String> {
    skill_sources::delete_source(&id)
}

#[tauri::command]
pub async fn test_skill_source(id: String) -> Result<SkillSourceHealth, String> {
    skill_sources::test_source(&id).await
}

#[tauri::command]
pub async fn sync_skill_source(id: String) -> Result<SkillSourceSyncResult, String> {
    skill_sources::sync_source(&id).await
}

#[tauri::command]
pub async fn preview_feishu_skill_doc(
    doc_url: String,
    auth_profile: Option<String>,
    parser_mode: Option<String>,
    source_id_hint: Option<String>,
) -> Result<RemoteSkillCandidate, String> {
    let mode = match parser_mode.as_deref().unwrap_or("strict") {
        "loose" => SkillParserMode::Loose,
        _ => SkillParserMode::Strict,
    };
    skill_sources::preview_feishu_doc(&doc_url, auth_profile, mode, source_id_hint).await
}

#[tauri::command]
pub fn install_remote_skill(
    candidate_id: String,
    scope: Option<String>,
    cwd: Option<String>,
    conflict_resolution: Option<String>,
) -> Result<InstallRemoteSkillResult, String> {
    let scope = scope.unwrap_or_else(|| "user".to_string());
    let cwd = cwd.unwrap_or_default();
    let res = conflict_resolution.unwrap_or_else(|| "abort".to_string());
    skill_sources::install_candidate(&candidate_id, &scope, &cwd, &res)
}

#[tauri::command]
pub async fn check_skill_source_updates(
    id: String,
    cwd: Option<String>,
) -> Result<SkillSourceUpdateCheck, String> {
    skill_sources::check_updates(&id, &cwd.unwrap_or_default()).await
}
