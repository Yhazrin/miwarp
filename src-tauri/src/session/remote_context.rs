//! Remote host context: resolve a `RemoteHost` from `RunMeta`.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! Pure logic + single settings lookup. Used by every command that needs SSH info.

use crate::models::{RemoteHost, RunMeta};

/// Resolve a `RemoteHost` from `RunMeta`.
///
/// Prefers the embedded `remote_host_snapshot` (self-contained, survives settings
/// rotation), falls back to name-based lookup against the live `UserSettings` for old
/// runs that predate the snapshot field.
pub(crate) fn resolve_remote_host(meta: &RunMeta) -> Result<Option<RemoteHost>, String> {
    // Prefer snapshot (new runs have this)
    if let Some(ref snapshot) = meta.remote_host_snapshot {
        log::debug!(
            "[session] resolve_remote_host: using snapshot for '{}'",
            snapshot.name
        );
        return Ok(Some(snapshot.clone()));
    }
    // Fallback: name-based lookup (old runs without snapshot)
    match &meta.remote_host_name {
        Some(name) => {
            let settings = crate::storage::settings::get_user_settings();
            settings
                .remote_hosts
                .iter()
                .find(|h| h.name == *name)
                .cloned()
                .map(Some)
                .ok_or_else(|| format!("Remote host '{}' not found in settings", name))
        }
        None => Ok(None),
    }
}
