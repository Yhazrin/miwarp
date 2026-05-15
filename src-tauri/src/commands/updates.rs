use reqwest::Client;
use std::sync::LazyLock;
use std::time::Duration;

// ── Constants ──

const GITHUB_API_URL: &str = "https://api.github.com/repos/Yhazrin/miwarp/releases/latest";

// ── HTTP client (reuse across requests) ──

static CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(10))
        .user_agent(format!("MiWarp/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
});

// ── Types ──

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest_version: String,
    pub current_version: String,
    pub download_url: String,
    pub error: String,
}

// ── Version comparison ──

fn parse_version(s: &str) -> Option<([u64; 3], bool)> {
    let s = s.strip_prefix('v').unwrap_or(s);
    let (main, has_pre) = if let Some(idx) = s.find('-') {
        (&s[..idx], true)
    } else {
        (s, false)
    };
    let parts: Vec<&str> = main.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let major = parts[0].parse::<u64>().ok()?;
    let minor = parts[1].parse::<u64>().ok()?;
    let patch = parts[2].parse::<u64>().ok()?;
    Some(([major, minor, patch], has_pre))
}

fn is_newer(current: &str, latest: &str) -> bool {
    let (cur_ver, cur_pre) = match parse_version(current) {
        Some(v) => v,
        None => return false,
    };
    let (lat_ver, lat_pre) = match parse_version(latest) {
        Some(v) => v,
        None => return false,
    };

    if lat_ver > cur_ver {
        return true;
    }
    if lat_ver < cur_ver {
        return false;
    }

    match (cur_pre, lat_pre) {
        (true, false) => true,
        _ => false,
    }
}

fn select_download_url_for_exts(body: &serde_json::Value, preferred_exts: &[&str]) -> String {
    let html_url = body["html_url"].as_str().unwrap_or("").to_string();
    let Some(assets) = body["assets"].as_array() else {
        return html_url;
    };

    for ext in preferred_exts {
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("").to_ascii_lowercase();
            if name.ends_with(ext) {
                if let Some(url) = asset["browser_download_url"].as_str() {
                    return url.to_string();
                }
            }
        }
    }

    for asset in assets {
        if let Some(url) = asset["browser_download_url"].as_str() {
            return url.to_string();
        }
    }

    html_url
}

fn select_download_url(body: &serde_json::Value) -> String {
    #[cfg(target_os = "macos")]
    let exts: &[&str] = &[".dmg"];
    #[cfg(target_os = "windows")]
    let exts: &[&str] = &[".msi", ".exe", ".zip"];
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let exts: &[&str] = &[".appimage", ".deb"];

    select_download_url_for_exts(body, exts)
}

// ── Helpers ──

fn no_update(current_version: String) -> UpdateInfo {
    UpdateInfo {
        has_update: false,
        latest_version: String::new(),
        current_version,
        download_url: String::new(),
        error: String::new(),
    }
}

fn error_info(current_version: String, error: String) -> UpdateInfo {
    log::warn!("[updates] {}", error);
    UpdateInfo {
        has_update: false,
        latest_version: String::new(),
        current_version,
        download_url: String::new(),
        error,
    }
}

// ── Tauri command ──

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    log::debug!(
        "[updates] checking for updates, current={}",
        current_version
    );

    let resp = match CLIENT
        .get(GITHUB_API_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(error_info(current_version, format!("Network error: {}", e)));
        }
    };

    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(error_info(
            current_version,
            "No releases found for this repository".to_string(),
        ));
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        return Ok(error_info(
            current_version,
            "GitHub API rate limit exceeded, try again later".to_string(),
        ));
    }
    if !status.is_success() {
        return Ok(error_info(
            current_version,
            format!("GitHub API error: HTTP {}", status),
        ));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return Ok(error_info(
                current_version,
                format!("Failed to parse response: {}", e),
            ));
        }
    };

    let tag = body["tag_name"].as_str().unwrap_or("");
    let download_url = select_download_url(&body);

    if tag.is_empty() {
        return Ok(error_info(
            current_version,
            "Invalid release data (missing tag)".to_string(),
        ));
    }

    let latest_version = tag.strip_prefix('v').unwrap_or(tag).to_string();
    let has_update = is_newer(&current_version, tag);

    log::debug!(
        "[updates] current={} latest={} has_update={}",
        current_version,
        latest_version,
        has_update
    );

    Ok(UpdateInfo {
        has_update,
        latest_version,
        current_version,
        download_url,
        error: String::new(),
    })
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_normal_upgrade() {
        assert!(is_newer("0.1.2", "v0.1.3"));
    }

    #[test]
    fn test_equal_versions() {
        assert!(!is_newer("0.1.3", "0.1.3"));
    }

    #[test]
    fn test_latest_is_prerelease() {
        assert!(!is_newer("0.1.3", "0.1.3-beta.1"));
    }

    #[test]
    fn test_current_is_prerelease() {
        assert!(is_newer("0.1.3-beta.1", "0.1.3"));
    }

    #[test]
    fn test_downgrade() {
        assert!(!is_newer("0.2.0", "0.1.9"));
    }

    #[test]
    fn test_v_prefix() {
        assert!(is_newer("v0.1.0", "v0.1.1"));
    }

    #[test]
    fn test_invalid_semver() {
        assert!(!is_newer("abc", "0.1.0"));
    }

    #[test]
    fn test_select_download_url_prefers_dmg() {
        let body = json!({
            "html_url": "https://github.com/Yhazrin/miwarp/releases/tag/v1.0.0",
            "assets": [
                { "name": "MiWarp-1.0.0.zip", "browser_download_url": "https://example.com/a.zip" },
                { "name": "MiWarp_1.0.0_universal.dmg", "browser_download_url": "https://example.com/a.dmg" }
            ]
        });
        assert_eq!(
            select_download_url_for_exts(&body, &[".dmg"]),
            "https://example.com/a.dmg"
        );
    }

    #[test]
    fn test_select_download_url_prefers_msi() {
        let body = json!({
            "html_url": "https://github.com/Yhazrin/miwarp/releases/tag/v1.0.0",
            "assets": [
                { "name": "MiWarp-1.0.0.zip", "browser_download_url": "https://example.com/a.zip" },
                { "name": "MiWarp_1.0.0_x64-setup.msi", "browser_download_url": "https://example.com/a.msi" },
                { "name": "MiWarp_1.0.0_x64.exe", "browser_download_url": "https://example.com/a.exe" }
            ]
        });
        assert_eq!(
            select_download_url_for_exts(&body, &[".msi", ".exe"]),
            "https://example.com/a.msi"
        );
    }

    #[test]
    fn test_select_download_url_exe_fallback() {
        let body = json!({
            "html_url": "https://github.com/Yhazrin/miwarp/releases/tag/v1.0.0",
            "assets": [
                { "name": "MiWarp-1.0.0.zip", "browser_download_url": "https://example.com/a.zip" },
                { "name": "MiWarp_1.0.0_x64.exe", "browser_download_url": "https://example.com/a.exe" }
            ]
        });
        assert_eq!(
            select_download_url_for_exts(&body, &[".msi", ".exe"]),
            "https://example.com/a.exe"
        );
    }

    #[test]
    fn test_select_download_url_zip_fallback_on_windows() {
        let body = json!({
            "html_url": "https://github.com/Yhazrin/miwarp/releases/tag/v1.0.0",
            "assets": [
                { "name": "MiWarp_1.0.0_universal.dmg", "browser_download_url": "https://example.com/a.dmg" },
                { "name": "MiWarp_1.0.0_x64-setup.zip", "browser_download_url": "https://example.com/a.zip" }
            ]
        });
        assert_eq!(
            select_download_url_for_exts(&body, &[".msi", ".exe", ".zip"]),
            "https://example.com/a.zip"
        );
    }

    #[test]
    fn test_select_download_url_prefers_appimage() {
        let body = json!({
            "html_url": "https://github.com/Yhazrin/miwarp/releases/tag/v1.0.0",
            "assets": [
                { "name": "MiWarp_1.0.0.AppImage", "browser_download_url": "https://example.com/a.AppImage" }
            ]
        });
        assert_eq!(
            select_download_url_for_exts(&body, &[".appimage", ".deb"]),
            "https://example.com/a.AppImage"
        );
    }

    #[test]
    fn test_select_download_url_falls_back_to_html() {
        let body = json!({
            "html_url": "https://github.com/Yhazrin/miwarp/releases/tag/v1.0.0",
            "assets": []
        });
        assert_eq!(
            select_download_url_for_exts(&body, &[".dmg"]),
            "https://github.com/Yhazrin/miwarp/releases/tag/v1.0.0"
        );
    }
}
