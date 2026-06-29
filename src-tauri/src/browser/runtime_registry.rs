//! Browser Runtime抽象层
//!
//! 定义统一的运行时接口，管理所有浏览器运行时实例

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::cdp_client::CdpClient;
use super::chrome_process::{ChromeConfig, ChromeProcess};
use super::profile_manager::ProfileManager;

/// Browser Runtime trait - 统一的运行时接口
#[async_trait]
pub trait BrowserRuntime: Send + Sync {
    /// 启动Profile并返回Session
    async fn launch_profile(&self, profile_id: &str) -> Result<BrowserSession, String>;

    /// 列出所有Tab
    async fn list_tabs(&self, session_id: &str) -> Result<Vec<BrowserTab>, String>;

    /// 观察Tab（获取页面信息）
    async fn observe(&self, tab_id: &str) -> Result<BrowserObservation, String>;

    /// 导航到URL
    async fn navigate(&self, tab_id: &str, url: &str) -> Result<(), String>;

    /// 执行动作
    async fn perform(&self, action: BrowserAction) -> Result<(), String>;

    /// 关闭Session
    async fn close(&self, session_id: &str) -> Result<(), String>;
}

/// Browser Session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserSession {
    pub session_id: String,
    pub profile_id: String,
    pub engine: String,
    pub debugging_url: String,
    pub created_at: DateTime<Utc>,
    pub tabs: Vec<BrowserTab>,
}

/// Browser Tab
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserTab {
    pub target_id: String,
    pub url: String,
    pub title: String,
    pub attached: bool,
}

/// Browser Observation - 页面观察结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserObservation {
    pub url: String,
    pub title: String,
    pub visible_text: String,
    pub screenshot: Option<String>, // base64 WebP
    pub viewport: Viewport,
    pub interactive_elements: Vec<InteractiveElement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractiveElement {
    pub ref_id: String,
    pub role: String,
    pub name: String,
    pub bounds: (f64, f64, f64, f64), // x, y, width, height
}

/// Browser Action - 可执行的动作
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BrowserAction {
    Click { x: f64, y: f64 },
    Type { text: String },
    Scroll { delta_x: f64, delta_y: f64 },
    Navigate { url: String },
    GoBack,
    GoForward,
    Refresh,
    Close,
}

/// Chrome Runtime实现
struct ChromeRuntime {
    profile_manager: Arc<ProfileManager>,
    active_sessions: RwLock<HashMap<String, ChromeSession>>,
    /// Last target that `observe()` attached to. Drives Phase 2
    /// `perform(Click|Type|Scroll|GoBack|...)` so the trait signature
    /// does not need per-action tab context.
    last_target: RwLock<Option<(String, String)>>,
}

struct ChromeSession {
    session: BrowserSession,
    chrome_process: ChromeProcess,
    cdp_client: Arc<CdpClient>,
}

impl ChromeRuntime {
    /// Locate the CDP client whose session hosts the given target_id.
    /// The read lock is released before any await so callers can chain
    /// additional ChromeRuntime state mutations afterwards.
    async fn cdp_client_for_target(&self, target_id: &str) -> Result<Arc<CdpClient>, String> {
        let client = {
            let sessions = self.active_sessions.read().await;
            let chrome_session = sessions
                .values()
                .find(|s| s.session.tabs.iter().any(|t| t.target_id == target_id))
                .ok_or_else(|| format!("Tab not found: {target_id}"))?;
            chrome_session.cdp_client.clone()
        };
        Ok(client)
    }

    /// Get the active target id stored by the most recent `observe()` call.
    /// Returns a (CdpClient, target_id, browser-session-id) triple bound
    /// to a fresh attached CDP session.
    async fn active_cdp_context(&self) -> Result<(Arc<CdpClient>, String, String), String> {
        let (session_id, target_id) = {
            let last = self.last_target.read().await;
            last.clone()
                .ok_or_else(|| "No active tab: observe() must be called first".to_string())?
        };
        let cdp = self.cdp_client_for_target(&target_id).await?;
        Ok((cdp, target_id, session_id))
    }

    /// Attach to the active target — needed because CDP commands like
    /// `Input.dispatchMouseEvent` must go through a per-target session
    /// (not the browser-level session).
    async fn attach_active(&self) -> Result<(Arc<CdpClient>, String), String> {
        let (cdp, target_id, _) = self.active_cdp_context().await?;
        let cdp_session_id = cdp.attach_to_target(&target_id).await?;
        Ok((cdp, cdp_session_id))
    }

    // ── Phase 2 dispatchers ─────────────────────────────────────────────

    async fn dispatch_click(&self, x: f64, y: f64) -> Result<(), String> {
        let (cdp, cdp_session) = self.attach_active().await?;
        cdp.send_command_to_session(
            &cdp_session,
            "Input.dispatchMouseEvent",
            serde_json::json!({
                "type": "mousePressed",
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 1,
                "clickCount": 1
            }),
        )
        .await?;
        cdp.send_command_to_session(
            &cdp_session,
            "Input.dispatchMouseEvent",
            serde_json::json!({
                "type": "mouseReleased",
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 0,
                "clickCount": 1
            }),
        )
        .await?;
        Ok(())
    }

    async fn dispatch_type(&self, text: &str) -> Result<(), String> {
        if text.is_empty() {
            return Ok(());
        }
        let (cdp, cdp_session) = self.attach_active().await?;
        cdp.send_command_to_session(
            &cdp_session,
            "Input.insertText",
            serde_json::json!({ "text": text }),
        )
        .await
        .map(|_| ())
    }

    async fn dispatch_scroll(&self, delta_x: f64, delta_y: f64) -> Result<(), String> {
        let (cdp, cdp_session) = self.attach_active().await?;
        cdp.send_command_to_session(
            &cdp_session,
            "Input.dispatchMouseEvent",
            serde_json::json!({
                "type": "mouseWheel",
                "x": 0,
                "y": 0,
                "deltaX": delta_x,
                "deltaY": delta_y
            }),
        )
        .await
        .map(|_| ())
    }

    async fn dispatch_history_back(&self) -> Result<(), String> {
        let (cdp, cdp_session) = self.attach_active().await?;
        cdp.send_command_to_session(
            &cdp_session,
            "Runtime.evaluate",
            serde_json::json!({ "expression": "history.back()" }),
        )
        .await
        .map(|_| ())
    }

    async fn dispatch_history_forward(&self) -> Result<(), String> {
        let (cdp, cdp_session) = self.attach_active().await?;
        cdp.send_command_to_session(
            &cdp_session,
            "Runtime.evaluate",
            serde_json::json!({ "expression": "history.forward()" }),
        )
        .await
        .map(|_| ())
    }

    async fn dispatch_reload(&self) -> Result<(), String> {
        let (cdp, cdp_session) = self.attach_active().await?;
        cdp.send_command_to_session(
            &cdp_session,
            "Page.reload",
            serde_json::json!({ "ignoreCache": false }),
        )
        .await
        .map(|_| ())
    }

    async fn dispatch_close_tab(&self) -> Result<(), String> {
        let target_id = {
            let last = self.last_target.read().await;
            let (_, target_id) = last
                .clone()
                .ok_or_else(|| "No active tab to close".to_string())?;
            target_id
        };
        let cdp = self.cdp_client_for_target(&target_id).await?;
        // Target.closeTarget is sent on the browser-level session, not a
        // target session.
        cdp.send_command(
            "Target.closeTarget",
            serde_json::json!({ "targetId": target_id }),
        )
        .await
        .map(|_| ())
    }
}

#[async_trait]
impl BrowserRuntime for ChromeRuntime {
    async fn launch_profile(&self, profile_id: &str) -> Result<BrowserSession, String> {
        // 获取Profile配置
        let profile = self
            .profile_manager
            .get_profile(profile_id)
            .await
            .ok_or_else(|| format!("Profile not found: {}", profile_id))?;

        // 启动Chrome进程
        let config = ChromeConfig::new(profile.data_directory.clone()).with_headless(false);

        let chrome_process = ChromeProcess::spawn(config).await?;

        // 等待Chrome启动
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // 连接CDP
        let ws_url = chrome_process.ws_debug_url();
        let cdp_client = CdpClient::connect(&ws_url).await?;

        // 获取Tab列表
        let targets = cdp_client.get_targets().await?;
        let tabs: Vec<BrowserTab> = targets
            .iter()
            .filter(|t| t.r#type == "page")
            .map(|t| BrowserTab {
                target_id: t.target_id.clone(),
                url: t.url.clone(),
                title: t.title.clone(),
                attached: t.attached,
            })
            .collect();

        let session_id = uuid::Uuid::new_v4().to_string();
        let session = BrowserSession {
            session_id: session_id.clone(),
            profile_id: profile_id.to_string(),
            engine: "chrome".to_string(),
            debugging_url: ws_url,
            created_at: Utc::now(),
            tabs,
        };

        let chrome_session = ChromeSession {
            session: session.clone(),
            chrome_process,
            cdp_client: Arc::new(cdp_client),
        };

        let mut sessions = self.active_sessions.write().await;
        sessions.insert(session_id, chrome_session);

        // 更新Profile最后使用时间
        let _ = self.profile_manager.update_last_used(profile_id).await;

        log::info!("[browser] Launched Chrome session: {}", session.session_id);
        Ok(session)
    }

    async fn list_tabs(&self, session_id: &str) -> Result<Vec<BrowserTab>, String> {
        let sessions = self.active_sessions.read().await;
        let chrome_session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        let targets = chrome_session.cdp_client.get_targets().await?;
        let tabs: Vec<BrowserTab> = targets
            .iter()
            .filter(|t| t.r#type == "page")
            .map(|t| BrowserTab {
                target_id: t.target_id.clone(),
                url: t.url.clone(),
                title: t.title.clone(),
                attached: t.attached,
            })
            .collect();

        Ok(tabs)
    }

    async fn observe(&self, tab_id: &str) -> Result<BrowserObservation, String> {
        // Look up the owning session, then drop the read lock before
        // chaining CDP awaits so we can also update `last_target`.
        let (cdp_client, owning_session_id) = {
            let sessions = self.active_sessions.read().await;
            let chrome_session = sessions
                .values()
                .find(|s| s.session.tabs.iter().any(|t| t.target_id == tab_id))
                .ok_or_else(|| format!("Tab not found: {}", tab_id))?;
            (
                chrome_session.cdp_client.clone(),
                chrome_session.session.session_id.clone(),
            )
        };

        // Record this tab as the active one for subsequent Phase 2 actions.
        *self.last_target.write().await = Some((owning_session_id, tab_id.to_string()));

        // 附加到目标
        let session_id = cdp_client.attach_to_target(tab_id).await?;

        // 启用Page域
        cdp_client
            .send_command_to_session(&session_id, "Page.enable", serde_json::json!({}))
            .await?;

        // 获取页面信息
        let document = cdp_client
            .send_command_to_session(
                &session_id,
                "Runtime.evaluate",
                serde_json::json!({
                    "expression": "document.title"
                }),
            )
            .await?;

        let title = document
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // 获取URL
        let url_result = cdp_client
            .send_command_to_session(
                &session_id,
                "Runtime.evaluate",
                serde_json::json!({
                    "expression": "window.location.href"
                }),
            )
            .await?;

        let url = url_result
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // 获取可见文本（简化版）
        let text_result = cdp_client
            .send_command_to_session(
                &session_id,
                "Runtime.evaluate",
                serde_json::json!({
                    "expression": "document.body.innerText.substring(0, 5000)"
                }),
            )
            .await?;

        let visible_text = text_result
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // 截图（WebP格式）
        let screenshot_result = cdp_client
            .send_command_to_session(
                &session_id,
                "Page.captureScreenshot",
                serde_json::json!({
                    "format": "webp",
                    "quality": 80
                }),
            )
            .await;

        let screenshot = screenshot_result.ok().and_then(|r| {
            r.get("data")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });

        Ok(BrowserObservation {
            url,
            title,
            visible_text,
            screenshot,
            viewport: Viewport {
                width: 1440,
                height: 900,
            },
            interactive_elements: Vec::new(), // Phase 2实现
        })
    }

    async fn navigate(&self, tab_id: &str, url: &str) -> Result<(), String> {
        let sessions = self.active_sessions.read().await;
        let chrome_session = sessions
            .values()
            .find(|s| s.session.tabs.iter().any(|t| t.target_id == tab_id))
            .ok_or_else(|| format!("Tab not found: {}", tab_id))?;

        let session_id = chrome_session.cdp_client.attach_to_target(tab_id).await?;

        chrome_session
            .cdp_client
            .send_command_to_session(
                &session_id,
                "Page.navigate",
                serde_json::json!({ "url": url }),
            )
            .await?;

        Ok(())
    }

    async fn perform(&self, action: BrowserAction) -> Result<(), String> {
        // Resolve the active tab. `perform` doesn't carry tab context, so we
        // look at the last (session_id, tab_id) recorded by `observe()`.
        // `BrowserAction::Navigate { url }` is special: it just navigates the
        // current tab without changing the active target.
        match action {
            BrowserAction::Navigate { url } => {
                let last = self.last_target.read().await.clone();
                let (_, tab_id) = last.ok_or_else(|| "No active tab".to_string())?;
                self.navigate(&tab_id, &url).await
            }
            BrowserAction::Click { x, y } => self.dispatch_click(x, y).await,
            BrowserAction::Type { text } => self.dispatch_type(&text).await,
            BrowserAction::Scroll { delta_x, delta_y } => {
                self.dispatch_scroll(delta_x, delta_y).await
            }
            BrowserAction::GoBack => self.dispatch_history_back().await,
            BrowserAction::GoForward => self.dispatch_history_forward().await,
            BrowserAction::Refresh => self.dispatch_reload().await,
            BrowserAction::Close => self.dispatch_close_tab().await,
        }
    }

    async fn close(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.active_sessions.write().await;
        if let Some(chrome_session) = sessions.remove(session_id) {
            chrome_session.chrome_process.kill().await?;
            log::info!("[browser] Closed Chrome session: {}", session_id);
            Ok(())
        } else {
            Err(format!("Session not found: {}", session_id))
        }
    }
}

/// Runtime Registry - 管理所有运行时实例
pub struct BrowserRuntimeRegistry {
    runtimes: RwLock<HashMap<String, Arc<dyn BrowserRuntime>>>,
    sessions: RwLock<HashMap<String, BrowserSession>>,
    profile_manager: Arc<ProfileManager>,
}

impl BrowserRuntimeRegistry {
    pub fn new(profile_manager: Arc<ProfileManager>) -> Self {
        Self {
            runtimes: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            profile_manager,
        }
    }

    /// Access the profile manager so commands can do CRUD outside of
    /// launching sessions.
    pub fn profile_manager(&self) -> &Arc<ProfileManager> {
        &self.profile_manager
    }

    /// 注册默认的Chrome运行时
    pub async fn register_default_chrome_runtime(&self) {
        let runtime = Arc::new(ChromeRuntime {
            profile_manager: self.profile_manager.clone(),
            active_sessions: RwLock::new(HashMap::new()),
            last_target: RwLock::new(None),
        });
        self.register_runtime("chrome".to_string(), runtime).await;
    }

    /// Register the WebViewRuntime under the `"webview"` engine name.
    /// Must be called from inside Tauri's setup closure (where AppHandle
    /// is available) since spawning a WebviewWindow needs an AppHandle.
    pub async fn register_default_webview_runtime(&self, app_handle: tauri::AppHandle) {
        let runtime = Arc::new(super::webview_runtime::WebViewRuntime::new(
            self.profile_manager.clone(),
            app_handle,
        ));
        self.register_runtime("webview".to_string(), runtime).await;
    }

    /// 注册新的运行时
    pub async fn register_runtime(&self, name: String, runtime: Arc<dyn BrowserRuntime>) {
        let mut runtimes = self.runtimes.write().await;
        runtimes.insert(name, runtime);
    }

    /// 获取运行时
    pub async fn get_runtime(&self, name: &str) -> Option<Arc<dyn BrowserRuntime>> {
        let runtimes = self.runtimes.read().await;
        runtimes.get(name).cloned()
    }

    /// 列出所有运行时
    pub async fn list_runtimes(&self) -> Vec<String> {
        let runtimes = self.runtimes.read().await;
        runtimes.keys().cloned().collect()
    }

    /// 启动Profile
    pub async fn launch_profile(
        &self,
        profile_id: &str,
        runtime_name: Option<&str>,
    ) -> Result<BrowserSession, String> {
        // 获取Profile以确定默认运行时
        let profile = self
            .profile_manager
            .get_profile(profile_id)
            .await
            .ok_or_else(|| format!("Profile not found: {}", profile_id))?;

        let runtime_name = runtime_name.unwrap_or(&profile.engine);
        let runtime = self
            .get_runtime(runtime_name)
            .await
            .ok_or_else(|| format!("Runtime not found: {}", runtime_name))?;

        let session = runtime.launch_profile(profile_id).await?;

        // 保存Session
        let mut sessions = self.sessions.write().await;
        sessions.insert(session.session_id.clone(), session.clone());

        Ok(session)
    }

    /// 获取Session
    pub async fn get_session(&self, session_id: &str) -> Option<BrowserSession> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).cloned()
    }

    /// 列出所有Session
    pub async fn list_sessions(&self) -> Vec<BrowserSession> {
        let sessions = self.sessions.read().await;
        sessions.values().cloned().collect()
    }

    /// 关闭Session
    pub async fn close_session(&self, session_id: &str) -> Result<(), String> {
        let session = {
            let sessions = self.sessions.read().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| format!("Session not found: {}", session_id))?
        };

        let runtime = self
            .get_runtime(&session.engine)
            .await
            .ok_or_else(|| format!("Runtime not found: {}", session.engine))?;

        runtime.close(session_id).await?;

        let mut sessions = self.sessions.write().await;
        sessions.remove(session_id);

        Ok(())
    }

    /// Given a session id, return the runtime that owns it so callers
    /// can drive `list_tabs` / `navigate` / `perform` without re-deriving
    /// the engine from the cached session.
    pub async fn get_runtime_by_session(
        &self,
        session_id: &str,
    ) -> Option<Arc<dyn BrowserRuntime>> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(session_id)?;
        self.get_runtime(&session.engine).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_runtime_registry() {
        let temp_dir = tempdir().unwrap();
        let profile_manager = Arc::new(ProfileManager::new(temp_dir.path().to_path_buf()).unwrap());
        let registry = BrowserRuntimeRegistry::new(profile_manager);

        // 列出运行时（应该为空）
        let runtimes = registry.list_runtimes().await;
        assert!(runtimes.is_empty());

        // 列出Session（应该为空）
        let sessions = registry.list_sessions().await;
        assert!(sessions.is_empty());
    }
}
