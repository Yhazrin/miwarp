use crate::models::{DirEntry, DirListing};
use base64::Engine;

const EXCLUDED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    "__pycache__",
    ".next",
    ".svelte-kit",
    ".turbo",
];

#[tauri::command]
pub fn list_directory(path: String, show_hidden: Option<bool>) -> Result<DirListing, String> {
    let show_hidden = show_hidden.unwrap_or(false);
    log::debug!(
        "[fs] list_directory: path={}, show_hidden={}",
        path,
        show_hidden
    );
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !dir.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries: Vec<DirEntry> = vec![];
    let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files unless requested
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        // Always skip noise directories
        if metadata.is_dir() && EXCLUDED_DIRS.contains(&name.as_str()) {
            continue;
        }
        entries.push(DirEntry {
            name,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }

    entries.sort_by(|a, b| {
        // Directories first, then alphabetical
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(DirListing {
        path: path.to_string(),
        entries,
    })
}

#[tauri::command]
pub fn check_is_directory(path: String) -> bool {
    let result = std::path::Path::new(&path).is_dir();
    log::debug!("[fs] check_is_directory: path={path}, result={result}");
    result
}

/// Maximum file size for base64 read (100 MB).
/// Shared by chat drag-drop and Explorer image preview.
const MAX_BASE64_FILE_SIZE: u64 = 100 * 1024 * 1024;

/// Resolve the trusted fallback root used when `cwd` is `None` and no
/// `drop_grant` was issued.
///
/// Preference order:
/// 1. Global user `working_directory` from settings (if set and exists)
/// 2. `~/.miwarp` (data dir)
/// 3. `~/.claude` (Claude config dir)
///
/// Returns `None` only if none of these resolve — in that case
/// `read_file_base64` will reject the call outright.
fn resolve_fallback_root() -> Option<std::path::PathBuf> {
    let s = crate::storage::settings::get_user_settings();
    let home = crate::storage::home_dir()
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    resolve_fallback_root_with(
        s.working_directory.as_deref(),
        &crate::storage::data_dir(),
        &home,
    )
}

/// Pure resolver used by `resolve_fallback_root` and by unit tests.
/// All inputs are injected so the function does **not** read live
/// `~/.miwarp/settings.json` — that was the source of the test
/// pollution in the original P0-1 implementation.
pub(crate) fn resolve_fallback_root_with(
    working_directory: Option<&str>,
    data_dir: &std::path::Path,
    home_dir: &std::path::Path,
) -> Option<std::path::PathBuf> {
    if let Some(wd) = working_directory {
        let p = std::path::PathBuf::from(wd);
        if p.exists() {
            if let Ok(c) = std::fs::canonicalize(&p) {
                return Some(c);
            }
        }
    }
    if data_dir.exists() {
        if let Ok(c) = std::fs::canonicalize(data_dir) {
            return Some(c);
        }
    }
    let claude = home_dir.join(".claude");
    if claude.exists() {
        if let Ok(c) = std::fs::canonicalize(&claude) {
            return Some(c);
        }
    }
    None
}

/// Issue a one-time grant for a list of absolute paths the user just
/// dropped into the window. The returned grant id is then threaded
/// through to `read_file_base64` so the file read can succeed without
/// re-opening the SSRF-like hole the P0-1 fix closed.
#[tauri::command]
pub fn issue_drop_grant(paths: Vec<String>) -> Result<String, String> {
    log::debug!("[fs] issue_drop_grant: {} paths", paths.len());
    super::fs_drop_grant::issue_grant(paths)
}

/// Read a file as base64 with MIME detection.
///
/// **Path validation (P0-1 + P0-1 hardening)**: every request is validated
/// against exactly one of three trusted scopes:
///
/// 1. **`cwd`** (project dir the renderer is currently viewing)
/// 2. **`grant`** (one-time user-gesture grant for a Tauri file drop)
/// 3. **trusted fallback root** (user `working_directory` / `~/.miwarp` /
///    `~/.claude`) — only reachable when neither `cwd` nor `grant` was
///    provided AND the trusted root resolves.
///
/// Browser-mode IPC / WebSocket callers cannot obtain a `grant`, so
/// they remain restricted to `cwd` or the fallback root. Native drag-drop
/// is restored because the renderer thread an `issue_drop_grant` call
/// before reaching here.
#[tauri::command]
pub fn read_file_base64(
    path: String,
    cwd: Option<String>,
    grant: Option<String>,
) -> Result<(String, String), String> {
    log::debug!(
        "[fs] read_file_base64: path={path}, cwd={cwd:?}, grant_present={}",
        grant.is_some()
    );
    let validated = if let Some(grant_id) = grant.as_deref() {
        // User-gesture grant flow: any path the user just dropped into
        // the window is allowed for the lifetime of the grant.
        let p = std::path::Path::new(&path);
        match super::fs_drop_grant::check_grant(grant_id, p) {
            Ok(true) => std::path::PathBuf::from(&path),
            Ok(false) => {
                log::warn!(
                    "[fs] read_file_base64 denied: grant {} does not cover path",
                    grant_id
                );
                return Err(ACCESS_DENIED.to_string());
            }
            Err(e) => {
                log::warn!("[fs] read_file_base64 denied: grant check failed: {e}");
                return Err(ACCESS_DENIED.to_string());
            }
        }
    } else if cwd.is_some() {
        super::files::validate_file_path(&path, cwd.as_deref()).map_err(|e| {
            // P0-1: scrub full path from any error returned to the client.
            // The detailed path is logged server-side but never echoed back.
            log::warn!("[fs] read_file_base64 denied (cwd=Some): {e}");
            if e.contains("Access denied") || e.contains("Path traversal") {
                ACCESS_DENIED.to_string()
            } else {
                e
            }
        })?
    } else {
        let fallback = resolve_fallback_root().ok_or_else(|| {
            log::warn!(
                "[fs] read_file_base64 denied: cwd=None and no trusted fallback root available"
            );
            ACCESS_DENIED.to_string()
        })?;
        // Use the fallback as the `extra_allowed` so validate_file_path runs
        // the same canonicalize + prefix check it would for any cwd.
        super::files::validate_file_path(&path, Some(fallback.to_string_lossy().as_ref())).map_err(
            |e| {
                // P0-1: scrub full path from any error returned to the client.
                log::warn!("[fs] read_file_base64 denied (cwd=None): {e}");
                if e.contains("Access denied") || e.contains("Path traversal") {
                    ACCESS_DENIED.to_string()
                } else {
                    e
                }
            },
        )?
    };
    let p = validated.as_path();
    let meta = p
        .metadata()
        .map_err(|e| format!("Cannot stat path: {}", e))?;

    if meta.len() > MAX_BASE64_FILE_SIZE {
        return Err(format!(
            "File too large ({} MB, max {} MB)",
            meta.len() / (1024 * 1024),
            MAX_BASE64_FILE_SIZE / (1024 * 1024)
        ));
    }

    // Use mime_guess for comprehensive MIME type detection
    let mime = mime_guess_from_path(p);
    let bytes = std::fs::read(p).map_err(|e| format!("Failed to read file: {}", e))?;

    // Use standard base64 library instead of manual implementation
    let base64 = base64::prelude::BASE64_STANDARD.encode(&bytes);
    log::debug!(
        "[fs] read_file_base64: done mime={mime}, size={}",
        bytes.len()
    );
    Ok((base64, mime))
}

/// Stable, non-leaking error message returned to callers when a file request
/// is rejected for boundary / traversal reasons. The full FS path is logged
/// server-side but NOT echoed to the client (per P0-1 audit guidance).
const ACCESS_DENIED: &str = "Access denied: path is outside allowed directories";

/// Detect MIME type from file path with Office format support.
///
/// Office formats are checked first (hardcoded table for accuracy),
/// then falls back to mime_guess library for all other formats.
pub(crate) fn mime_guess_from_path(path: &std::path::Path) -> String {
    // Office formats first — mime_guess is inaccurate for some of these
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if let Some(mime) = office_mime(ext) {
            return mime.into();
        }
    }
    // Fallback to mime_guess for non-Office formats
    mime_guess::from_path(path)
        .first()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "application/octet-stream".into())
}

fn office_mime(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "xls" => Some("application/vnd.ms-excel"),
        "csv" => Some("text/csv"),
        "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "doc" => Some("application/msword"),
        "docm" => Some("application/vnd.ms-word.document.macroEnabled.12"),
        "dotx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.template"),
        "dotm" => Some("application/vnd.ms-word.template.macroEnabled.12"),
        "pptx" => Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        "ppt" => Some("application/vnd.ms-powerpoint"),
        "pptm" => Some("application/vnd.ms-powerpoint.presentation.macroEnabled.12"),
        "potx" => Some("application/vnd.openxmlformats-officedocument.presentationml.template"),
        "potm" => Some("application/vnd.ms-powerpoint.template.macroEnabled.12"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Minimal 1x1 PNG byte sequence (reused by PNG-related tests).
    const PNG_BYTES: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77,
        0x53, 0xDE, // 1x1 RGB
        0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT
        0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
        0x33, // compressed pixel
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82, // IEND
    ];

    /// cwd=None must NOT silently allow arbitrary paths (P0-1). The path is
    /// re-checked against the trusted fallback root, so a tempdir file outside
    /// any allowed root must be rejected.
    #[test]
    fn read_file_base64_no_cwd_rejects_path_outside_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("test.png");
        std::fs::File::create(&img)
            .unwrap()
            .write_all(PNG_BYTES)
            .unwrap();

        let result = read_file_base64(img.to_string_lossy().into(), None, None);
        assert!(
            result.is_err(),
            "cwd=None should reject arbitrary tempdir paths (P0-1 fix)"
        );
        let err = result.unwrap_err();
        assert!(
            err.contains("Access denied") || err.contains("outside allowed"),
            "expected access denied message, got: {err}"
        );
        // Error message must NOT leak the full filesystem path
        assert!(
            !err.contains(dir.path().to_str().unwrap()),
            "error message leaks full path: {err}"
        );
    }

    /// cwd=Some: path outside the allowed directory should be rejected.
    #[test]
    fn read_file_base64_with_cwd_rejects_outside_path() {
        let allowed_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.txt");
        std::fs::write(&outside_file, b"secret").unwrap();

        let result = read_file_base64(
            outside_file.to_string_lossy().into(),
            Some(allowed_dir.path().to_string_lossy().into()),
            None,
        );
        assert!(
            result.is_err(),
            "cwd=Some should reject path outside allowed dir"
        );
    }

    /// cwd=Some: path inside the allowed directory should succeed.
    #[test]
    fn read_file_base64_with_cwd_allows_inside_path() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("hello.txt");
        std::fs::write(&file, b"hello").unwrap();

        let result = read_file_base64(
            file.to_string_lossy().into(),
            Some(dir.path().to_string_lossy().into()),
            None,
        );
        assert!(
            result.is_ok(),
            "cwd=Some should allow path inside allowed dir"
        );
        let (base64, mime) = result.unwrap();
        assert!(!base64.is_empty());
        assert!(mime.contains("text"), "expected text mime, got {}", mime);
    }

    /// Traversal attempt: `..` segments must be rejected up front by the
    /// validator even when `cwd` is supplied.
    #[test]
    fn read_file_base64_rejects_traversal_segments() {
        let dir = tempfile::tempdir().unwrap();
        let traversal = format!("{}/../escaped.txt", dir.path().display());
        let result = read_file_base64(traversal, Some(dir.path().to_string_lossy().into()), None);
        assert!(
            result.is_err(),
            "path containing '..' must be rejected as traversal"
        );
    }

    /// `cwd=None` succeeds when the file lives inside the trusted fallback
    /// root. Pure-function path: we test `resolve_fallback_root_with`
    /// directly so this test does **not** touch real `~/.miwarp/settings.json`.
    #[test]
    fn resolve_fallback_root_with_prefers_working_directory() {
        let wd = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let result =
            resolve_fallback_root_with(Some(wd.path().to_str().unwrap()), data.path(), home.path());
        assert_eq!(
            result.as_deref(),
            std::fs::canonicalize(wd.path()).ok().as_deref()
        );
    }

    /// `resolve_fallback_root_with` falls back to the data dir when
    /// `working_directory` is unset.
    #[test]
    fn resolve_fallback_root_with_falls_back_to_data_dir() {
        let wd_dir = tempfile::tempdir().unwrap(); // never linked in
        let data = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        // Make sure wd is NOT canonicalized by giving a non-existent path.
        let bogus = wd_dir.path().join("does-not-exist");
        let result =
            resolve_fallback_root_with(Some(bogus.to_str().unwrap()), data.path(), home.path());
        assert_eq!(
            result.as_deref(),
            std::fs::canonicalize(data.path()).ok().as_deref()
        );
    }

    /// `cwd=None` reads that land in the trusted fallback root succeed.
    /// This test bypasses the Tauri command and calls the pure
    /// resolver + the validator directly, so it does not depend on
    /// (and does not pollute) live user settings.
    #[test]
    fn read_file_base64_via_fallback_root_pure() {
        let root = tempfile::tempdir().unwrap();
        let img = root.path().join("in_root.png");
        std::fs::File::create(&img)
            .unwrap()
            .write_all(PNG_BYTES)
            .unwrap();
        let resolved = resolve_fallback_root_with(
            Some(root.path().to_str().unwrap()),
            root.path(),
            root.path(),
        )
        .expect("resolve");
        let result = crate::commands::files::validate_file_path(
            img.to_str().unwrap(),
            Some(resolved.to_str().unwrap()),
        );
        assert!(
            result.is_ok(),
            "validate_file_path should accept in-root path, got: {:?}",
            result
        );
    }

    /// P0-1 hardening: with a valid drop grant, `read_file_base64` reads
    /// a path that lives outside the fallback root. This is the chat
    /// native drag-drop scenario.
    #[test]
    fn read_file_base64_with_drop_grant_allows_outside_fallback() {
        // Path that is NOT inside any of the trusted roots.
        let desktop = tempfile::tempdir().unwrap();
        let img = desktop.path().join("from_desktop.png");
        std::fs::File::create(&img)
            .unwrap()
            .write_all(PNG_BYTES)
            .unwrap();

        let grant_id =
            issue_drop_grant(vec![img.to_string_lossy().into()]).expect("issue_drop_grant");
        let result = read_file_base64(img.to_string_lossy().into(), None, Some(grant_id));
        assert!(
            result.is_ok(),
            "valid drop grant should allow read of outside-fallback path, got: {:?}",
            result
        );
        let (base64, mime) = result.unwrap();
        assert!(!base64.is_empty());
        assert_eq!(mime, "image/png");
    }

    /// P0-1 hardening: regular IPC / WebSocket with no grant cannot
    /// piggy-back on a grant issued by another renderer tab. This is
    /// the SSRF-like hole the original P0-1 fix was designed to close.
    #[test]
    fn read_file_base64_without_grant_still_rejects_outside_fallback() {
        let desktop = tempfile::tempdir().unwrap();
        let img = desktop.path().join("from_desktop.png");
        std::fs::File::create(&img)
            .unwrap()
            .write_all(PNG_BYTES)
            .unwrap();

        // No grant issued, no cwd → must still be rejected.
        let result = read_file_base64(img.to_string_lossy().into(), None, None);
        assert!(
            result.is_err(),
            "no-cwd + no-grant + outside-fallback must still be rejected"
        );
        let err = result.unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
        assert!(
            !err.contains(desktop.path().to_str().unwrap()),
            "error leaks full path: {err}"
        );
    }

    /// P0-1 hardening: a grant issued for path A cannot be used to read
    /// path B (a different drop or a different user's drop).
    #[test]
    fn read_file_base64_grant_does_not_cross_paths() {
        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();
        let a = dir_a.path().join("a.png");
        let b = dir_b.path().join("b.png");
        std::fs::File::create(&a)
            .unwrap()
            .write_all(PNG_BYTES)
            .unwrap();
        std::fs::File::create(&b)
            .unwrap()
            .write_all(PNG_BYTES)
            .unwrap();

        let grant_id = issue_drop_grant(vec![a.to_string_lossy().into()]).expect("issue");
        let result = read_file_base64(b.to_string_lossy().into(), None, Some(grant_id));
        assert!(result.is_err(), "grant for A must not authorize B");
    }

    /// P0-1 hardening: an unknown / forged grant id is treated as
    /// "no grant" and falls through to the regular boundary check.
    #[test]
    fn read_file_base64_with_unknown_grant_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("x.png");
        std::fs::File::create(&img)
            .unwrap()
            .write_all(PNG_BYTES)
            .unwrap();
        let result = read_file_base64(
            img.to_string_lossy().into(),
            None,
            Some("drop-deadbeefdeadbeef".to_string()),
        );
        assert!(result.is_err(), "unknown grant must be rejected");
    }
}
