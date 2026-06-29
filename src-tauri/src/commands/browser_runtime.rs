//! Browser Runtime — Real Tauri commands backed by `BrowserRuntimeRegistry`.
//!
//! The placeholder `commands::browser` module (110-A9) is kept untouched for
//! legacy audit/IPC. This module exposes the real browser runtime: profile
//! CRUD, launch/close session, list tabs, observe, navigate, perform actions.
//!
//! All commands accept `tauri::State<'_, Arc<BrowserRuntimeRegistry>>` so the
//! frontend can drive the actual Chrome DevTools Protocol session.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::browser::{
    BrowserAction, BrowserObservation, BrowserProfile, BrowserRuntimeRegistry, BrowserSession,
    BrowserTab, ProfileManager,
};

/// Frontend-facing JSON shapes. We use `camelCase` so the Svelte store
/// can pass them through without renaming.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileDto {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub data_directory: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub allowed_origins: Vec<String>,
}

impl From<BrowserProfile> for BrowserProfileDto {
    fn from(p: BrowserProfile) -> Self {
        Self {
            id: p.id,
            name: p.name,
            engine: p.engine,
            data_directory: p.data_directory.to_string_lossy().into_owned(),
            created_at: p.created_at.to_rfc3339(),
            last_used_at: p.last_used_at.map(|d| d.to_rfc3339()),
            allowed_origins: p.allowed_origins,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabDto {
    pub target_id: String,
    pub url: String,
    pub title: String,
    pub attached: bool,
}

impl From<BrowserTab> for BrowserTabDto {
    fn from(t: BrowserTab) -> Self {
        Self {
            target_id: t.target_id,
            url: t.url,
            title: t.title,
            attached: t.attached,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionDto {
    pub session_id: String,
    pub profile_id: String,
    pub engine: String,
    pub debugging_url: String,
    pub created_at: String,
    pub tabs: Vec<BrowserTabDto>,
}

impl From<BrowserSession> for BrowserSessionDto {
    fn from(s: BrowserSession) -> Self {
        Self {
            session_id: s.session_id,
            profile_id: s.profile_id,
            engine: s.engine,
            debugging_url: s.debugging_url,
            created_at: s.created_at.to_rfc3339(),
            tabs: s.tabs.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserObservationDto {
    pub url: String,
    pub title: String,
    pub visible_text: String,
    pub screenshot: Option<String>,
    pub viewport: ViewportDto,
    pub interactive_elements: Vec<InteractiveElementDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportDto {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveElementDto {
    pub ref_id: String,
    pub role: String,
    pub name: String,
    pub bounds: (f64, f64, f64, f64),
}

impl From<BrowserObservation> for BrowserObservationDto {
    fn from(o: BrowserObservation) -> Self {
        Self {
            url: o.url,
            title: o.title,
            visible_text: o.visible_text,
            screenshot: o.screenshot,
            viewport: ViewportDto {
                width: o.viewport.width,
                height: o.viewport.height,
            },
            interactive_elements: o
                .interactive_elements
                .into_iter()
                .map(|e| InteractiveElementDto {
                    ref_id: e.ref_id,
                    role: e.role,
                    name: e.name,
                    bounds: e.bounds,
                })
                .collect(),
        }
    }
}

const MAX_NAME_BYTES: usize = 128;
const MAX_URL_BYTES: usize = 2048;

/// Build the registry used by the Tauri state. Owns its own ProfileManager
/// rooted at `~/.miwarp/browser/`. The Chrome runtime is registered eagerly
/// so the frontend can `launch_profile` without first calling any setup
/// command.
pub fn build_registry() -> Result<Arc<BrowserRuntimeRegistry>, String> {
    let base_dir = registry_base_dir();
    // Offload to blocking pool — std::fs::create_dir_all is sync I/O and we
    // don't want to pin a tokio worker (this fn runs on the async runtime
    // during app initialization).
    let base_dir_for_blocking = base_dir.clone();
    tauri::async_runtime::block_on(async move {
        tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(&base_dir_for_blocking).map_err(|e| {
                format!(
                    "create browser dir {}: {}",
                    base_dir_for_blocking.display(),
                    e
                )
            })
        })
        .await
        .map_err(|e| format!("[browser] blocking task join failed: {}", e))?
    })?;

    let profile_manager = Arc::new(ProfileManager::new(base_dir)?);
    let registry = Arc::new(BrowserRuntimeRegistry::new(profile_manager));

    // Register Chrome runtime synchronously inside an async block — the
    // registry's `register_runtime` is async-only.
    let registry_for_init = registry.clone();
    tauri::async_runtime::block_on(async move {
        registry_for_init.register_default_chrome_runtime().await;
    });

    Ok(registry)
}

fn registry_base_dir() -> PathBuf {
    crate::storage::data_dir().join("browser")
}

fn validate_profile_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("profile name must not be empty".to_string());
    }
    if trimmed.len() > MAX_NAME_BYTES {
        return Err(format!("profile name exceeds {MAX_NAME_BYTES} bytes"));
    }
    Ok(trimmed.to_string())
}

fn validate_engine(engine: &str) -> Result<String, String> {
    match engine {
        "chrome" | "webview" => Ok(engine.to_string()),
        other => Err(format!(
            "unsupported engine '{other}', expected 'chrome' or 'webview'"
        )),
    }
}

fn validate_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("url must not be empty".to_string());
    }
    if trimmed.len() > MAX_URL_BYTES {
        return Err(format!("url exceeds {MAX_URL_BYTES} bytes"));
    }
    Ok(trimmed.to_string())
}

// ── Commands ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn browser_runtime_list_profiles(
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<Vec<BrowserProfileDto>, String> {
    let profiles = registry_profiles(&state).list_profiles().await;
    Ok(profiles.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn browser_runtime_create_profile(
    name: String,
    engine: String,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<BrowserProfileDto, String> {
    let name = validate_profile_name(&name)?;
    let engine = validate_engine(&engine)?;
    let profile = registry_profiles(&state)
        .create_profile(name, engine)
        .await?;
    Ok(profile.into())
}

#[tauri::command]
pub async fn browser_runtime_get_profile(
    profile_id: String,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<Option<BrowserProfileDto>, String> {
    let trimmed = profile_id.trim();
    if trimmed.is_empty() {
        return Err("profile_id must not be empty".to_string());
    }
    let result = registry_profiles(&state).get_profile(trimmed).await;
    Ok(result.map(Into::into))
}

#[tauri::command]
pub async fn browser_runtime_delete_profile(
    profile_id: String,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<(), String> {
    let trimmed = profile_id.trim();
    if trimmed.is_empty() {
        return Err("profile_id must not be empty".to_string());
    }
    registry_profiles(&state).delete_profile(trimmed).await
}

#[tauri::command]
pub async fn browser_runtime_launch_profile(
    profile_id: String,
    runtime_name: Option<String>,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<BrowserSessionDto, String> {
    let trimmed = profile_id.trim();
    if trimmed.is_empty() {
        return Err("profile_id must not be empty".to_string());
    }
    let runtime_ref = runtime_name.as_deref();
    let session = state.launch_profile(trimmed, runtime_ref).await?;
    Ok(session.into())
}

#[tauri::command]
pub async fn browser_runtime_list_sessions(
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<Vec<BrowserSessionDto>, String> {
    let sessions = state.list_sessions().await;
    Ok(sessions.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn browser_runtime_get_session(
    session_id: String,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<Option<BrowserSessionDto>, String> {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    let session = state.get_session(trimmed).await;
    Ok(session.map(Into::into))
}

#[tauri::command]
pub async fn browser_runtime_list_tabs(
    session_id: String,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<Vec<BrowserTabDto>, String> {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    let runtime = state
        .get_runtime_by_session(trimmed)
        .await
        .ok_or_else(|| format!("session not found: {trimmed}"))?;
    let tabs = runtime.list_tabs(trimmed).await?;
    Ok(tabs.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn browser_runtime_observe(
    session_id: String,
    tab_id: String,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<BrowserObservationDto, String> {
    let trimmed_sid = session_id.trim();
    let trimmed_tid = tab_id.trim();
    if trimmed_sid.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    if trimmed_tid.is_empty() {
        return Err("tab_id must not be empty".to_string());
    }
    let runtime = state
        .get_runtime_by_session(trimmed_sid)
        .await
        .ok_or_else(|| format!("session not found: {trimmed_sid}"))?;
    // ChromeRuntime::observe scopes its lookup by tab_id across all sessions,
    // so we don't strictly need session_id, but pass it via the chrome
    // module later if multi-session logic lands.
    let _ = trimmed_sid;
    let observation = runtime.observe(trimmed_tid).await?;
    Ok(observation.into())
}

#[tauri::command]
pub async fn browser_runtime_navigate(
    session_id: String,
    tab_id: String,
    url: String,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<(), String> {
    let trimmed_sid = session_id.trim();
    let trimmed_tid = tab_id.trim();
    let url = validate_url(&url)?;
    if trimmed_sid.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    if trimmed_tid.is_empty() {
        return Err("tab_id must not be empty".to_string());
    }
    let runtime = state
        .get_runtime_by_session(trimmed_sid)
        .await
        .ok_or_else(|| format!("session not found: {trimmed_sid}"))?;
    runtime.navigate(trimmed_tid, &url).await
}

#[tauri::command]
pub async fn browser_runtime_perform(
    session_id: String,
    tab_id: String,
    action: BrowserAction,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<(), String> {
    let trimmed_sid = session_id.trim();
    let trimmed_tid = tab_id.trim();
    if trimmed_sid.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    if trimmed_tid.is_empty() {
        return Err("tab_id must not be empty".to_string());
    }
    let runtime = state
        .get_runtime_by_session(trimmed_sid)
        .await
        .ok_or_else(|| format!("session not found: {trimmed_sid}"))?;
    let _ = trimmed_sid;
    let _ = trimmed_tid; // Phase 2 routing will use these.
    runtime.perform(action).await
}

#[tauri::command]
pub async fn browser_runtime_close_session(
    session_id: String,
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<(), String> {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    state.close_session(trimmed).await
}

#[tauri::command]
pub async fn browser_runtime_list_runtimes(
    state: tauri::State<'_, Arc<BrowserRuntimeRegistry>>,
) -> Result<Vec<String>, String> {
    Ok(state.list_runtimes().await)
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn registry_profiles(state: &tauri::State<'_, Arc<BrowserRuntimeRegistry>>) -> Arc<ProfileManager> {
    state.profile_manager().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_profile_name_rejects_empty_and_whitespace() {
        assert!(validate_profile_name("").is_err());
        assert!(validate_profile_name("   ").is_err());
    }

    #[test]
    fn validate_profile_name_accepts_normal_text() {
        assert_eq!(validate_profile_name("default").unwrap(), "default");
        assert_eq!(validate_profile_name("  profile-1  ").unwrap(), "profile-1");
    }

    #[test]
    fn validate_profile_name_rejects_oversized() {
        let huge = "x".repeat(MAX_NAME_BYTES + 1);
        assert!(validate_profile_name(&huge).is_err());
    }

    #[test]
    fn validate_engine_accepts_known_engines() {
        assert_eq!(validate_engine("chrome").unwrap(), "chrome");
        assert_eq!(validate_engine("webview").unwrap(), "webview");
    }

    #[test]
    fn validate_engine_rejects_unknown() {
        assert!(validate_engine("firefox").is_err());
        assert!(validate_engine("").is_err());
    }

    #[test]
    fn validate_url_trims_and_rejects_empty() {
        assert!(validate_url("").is_err());
        assert!(validate_url("   ").is_err());
        assert_eq!(
            validate_url("  https://example.com  ").unwrap(),
            "https://example.com"
        );
    }

    #[test]
    fn validate_url_rejects_oversized() {
        assert!(validate_url(&"x".repeat(MAX_URL_BYTES + 1)).is_err());
    }

    #[test]
    fn registry_base_dir_is_under_data_dir() {
        let dir = registry_base_dir();
        assert!(dir.ends_with("browser"));
        assert!(dir.starts_with(crate::storage::data_dir()));
    }
}
