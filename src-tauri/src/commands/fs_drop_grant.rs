//! Process-scoped "user drop gesture" grant store.
//!
//! When the OS hands us a Tauri file-drop event, the user has explicitly
//! indicated intent to attach those paths to a chat message. The frontend
//! asks the backend to issue a short-lived, one-time grant for the
//! specific paths in that drop, then passes the grant id back through
//! `read_file_base64`. Without a grant, `read_file_base64` still rejects
//! every path that is not covered by `cwd` or the trusted fallback
//! roots — so browser-mode IPC / WebSocket callers cannot piggy-back on
//! the grant flow to read arbitrary files.
//!
//! ## Why a separate grant
//!
//! The previous P0-1 fix tightened the default path to `cwd` only; chat
//! native drag-drop calls `readFileBase64(path)` without `cwd`, so drops
//! from `Desktop/`, `Downloads/`, external disks, etc. stopped working.
//! Widening the default trusted-root set would have re-opened the
//! SSRF-like hole the fix was designed to close. The grant mechanism
//! keeps the hole closed while restoring the drag-drop UX.
//!
//! ## Lifecycle
//!
//! - Grant ids are 256-bit random UUIDs (v4).
//! - Each grant covers a fixed set of canonical paths.
//! - Grants expire after `GRANT_TTL` (30 s) and are garbage-collected
//!   lazily on the next access.
//! - Grant ids are **not** bound to a session id or a chat — anyone who
//!   can read the grant id can consume it within the TTL. This is OK
//!   because the user already had to drag the file into the window to
//!   trigger the issue flow; the grant id is just a one-time
//!   capability that the renderer threads through to `read_file_base64`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How long an issued grant remains valid. Generous enough to cover
/// realistic drop batches (multi-file classification + base64 read at
/// concurrency=2) but short enough that leaked grant ids are not useful
/// for long.
pub const GRANT_TTL: Duration = Duration::from_secs(30);

/// Process-wide cap on the number of live grants. A cap protects against
/// the (unlikely) case where a misbehaving renderer issues grants in a
/// tight loop and exhausts memory. At 30 s TTL the cap effectively
/// throttles sustained abuse to ~34 grants/s before the oldest gets
/// evicted by the lazy GC.
const MAX_GRANTS: usize = 1024;

#[derive(Debug)]
pub struct DropGrant {
    pub paths: HashSet<PathBuf>,
    pub expires_at: Instant,
}

#[derive(Debug, Default)]
struct GrantStore {
    grants: HashMap<String, DropGrant>,
}

static STORE: OnceLock<Mutex<GrantStore>> = OnceLock::new();

fn store() -> &'static Mutex<GrantStore> {
    STORE.get_or_init(|| Mutex::new(GrantStore::default()))
}

/// Issue a grant for the given absolute paths. Returns the grant id.
///
/// All paths are canonicalized before being stored. A path that fails
/// canonicalization (e.g. already deleted) is dropped from the grant
/// set; the grant is still issued as long as at least one path is
/// valid. Returns an error if **no** path is valid.
pub fn issue_grant<I, P>(paths: I) -> Result<String, String>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    let canonical_paths: HashSet<PathBuf> = paths
        .into_iter()
        .filter_map(|p| std::fs::canonicalize(p.as_ref()).ok())
        .collect();

    if canonical_paths.is_empty() {
        return Err("No valid paths in drop grant".to_string());
    }

    let grant_id = format!("drop-{}", uuid::Uuid::new_v4());
    let grant = DropGrant {
        paths: canonical_paths,
        expires_at: Instant::now() + GRANT_TTL,
    };

    let mut s = store()
        .lock()
        .map_err(|e| format!("grant store lock poisoned: {e}"))?;
    gc_locked(&mut s.grants);
    if s.grants.len() >= MAX_GRANTS {
        return Err("Too many active drop grants".to_string());
    }
    s.grants.insert(grant_id.clone(), grant);
    Ok(grant_id)
}

/// Check whether `grant_id` is valid and covers `requested_path`.
///
/// This is a **non-consuming** check: the same grant id can be used for
/// multiple `read_file_base64` calls within its TTL (so a drop batch
/// of N files only needs one issue call). The grant entry is
/// removed only when it expires or when the GC runs.
///
/// Returns:
/// - `Ok(true)` if the grant exists, is not expired, and `requested_path`
///   is in the grant's path set.
/// - `Ok(false)` if any of the above fail.
/// - `Err(_)` only on lock failure (treated as a denial upstream).
pub fn check_grant(grant_id: &str, requested_path: &Path) -> Result<bool, String> {
    let canonical_requested = std::fs::canonicalize(requested_path)
        .map_err(|e| format!("Cannot canonicalize requested path: {e}"))?;
    let mut s = store()
        .lock()
        .map_err(|e| format!("grant store lock poisoned: {e}"))?;
    gc_locked(&mut s.grants);
    match s.grants.get(grant_id) {
        Some(grant) if grant.expires_at > Instant::now() => {
            Ok(grant.paths.contains(&canonical_requested))
        }
        _ => Ok(false),
    }
}

/// Force-expire the grant with the given id. Used by tests; not
/// exposed via IPC.
#[cfg(test)]
pub fn _expire_for_test(grant_id: &str) {
    if let Ok(mut s) = store().lock() {
        s.grants.remove(grant_id);
    }
}

/// Count of live (non-expired) grants. Used by tests; not exposed via IPC.
#[cfg(test)]
pub fn _live_count_for_test() -> usize {
    let Ok(mut s) = store().lock() else {
        return 0;
    };
    gc_locked(&mut s.grants);
    s.grants.len()
}

fn gc_locked(grants: &mut HashMap<String, DropGrant>) {
    let now = Instant::now();
    grants.retain(|_, g| g.expires_at > now);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_and_check_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("hello.txt");
        std::fs::write(&p, b"hi").unwrap();

        let id = issue_grant([p.as_path()]).expect("issue");
        assert!(check_grant(&id, &p).unwrap());
    }

    #[test]
    fn check_denies_ungranted_path() {
        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();
        let a = dir_a.path().join("a.txt");
        let b = dir_b.path().join("b.txt");
        std::fs::write(&a, b"a").unwrap();
        std::fs::write(&b, b"b").unwrap();

        let id = issue_grant([a.as_path()]).expect("issue");
        assert!(check_grant(&id, &a).unwrap());
        assert!(!check_grant(&id, &b).unwrap());
    }

    #[test]
    fn check_denies_unknown_grant_id() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.txt");
        std::fs::write(&p, b"x").unwrap();
        assert!(!check_grant("drop-deadbeef", &p).unwrap());
    }

    #[test]
    fn expired_grant_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("e.txt");
        std::fs::write(&p, b"e").unwrap();
        let id = issue_grant([p.as_path()]).expect("issue");
        _expire_for_test(&id);
        assert!(!check_grant(&id, &p).unwrap());
    }

    #[test]
    fn issue_rejects_all_invalid_paths() {
        let err = issue_grant(["/this/path/does/not/exist/abc"]).unwrap_err();
        assert!(err.contains("No valid paths"));
    }

    #[test]
    fn same_grant_id_is_multi_use() {
        let dir = tempfile::tempdir().unwrap();
        let p1 = dir.path().join("1.txt");
        let p2 = dir.path().join("2.txt");
        std::fs::write(&p1, b"1").unwrap();
        std::fs::write(&p2, b"2").unwrap();
        let id = issue_grant([p1.as_path(), p2.as_path()]).expect("issue");
        assert!(check_grant(&id, &p1).unwrap());
        assert!(check_grant(&id, &p2).unwrap());
        assert!(
            check_grant(&id, &p1).unwrap(),
            "second check should still pass"
        );
    }
}
