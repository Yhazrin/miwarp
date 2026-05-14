use super::model::{ScheduledTask, ScheduledTaskRun};
use std::fs;
use std::path::PathBuf;

fn scheduler_dir() -> PathBuf {
    crate::storage::data_dir().join("scheduler")
}

fn tasks_file() -> PathBuf {
    scheduler_dir().join("tasks.json")
}

fn runs_dir() -> PathBuf {
    scheduler_dir().join("runs")
}

fn ensure_dirs() -> Result<(), String> {
    let dir = scheduler_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create scheduler dir: {e}"))?;
    let rdir = runs_dir();
    fs::create_dir_all(&rdir).map_err(|e| format!("create runs dir: {e}"))?;
    Ok(())
}

/// Load all scheduled tasks from disk.
pub fn load_tasks() -> Vec<ScheduledTask> {
    let path = tasks_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Save all scheduled tasks to disk.
pub fn save_tasks(tasks: &[ScheduledTask]) -> Result<(), String> {
    ensure_dirs()?;
    let json = serde_json::to_string_pretty(tasks).map_err(|e| format!("serialize tasks: {e}"))?;
    fs::write(tasks_file(), json).map_err(|e| format!("write tasks.json: {e}"))
}

/// Load a single task run from disk.
pub fn load_run(run_id: &str) -> Option<ScheduledTaskRun> {
    let path = runs_dir().join(format!("{run_id}.json"));
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

/// Save a single task run to disk.
pub fn save_run(run: &ScheduledTaskRun) -> Result<(), String> {
    ensure_dirs()?;
    let path = runs_dir().join(format!("{}.json", run.id));
    let json = serde_json::to_string_pretty(run).map_err(|e| format!("serialize run: {e}"))?;
    fs::write(path, json).map_err(|e| format!("write run: {e}"))
}

/// Load runs for a specific task, optionally limited.
pub fn load_runs_for_task(task_id: &str, limit: Option<u32>) -> Vec<ScheduledTaskRun> {
    let dir = runs_dir();
    if !dir.exists() {
        return Vec::new();
    }

    let mut runs: Vec<ScheduledTaskRun> = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(run) = serde_json::from_str::<ScheduledTaskRun>(&data) {
                if run.task_id == task_id {
                    runs.push(run);
                }
            }
        }
    }

    // Sort by started_at descending (newest first)
    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    if let Some(limit) = limit {
        runs.truncate(limit as usize);
    }

    runs
}

/// Load all runs (across all tasks), optionally limited.
pub fn load_all_runs(limit: Option<u32>) -> Vec<ScheduledTaskRun> {
    let dir = runs_dir();
    if !dir.exists() {
        return Vec::new();
    }

    let mut runs: Vec<ScheduledTaskRun> = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(run) = serde_json::from_str::<ScheduledTaskRun>(&data) {
                runs.push(run);
            }
        }
    }

    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    if let Some(limit) = limit {
        runs.truncate(limit as usize);
    }

    runs
}
