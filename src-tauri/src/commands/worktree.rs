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
pub fn remove_worktree_internal(
    worktree_path: &str,
    parent_cwd: &str,
    branch_name: Option<&str>,
) -> Result<(), String> {
    let root = repo_root(parent_cwd).unwrap_or_else(|_| PathBuf::from(parent_cwd));

    // git worktree remove
    let output = Command::new("git")
        .current_dir(&root)
        .args(["worktree", "remove", worktree_path, "--force"])
        .hide_console()
        .output()
        .map_err(|e| format!("git worktree remove failed: {}", e))?;
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
) -> Result<(), String> {
    log::debug!(
        "[cmd/worktree] remove_worktree: path={}, parent={}",
        worktree_path,
        parent_cwd
    );
    remove_worktree_internal(&worktree_path, &parent_cwd, branch_name.as_deref())
}

#[tauri::command]
pub fn list_worktrees(parent_cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    log::debug!("[cmd/worktree] list_worktrees: parent={}", parent_cwd);
    list_worktrees_internal(&parent_cwd)
}
