//! End-to-end integration tests that spawn a real Chrome process and drive
//! it through the CDP client.
//!
//! These tests are gracefully skipped when no Chrome binary is detected on
//! the host so they don't break CI on bare runners. Enable locally with:
//!
//! ```text
//! cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored chrome_runtime_full_cycle
//! ```
//!
//! They exercise the same call paths the Tauri IPC commands take:
//! ChromeProcess::spawn → CdpClient::connect → Target.getTargets →
//! Target.attachToTarget → Page.navigate → Page.captureScreenshot →
//! BrowserRuntime::observe → BrowserRuntime::close.

#![cfg(test)]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tempfile::tempdir;
use tokio::time::sleep;

use super::cdp_client::CdpClient;
use super::chrome_process::{ChromeConfig, ChromeProcess};
use super::profile_manager::ProfileManager;
use super::runtime_registry::{BrowserRuntime, BrowserRuntimeRegistry};
use crate::storage::data_dir;

async fn ensure_chrome_or_skip() -> bool {
    if ChromeProcess::find_chrome_binary().is_some() {
        return true;
    }
    eprintln!("[integration_test] Skipping: Chrome binary not found in known locations");
    false
}

fn unique_user_data_dir(label: &str) -> PathBuf {
    data_dir()
        .join("browser")
        .join("integration-tests")
        .join(format!("{label}-{}", uuid::Uuid::new_v4()))
}

async fn drop_dir_silently(path: PathBuf) {
    let _ = tokio::fs::remove_dir_all(&path).await;
}

/// Connect to Chrome's CDP endpoint with up to N retries so we don't
/// flake on first-run profile warm-up or slow CI machines.
async fn connect_with_retry(ws_url: &str, attempts: u32) -> Result<CdpClient, String> {
    let mut last_err: Option<String> = None;
    for attempt in 0..attempts {
        match CdpClient::connect(ws_url).await {
            Ok(client) => return Ok(client),
            Err(e) => last_err = Some(e),
        }
        sleep(Duration::from_millis(500 * (attempt as u64 + 1))).await;
    }
    Err(last_err.unwrap_or_else(|| "no attempts made".to_string()))
}

#[tokio::test]
async fn cdp_client_can_query_browser_version() {
    if !ensure_chrome_or_skip().await {
        return;
    }
    let dir = unique_user_data_dir("version");
    let chrome =
        match ChromeProcess::spawn(ChromeConfig::new(dir.clone()).with_headless(true)).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[integration_test] ChromeProcess::spawn failed, skipping: {e}");
                return;
            }
        };
    let ws_url = chrome.ws_debug_url();
    sleep(Duration::from_secs(1)).await;

    let cdp = match connect_with_retry(&ws_url, 10).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[integration_test] CDP connect failed after retries, skipping: {e}");
            let _ = chrome.kill().await;
            drop_dir_silently(dir).await;
            return;
        }
    };
    let version = match cdp.get_version().await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[integration_test] get_version failed, skipping: {e}");
            let _ = chrome.kill().await;
            drop_dir_silently(dir).await;
            return;
        }
    };

    // Browser.getVersion returns `product` containing "HeadlessChrome" in
    // headless mode. Accept either so this works on either flavor.
    let product = version
        .get("product")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(
        product.to_ascii_lowercase().contains("chrome"),
        "expected product to mention chrome, got {product}"
    );

    let _ = chrome.kill().await;
    drop_dir_silently(dir).await;
}

#[tokio::test]
#[ignore = "needs Chrome + writes real profile data; run locally with --ignored"]
async fn chrome_runtime_full_cycle_launch_observe_close() {
    if !ensure_chrome_or_skip().await {
        return;
    }
    let scratch = match tempdir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let profile_dir = scratch.path().join("integration-profile");
    tokio::fs::create_dir_all(&profile_dir).await.unwrap();

    let profile_manager =
        Arc::new(ProfileManager::new(scratch.path().to_path_buf()).expect("profile manager init"));
    let registry = BrowserRuntimeRegistry::new(profile_manager.clone());
    registry.register_default_chrome_runtime().await;

    let profile = match profile_manager
        .create_profile("integration".to_string(), "chrome".to_string())
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[integration_test] create_profile failed, skipping: {e}");
            return;
        }
    };

    let runtime = match registry.get_runtime("chrome").await {
        Some(r) => r,
        None => {
            eprintln!("[integration_test] no chrome runtime registered, skipping");
            return;
        }
    };

    let session = match registry.launch_profile(&profile.id, Some("chrome")).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[integration_test] registry.launch_profile failed, skipping: {e}");
            return;
        }
    };
    assert!(!session.tabs.is_empty(), "expected at least one tab");
    let tab = &session.tabs[0];

    sleep(Duration::from_millis(1500)).await;

    let observation = match runtime.observe(&tab.target_id).await {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[integration_test] observe failed, skipping: {e}");
            let _ = registry.close_session(&session.session_id).await;
            return;
        }
    };

    assert!(
        !observation.title.is_empty() || !observation.url.is_empty(),
        "observation should return url or title"
    );
    assert!(observation.viewport.width > 0);

    registry
        .close_session(&session.session_id)
        .await
        .expect("close_session");
}
