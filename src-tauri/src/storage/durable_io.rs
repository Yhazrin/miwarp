//! Shared crash-consistent file primitives for local durable aggregates.

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        fs::File::open(path)
            .and_then(|dir| dir.sync_all())
            .map_err(|e| format!("sync directory {}: {e}", path.display()))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

pub(crate) fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("durable file {} has no parent directory", path.display()))?;
    super::ensure_dir(parent).map_err(|e| e.to_string())?;

    let tmp = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("durable"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));

    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp)
            .map_err(|e| format!("create {}: {e}", tmp.display()))?;
        file.write_all(content)
            .map_err(|e| format!("write {}: {e}", tmp.display()))?;
        file.sync_all()
            .map_err(|e| format!("sync {}: {e}", tmp.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("chmod {}: {e}", tmp.display()))?;
        }
        fs::rename(&tmp, path)
            .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))?;
        sync_directory(parent)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

pub(crate) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    write_atomic(path, &json)
}

pub(crate) fn repair_jsonl_tail<T: DeserializeOwned>(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    if bytes.is_empty() || bytes.last() == Some(&b'\n') {
        return Ok(());
    }

    let tail_start = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1);
    let tail = &bytes[tail_start..];
    if serde_json::from_slice::<T>(tail).is_ok() {
        let mut file = OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(|e| format!("open {}: {e}", path.display()))?;
        file.write_all(b"\n")
            .and_then(|_| file.sync_data())
            .map_err(|e| format!("terminate {}: {e}", path.display()))?;
        return Ok(());
    }

    let file = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    file.set_len(tail_start as u64)
        .and_then(|_| file.sync_data())
        .map_err(|e| format!("truncate {}: {e}", path.display()))
}

/// Append a JSON line to a journal file.
///
/// Durability is provided by the OS's normal write coalescing plus an explicit
/// durability boundary at caller-controlled checkpoints (e.g. actor stop,
/// journal rotation). This function intentionally avoids `sync_data` /
/// `sync_directory` per write: the streaming hot path would otherwise pay an
/// fsync syscall per appended line. At most a few KB of buffered journal
/// entries may be lost on hard crash — accepted trade-off in exchange for
/// eliminating the per-event fsync bottleneck. Callers needing a stronger
/// durability guarantee should invoke [`sync_now`] after batched appends.
pub(crate) fn append_json_line<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("journal file {} has no parent directory", path.display()))?;
    super::ensure_dir(parent).map_err(|e| e.to_string())?;
    let line = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("chmod {}: {e}", path.display()))?;
    }
    file.write_all(&line)
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| format!("append {}: {e}", path.display()))?;
    // Note: no sync_data / sync_directory here — see doc comment above.
    let _ = parent;
    Ok(())
}

/// Force a durable sync of `path`'s parent directory and the file itself.
/// Use at explicit durability boundaries (actor stop, journal rotation,
/// shutdown) when callers need to convert buffered writes to a hard durability
/// guarantee without paying the cost on the hot streaming path.
#[allow(dead_code)]
pub(crate) fn sync_now(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("journal file {} has no parent directory", path.display()))?;
    let file = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    file.sync_data()
        .map_err(|e| format!("sync {}: {e}", path.display()))?;
    sync_directory(parent)
}

pub(crate) fn remove_file_durable(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                sync_directory(parent)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove {}: {error}", path.display())),
    }
}
