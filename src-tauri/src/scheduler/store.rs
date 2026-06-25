use super::model::{ScheduledTask, ScheduledTaskRun};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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

fn runs_index_file() -> PathBuf {
    scheduler_dir().join("runs_index.json")
}

fn ensure_dirs() -> Result<(), String> {
    let dir = scheduler_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create scheduler dir: {e}"))?;
    let rdir = runs_dir();
    fs::create_dir_all(&rdir).map_err(|e| format!("create runs dir: {e}"))?;
    Ok(())
}

/// Sidecar index mapping `task_id -> Vec<run_id>` sorted by `started_at` desc.
/// Rebuilt on startup if missing, updated incrementally on `save_run`.
#[derive(Debug, Default, Serialize, Deserialize)]
struct RunsIndex {
    /// task_id -> run_ids (newest first)
    by_task: HashMap<String, Vec<String>>,
}

fn load_runs_index() -> RunsIndex {
    let path = runs_index_file();
    if !path.exists() {
        return RunsIndex::default();
    }
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => RunsIndex::default(),
    }
}

fn save_runs_index(idx: &RunsIndex) -> Result<(), String> {
    ensure_dirs()?;
    let json =
        serde_json::to_string_pretty(idx).map_err(|e| format!("serialize runs index: {e}"))?;
    fs::write(runs_index_file(), json).map_err(|e| format!("write runs_index.json: {e}"))
}

/// One-time migration: if the sidecar is missing or empty but runs exist on disk,
/// scan the runs dir and rebuild the index. Idempotent and cheap.
fn rebuild_runs_index_if_needed() -> RunsIndex {
    let mut idx = load_runs_index();
    if !idx.by_task.is_empty() {
        return idx;
    }
    let dir = runs_dir();
    if !dir.exists() {
        return idx;
    }
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return idx,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(run) = serde_json::from_str::<ScheduledTaskRun>(&data) {
                idx.by_task
                    .entry(run.task_id.clone())
                    .or_default()
                    .push(run.id);
            }
        }
    }
    // Sort each bucket by started_at desc using a single in-memory pass.
    for ids in idx.by_task.values_mut() {
        let mut pairs: Vec<(String, String)> = ids
            .drain(..)
            .filter_map(|id| {
                let path = runs_dir().join(format!("{id}.json"));
                let data = fs::read_to_string(&path).ok()?;
                let run: ScheduledTaskRun = serde_json::from_str(&data).ok()?;
                Some((run.id, run.started_at))
            })
            .collect();
        pairs.sort_by(|a, b| b.1.cmp(&a.1));
        *ids = pairs.into_iter().map(|(id, _)| id).collect();
    }
    if !idx.by_task.is_empty() {
        if let Err(e) = save_runs_index(&idx) {
            log::warn!("[scheduler] failed to persist rebuilt runs index: {e}");
        }
    }
    idx
}

/// Load all scheduled tasks from disk, sorted by `updated_at` desc so the most
/// recently edited task is at the top of the list.
pub fn load_tasks() -> Vec<ScheduledTask> {
    let path = tasks_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let mut tasks: Vec<ScheduledTask> = serde_json::from_str(&data).unwrap_or_default();
    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    tasks
}

/// Load a single task by ID.
pub fn load_task(id: &str) -> Option<ScheduledTask> {
    load_tasks().into_iter().find(|t| t.id == id)
}

/// Save all scheduled tasks to disk.
pub fn save_tasks(tasks: &[ScheduledTask]) -> Result<(), String> {
    ensure_dirs()?;
    let json = serde_json::to_string_pretty(tasks).map_err(|e| format!("serialize tasks: {e}"))?;
    fs::write(tasks_file(), json).map_err(|e| format!("write tasks.json: {e}"))
}

/// Save a single task (find-and-replace in the tasks list).
pub fn save_task(task: &ScheduledTask) -> Result<(), String> {
    let mut tasks = load_tasks();
    if let Some(pos) = tasks.iter().position(|t| t.id == task.id) {
        tasks[pos] = task.clone();
    } else {
        tasks.push(task.clone());
    }
    save_tasks(&tasks)
}

/// Load a single task run from disk.
pub fn load_run(run_id: &str) -> Option<ScheduledTaskRun> {
    let path = runs_dir().join(format!("{run_id}.json"));
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

/// Save a single task run to disk and update the runs sidecar index.
pub fn save_run(run: &ScheduledTaskRun) -> Result<(), String> {
    ensure_dirs()?;
    let path = runs_dir().join(format!("{}.json", run.id));
    let json = serde_json::to_string_pretty(run).map_err(|e| format!("serialize run: {e}"))?;
    fs::write(path, json).map_err(|e| format!("write run: {e}"))?;

    // Update sidecar index: remove any prior entry for this run id, then push
    // the new one (newest first).
    let mut idx = load_runs_index();
    let known_ids: HashSet<String> = idx
        .by_task
        .values()
        .flat_map(|v| v.iter().cloned())
        .collect();
    if !known_ids.contains(&run.id) {
        idx.by_task
            .entry(run.task_id.clone())
            .or_default()
            .insert(0, run.id.clone());
        let _ = save_runs_index(&idx);
    } else {
        // Existing run being updated — re-sort its bucket by started_at desc.
        let mut pairs: Vec<(String, String)> = idx
            .by_task
            .get(&run.task_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|id| {
                if id == run.id {
                    (id, run.started_at.clone())
                } else {
                    let path = runs_dir().join(format!("{id}.json"));
                    let started_at = fs::read_to_string(&path)
                        .ok()
                        .and_then(|d| serde_json::from_str::<ScheduledTaskRun>(&d).ok())
                        .map(|r| r.started_at)
                        .unwrap_or_default();
                    (id, started_at)
                }
            })
            .collect();
        pairs.sort_by(|a, b| b.1.cmp(&a.1));
        if let Some(bucket) = idx.by_task.get_mut(&run.task_id) {
            *bucket = pairs.into_iter().map(|(id, _)| id).collect();
        }
        let _ = save_runs_index(&idx);
    }

    Ok(())
}

/// Load runs for a specific task, optionally limited. Uses the sidecar index
/// to avoid scanning the entire runs directory on every call.
pub fn load_runs_for_task(task_id: &str, limit: Option<u32>) -> Vec<ScheduledTaskRun> {
    let idx = rebuild_runs_index_if_needed();
    let Some(bucket) = idx.by_task.get(task_id) else {
        return Vec::new();
    };

    let mut runs: Vec<ScheduledTaskRun> = Vec::with_capacity(bucket.len());
    for id in bucket {
        if let Some(run) = load_run(id) {
            runs.push(run);
        }
    }

    if let Some(limit) = limit {
        runs.truncate(limit as usize);
    }

    runs
}

/// Load all runs (across all tasks), optionally limited. Walks each task bucket
/// in the sidecar index instead of doing a flat directory scan.
pub fn load_all_runs(limit: Option<u32>) -> Vec<ScheduledTaskRun> {
    let idx = rebuild_runs_index_if_needed();
    let mut runs: Vec<ScheduledTaskRun> = Vec::new();
    for bucket in idx.by_task.values() {
        for id in bucket {
            if let Some(run) = load_run(id) {
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

/// Drop all runs associated with a task from the sidecar index (called when a
/// task is deleted so we don't leak orphan entries).
pub fn forget_task_runs(task_id: &str) {
    let mut idx = load_runs_index();
    if idx.by_task.remove(task_id).is_some() {
        let _ = save_runs_index(&idx);
    }
}

/// Backfill `RunMeta.scheduled_task_*` from scheduler execution records (historical migration).
pub fn backfill_scheduled_run_metadata() -> u32 {
    let mut updated = 0u32;
    for task_run in load_all_runs(None) {
        let Some(miwarp_run_id) = task_run.run_id.clone() else {
            continue;
        };
        let result = crate::storage::runs::with_meta(&miwarp_run_id, |meta| {
            if meta.scheduled_task_id.is_some() {
                return Ok(());
            }
            meta.scheduled_task_id = Some(task_run.task_id.clone());
            meta.scheduled_task_run_id = Some(task_run.id.clone());
            updated += 1;
            Ok(())
        });
        if result.is_err() {
            continue;
        }
    }
    if updated > 0 {
        log::info!("[scheduler] backfilled scheduled_task tags on {updated} run(s)");
    }
    updated
}
