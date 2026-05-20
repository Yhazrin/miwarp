use crate::models::SessionFolder;
use crate::storage;

#[tauri::command]
pub fn list_session_folders(workspace_id: String) -> Result<Vec<SessionFolder>, String> {
    log::debug!(
        "[cmd/folders] list_session_folders: workspace={}",
        workspace_id
    );
    Ok(storage::folders::list_folders(&workspace_id))
}

#[tauri::command]
pub fn list_all_session_folders() -> Result<Vec<SessionFolder>, String> {
    log::debug!("[cmd/folders] list_all_session_folders");
    Ok(storage::folders::list_all_folders())
}

#[tauri::command]
pub fn create_session_folder(name: String, workspace_id: String) -> Result<SessionFolder, String> {
    log::debug!(
        "[cmd/folders] create_session_folder: name={}, workspace={}",
        name,
        workspace_id
    );
    storage::folders::create_folder(&name, &workspace_id)
}

#[tauri::command]
pub fn rename_session_folder(folder_id: String, new_name: String) -> Result<(), String> {
    log::debug!(
        "[cmd/folders] rename_session_folder: id={}, name={}",
        folder_id,
        new_name
    );
    storage::folders::update_folder_name(&folder_id, &new_name)
}

#[tauri::command]
pub fn delete_session_folder(folder_id: String, cascade: bool) -> Result<u32, String> {
    log::debug!(
        "[cmd/folders] delete_session_folder: id={}, cascade={}",
        folder_id,
        cascade
    );
    storage::folders::delete_folder(&folder_id, cascade)
}

#[tauri::command]
pub fn move_run_to_folder(run_id: String, folder_id: Option<String>) -> Result<(), String> {
    log::debug!(
        "[cmd/folders] move_run_to_folder: run_id={}, folder_id={:?}",
        run_id,
        folder_id
    );
    storage::runs::update_run_folder(&run_id, folder_id)
}

#[tauri::command]
pub fn batch_move_to_folder(
    run_ids: Vec<String>,
    folder_id: Option<String>,
) -> Result<u32, String> {
    log::debug!(
        "[cmd/folders] batch_move_to_folder: count={}, folder_id={:?}",
        run_ids.len(),
        folder_id
    );
    storage::runs::batch_update_run_folder(&run_ids, folder_id)
}

#[tauri::command]
pub fn hard_delete_runs(ids: Vec<String>) -> Result<u32, String> {
    log::debug!("[cmd/folders] hard_delete_runs: ids={:?}", ids);
    super::runs::cleanup_worktrees_for_runs(&ids);
    storage::runs::hard_delete_runs(&ids)
}
