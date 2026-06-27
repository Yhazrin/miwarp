pub mod artifacts;
pub mod attention_queue;
pub mod changelog;
pub mod claude_usage;
pub mod cli_config;
pub mod cli_sessions;
pub mod community_skills;
pub(crate) mod durable_io;
pub mod events;
pub mod favorites;
pub mod folders;
pub mod mcp_registry;
pub mod plugins;
pub mod product_bootstrap;
pub mod prompt_index;
pub mod run_index;
pub mod run_journal;
pub mod runs;
pub mod settings;
pub mod shared;
pub mod tasks;
pub mod team_runs;
pub mod teams;

use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    home_dir()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".miwarp")
}

pub fn runs_dir() -> PathBuf {
    data_dir().join("runs")
}

pub fn run_dir(run_id: &str) -> PathBuf {
    runs_dir().join(run_id)
}

/// Per-run usage 提取结果缓存目录：`~/.miwarp/cache/usage/<run_id>.json`。
/// 写入内容包含 events.jsonl 的 mtime/size 元信息，下次提取时按 mtime 决定
/// 是否复用。
pub fn usage_cache_dir() -> PathBuf {
    data_dir().join("cache").join("usage")
}

/// Resolve the user's home directory reliably.
/// Primary: `getpwuid()` system call (works even when `$HOME` is unset,
/// e.g. GUI apps launched from Finder/Dock on macOS 26+).
/// Fallback: `$HOME` (Unix) or `$USERPROFILE` (Windows).
pub fn home_dir() -> Option<String> {
    #[cfg(unix)]
    {
        let pwd_home = unsafe {
            let uid = libc::getuid();
            let pw = libc::getpwuid(uid);
            if !pw.is_null() {
                let dir = (*pw).pw_dir;
                if !dir.is_null() {
                    Some(std::ffi::CStr::from_ptr(dir).to_string_lossy().into_owned())
                } else {
                    None
                }
            } else {
                None
            }
        };
        if pwd_home.is_some() {
            return pwd_home;
        }
        std::env::var("HOME").ok()
    }
    #[cfg(not(unix))]
    {
        std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .or_else(|_| {
                let drive = std::env::var("HOMEDRIVE").unwrap_or_default();
                let path = std::env::var("HOMEPATH").unwrap_or_default();
                if !drive.is_empty() && !path.is_empty() {
                    Ok(format!("{}{}", drive, path))
                } else {
                    Err(std::env::VarError::NotPresent)
                }
            })
            .ok()
    }
}

pub(crate) fn dirs_next() -> Option<PathBuf> {
    home_dir().map(PathBuf::from)
}

pub fn ensure_dir(path: &std::path::Path) -> std::io::Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
    }

    // Restrict directory permissions — data dir may contain sensitive data
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
    }

    Ok(())
}
