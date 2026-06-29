use crate::process_ext::HideConsole;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Info about a created worktree.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
}

/// Returned when `remove_worktree_internal` is called with `force=false` and
/// the worktree has uncommitted changes or untracked files that would be
/// silently deleted by `git worktree remove --force`. The caller must decide
/// whether to discard the changes (re-invoke with `force=true`) or keep them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDirtyError {
    pub worktree_path: String,
    pub dirty_files: Vec<String>,
    pub message: String,
}

impl std::fmt::Display for WorktreeDirtyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} ({} dirty file(s); pass force=true to discard)",
            self.message,
            self.dirty_files.len()
        )
    }
}

impl std::error::Error for WorktreeDirtyError {}

/// Parse the output of `git status --porcelain` into a list of dirty file paths.
///
/// Each line is at minimum 3 characters: `<xy> <path>` where `<xy>` is the
/// 2-char status code. We trim and skip empty / malformed lines.
fn parse_dirty_files(stdout: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(stdout);
    text.lines()
        .filter(|line| line.len() >= 3)
        .map(|line| line[3..].trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Run `git -C <path> status --porcelain` and return the dirty file list.
/// Returns an empty Vec if the path is clean or not a git working tree.
fn dirty_files_in(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let output = Command::new("git")
        .args(["-C", &path.to_string_lossy(), "status", "--porcelain"])
        .hide_console()
        .output()
        .map_err(|e| format!("git status failed: {}", e))?;
    if !output.status.success() {
        // If path isn't a git worktree (already removed, etc.) treat as clean.
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not a git repository") {
            return Ok(Vec::new());
        }
        return Err(format!("git status failed: {}", stderr.trim()));
    }
    Ok(parse_dirty_files(&output.stdout))
}

/// Result of an auto-commit attempt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCommitResult {
    pub committed: bool,
    pub sha: Option<String>,
    pub message: String,
}

/// A single worktree entry from `git worktree list --porcelain`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: String,
    pub head: String,
}

// ── Internal helpers (used by other modules) ──

/// Check if `cwd` is inside a git working tree.
pub fn is_git_repo_internal(cwd: &str) -> Result<bool, String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(["rev-parse", "--is-inside-work-tree"])
        .hide_console()
        .output()
        .map_err(|e| format!("git not available: {}", e))?;
    Ok(output.status.success()
        && String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case("true"))
}

/// Get the git repo root for the given cwd.
fn repo_root(cwd: &str) -> Result<PathBuf, String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(["rev-parse", "--show-toplevel"])
        .hide_console()
        .output()
        .map_err(|e| format!("git rev-parse failed: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "not a git repo: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(PathBuf::from(raw))
}

/// Resolve the default base branch (origin/HEAD or fallback to main/master).
pub fn detect_base_branch(cwd: &str) -> String {
    // Try origin/HEAD
    if let Ok(out) = Command::new("git")
        .current_dir(cwd)
        .args(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"])
        .hide_console()
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            // "origin/main" → "main"
            if let Some(name) = s.strip_prefix("origin/") {
                return name.to_string();
            }
        }
    }
    // Fallback: try main, then master
    for candidate in &["main", "master"] {
        if let Ok(out) = Command::new("git")
            .current_dir(cwd)
            .args(["rev-parse", "--verify", candidate])
            .hide_console()
            .output()
        {
            if out.status.success() {
                return candidate.to_string();
            }
        }
    }
    "main".to_string()
}

/// Create a git worktree for a session. Returns the worktree path and branch name.
pub fn create_worktree_internal(
    parent_cwd: &str,
    session_id_short: &str,
    branch_name: &str,
) -> Result<WorktreeInfo, String> {
    let root = repo_root(parent_cwd)?;

    // Worktree path: sibling of repo root under .miwarp-worktrees/
    let worktrees_dir = root
        .parent()
        .unwrap_or(&root)
        .join(".miwarp-worktrees")
        .join(session_id_short);

    // Create branch from current HEAD
    let branch_output = Command::new("git")
        .current_dir(&root)
        .args(["branch", branch_name])
        .hide_console()
        .output()
        .map_err(|e| format!("git branch failed: {}", e))?;
    if !branch_output.status.success() {
        let stderr = String::from_utf8_lossy(&branch_output.stderr)
            .trim()
            .to_string();
        // Branch already exists is OK
        if !stderr.contains("already exists") {
            return Err(format!("git branch failed: {}", stderr));
        }
    }

    // Create worktree
    let wt_path_str = worktrees_dir.to_string_lossy().to_string();
    let wt_output = Command::new("git")
        .current_dir(&root)
        .args(["worktree", "add", &wt_path_str, branch_name])
        .hide_console()
        .output()
        .map_err(|e| format!("git worktree add failed: {}", e))?;
    if !wt_output.status.success() {
        return Err(format!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&wt_output.stderr).trim()
        ));
    }

    log::debug!(
        "[worktree] created: path={}, branch={}, session={}",
        wt_path_str,
        branch_name,
        session_id_short
    );

    Ok(WorktreeInfo {
        path: wt_path_str,
        branch: branch_name.to_string(),
    })
}

/// Auto-commit all changes in the given cwd.
pub fn auto_commit_internal(cwd: &str, message: &str) -> Result<AutoCommitResult, String> {
    // git add -A
    let add_output = Command::new("git")
        .current_dir(cwd)
        .args(["add", "-A"])
        .hide_console()
        .output()
        .map_err(|e| format!("git add failed: {}", e))?;
    if !add_output.status.success() {
        return Err(format!(
            "git add failed: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        ));
    }

    // Check if there are staged changes
    let diff_output = Command::new("git")
        .current_dir(cwd)
        .args(["diff", "--cached", "--quiet"])
        .hide_console()
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;

    if diff_output.status.success() {
        // No staged changes
        return Ok(AutoCommitResult {
            committed: false,
            sha: None,
            message: "No changes to commit".to_string(),
        });
    }

    // Commit
    let commit_output = Command::new("git")
        .current_dir(cwd)
        .args(["commit", "-m", message])
        .hide_console()
        .output()
        .map_err(|e| format!("git commit failed: {}", e))?;
    if !commit_output.status.success() {
        return Err(format!(
            "git commit failed: {}",
            String::from_utf8_lossy(&commit_output.stderr).trim()
        ));
    }

    // Get short SHA
    let sha = Command::new("git")
        .current_dir(cwd)
        .args(["rev-parse", "--short", "HEAD"])
        .hide_console()
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    log::debug!("[worktree] auto-committed in {}: {:?}", cwd, sha);

    Ok(AutoCommitResult {
        committed: true,
        sha,
        message: message.to_string(),
    })
}

/// Push branch and create a PR using `gh` CLI.
pub async fn create_pull_request_internal(
    cwd: &str,
    branch: &str,
    base_branch: &str,
) -> Result<String, String> {
    // Push to origin
    let push_output = Command::new("git")
        .current_dir(cwd)
        .args(["push", "-u", "origin", branch])
        .hide_console()
        .output()
        .map_err(|e| format!("git push failed: {}", e))?;
    if !push_output.status.success() {
        return Err(format!(
            "git push failed: {}",
            String::from_utf8_lossy(&push_output.stderr).trim()
        ));
    }

    // Create PR via gh CLI
    let pr_output = Command::new("gh")
        .current_dir(cwd)
        .args([
            "pr",
            "create",
            "--head",
            branch,
            "--base",
            base_branch,
            "--fill",
        ])
        .hide_console()
        .output()
        .map_err(|e| format!("gh CLI not available: {}", e))?;
    if !pr_output.status.success() {
        return Err(format!(
            "gh pr create failed: {}",
            String::from_utf8_lossy(&pr_output.stderr).trim()
        ));
    }

    let url = String::from_utf8_lossy(&pr_output.stdout)
        .trim()
        .to_string();
    log::debug!("[worktree] created PR: {}", url);
    Ok(url)
}

/// Remove a git worktree and optionally delete the branch.
///
/// **Safety (P0-7 fix):** When `force` is `false` (the safe default), the
/// worktree is first inspected with `git status --porcelain`. If there are
/// uncommitted modifications, staged changes, or untracked files, the call
/// is rejected and a `WorktreeDirtyError` is returned listing every dirty
/// path so the caller can surface them to the user for confirmation. When
/// `force` is `true`, the original `--force` behavior is preserved — used
/// by best-effort cleanup paths (e.g. run deletion auto-cleanup).
pub fn remove_worktree_internal(
    worktree_path: &str,
    parent_cwd: &str,
    branch_name: Option<&str>,
    force: bool,
) -> Result<(), WorktreeDirtyError> {
    let root = repo_root(parent_cwd).unwrap_or_else(|_| PathBuf::from(parent_cwd));

    // Pre-flight: when caller did NOT explicitly opt in to --force, refuse
    // to delete a worktree that has any dirty files (modified / staged /
    // untracked). Returning a structured error lets the UI show a precise
    // "save your work?" prompt rather than silently dropping changes.
    if !force {
        let dirty = match dirty_files_in(Path::new(worktree_path)) {
            Ok(d) => d,
            Err(e) => {
                return Err(WorktreeDirtyError {
                    worktree_path: worktree_path.to_string(),
                    dirty_files: Vec::new(),
                    message: format!("failed to inspect worktree: {}", e),
                });
            }
        };
        if !dirty.is_empty() {
            log::warn!(
                "[worktree] refusing to remove dirty worktree (force=false): path={}, dirty={}",
                worktree_path,
                dirty.len()
            );
            return Err(WorktreeDirtyError {
                worktree_path: worktree_path.to_string(),
                dirty_files: dirty,
                message: format!(
                    "worktree at {} has uncommitted or untracked changes",
                    worktree_path
                ),
            });
        }
    }

    // git worktree remove (only --force when explicitly requested)
    let mut args: Vec<&str> = vec!["worktree", "remove", worktree_path];
    if force {
        args.push("--force");
    }
    let output = Command::new("git")
        .current_dir(&root)
        .args(&args)
        .hide_console()
        .output()
        .map_err(|e| WorktreeDirtyError {
            worktree_path: worktree_path.to_string(),
            dirty_files: Vec::new(),
            message: format!("git worktree remove failed: {}", e),
        })?;
    if !output.status.success() {
        log::warn!(
            "[worktree] remove failed (non-fatal): {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    // Optionally delete the branch
    if let Some(branch) = branch_name {
        let _ = Command::new("git")
            .current_dir(&root)
            .args(["branch", "-d", branch])
            .hide_console()
            .output();
    }

    Ok(())
}

/// List all worktrees for a repo.
pub fn list_worktrees_internal(parent_cwd: &str) -> Result<Vec<WorktreeEntry>, String> {
    let root = repo_root(parent_cwd)?;

    let output = Command::new("git")
        .current_dir(&root)
        .args(["worktree", "list", "--porcelain"])
        .hide_console()
        .output()
        .map_err(|e| format!("git worktree list failed: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "git worktree list failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut current_path = String::new();
    let mut current_branch = String::new();
    let mut current_head = String::new();

    for line in text.lines() {
        if let Some(val) = line.strip_prefix("worktree ") {
            if !current_path.is_empty() {
                entries.push(WorktreeEntry {
                    path: current_path.clone(),
                    branch: current_branch.clone(),
                    head: current_head.clone(),
                });
            }
            current_path = val.to_string();
            current_branch.clear();
            current_head.clear();
        } else if let Some(val) = line.strip_prefix("HEAD ") {
            current_head = val.to_string();
        } else if let Some(val) = line.strip_prefix("branch ") {
            // "branch refs/heads/feat/abc" → "feat/abc"
            current_branch = val.strip_prefix("refs/heads/").unwrap_or(val).to_string();
        }
    }
    if !current_path.is_empty() {
        entries.push(WorktreeEntry {
            path: current_path,
            branch: current_branch,
            head: current_head,
        });
    }

    Ok(entries)
}

// ── Tauri commands (frontend-facing) ──

#[tauri::command]
pub fn create_worktree(
    parent_cwd: String,
    session_id_short: String,
    branch_name: String,
) -> Result<WorktreeInfo, String> {
    log::debug!(
        "[cmd/worktree] create_worktree: parent={}, session={}, branch={}",
        parent_cwd,
        session_id_short,
        branch_name
    );
    create_worktree_internal(&parent_cwd, &session_id_short, &branch_name)
}

#[tauri::command]
pub fn auto_commit(cwd: String, message: String) -> Result<AutoCommitResult, String> {
    log::debug!("[cmd/worktree] auto_commit: cwd={}", cwd);
    auto_commit_internal(&cwd, &message)
}

#[tauri::command]
pub async fn create_pull_request(
    cwd: String,
    branch: String,
    base_branch: String,
) -> Result<String, String> {
    log::debug!(
        "[cmd/worktree] create_pull_request: cwd={}, branch={}, base={}",
        cwd,
        branch,
        base_branch
    );
    create_pull_request_internal(&cwd, &branch, &base_branch).await
}

#[tauri::command]
pub fn remove_worktree(
    worktree_path: String,
    parent_cwd: String,
    branch_name: Option<String>,
    force: Option<bool>,
) -> Result<(), WorktreeDirtyError> {
    // `force` defaults to false (safe). Callers that intentionally want to
    // discard dirty state (e.g. settings-driven auto-cleanup on run delete)
    // must pass `force: true` explicitly. Tauri deserializes a missing field
    // to None, so old JS callers that don't send `force` will still hit the
    // safe default and get a structured error if the tree is dirty.
    let force = force.unwrap_or(false);
    log::debug!(
        "[cmd/worktree] remove_worktree: path={}, parent={}, force={}",
        worktree_path,
        parent_cwd,
        force
    );
    remove_worktree_internal(&worktree_path, &parent_cwd, branch_name.as_deref(), force)
}

#[tauri::command]
pub fn list_worktrees(parent_cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    log::debug!("[cmd/worktree] list_worktrees: parent={}", parent_cwd);
    list_worktrees_internal(&parent_cwd)
}

// ── Tests ──
//
// These tests construct a real temporary git repo + worktree to exercise
// the P0-7 safety guard. They use the system `git` binary (same as the
// production code paths) so we need it available; CI provides it.

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    /// Helper: run a shell command and panic with stderr if it fails.
    fn run(cwd: &std::path::Path, args: &[&str]) {
        let out = StdCommand::new("git")
            .current_dir(cwd)
            .args(args)
            .hide_console()
            .output()
            .expect("git command spawn");
        assert!(
            out.status.success(),
            "git {:?} failed in {}: {}",
            args,
            cwd.display(),
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Build a minimal repo with one commit and a sibling worktree on a
    /// separate branch. Returns (repo_dir, worktree_dir).
    fn build_repo_with_worktree() -> (TempDir, std::path::PathBuf, std::path::PathBuf) {
        let tmp = TempDir::new().expect("tempdir");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();

        run(&repo, &["init", "--initial-branch=main"]);
        run(&repo, &["config", "user.email", "test@example.com"]);
        run(&repo, &["config", "user.name", "Test"]);

        fs::write(repo.join("README.md"), "hello\n").unwrap();
        run(&repo, &["add", "."]);
        run(&repo, &["commit", "-m", "init"]);

        // Create a branch + worktree sibling to repo
        run(&repo, &["branch", "feat/test"]);
        let wt = tmp.path().join("wt");
        run(
            &repo,
            &["worktree", "add", wt.to_str().unwrap(), "feat/test"],
        );

        (tmp, repo, wt)
    }

    #[test]
    fn parse_dirty_files_handles_modification_and_untracked() {
        let input = b" M src/lib.rs\n\
                      M  Cargo.toml\n\
                      ?? notes.txt\n\
                      A  added.rs\n\
                      ";
        let files = parse_dirty_files(input);
        assert_eq!(
            files,
            vec![
                "src/lib.rs".to_string(),
                "Cargo.toml".to_string(),
                "notes.txt".to_string(),
                "added.rs".to_string(),
            ]
        );
    }

    #[test]
    fn parse_dirty_files_ignores_short_and_empty_lines() {
        let input = b"\n\n M ok.rs\nxy\n";
        let files = parse_dirty_files(input);
        // "xy" is only 2 chars → ignored
        assert_eq!(files, vec!["ok.rs".to_string()]);
    }

    #[test]
    fn dirty_files_in_clean_repo_returns_empty() {
        let (_tmp, repo, _wt) = build_repo_with_worktree();
        let dirty = dirty_files_in(&repo).expect("status ok");
        assert!(dirty.is_empty(), "expected clean, got {:?}", dirty);
    }

    #[test]
    fn dirty_files_in_returns_modified_and_untracked() {
        let (_tmp, repo, _wt) = build_repo_with_worktree();
        fs::write(repo.join("README.md"), "changed\n").unwrap();
        fs::write(repo.join("scratch.txt"), "wip\n").unwrap();
        let dirty = dirty_files_in(&repo).expect("status ok");
        assert!(
            dirty.iter().any(|p| p.ends_with("README.md")),
            "expected README.md in {:?}",
            dirty
        );
        assert!(
            dirty.iter().any(|p| p.ends_with("scratch.txt")),
            "expected scratch.txt in {:?}",
            dirty
        );
    }

    #[test]
    fn dirty_files_in_missing_path_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("does-not-exist");
        let dirty = dirty_files_in(&missing).expect("missing path is fine");
        assert!(dirty.is_empty());
    }

    #[test]
    fn remove_worktree_rejects_dirty_when_force_false() {
        let (_tmp, repo, wt) = build_repo_with_worktree();
        // Make the worktree dirty
        fs::write(wt.join("README.md"), "WIP changes\n").unwrap();
        fs::write(wt.join("untracked.log"), "logs\n").unwrap();

        let wt_str = wt.to_string_lossy().to_string();
        let repo_str = repo.to_string_lossy().to_string();

        let res = remove_worktree_internal(&wt_str, &repo_str, Some("feat/test"), false);
        let err = res.expect_err("must refuse to remove dirty worktree");
        assert!(
            err.dirty_files
                .iter()
                .any(|p| p.ends_with("README.md") || p.ends_with("untracked.log")),
            "expected dirty files in error, got {:?}",
            err.dirty_files
        );
        assert_eq!(err.worktree_path, wt_str);

        // The worktree directory must still exist on disk.
        assert!(wt.exists(), "worktree must NOT be deleted when dirty");
    }

    #[test]
    fn remove_worktree_removes_clean_when_force_false() {
        let (_tmp, repo, wt) = build_repo_with_worktree();
        let wt_str = wt.to_string_lossy().to_string();
        let repo_str = repo.to_string_lossy().to_string();

        remove_worktree_internal(&wt_str, &repo_str, Some("feat/test"), false)
            .expect("clean worktree must be removable with default force=false");
        assert!(!wt.exists(), "worktree directory should be gone");
    }

    #[test]
    fn remove_worktree_force_true_overrides_dirty_state() {
        let (_tmp, repo, wt) = build_repo_with_worktree();
        // Make it dirty
        fs::write(wt.join("README.md"), "WIP changes\n").unwrap();
        fs::write(wt.join("untracked.log"), "logs\n").unwrap();

        let wt_str = wt.to_string_lossy().to_string();
        let repo_str = repo.to_string_lossy().to_string();

        remove_worktree_internal(&wt_str, &repo_str, Some("feat/test"), true)
            .expect("force=true must allow dirty worktree removal");
        assert!(
            !wt.exists(),
            "worktree directory should be gone after force=true"
        );
    }
}
