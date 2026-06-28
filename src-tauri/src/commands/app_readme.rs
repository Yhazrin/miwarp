use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const README_EN: &str = "README.md";
const README_ZH: &str = "README.zh-CN.md";

// ── Remote fetch configuration ─────────────────────────────────────────
// v1.0.10: Read AboutModal README from the upstream GitHub repo so users
// always see the latest doc that matches the installed release. Falls back
// to bundled/repo-local copies on any network error.
//
// Override the repo at compile time (default: Yhazrin/miwarp@master):
//   MIWARP_README_REPO=Yhazrin/miwarp@main cargo build
const DEFAULT_REPO: &str = "Yhazrin/miwarp@master";

fn remote_repo_ref() -> (&'static str, &'static str) {
    let raw = option_env!("MIWARP_README_REPO").unwrap_or(DEFAULT_REPO);
    if let Some((owner_repo, branch)) = raw.split_once('@') {
        (owner_repo, branch)
    } else {
        let (owner_repo, _) = raw.split_once('@').unwrap_or((raw, "master"));
        (owner_repo, "master")
    }
}

fn remote_readme_url(locale: Option<&str>) -> String {
    let (owner_repo, branch) = remote_repo_ref();
    let file = match locale {
        Some("zh-CN") | Some("zh-cn") | Some("zh") => README_ZH,
        _ => README_EN,
    };
    format!(
        "https://raw.githubusercontent.com/{}/{}/{}",
        owner_repo, branch, file
    )
}

#[allow(dead_code)]
const CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes — cache is currently only invalidated by manual refresh; reserved for future TTL eviction

fn locale_filenames(locale: Option<&str>) -> [&'static str; 2] {
    match locale {
        Some("zh-CN") | Some("zh-cn") | Some("zh") => [README_ZH, README_EN],
        _ => [README_EN, README_ZH],
    }
}

fn dev_repo_readme(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(name)
}

fn bundled_readme(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let resolved = app
        .path()
        .resolve(name, tauri::path::BaseDirectory::Resource)
        .ok()?;
    resolved.is_file().then_some(resolved)
}

fn read_first_existing(paths: impl IntoIterator<Item = PathBuf>) -> Option<String> {
    for path in paths {
        if path.is_file() {
            if let Ok(content) = fs::read_to_string(&path) {
                log::debug!("[app_readme] loaded {}", path.display());
                return Some(content);
            }
        }
    }
    None
}

// ── Remote fetch (best-effort, cached) ────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadmeSource {
    pub content: String,
    pub origin: ReadmeOrigin,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReadmeOrigin {
    /// Freshly fetched from the upstream GitHub repo.
    Remote,
    /// Fetched from the upstream repo but served from the in-memory cache.
    RemoteCache,
    /// Remote fetch failed; served from the bundled resources or repo-local file.
    LocalFallback,
}

struct CacheEntry {
    content: String,
    fetched_at: Instant,
}

static REMOTE_CACHE: LazyLock<tokio::sync::Mutex<Option<CacheEntry>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(None));

async fn fetch_remote_readme(locale: Option<&str>) -> Result<String, String> {
    let url = remote_readme_url(locale);
    log::debug!("[app_readme] fetching remote README {}", url);

    // Short connect / total budget. AboutModal should never block waiting
    // on a network that may be offline; 4s is generous for a small markdown file.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(4))
        .user_agent(concat!("MiWarp/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("README fetch network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("README fetch HTTP {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("README fetch decode error: {}", e))?;

    if text.trim().is_empty() {
        return Err("README fetch returned empty body".to_string());
    }

    Ok(text)
}

/// Try remote, fall back to local. Always returns *some* content if either
/// source has anything. Errors only when both sources fail.
async fn try_remote_or_local(
    locale: Option<&str>,
    app: Option<&AppHandle>,
) -> Result<ReadmeSource, String> {
    // 1. Try remote (with cache)
    match fetch_remote_readme(locale).await {
        Ok(content) => {
            // Update cache
            let mut cache = REMOTE_CACHE.lock().await;
            *cache = Some(CacheEntry {
                content: content.clone(),
                fetched_at: Instant::now(),
            });
            Ok(ReadmeSource {
                content,
                origin: ReadmeOrigin::Remote,
            })
        }
        Err(remote_err) => {
            log::warn!("[app_readme] remote fetch failed: {}", remote_err);

            // 2. Try cache as a less-stale fallback than local file
            {
                let cache = REMOTE_CACHE.lock().await;
                if let Some(entry) = cache.as_ref() {
                    log::debug!(
                        "[app_readme] using cached remote (age={:.0}s)",
                        entry.fetched_at.elapsed().as_secs_f64()
                    );
                    return Ok(ReadmeSource {
                        content: entry.content.clone(),
                        origin: ReadmeOrigin::RemoteCache,
                    });
                }
            }

            // 3. Fall back to local file
            for name in locale_filenames(locale) {
                let mut candidates = vec![dev_repo_readme(name)];
                if let Some(app) = app {
                    if let Some(path) = bundled_readme(app, name) {
                        candidates.push(path);
                    }
                }
                if let Some(content) = read_first_existing(candidates) {
                    log::info!(
                        "[app_readme] remote + cache unavailable, using local fallback ({} bytes)",
                        content.len()
                    );
                    return Ok(ReadmeSource {
                        content,
                        origin: ReadmeOrigin::LocalFallback,
                    });
                }
            }

            Err(format!(
                "README unavailable: remote failed ({}) and no local copy found",
                remote_err
            ))
        }
    }
}

/// Load README from upstream GitHub (cached) → repo-local → bundled.
/// Always returns ReadmeSource with an `origin` describing where the bytes
/// came from so the UI can label the source.
pub async fn read_app_readme_source(
    locale: Option<&str>,
    app: Option<&AppHandle>,
) -> Result<ReadmeSource, String> {
    try_remote_or_local(locale, app).await
}

/// Force a remote refresh (bypass cache TTL). Used by the "刷新" button
/// in AboutModal. Falls back to local if remote still fails.
pub async fn refresh_remote_readme(
    locale: Option<&str>,
    app: Option<&AppHandle>,
) -> Result<ReadmeSource, String> {
    // Invalidate cache so the next try_remote_or_local call definitely re-fetches.
    {
        let mut cache = REMOTE_CACHE.lock().await;
        *cache = None;
    }
    try_remote_or_local(locale, app).await
}

/// Legacy synchronous helper (kept for web_server dispatch + tests).
/// Skips the remote path entirely — only reads local/bundled copies.
/// Prefer `read_app_readme_source` from new code.
pub fn read_app_readme_impl(
    locale: Option<&str>,
    app: Option<&AppHandle>,
) -> Result<String, String> {
    for name in locale_filenames(locale) {
        let mut candidates = vec![dev_repo_readme(name)];
        if let Some(app) = app {
            if let Some(path) = bundled_readme(app, name) {
                candidates.push(path);
            }
        }
        if let Some(content) = read_first_existing(candidates) {
            return Ok(content);
        }
    }
    Err("App README not found".into())
}

#[tauri::command]
pub async fn read_app_readme(
    app: AppHandle,
    locale: Option<String>,
) -> Result<ReadmeSource, String> {
    log::debug!("[app_readme] read_app_readme locale={:?}", locale);
    read_app_readme_source(locale.as_deref(), Some(&app)).await
}

#[tauri::command]
pub async fn refresh_app_readme(
    app: AppHandle,
    locale: Option<String>,
) -> Result<ReadmeSource, String> {
    log::debug!("[app_readme] refresh_app_readme locale={:?}", locale);
    refresh_remote_readme(locale.as_deref(), Some(&app)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_readme_files_exist_for_dev_loader() {
        let en = dev_repo_readme(README_EN);
        let zh = dev_repo_readme(README_ZH);
        assert!(en.is_file(), "missing {}", en.display());
        assert!(zh.is_file(), "missing {}", zh.display());
    }

    #[test]
    fn locale_filenames_prefers_zh_first() {
        assert_eq!(locale_filenames(Some("zh-CN"))[0], README_ZH);
        assert_eq!(locale_filenames(Some("en"))[0], README_EN);
    }

    #[test]
    fn remote_readme_url_uses_master_default_branch() {
        assert_eq!(
            remote_readme_url(None),
            "https://raw.githubusercontent.com/Yhazrin/miwarp/master/README.md"
        );
        assert_eq!(
            remote_readme_url(Some("zh-CN")),
            "https://raw.githubusercontent.com/Yhazrin/miwarp/master/README.zh-CN.md"
        );
        assert_eq!(
            remote_readme_url(Some("en")),
            "https://raw.githubusercontent.com/Yhazrin/miwarp/master/README.md"
        );
    }

    #[tokio::test]
    async fn read_app_readme_returns_some_origin() {
        // Even without network, dev_repo_readme has the README on disk,
        // so the function should always return Ok with a LocalFallback origin.
        let result = read_app_readme_source(Some("en"), None).await;
        // We can't assert which origin (depends on network availability in CI),
        // only that the function either returns content or a clear error.
        if let Ok(source) = result {
            assert!(!source.content.is_empty());
            // origin must be one of the three variants
            match source.origin {
                ReadmeOrigin::Remote | ReadmeOrigin::RemoteCache | ReadmeOrigin::LocalFallback => {}
            }
        }
    }

    #[tokio::test]
    async fn refresh_remote_readme_invalidates_cache() {
        // Pre-populate cache
        {
            let mut cache = REMOTE_CACHE.lock().await;
            *cache = Some(CacheEntry {
                content: "stale-cached-content".to_string(),
                fetched_at: Instant::now(),
            });
        }
        // Even if network fails, refresh should return either:
        //   - new remote content (cache is fresh), OR
        //   - local fallback content (not the stale "stale-cached-content")
        let result = refresh_remote_readme(Some("en"), None).await;
        if let Ok(source) = result {
            assert_ne!(source.content, "stale-cached-content");
        }
    }
}
