//! Browser Runtime - 双引擎浏览器运行时
//!
//! 提供两种浏览器模式：
//! - Real Chrome Mode: 系统Chrome + MiWarp独立持久化Profile + CDP
//! - Embedded Web App Mode: Tauri Child WebView + 持久化Data Store (Phase 3)

pub mod cdp_client;
pub mod chrome_process;
pub mod profile_manager;
pub mod runtime_registry;

// 重新导出核心类型
pub use cdp_client::{CdpClient, CdpEvent};
pub use chrome_process::ChromeProcess;
pub use profile_manager::{BrowserProfile, ProfileManager};
pub use runtime_registry::{BrowserAction, BrowserRuntime, BrowserRuntimeRegistry, BrowserSession};
