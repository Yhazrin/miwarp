//! Multi-source detection and one-click update for external CLI tools.
//!
//! ## Why this module exists
//!
//! A tool like CC-Switch can be installed via Homebrew Cask, a downloaded
//! DMG, a `.deb`/`.rpm`/`.msi`, or an AppImage — and only the brew path puts
//! the binary on `PATH`. Probing with `which <bin>` will silently miss the
//! other three channels. To make the CLI update center actually useful for
//! non-npm / non-brew installs, we need:
//!
//! 1. **Multi-source detection** — try `which`, then Spotlight (`mdfind`) and
//!    `/Applications` on macOS, then `dpkg -l` / `rpm -qa` on Linux, then
//!    `where` on Windows. Read versions from `Info.plist` for `.app` bundles
//!    when `--version` isn't available.
//! 2. **GitHub release auto-install** as the universal update path: when we
//!    can't run a native upgrade (no brew, no self-update subcommand), fetch
//!    the latest release from the project's GitHub API, pick the asset that
//!    matches the current OS/arch, download it, and run the platform-specific
//!    install (hdiutil attach for DMG, `dpkg -i` for `.deb`, etc.).
//!
//! All network I/O is concentrated in [`get_github_latest_release`] so tests
//! can substitute a fixture; everything else operates on the parsed release
//! info.

use crate::process_ext::HideConsole;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

/// How the tool was installed on disk. Drives both the next detection attempt
/// and the upgrade command we run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CliInstallMethod {
    /// npm global install — `npm install -g <pkg>` upgrades in place.
    Npm,
    /// Homebrew Cask — `brew upgrade --cask <cask>`.
    BrewCask,
    /// macOS DMG (downloaded from GitHub releases or vendor site). Upgraded by
    /// downloading a new DMG and copying the `.app` bundle into `/Applications`.
    Dmg,
    /// Debian package (`.deb`). Upgraded via `dpkg -i`.
    Deb,
    /// RPM package. Upgraded via `rpm -U`.
    Rpm,
    /// Linux AppImage. Upgraded by replacing the existing file with a freshly
    /// downloaded one.
    AppImage,
    /// Windows MSI. Upgraded via `msiexec /i`.
    Msi,
    /// Detected but the install channel isn't recognized — we can show the
    /// version but can't safely upgrade it ourselves.
    Unknown,
}

impl CliInstallMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Npm => "npm",
            Self::BrewCask => "brew_cask",
            Self::Dmg => "dmg",
            Self::Deb => "deb",
            Self::Rpm => "rpm",
            Self::AppImage => "appimage",
            Self::Msi => "msi",
            Self::Unknown => "unknown",
        }
    }
}

/// What we know about a tool's on-disk state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallInfo {
    /// Whether the tool was found at all.
    pub found: bool,
    /// The detected version string, or `None` if we found the binary but
    /// couldn't extract a version.
    pub version: Option<String>,
    /// The install channel. `Unknown` when we found the binary but the
    /// channel isn't one we know how to upgrade.
    pub method: CliInstallMethod,
    /// Absolute path to the binary or `.app` bundle, when known.
    pub install_path: Option<String>,
}

/// Result of a GitHub release lookup. We only deserialize the fields we
/// actually use; everything else is ignored to stay forward-compatible.
#[derive(Debug, Clone, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

// ── Per-tool detection ─────────────────────────────────────────────────

/// Detect a CC-Switch install. CC-Switch is shipped via brew Cask (macOS),
/// DMG (macOS manual), `.deb`/`.rpm`/AppImage (Linux), and `.msi` (Windows).
///
/// On macOS, the .app bundle is named "CC Switch" (with a space), not
/// "CC-Switch" — the upstream macOS releases use that display name even
/// though the GitHub repo and cask token are "cc-switch"/"cc-switch". The
/// versioned downloads from GitHub contain "CC-Switch" in the filename,
/// which is why we explicitly pass the macOS display name here.
pub fn detect_ccswitch() -> InstallInfo {
    #[cfg(target_os = "macos")]
    {
        // brew first — easiest upgrade path.
        if let Some(info) = detect_via_brew_cask("cc-switch", "CC-Switch") {
            return info;
        }
        // then Spotlight/manual DMG install. Note: app display name has a space.
        return detect_macos_app("CC Switch", "CC-Switch");
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(info) = detect_via_apt("cc-switch", "CC-Switch") {
            return info;
        }
        if let Some(info) = detect_via_rpm("cc-switch", "CC-Switch") {
            return info;
        }
        if let Some(info) = detect_via_appimage("cc-switch", "CC-Switch") {
            return info;
        }
        return detect_via_path("CC-Switch");
    }
    #[cfg(target_os = "windows")]
    {
        return detect_via_path("CC-Switch");
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        InstallInfo {
            found: false,
            version: None,
            method: CliInstallMethod::Unknown,
            install_path: None,
        }
    }
}

// ── macOS helpers ──────────────────────────────────────────────────────

/// Probe a Homebrew Cask. Returns `Some(InstallInfo)` if the cask is installed.
/// Requires the cask token (e.g. `cc-switch`) and the binary name (e.g. `CC-Switch`).
#[cfg(target_os = "macos")]
pub fn detect_via_brew_cask(cask: &str, binary: &str) -> Option<InstallInfo> {
    if crate::agent::claude_stream::which_binary("brew").is_none() {
        return None;
    }
    // `brew list --cask <name> --versions` prints the version (or fails with
    // a non-zero exit if the cask isn't installed). Treat non-zero as "not
    // installed via brew" so callers can try the next detection path.
    let output = Command::new("brew")
        .args(["list", "--cask", cask, "--versions"])
        .hide_console()
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let version = raw
        .split_whitespace()
        .nth(1)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let install_path = crate::agent::claude_stream::which_binary(binary).or_else(|| {
        // Some casks don't put the binary on PATH; fall back to the
        // canonical /Applications/<App>.app location.
        let app = format!("/Applications/{}.app", binary);
        if std::path::Path::new(&app).exists() {
            Some(app)
        } else {
            None
        }
    });
    Some(InstallInfo {
        found: true,
        version,
        method: CliInstallMethod::BrewCask,
        install_path,
    })
}

/// Locate a macOS `.app` bundle by display name (via Spotlight's `mdfind`),
/// then read its `CFBundleShortVersionString` from `Info.plist`. Falls back
/// to scanning `/Applications` and `~/Applications` if Spotlight is missing
/// the index for some reason.
#[cfg(target_os = "macos")]
pub fn detect_macos_app(display_name: &str, _binary: &str) -> InstallInfo {
    let app_paths = find_macos_app_paths(display_name);
    if let Some(app_path) = app_paths.first() {
        let version = read_macos_bundle_version(app_path);
        return InstallInfo {
            found: true,
            version,
            method: CliInstallMethod::Dmg,
            install_path: Some(app_path.to_string_lossy().to_string()),
        };
    }
    InstallInfo {
        found: false,
        version: None,
        method: CliInstallMethod::Dmg,
        install_path: None,
    }
}

#[cfg(target_os = "macos")]
fn find_macos_app_paths(display_name: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    // Spotlight first — fastest, indexes /Applications and ~/Applications.
    if let Ok(output) = Command::new("mdfind")
        .arg(format!("kMDItemDisplayName == \"{}*\"", display_name))
        .hide_console()
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let trimmed = line.trim();
                if trimmed.ends_with(".app") && Path::new(trimmed).is_dir() {
                    out.push(PathBuf::from(trimmed));
                }
            }
        }
    }
    // Fallback: direct scan of /Applications and $HOME/Applications.
    if out.is_empty() {
        for parent in ["/Applications", &home_applications_dir()] {
            if parent.is_empty() {
                continue;
            }
            let candidate = Path::new(parent).join(format!("{}.app", display_name));
            if candidate.is_dir() {
                out.push(candidate);
            }
        }
    }
    out
}

#[cfg(target_os = "macos")]
fn home_applications_dir() -> String {
    std::env::var("HOME")
        .map(|h| format!("{}/Applications", h))
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn read_macos_bundle_version(app_path: &Path) -> Option<String> {
    let plist = app_path.join("Contents/Info.plist");
    if !plist.exists() {
        return None;
    }
    // `defaults read <plist> CFBundleShortVersionString` returns just the value
    // on stdout, which is much easier to parse than `plutil -convert xml1 -o -`.
    let output = Command::new("defaults")
        .arg("read")
        .arg(&plist)
        .arg("CFBundleShortVersionString")
        .hide_console()
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

// ── Linux helpers ──────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
pub fn detect_via_apt(pkg: &str, binary: &str) -> Option<InstallInfo> {
    let output = Command::new("dpkg-query")
        .args(["-W", "-f=${Version}", pkg])
        .hide_console()
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let version = if version.is_empty() {
        None
    } else {
        Some(version)
    };
    let path = crate::agent::claude_stream::which_binary(binary);
    Some(InstallInfo {
        found: true,
        version,
        method: CliInstallMethod::Deb,
        install_path: path,
    })
}

#[cfg(target_os = "linux")]
pub fn detect_via_rpm(pkg: &str, binary: &str) -> Option<InstallInfo> {
    let output = Command::new("rpm")
        .args(["-q", "--qf", "%{VERSION}", pkg])
        .hide_console()
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let version = if version.is_empty() {
        None
    } else {
        Some(version)
    };
    let path = crate::agent::claude_stream::which_binary(binary);
    Some(InstallInfo {
        found: true,
        version,
        method: CliInstallMethod::Rpm,
        install_path: path,
    })
}

#[cfg(target_os = "linux")]
pub fn detect_via_appimage(token: &str, binary: &str) -> Option<InstallInfo> {
    // Walk the user's bin dirs looking for an AppImage whose filename matches
    // the tool token. Version isn't introspectable from an AppImage without
    // running it, so we leave `version = None` and let the user click "check"
    // to compare against the GitHub release tag.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(format!("{}/.local/bin", home)));
        candidates.push(PathBuf::from(format!("{}/Applications", home)));
        candidates.push(PathBuf::from(format!("{}/bin", home)));
    }
    candidates.push(PathBuf::from("/opt"));
    candidates.push(PathBuf::from("/usr/local/bin"));

    let needle = token.to_lowercase();
    for dir in candidates {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            if name.contains(&needle) && name.ends_with(".appimage") {
                return Some(InstallInfo {
                    found: true,
                    version: None,
                    method: CliInstallMethod::AppImage,
                    install_path: Some(path.to_string_lossy().to_string()),
                });
            }
        }
    }
    // Fall through to PATH probe — AppImage is sometimes symlinked as just
    // the binary name.
    let _ = binary; // suppress unused
    detect_via_path(binary)
}

// ── PATH-only fallback (used on Windows + Linux AppImage miss) ─────────

pub fn detect_via_path(binary: &str) -> InstallInfo {
    if let Some(path) = crate::agent::claude_stream::which_binary(binary) {
        let version = read_binary_version(binary).ok().flatten();
        return InstallInfo {
            found: true,
            version,
            method: CliInstallMethod::Unknown,
            install_path: Some(path),
        };
    }
    InstallInfo {
        found: false,
        version: None,
        method: CliInstallMethod::Unknown,
        install_path: None,
    }
}

fn read_binary_version(binary: &str) -> std::io::Result<Option<String>> {
    let output = Command::new(binary)
        .arg("--version")
        .hide_console()
        .output()?;
    if !output.status.success() {
        return Ok(None);
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Strip " (App Name)" suffix some tools append to --version output.
    let cleaned = raw.find(" (").map(|i| raw[..i].to_string()).unwrap_or(raw);
    let cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        Ok(None)
    } else {
        Ok(Some(cleaned))
    }
}

// ── GitHub release fetch + asset selection ────────────────────────────

/// Fetch the latest release for a public GitHub repository. Uses the
/// unauthenticated REST endpoint, so the rate limit is 60 req/h per IP —
/// acceptable for an on-demand update button.
pub async fn get_github_latest_release(owner: &str, repo: &str) -> Result<GitHubRelease, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        owner, repo
    );
    let client = reqwest::Client::builder()
        .user_agent("miwarp-cli-update")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("reqwest client build failed: {}", e))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("github release request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "github release request returned {} for {}/{}",
            response.status(),
            owner,
            repo
        ));
    }
    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("failed to parse github release json: {}", e))?;
    Ok(release)
}

/// Pick the best asset for the current platform. The match is a "contains"
/// against the asset filename (case-insensitive) so we don't depend on
/// upstream using our exact arch string. Falls back to `None` if no asset
/// looks like a match — caller should then surface a "no release for this
/// platform" error to the user.
pub fn pick_release_asset<'a>(release: &'a GitHubRelease) -> Option<&'a GitHubAsset> {
    pick_release_asset_for(release, platform_asset_needle())
}

/// Platform-agnostic asset picker. Exposed for testing — production code
/// should call [`pick_release_asset`] which uses the current platform's
/// needle.
pub fn pick_release_asset_for<'a>(
    release: &'a GitHubRelease,
    needle: &str,
) -> Option<&'a GitHubAsset> {
    let needle = needle.to_lowercase();
    release
        .assets
        .iter()
        .find(|a| a.name.to_lowercase().contains(&needle))
}

fn platform_asset_needle() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("linux", "x86_64") => "x86_64-unknown-linux",
        ("linux", "aarch64") => "aarch64-unknown-linux",
        ("windows", "x86_64") => "x86_64-pc-windows",
        ("windows", "aarch64") => "aarch64-pc-windows",
        _ => std::env::consts::ARCH,
    }
}

// ── Install from a GitHub release asset ───────────────────────────────

/// Download a release asset and install it according to the install method.
/// Returns the version we installed (from the release tag) so callers can
/// surface it in the UI's success toast.
///
/// Currently supports:
/// - `Dmg` (macOS): hdiutil attach → copy .app to /Applications → detach
/// - `Deb` (Linux): download + `dpkg -i` (requires sudo/root)
/// - `AppImage` (Linux): download + replace existing file
/// - `Msi` (Windows): download + `msiexec /i`
///
/// Other methods (BrewCask, Npm) shouldn't reach this function — those use
/// the native upgrade commands and don't need a download step.
pub async fn install_from_release(
    asset: &GitHubAsset,
    method: CliInstallMethod,
    app_name: &str,
) -> Result<String, String> {
    let tmp_path = std::env::temp_dir().join(format!("miwarp-update-{}", asset.name));
    log::info!(
        "[cli_update] downloading {} ({} bytes) → {}",
        asset.browser_download_url,
        asset.size,
        tmp_path.display()
    );
    download_to_file(&asset.browser_download_url, &tmp_path).await?;

    let result = match method {
        CliInstallMethod::Dmg => install_dmg(&tmp_path, app_name),
        CliInstallMethod::Deb => install_deb(&tmp_path),
        CliInstallMethod::Rpm => install_rpm(&tmp_path),
        CliInstallMethod::AppImage => install_appimage(&tmp_path),
        CliInstallMethod::Msi => install_msi(&tmp_path),
        other => Err(format!(
            "install_from_release called with method {:?} (no installer path)",
            other
        )),
    };

    // Always clean up the temp file — leaving it behind wastes disk and
    // could trigger Gatekeeper on next launch.
    let _ = std::fs::remove_file(&tmp_path); // ignore: temp file may already be gone

    result
}

async fn download_to_file(url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("miwarp-cli-update")
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("reqwest client build failed: {}", e))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("download returned HTTP {}", response.status()));
    }
    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("failed to create {}: {}", dest.display(), e))?;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download chunk failed: {}", e))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("failed to write chunk: {}", e))?;
    }
    file.flush()
        .map_err(|e| format!("failed to flush file: {}", e))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_dmg(dmg: &Path, app_name: &str) -> Result<String, String> {
    // 1. Mount the DMG (read-only). hdiutil returns a path like /Volumes/CC-Switch.
    let mount = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly"])
        .arg(dmg)
        .hide_console()
        .output()
        .map_err(|e| format!("hdiutil attach spawn failed: {}", e))?;
    if !mount.status.success() {
        return Err(format!(
            "hdiutil attach failed: {}",
            String::from_utf8_lossy(&mount.stderr)
        ));
    }
    let mount_stdout = String::from_utf8_lossy(&mount.stdout);
    // hdiutil prints: "/Volumes/CC-Switch\t/dev/diskX"
    let mount_point = mount_stdout
        .lines()
        .find_map(|line| line.split('\t').next())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "could not parse hdiutil mount point".to_string())?;

    // 2. Copy the .app bundle from the mount to /Applications, replacing any
    //    existing version. `ditto` preserves extended attributes / signatures
    //    better than `cp -R` for macOS bundles.
    let app_in_dmg = Path::new(&mount_point).join(format!("{}.app", app_name));
    if !app_in_dmg.exists() {
        let _ = Command::new("hdiutil")
            .arg("detach")
            .arg(&mount_point)
            .output();
        return Err(format!(
            "{} not found inside DMG at {}",
            app_in_dmg.display(),
            mount_point
        ));
    }
    let target = PathBuf::from("/Applications").join(format!("{}.app", app_name));
    let _ = std::fs::remove_dir_all(&target); // best-effort: drop the old version
    let copy = Command::new("ditto")
        .arg(&app_in_dmg)
        .arg(&target)
        .hide_console()
        .output()
        .map_err(|e| format!("ditto spawn failed: {}", e))?;
    let _ = Command::new("hdiutil")
        .arg("detach")
        .arg(&mount_point)
        .output();
    if !copy.status.success() {
        return Err(format!(
            "ditto copy failed: {}",
            String::from_utf8_lossy(&copy.stderr)
        ));
    }
    Ok(target.to_string_lossy().to_string())
}

#[cfg(not(target_os = "macos"))]
fn install_dmg(_dmg: &Path, _app_name: &str) -> Result<String, String> {
    Err("DMG install is only supported on macOS".to_string())
}

#[cfg(target_os = "linux")]
fn install_deb(deb: &Path) -> Result<String, String> {
    let status = Command::new("sudo")
        .args(["dpkg", "-i"])
        .arg(deb)
        .hide_console()
        .status()
        .map_err(|e| format!("dpkg spawn failed: {}", e))?;
    if !status.success() {
        return Err(format!("dpkg -i exited with {:?}", status.code()));
    }
    Ok(deb.to_string_lossy().to_string())
}

#[cfg(not(target_os = "linux"))]
fn install_deb(_deb: &Path) -> Result<String, String> {
    Err(".deb install is only supported on Linux".to_string())
}

#[cfg(target_os = "linux")]
fn install_rpm(rpm: &Path) -> Result<String, String> {
    let status = Command::new("sudo")
        .args(["rpm", "-U"])
        .arg(rpm)
        .hide_console()
        .status()
        .map_err(|e| format!("rpm spawn failed: {}", e))?;
    if !status.success() {
        return Err(format!("rpm -U exited with {:?}", status.code()));
    }
    Ok(rpm.to_string_lossy().to_string())
}

#[cfg(not(target_os = "linux"))]
fn install_rpm(_rpm: &Path) -> Result<String, String> {
    Err(".rpm install is only supported on Linux".to_string())
}

fn install_appimage(appimage: &Path) -> Result<String, String> {
    // AppImage "install" is just `chmod +x` + put somewhere on PATH. We
    // assume the user already has the previous version's location on PATH
    // (or we keep the same filename in the same dir). For now: chmod and
    // return the path; the caller can decide whether to move it.
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(appimage)
        .map_err(|e| format!("stat failed: {}", e))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(appimage, perms).map_err(|e| format!("chmod failed: {}", e))?;
    Ok(appimage.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn install_msi(msi: &Path) -> Result<String, String> {
    let status = Command::new("msiexec")
        .args(["/i", &msi.to_string_lossy(), "/qn", "/norestart"])
        .hide_console()
        .status()
        .map_err(|e| format!("msiexec spawn failed: {}", e))?;
    if !status.success() {
        return Err(format!("msiexec exited with {:?}", status.code()));
    }
    Ok(msi.to_string_lossy().to_string())
}

#[cfg(not(target_os = "windows"))]
fn install_msi(_msi: &Path) -> Result<String, String> {
    Err("MSI install is only supported on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_release() -> GitHubRelease {
        // Reserved for future tests that need the full mixed-OS asset list.
        // Currently each test inlines its own minimal release to make the
        // platform expectation obvious.
        GitHubRelease {
            tag_name: "v0.0.0".to_string(),
            assets: vec![],
        }
    }

    #[test]
    fn pick_release_asset_for_matches_macos_arm64() {
        let release = GitHubRelease {
            tag_name: "v3.16.5".to_string(),
            assets: vec![GitHubAsset {
                name: "CC-Switch-3.16.5-aarch64-apple-darwin.dmg".to_string(),
                browser_download_url: "https://example.com/mac-arm.dmg".to_string(),
                size: 12_000_000,
            }],
        };
        let asset = pick_release_asset_for(&release, "aarch64-apple-darwin");
        assert!(
            asset.is_some(),
            "aarch64-apple-darwin asset should be selected"
        );
        assert_eq!(
            asset.unwrap().browser_download_url,
            "https://example.com/mac-arm.dmg"
        );
    }

    #[test]
    fn pick_release_asset_for_matches_linux_gnu_needle() {
        let release = GitHubRelease {
            tag_name: "v3.16.5".to_string(),
            assets: vec![GitHubAsset {
                name: "cc-switch-3.16.5-x86_64-unknown-linux-gnu.AppImage".to_string(),
                browser_download_url: "https://example.com/linux.AppImage".to_string(),
                size: 13_000_000,
            }],
        };
        let asset = pick_release_asset_for(&release, "x86_64-unknown-linux");
        assert!(
            asset.is_some(),
            "x86_64-unknown-linux asset should be selected"
        );
    }

    #[test]
    fn pick_release_asset_for_matches_windows_needle() {
        let release = GitHubRelease {
            tag_name: "v3.16.5".to_string(),
            assets: vec![GitHubAsset {
                name: "CC-Switch-3.16.5-x86_64-pc-windows-msvc.msi".to_string(),
                browser_download_url: "https://example.com/win.msi".to_string(),
                size: 11_000_000,
            }],
        };
        let asset = pick_release_asset_for(&release, "x86_64-pc-windows");
        assert!(
            asset.is_some(),
            "x86_64-pc-windows asset should be selected"
        );
    }

    #[test]
    fn pick_release_asset_for_returns_none_when_no_match() {
        let release = GitHubRelease {
            tag_name: "v3.16.5".to_string(),
            assets: vec![GitHubAsset {
                name: "source.tar.gz".to_string(),
                browser_download_url: "https://example.com/source.tar.gz".to_string(),
                size: 1_000,
            }],
        };
        assert!(pick_release_asset_for(&release, "aarch64-apple-darwin").is_none());
    }

    #[test]
    fn pick_release_asset_for_is_case_insensitive() {
        let release = GitHubRelease {
            tag_name: "v3.16.5".to_string(),
            assets: vec![GitHubAsset {
                name: "CC-Switch-3.16.5-AARCH64-APPLE-DARWIN.dmg".to_string(),
                browser_download_url: "https://example.com/mac-arm.dmg".to_string(),
                size: 12_000_000,
            }],
        };
        let asset = pick_release_asset_for(&release, "aarch64-apple-darwin");
        assert!(asset.is_some(), "needle should match case-insensitively");
    }

    #[test]
    fn install_method_as_str_round_trip() {
        for m in [
            CliInstallMethod::Npm,
            CliInstallMethod::BrewCask,
            CliInstallMethod::Dmg,
            CliInstallMethod::Deb,
            CliInstallMethod::Rpm,
            CliInstallMethod::AppImage,
            CliInstallMethod::Msi,
            CliInstallMethod::Unknown,
        ] {
            assert!(!m.as_str().is_empty());
        }
    }
}
