//! Project Desk metadata commands (v1.2.0+).
//!
//! Lightweight stat-shape IPC surface for the workbench project desk:
//! stack fingerprint, available commands, curated docs (CLAUDE.md / README.md
//! excerpts), git snapshot, and user-curated `notes.md` per project.

use crate::models::{
    DocExcerpt, LastCommit, ProjectCommands, ProjectGitStatus, ProjectMetadata, ProjectNotes,
    ProjectStack,
};
use crate::storage;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Max characters kept in a doc excerpt.
const EXCERPT_CHARS: usize = 500;

/// Stable + unique encoding for a project cwd, used to namespace per-project
/// state under `~/.miwarp/projects/<encoded>/`.
fn encoded_cwd(cwd: &str) -> String {
    cwd.replace(['/', '\\', ':'], "_")
}

/// Path to the per-project notes file (`~/.miwarp/projects/<encoded>/notes.md`).
fn notes_path(cwd: &str) -> Option<PathBuf> {
    Some(
        storage::data_dir()
            .join("projects")
            .join(encoded_cwd(cwd))
            .join("notes.md"),
    )
}

/// Read up to `max` chars from `path`, returning `None` on any I/O / UTF-8 error.
fn read_excerpt(path: &Path, max: usize) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let truncated: String = raw.chars().take(max).collect();
    Some(truncated)
}

fn doc_excerpt(path: &Path) -> DocExcerpt {
    match read_excerpt(path, EXCERPT_CHARS) {
        Some(text) => DocExcerpt {
            exists: true,
            excerpt: text,
        },
        None => DocExcerpt {
            exists: false,
            excerpt: String::new(),
        },
    }
}

/// Run `git <args>` in `cwd`, returning trimmed stdout.
fn run_git(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Count non-empty lines in stdout (used for dirty file count).
fn count_lines(stdout: &str) -> u32 {
    stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count() as u32
}

/// Parse `git rev-list --left-right --count @{u}...HEAD` → (ahead, behind).
fn parse_ahead_behind(stdout: &str) -> (u32, u32) {
    let mut parts = stdout.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    (ahead, behind)
}

/// Pull a single named capture from `git log -1 --format='%h|%s|%an|%aI'`.
fn parse_log_line(line: &str) -> Option<LastCommit> {
    let mut parts = line.splitn(4, '|');
    Some(LastCommit {
        short_hash: parts.next()?.to_string(),
        subject: parts.next()?.to_string(),
        author: parts.next()?.to_string(),
        time_iso: parts.next()?.to_string(),
    })
}

/// Extract the named scripts from `package.json` (test/build/dev/lint/start).
fn package_json_commands(cwd: &Path) -> ProjectCommands {
    let path = cwd.join("package.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return ProjectCommands::default(),
    };
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return ProjectCommands::default(),
    };
    let scripts = parsed
        .get("scripts")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
        });

    let mut out = ProjectCommands::default();
    let Some(scripts) = scripts else {
        return out;
    };
    for (name, value) in scripts {
        // Only push when the script is defined and non-empty — keeps payload tight.
        if value.trim().is_empty() {
            continue;
        }
        // Match by the canonical name OR common aliases (e.g. `build:prod` → build,
        // `test:unit` → test) so the sidebar shows actionable options without
        // the user drilling into details.
        match name.as_str() {
            "test" | "test:unit" | "test:e2e" | "test:integration" => out.test.push(value),
            "build" | "build:prod" | "build:dev" => out.build.push(value),
            "dev" | "develop" | "start:dev" => out.dev.push(value),
            "lint" | "lint:fix" | "lint:check" => out.lint.push(value),
            "start" | "serve" => out.start.push(value),
            _ => {}
        }
    }
    out
}

/// Extract top-level Makefile targets (lines starting with `name:`, ignoring
/// variables/recipes/`.PHONY`). Pure heuristic — sufficient for the sidebar
/// preview; users edit `notes.md` for the canonical list.
fn makefile_commands(cwd: &Path) -> ProjectCommands {
    let path = cwd.join("Makefile");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return ProjectCommands::default(),
    };
    let mut out = ProjectCommands::default();
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('\t') {
            continue;
        }
        let Some((name, rest)) = trimmed.split_once(':') else {
            continue;
        };
        // Only treat top-level targets — skip recipe lines (starting with whitespace).
        let target = name.trim();
        if target.is_empty() || target.contains('=') {
            continue;
        }
        // Skip phony / include / variable definitions.
        if matches!(target, ".PHONY" | "include" | "export" | "define") {
            continue;
        }
        let body = rest.trim();
        // Body must be non-empty to be a real target (skip `foo:` definitions
        // without a recipe — those are usually variable-style).
        if body.is_empty() {
            continue;
        }
        match target {
            "test" | "tests" | "check-test" => out.test.push(target.to_string()),
            "build" | "all" | "compile" => out.build.push(target.to_string()),
            "dev" | "develop" | "serve" => out.dev.push(target.to_string()),
            "lint" | "format" | "fmt" => out.lint.push(target.to_string()),
            "start" | "run" => out.start.push(target.to_string()),
            _ => {}
        }
    }
    out
}

#[tauri::command]
pub async fn list_project_metadata(cwd: String) -> Result<ProjectMetadata, String> {
    let path = PathBuf::from(&cwd);
    if !path.is_dir() {
        return Err(format!("project cwd does not exist: {cwd}"));
    }
    let stack = ProjectStack {
        typescript: path.join("package.json").is_file(),
        rust: path.join("Cargo.toml").is_file(),
        python: path.join("pyproject.toml").is_file(),
        go: path.join("go.mod").is_file(),
    };
    // npm scripts win when present (more specific), Makefile fills in gaps.
    let mut commands = package_json_commands(&path);
    if commands.test.is_empty() && commands.build.is_empty() {
        let make = makefile_commands(&path);
        if commands.test.is_empty() {
            commands.test = make.test;
        }
        if commands.build.is_empty() {
            commands.build = make.build;
        }
        if commands.dev.is_empty() {
            commands.dev = make.dev;
        }
        if commands.lint.is_empty() {
            commands.lint = make.lint;
        }
        if commands.start.is_empty() {
            commands.start = make.start;
        }
    }
    let claude_md = doc_excerpt(&path.join("CLAUDE.md"));
    let readme = doc_excerpt(&path.join("README.md"));
    Ok(ProjectMetadata {
        stack,
        commands,
        claude_md,
        readme,
    })
}

#[tauri::command]
pub async fn list_project_git_status(cwd: String) -> Result<ProjectGitStatus, String> {
    let path = PathBuf::from(&cwd);
    if !path.is_dir() {
        return Err(format!("project cwd does not exist: {cwd}"));
    }
    // Bail out cleanly when cwd is not a git repo — return is_git_repo=false
    // with everything else default/None. Avoids spamming stderr via git itself.
    let branch_check = run_git(&path, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let branch = branch_check.filter(|s| !s.is_empty());

    if branch.is_none() {
        // Double-check whether git itself is available at all.
        let _ = Command::new("git").arg("--version").output();
        return Ok(ProjectGitStatus {
            is_git_repo: false,
            ..ProjectGitStatus::default()
        });
    }

    // ahead/behind — only meaningful when an upstream is configured.
    let ahead_behind = run_git(
        &path,
        &["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    );
    let (ahead, behind) = match ahead_behind {
        Some(ref s) if !s.is_empty() => {
            let (a, b) = parse_ahead_behind(s);
            (Some(a), Some(b))
        }
        _ => (None, None),
    };

    // dirty count = modified/deleted tracked files + untracked files.
    let mut dirty_count: u32 = 0;
    if let Some(out) = run_git(&path, &["diff", "--name-only"]) {
        dirty_count = dirty_count.saturating_add(count_lines(&out));
    }
    if let Some(out) = run_git(&path, &["ls-files", "--others", "--exclude-standard"]) {
        dirty_count = dirty_count.saturating_add(count_lines(&out));
    }

    let last_commit = run_git(&path, &["log", "-1", "--format=%h|%s|%an|%aI"]).and_then(|line| {
        if line.is_empty() {
            None
        } else {
            parse_log_line(&line)
        }
    });

    Ok(ProjectGitStatus {
        is_git_repo: true,
        branch,
        ahead,
        behind,
        dirty_count,
        last_commit,
    })
}

#[tauri::command]
pub async fn read_project_notes(cwd: String) -> Result<ProjectNotes, String> {
    let Some(path) = notes_path(&cwd) else {
        return Ok(ProjectNotes::default());
    };
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            let modified_at = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Utc> = t.into();
                    dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                });
            Ok(ProjectNotes {
                content,
                modified_at,
            })
        }
        Err(_) => Ok(ProjectNotes::default()),
    }
}

#[tauri::command]
pub async fn write_project_notes(cwd: String, content: String) -> Result<(), String> {
    let path = notes_path(&cwd).ok_or_else(|| "cannot resolve notes path".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "notes path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create notes dir failed: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("write notes failed: {e}"))
}
