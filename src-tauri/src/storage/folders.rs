use crate::models::{now_iso, SessionFolder};
use std::fs;

fn folders_path() -> std::path::PathBuf {
    super::data_dir().join("session-folders.json")
}

fn load_all() -> Vec<SessionFolder> {
    let path = folders_path();
    if !path.exists() {
        return vec![];
    }
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_all(folders: &[SessionFolder]) -> Result<(), String> {
    let path = folders_path();
    super::ensure_dir(path.parent().unwrap_or(&path)).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(folders).map_err(|e| e.to_string())?;
    fs::write(&path, &json).map_err(|e| format!("write folders: {e}"))
}

pub fn list_folders(workspace_id: &str) -> Vec<SessionFolder> {
    load_all()
        .into_iter()
        .filter(|f| f.workspace_id == workspace_id)
        .collect()
}

pub fn list_all_folders() -> Vec<SessionFolder> {
    load_all()
}

pub fn create_folder(name: &str, workspace_id: &str) -> Result<SessionFolder, String> {
    if name.trim().is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    let mut folders = load_all();
    let now = now_iso();
    let folder = SessionFolder {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        workspace_id: workspace_id.to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    folders.push(folder.clone());
    save_all(&folders)?;
    log::debug!(
        "[storage/folders] create_folder: id={}, name={}",
        folder.id,
        folder.name
    );
    Ok(folder)
}

pub fn update_folder_name(folder_id: &str, new_name: &str) -> Result<(), String> {
    if new_name.trim().is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    let mut folders = load_all();
    let folder = folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or_else(|| format!("Folder {} not found", folder_id))?;
    folder.name = new_name.trim().to_string();
    folder.updated_at = now_iso();
    save_all(&folders)?;
    log::debug!(
        "[storage/folders] update_folder_name: id={}, name={}",
        folder_id,
        new_name
    );
    Ok(())
}

pub fn delete_folder(folder_id: &str, cascade: bool) -> Result<u32, String> {
    let mut folders = load_all();
    let idx = folders
        .iter()
        .position(|f| f.id == folder_id)
        .ok_or_else(|| format!("Folder {} not found", folder_id))?;
    folders.remove(idx);
    save_all(&folders)?;

    let mut affected = 0u32;
    if cascade {
        // Hard-delete all runs that were in this folder
        let run_ids = get_run_ids_for_folder(folder_id);
        if !run_ids.is_empty() {
            affected = super::runs::hard_delete_runs(&run_ids).unwrap_or(0);
        }
    } else {
        // Move runs to uncategorized (clear folder_id)
        affected = clear_run_folder_refs(folder_id);
    }

    log::debug!(
        "[storage/folders] delete_folder: id={}, cascade={}, affected_runs={}",
        folder_id,
        cascade,
        affected
    );
    Ok(affected)
}

/// Get all run IDs that belong to a folder.
fn get_run_ids_for_folder(folder_id: &str) -> Vec<String> {
    let runs_dir = super::runs_dir();
    if !runs_dir.exists() {
        return vec![];
    }
    let mut ids = vec![];
    if let Ok(entries) = fs::read_dir(&runs_dir) {
        for entry in entries.flatten() {
            let meta_path = entry.path().join("meta.json");
            if !meta_path.exists() {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&meta_path) {
                if let Ok(meta) = serde_json::from_str::<crate::models::RunMeta>(&content) {
                    if meta.folder_id.as_deref() == Some(folder_id) {
                        ids.push(meta.id);
                    }
                }
            }
        }
    }
    ids
}

/// Remove folder_id from all runs referencing the given folder.
fn clear_run_folder_refs(folder_id: &str) -> u32 {
    let runs_dir = super::runs_dir();
    if !runs_dir.exists() {
        return 0;
    }
    let mut count = 0u32;
    if let Ok(entries) = fs::read_dir(&runs_dir) {
        for entry in entries.flatten() {
            let meta_path = entry.path().join("meta.json");
            if !meta_path.exists() {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&meta_path) {
                if let Ok(mut meta) = serde_json::from_str::<crate::models::RunMeta>(&content) {
                    if meta.folder_id.as_deref() == Some(folder_id) {
                        meta.folder_id = None;
                        if super::runs::save_meta(&meta).is_ok() {
                            count += 1;
                        }
                    }
                }
            }
        }
    }
    count
}
