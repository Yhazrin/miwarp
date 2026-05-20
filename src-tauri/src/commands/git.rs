use crate::process_ext::HideConsole;
use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct GitFileStat {
    pub path: String,
    pub status: String,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
pub struct GitSummary {
    pub branch: String,
    pub files: Vec<GitFileStat>,
    pub total_files: u32,
    pub total_insertions: u32,
    pub total_deletions: u32,
}

#[tauri::command]
pub async fn get_git_summary(cwd: String) -> Result<GitSummary, String> {
    log::debug!("[git] get_git_summary: cwd={}", cwd);

    // Branch name
    let branch = Command::new("git")
        .current_dir(&cwd)
        .args(["branch", "--show-current"])
        .hide_console()
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();

    // Per-file numstat (staged + unstaged vs HEAD)
    let numstat_output = Command::new("git")
        .current_dir(&cwd)
        .args(["diff", "--numstat", "HEAD"])
        .hide_console()
        .output()
        .map_err(|e| format!("Failed to run git diff --numstat: {}", e))?;

    // Status for file status codes (M/A/D/R/?)
    let status_output = Command::new("git")
        .current_dir(&cwd)
        .args(["status", "--short"])
        .hide_console()
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    // Parse status codes into a map: path → status char
    let status_str = String::from_utf8_lossy(&status_output.stdout);
    let mut status_map = std::collections::HashMap::new();
    for line in status_str.lines() {
        if line.len() < 4 {
            continue;
        }
        let xy = &line[..2];
        let path = line[3..].trim();
        // Pick the most relevant status: index (X) or worktree (Y)
        let code = if xy.starts_with('?') {
            "?"
        } else if xy.starts_with('A') || xy.ends_with('A') {
            "A"
        } else if xy.starts_with('D') || xy.ends_with('D') {
            "D"
        } else if xy.starts_with('R') || xy.ends_with('R') {
            "R"
        } else {
            "M"
        };
        // Handle renames: "R  old -> new"
        let actual_path = if let Some(arrow) = path.find(" -> ") {
            &path[arrow + 4..]
        } else {
            path
        };
        status_map.insert(actual_path.to_string(), code.to_string());
    }

    // Parse numstat: "insertions\tdeletions\tpath"
    let numstat_str = String::from_utf8_lossy(&numstat_output.stdout);
    let mut files = Vec::new();
    let mut total_ins: u32 = 0;
    let mut total_del: u32 = 0;

    for line in numstat_str.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        // Binary files show "-" for insertions/deletions
        let ins = parts[0].parse::<u32>().unwrap_or(0);
        let del = parts[1].parse::<u32>().unwrap_or(0);
        let path = parts[2].to_string();
        let status = status_map
            .get(&path)
            .cloned()
            .unwrap_or_else(|| "M".to_string());
        total_ins += ins;
        total_del += del;
        files.push(GitFileStat {
            path,
            status,
            insertions: ins,
            deletions: del,
        });
    }

    // Also add untracked files from status (not in numstat)
    for (path, code) in &status_map {
        if code == "?" && !files.iter().any(|f| &f.path == path) {
            files.push(GitFileStat {
                path: path.clone(),
                status: "?".to_string(),
                insertions: 0,
                deletions: 0,
            });
        }
    }

    let total_files = files.len() as u32;

    Ok(GitSummary {
        branch,
        files,
        total_files,
        total_insertions: total_ins,
        total_deletions: total_del,
    })
}

#[tauri::command]
pub async fn get_git_branch(cwd: String) -> Result<String, String> {
    log::debug!("[git] get_git_branch: cwd={}", cwd);

    // Step 1: structured probe (rev-parse plumbing, exit code semantics are well-defined)
    let check = match Command::new("git")
        .current_dir(&cwd)
        .args(["rev-parse", "--is-inside-work-tree"])
        .hide_console()
        .output()
    {
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                // git executable not installed → normal state, no branch badge
                log::debug!("[git] get_git_branch: git not installed, cwd={}", cwd);
                return Ok(String::new());
            }
            log::warn!("[git] get_git_branch I/O error: cwd={}, err={}", cwd, e);
            return Err(e.to_string());
        }
        Ok(o) => o,
    };

    if check.status.success() {
        let stdout = String::from_utf8_lossy(&check.stdout).trim().to_string();
        if stdout != "true" {
            // "false" → bare repo / inside .git dir → no branch badge
            log::debug!("[git] get_git_branch: not a work tree, cwd={}", cwd);
            return Ok(String::new());
        }
    } else {
        let code = check.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&check.stderr);
        let stderr_trimmed = stderr.trim();
        if code == 128 && stderr_trimmed.contains("not a git repository") {
            // Genuinely not a git directory → Ok("") (normal state, not an error)
            log::debug!("[git] get_git_branch: not a git repo, cwd={}", cwd);
            return Ok(String::new());
        }
        // Other failures (safe.directory, corruption, permissions, etc) → Err
        log::warn!(
            "[git] get_git_branch: rev-parse error, cwd={}, code={}",
            cwd,
            code
        );
        return Err(format!(
            "git rev-parse failed (code {}): {}",
            code, stderr_trimmed
        ));
    }

    // Step 2: get branch name
    let output = Command::new("git")
        .current_dir(&cwd)
        .args(["branch", "--show-current"])
        .hide_console()
        .output()
        .map_err(|e| {
            log::warn!("[git] get_git_branch: branch cmd I/O error: {}", e);
            e.to_string()
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!(
            "[git] get_git_branch: branch cmd failed: code={}",
            output.status.code().unwrap_or(-1)
        );
        return Err(format!("git branch failed: {}", stderr.trim()));
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Step 3: detached HEAD → fallback to short SHA
    if branch.is_empty() {
        let sha = Command::new("git")
            .current_dir(&cwd)
            .args(["rev-parse", "--short", "HEAD"])
            .hide_console()
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        log::debug!(
            "[git] get_git_branch: detached HEAD, sha={}, cwd={}",
            sha,
            cwd
        );
        return Ok(sha);
    }

    Ok(branch)
}

#[tauri::command]
pub async fn get_git_diff(
    cwd: String,
    staged: bool,
    file: Option<String>,
) -> Result<String, String> {
    log::debug!(
        "[git] get_git_diff: cwd={}, staged={}, file={:?}",
        cwd,
        staged,
        file
    );
    let mut cmd = Command::new("git");
    cmd.current_dir(&cwd);
    cmd.arg("diff");
    if staged {
        cmd.arg("--cached");
    } else if file.is_some() {
        // Per-file diff: compare working tree against HEAD (staged + unstaged)
        cmd.arg("HEAD");
    }
    if let Some(ref f) = file {
        cmd.arg("--").arg(f);
    }
    let output = cmd
        .hide_console()
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn get_git_status(cwd: String) -> Result<String, String> {
    log::debug!("[git] get_git_status: cwd={}", cwd);
    let output = Command::new("git")
        .current_dir(&cwd)
        .args(["status", "--short"])
        .hide_console()
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[derive(Serialize)]
pub struct GitTimelineEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_current: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dirty: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_files: Option<u32>,
}

#[derive(Serialize)]
pub struct GitTimelineResponse {
    pub is_repo: bool,
    pub branch: String,
    pub is_detached: bool,
    pub is_clean: bool,
    pub changed_files: u32,
    pub entries: Vec<GitTimelineEntry>,
}

fn is_git_repo(cwd: &str) -> bool {
    Command::new("git")
        .current_dir(cwd)
        .args(["rev-parse", "--is-inside-work-tree"])
        .hide_console()
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

fn git_output_ok(cwd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git").current_dir(cwd).args(args).hide_console().output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[tauri::command]
pub async fn get_git_timeline(cwd: String, limit: Option<u32>) -> Result<GitTimelineResponse, String> {
    log::debug!("[git] get_git_timeline: cwd={}, limit={:?}", cwd, limit);
    let limit = limit.unwrap_or(12).clamp(1, 30) as usize;

    if !is_git_repo(&cwd) {
        return Ok(GitTimelineResponse {
            is_repo: false,
            branch: String::new(),
            is_detached: false,
            is_clean: true,
            changed_files: 0,
            entries: vec![],
        });
    }

    let branch_raw = git_output_ok(&cwd, &["branch", "--show-current"]).unwrap_or_default();
    let is_detached = branch_raw.is_empty();
    let branch = if is_detached {
        git_output_ok(&cwd, &["rev-parse", "--short", "HEAD"]).unwrap_or_default()
    } else {
        branch_raw.clone()
    };

    let status_output = Command::new("git")
        .current_dir(&cwd)
        .args(["status", "--short"])
        .hide_console()
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;
    let status_str = String::from_utf8_lossy(&status_output.stdout);
    let changed_files = status_str.lines().filter(|l| !l.trim().is_empty()).count() as u32;
    let is_clean = changed_files == 0;

    let mut entries = Vec::new();
    entries.push(GitTimelineEntry {
        id: "working_tree".to_string(),
        entry_type: "working_tree".to_string(),
        label: if is_clean {
            "Working tree clean".to_string()
        } else {
            "Current changes".to_string()
        },
        description: None,
        hash: None,
        short_hash: None,
        author: None,
        date: None,
        branch: Some(branch.clone()),
        remote: None,
        is_current: Some(true),
        is_dirty: Some(!is_clean),
        changed_files: if is_clean { None } else { Some(changed_files) },
    });

    let log_output = Command::new("git")
        .current_dir(&cwd)
        .args([
            "log",
            &format!("-n{}", limit),
            "--format=%H\x1f%h\x1f%s\x1f%an\x1f%aI",
        ])
        .hide_console()
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if log_output.status.success() {
        let log_str = String::from_utf8_lossy(&log_output.stdout);
        for (i, line) in log_str.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let parts: Vec<&str> = line.split('\x1f').collect();
            if parts.len() < 5 {
                continue;
            }
            let hash = parts[0].to_string();
            entries.push(GitTimelineEntry {
                id: format!("commit-{}", hash),
                entry_type: "commit".to_string(),
                label: parts[2].to_string(),
                description: None,
                hash: Some(hash.clone()),
                short_hash: Some(parts[1].to_string()),
                author: Some(parts[3].to_string()),
                date: Some(parts[4].to_string()),
                branch: if i == 0 && !is_detached {
                    Some(branch.clone())
                } else {
                    None
                },
                remote: None,
                is_current: if i == 0 { Some(true) } else { None },
                is_dirty: None,
                changed_files: None,
            });
        }
    }

    if !is_detached {
        if let Some(upstream) =
            git_output_ok(&cwd, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        {
            entries.push(GitTimelineEntry {
                id: format!("remote-{}", upstream.replace('/', "-")),
                entry_type: "remote_ref".to_string(),
                label: upstream.clone(),
                description: Some("Tracking remote".to_string()),
                hash: None,
                short_hash: None,
                author: None,
                date: None,
                branch: None,
                remote: Some(upstream),
                is_current: None,
                is_dirty: None,
                changed_files: None,
            });
        }

        let base_branch = if git_output_ok(&cwd, &["rev-parse", "--verify", "main"]).is_some() {
            "main"
        } else if git_output_ok(&cwd, &["rev-parse", "--verify", "master"]).is_some() {
            "master"
        } else {
            ""
        };
        if !base_branch.is_empty() && base_branch != branch {
            entries.push(GitTimelineEntry {
                id: format!("base-{}", base_branch),
                entry_type: "base".to_string(),
                label: base_branch.to_string(),
                description: Some("Base branch".to_string()),
                hash: None,
                short_hash: None,
                author: None,
                date: None,
                branch: None,
                remote: None,
                is_current: None,
                is_dirty: None,
                changed_files: None,
            });
        }
    }

    Ok(GitTimelineResponse {
        is_repo: true,
        branch,
        is_detached,
        is_clean,
        changed_files,
        entries,
    })
}
