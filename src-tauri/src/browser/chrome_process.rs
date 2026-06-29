//! Chrome进程管理
//!
//! 查找本机Chrome、启动子进程、管理生命周期

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// Chrome进程配置
#[derive(Debug, Clone)]
pub struct ChromeConfig {
    pub user_data_dir: PathBuf,
    pub debugging_port: Option<u16>,
    pub headless: bool,
    pub extra_args: Vec<String>,
}

impl ChromeConfig {
    pub fn new(user_data_dir: PathBuf) -> Self {
        Self {
            user_data_dir,
            debugging_port: None,
            headless: false,
            extra_args: Vec::new(),
        }
    }

    pub fn with_debugging_port(mut self, port: u16) -> Self {
        self.debugging_port = Some(port);
        self
    }

    pub fn with_headless(mut self, headless: bool) -> Self {
        self.headless = headless;
        self
    }
}

/// Chrome进程状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChromeProcessInfo {
    pub pid: u32,
    pub debugging_port: u16,
    pub user_data_dir: PathBuf,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

/// Chrome进程管理器
pub struct ChromeProcess {
    child: Arc<Mutex<Option<Child>>>,
    info: ChromeProcessInfo,
}

impl ChromeProcess {
    /// 查找本机Chrome路径
    pub fn find_chrome_binary() -> Option<PathBuf> {
        #[cfg(target_os = "macos")]
        {
            let paths = vec![
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ];
            for path in paths {
                if Path::new(path).exists() {
                    return Some(PathBuf::from(path));
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            let paths = vec![
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            ];
            for path in paths {
                if Path::new(path).exists() {
                    return Some(PathBuf::from(path));
                }
            }
        }

        #[cfg(target_os = "linux")]
        {
            let binaries = vec![
                "google-chrome",
                "google-chrome-stable",
                "chromium",
                "chromium-browser",
            ];
            for binary in binaries {
                if let Ok(output) = std::process::Command::new("which").arg(binary).output() {
                    if output.status.success() {
                        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        return Some(PathBuf::from(path));
                    }
                }
            }
        }

        None
    }

    /// 生成随机调试端口
    fn random_debugging_port() -> u16 {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        rng.gen_range(1024..65535)
    }

    /// 启动Chrome进程
    pub async fn spawn(config: ChromeConfig) -> Result<Self, String> {
        let chrome_binary = Self::find_chrome_binary()
            .ok_or_else(|| "Chrome not found. Please install Google Chrome.".to_string())?;

        let debugging_port = config
            .debugging_port
            .unwrap_or_else(Self::random_debugging_port);

        // 确保user_data_dir存在
        tokio::fs::create_dir_all(&config.user_data_dir)
            .await
            .map_err(|e| format!("Failed to create user data dir: {}", e))?;

        let mut args = vec![
            format!("--user-data-dir={}", config.user_data_dir.display()),
            format!("--remote-debugging-port={}", debugging_port),
            "--no-first-run".to_string(),
            "--no-default-browser-check".to_string(),
            "--disable-background-networking".to_string(),
            "--disable-sync".to_string(),
            "--disable-translate".to_string(),
            "--metrics-recording-only".to_string(),
            "--safebrowsing-disable-auto-update".to_string(),
        ];

        if config.headless {
            args.push("--headless=new".to_string());
        }

        args.extend(config.extra_args);

        log::info!(
            "[browser] Starting Chrome: {} {}",
            chrome_binary.display(),
            args.join(" ")
        );

        let child = Command::new(&chrome_binary)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start Chrome: {}", e))?;

        let pid = child
            .id()
            .ok_or_else(|| "Failed to get Chrome PID".to_string())?;

        let info = ChromeProcessInfo {
            pid,
            debugging_port,
            user_data_dir: config.user_data_dir,
            started_at: chrono::Utc::now(),
        };

        log::info!(
            "[browser] Chrome started with PID: {}, port: {}",
            pid,
            debugging_port
        );

        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
            info,
        })
    }

    /// 获取进程信息
    pub fn info(&self) -> &ChromeProcessInfo {
        &self.info
    }

    /// 获取调试端口
    pub fn debugging_port(&self) -> u16 {
        self.info.debugging_port
    }

    /// 检查进程是否运行中
    pub async fn is_running(&self) -> bool {
        let guard = self.child.lock().await;
        if let Some(child) = guard.as_ref() {
            // 通过尝试发送信号0来检查进程是否存在
            #[cfg(unix)]
            {
                use nix::sys::signal;
                use nix::unistd::Pid;
                let pid = Pid::from_raw(child.id().unwrap_or(0) as i32);
                signal::kill(pid, None).is_ok()
            }
            #[cfg(not(unix))]
            {
                // Windows: 假设仍在运行
                true
            }
        } else {
            false
        }
    }

    /// 优雅关闭Chrome
    pub async fn kill(&self) -> Result<(), String> {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            log::info!("[browser] Killing Chrome PID: {}", self.info.pid);
            child
                .kill()
                .await
                .map_err(|e| format!("Failed to kill Chrome: {}", e))?;
        }
        Ok(())
    }

    /// 获取WebSocket调试URL
    pub fn ws_debug_url(&self) -> String {
        format!(
            "ws://127.0.0.1:{}/devtools/browser",
            self.info.debugging_port
        )
    }

    /// 获取HTTP调试URL
    pub fn http_debug_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.info.debugging_port)
    }
}

impl Drop for ChromeProcess {
    fn drop(&mut self) {
        // 注意：Drop不能是async，所以这里只是尝试kill
        // 实际的清理应该在异步上下文中调用kill()
        log::debug!("[browser] ChromeProcess dropped for PID: {}", self.info.pid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_chrome_binary() {
        // 这个测试只在安装了Chrome的机器上通过
        let chrome = ChromeProcess::find_chrome_binary();
        println!("Chrome binary: {:?}", chrome);
    }

    #[test]
    fn test_random_port() {
        let port = ChromeProcess::random_debugging_port();
        assert!(port >= 1024);
        assert!(port < 65535);
    }

    #[test]
    fn test_config_builder() {
        let config = ChromeConfig::new(PathBuf::from("/tmp/test"))
            .with_debugging_port(9222)
            .with_headless(true);

        assert_eq!(config.debugging_port, Some(9222));
        assert!(config.headless);
    }
}
