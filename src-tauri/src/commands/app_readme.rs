use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const README_EN: &str = "README.md";
const README_ZH: &str = "README.zh-CN.md";

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

/// Load README from repo root in dev (live edits) or bundled resources in release.
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
pub fn read_app_readme(app: AppHandle, locale: Option<String>) -> Result<String, String> {
    log::debug!("[app_readme] read_app_readme locale={:?}", locale);
    read_app_readme_impl(locale.as_deref(), Some(&app))
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
}
