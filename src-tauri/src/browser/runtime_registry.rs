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
use super::profile_manager::{BrowserProfile, ProfileManager};

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
}

struct ChromeSession {
    session: BrowserSession,
    chrome_process: ChromeProcess,
    cdp_client: Arc<CdpClient>,
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
        let sessions = self.active_sessions.read().await;

        // 找到包含这个tab的session
        let chrome_session = sessions
            .values()
            .find(|s| s.session.tabs.iter().any(|t| t.target_id == tab_id))
            .ok_or_else(|| format!("Tab not found: {}", tab_id))?;

        // 附加到目标
        let session_id = chrome_session.cdp_client.attach_to_target(tab_id).await?;

        // 启用Page域
        chrome_session
            .cdp_client
            .send_command_to_session(&session_id, "Page.enable", serde_json::json!({}))
            .await?;

        // 获取页面信息
        let document = chrome_session
            .cdp_client
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
        let url_result = chrome_session
            .cdp_client
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
        let text_result = chrome_session
            .cdp_client
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
        let screenshot_result = chrome_session
            .cdp_client
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
        match action {
            BrowserAction::Navigate { url } => {
                // 找到当前活跃的tab并导航
                let target_tab = {
                    let sessions = self.active_sessions.read().await;
                    sessions
                        .values()
                        .next()
                        .and_then(|s| s.session.tabs.first().map(|t| t.target_id.clone()))
                };
                match target_tab {
                    Some(tab_id) => self.navigate(&tab_id, &url).await,
                    None => Err("No active tab found".to_string()),
                }
            }
            BrowserAction::Click { x, y } => {
                // Phase 2实现
                log::info!("[browser] Click at ({}, {}) - Phase 2", x, y);
                Ok(())
            }
            BrowserAction::Type { text } => {
                log::info!("[browser] Type '{}' - Phase 2", text);
                Ok(())
            }
            BrowserAction::Scroll { delta_x, delta_y } => {
                log::info!("[browser] Scroll ({}, {}) - Phase 2", delta_x, delta_y);
                Ok(())
            }
            BrowserAction::GoBack => {
                log::info!("[browser] GoBack - Phase 2");
                Ok(())
            }
            BrowserAction::GoForward => {
                log::info!("[browser] GoForward - Phase 2");
                Ok(())
            }
            BrowserAction::Refresh => {
                log::info!("[browser] Refresh - Phase 2");
                Ok(())
            }
            BrowserAction::Close => {
                log::info!("[browser] Close - Phase 2");
                Ok(())
            }
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

    /// 注册默认的Chrome运行时
    pub async fn register_default_chrome_runtime(&self) {
        let runtime = Arc::new(ChromeRuntime {
            profile_manager: self.profile_manager.clone(),
            active_sessions: RwLock::new(HashMap::new()),
        });
        self.register_runtime("chrome".to_string(), runtime).await;
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
