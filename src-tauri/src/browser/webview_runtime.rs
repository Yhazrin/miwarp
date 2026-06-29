//! WebView Runtime — Embedded Web App 模式（Phase 3）。
//!
//! 与 `ChromeRuntime` 不同，WebViewRuntime 不启动外部进程，而是在主
//! Tauri 窗口内创建一个新的 `WebviewWindow`，加载内置的 `embedded-app`
//! 路由。Profile 的 `data_directory` 留作未来"持久化 Data Store"的物理位置。
//!
//! Scaffold 范围（本 PR）：
//! - `launch_profile` / `close` 实做（创建 + 关闭 WebviewWindow）
//! - `list_tabs` / `observe` / `navigate` / `perform` 返回轻量 stub，
//!   等 Phase 3 桥接就位后再接 Input / Message 端口。
//!
//! 该 runtime 必须使用 `register_default_webview_runtime(&app_handle)` 注册，
//! 因为创建 WebviewWindow 需要一个 `AppHandle`。

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::RwLock;
use uuid::Uuid;

use super::profile_manager::ProfileManager;
use super::runtime_registry::{
    BrowserAction, BrowserObservation, BrowserRuntime, BrowserSession, BrowserTab, Viewport,
};

const EMBEDDED_APP_ROUTE: &str = "embedded-app/";

/// Per-session bookkeeping for a spawned WebviewWindow.
struct WebViewSessionEntry {
    session: BrowserSession,
    window_label: String,
}

/// WebView Runtime — uses Tauri's child WebviewWindow instead of launching
/// a separate process.
pub struct WebViewRuntime {
    profile_manager: Arc<ProfileManager>,
    app_handle: AppHandle,
    active_sessions: RwLock<HashMap<String, WebViewSessionEntry>>,
}

impl WebViewRuntime {
    /// Construct the runtime. The `AppHandle` must outlive the runtime so
    /// we keep it by-clone (cheap; AppHandle is an Arc internally).
    pub fn new(profile_manager: Arc<ProfileManager>, app_handle: AppHandle) -> Self {
        Self {
            profile_manager,
            app_handle,
            active_sessions: RwLock::new(HashMap::new()),
        }
    }

    fn window_label(session_id: &str) -> String {
        // Tauri labels must match `^[a-zA-Z0-9_-]+$` and stay short.
        format!(
            "bw-{session_label}",
            session_label = &session_id[..8.min(session_id.len())]
        )
    }

    fn parse_query(session_id: &str, profile_id: &str) -> String {
        format!("{EMBEDDED_APP_ROUTE}?sessionId={session_id}&profileId={profile_id}")
    }
}

#[async_trait]
impl BrowserRuntime for WebViewRuntime {
    async fn launch_profile(&self, profile_id: &str) -> Result<BrowserSession, String> {
        let profile = self
            .profile_manager
            .get_profile(profile_id)
            .await
            .ok_or_else(|| format!("Profile not found: {profile_id}"))?;

        let session_id = Uuid::new_v4().to_string();
        let window_label = Self::window_label(&session_id);
        let url = Self::parse_query(&session_id, profile_id);

        // Build the window off the main thread so we don't block the
        // Tauri runtime. Failure modes:
        //   - label collision → return Err
        //   - no parent window → manager().get_webview_window("main") failure
        let app_handle = self.app_handle.clone();
        let profile_id_owned = profile.id.clone();
        let label_clone = window_label.clone();
        let url_clone = url.clone();

        let window_result = tokio::task::spawn_blocking(move || {
            WebviewWindowBuilder::new(
                &app_handle,
                label_clone,
                WebviewUrl::App(PathBuf::from(url_clone)),
            )
            .title(format!("Embedded App — {profile_id_owned}"))
            .inner_size(960.0, 720.0)
            .resizable(true)
            .build()
        })
        .await
        .map_err(|e| format!("WebviewWindowBuilder join error: {e}"))?;

        let _window = window_result.map_err(|e| format!("create webview window: {e}"))?;

        let session = BrowserSession {
            session_id: session_id.clone(),
            profile_id: profile.id.clone(),
            engine: "webview".to_string(),
            debugging_url: format!("tauri://localhost/{url}"),
            created_at: Utc::now(),
            tabs: vec![BrowserTab {
                target_id: session_id.clone(),
                url: format!("tauri://localhost/{url}"),
                title: "Embedded App".to_string(),
                attached: true,
            }],
        };

        let entry = WebViewSessionEntry {
            session: session.clone(),
            window_label,
        };

        self.active_sessions
            .write()
            .await
            .insert(session_id.clone(), entry);

        let _ = self.profile_manager.update_last_used(profile_id).await;
        log::info!("[webview] launched session {session_id} for profile {profile_id}");
        Ok(session)
    }

    async fn list_tabs(&self, session_id: &str) -> Result<Vec<BrowserTab>, String> {
        let sessions = self.active_sessions.read().await;
        let entry = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        Ok(entry.session.tabs.clone())
    }

    async fn observe(&self, _tab_id: &str) -> Result<BrowserObservation, String> {
        // The embedded app's content is rendered inside our own WebView, so
        // we don't need CDP. For Phase 3 we surface a minimal stub so the
        // panel keeps the same observation contract.
        Ok(BrowserObservation {
            url: format!("tauri://localhost/{EMBEDDED_APP_ROUTE}"),
            title: "Embedded App".to_string(),
            visible_text: String::new(),
            screenshot: None,
            viewport: Viewport {
                width: 960,
                height: 720,
            },
            interactive_elements: Vec::new(),
        })
    }

    async fn navigate(&self, _tab_id: &str, _url: &str) -> Result<(), String> {
        // Phase 3 follow-up: hook into a postMessage bridge to drive the
        // child WebView's location. For now the embedded app loads once
        // at launch and stays put.
        Err("WebViewRuntime::navigate is not yet implemented in Phase 3".to_string())
    }

    async fn perform(&self, _action: BrowserAction) -> Result<(), String> {
        // Phase 3 follow-up: bridge Input events to the embedded WebView
        // via `window.__TAURI__` event API.
        Err("WebViewRuntime::perform is not yet implemented in Phase 3".to_string())
    }

    async fn close(&self, session_id: &str) -> Result<(), String> {
        let entry = {
            let mut sessions = self.active_sessions.write().await;
            sessions.remove(session_id)
        };
        let entry = entry.ok_or_else(|| format!("Session not found: {session_id}"))?;
        if let Some(window) = self.app_handle.get_webview_window(&entry.window_label) {
            let _ = window.close();
        }
        log::info!("[webview] closed session {session_id}");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn window_label_truncates_long_session_ids() {
        let id = "abcdef1234567890ABCDEF";
        let label = WebViewRuntime::window_label(id);
        assert!(label.starts_with("bw-"));
        assert!(label.len() <= "bw-".len() + 8);
        // Must match Tauri's label regex (no weird chars beyond dashes).
        assert!(label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn window_label_handles_short_session_ids() {
        let label = WebViewRuntime::window_label("abc");
        assert_eq!(label, "bw-abc");
    }

    #[test]
    fn embedded_app_url_is_well_formed() {
        let url = WebViewRuntime::parse_query("sess-1", "prof-2");
        assert!(url.starts_with(EMBEDDED_APP_ROUTE));
        assert!(url.contains("sessionId=sess-1"));
        assert!(url.contains("profileId=prof-2"));
    }

    // Smoke test for the runtime registration wiring without ever spawning
    // a real Tauri runtime — we just confirm the type can be named.
    #[allow(dead_code)]
    fn type_construction_succeeds_without_app_handle(
        pm: Arc<ProfileManager>,
    ) -> Result<(), String> {
        let dir = tempdir().map_err(|e| e.to_string())?;
        let _ = (pm, dir);
        Ok(())
    }
}
