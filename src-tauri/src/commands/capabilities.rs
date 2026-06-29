//! Backend capability probe for frontend/backend version alignment.

use serde::Serialize;

/// Schema version bumps when IPC payloads or semantics change materially.
pub const SCHEMA_VERSION: u32 = 5;

/// Commands the current frontend may gate on. Keep in sync when adding new IPC.
const SUPPORTED_COMMANDS: &[&str] = &[
    "get_backend_capabilities",
    "list_runs",
    "list_runs_since",
    "get_run",
    "export_claude_code_history_archive",
    "import_claude_code_history_archive",
    "scan_claude_code_history",
    "task_create",
    "task_get",
    "task_list",
    "task_list_events",
    "task_update_status",
    "task_link_run",
    "task_link_artifact",
    "task_set_quality_gate",
    "task_set_review_decision",
    "task_set_merge_decision",
    "task_reconcile_after_restart",
    "task_set_worktree",
    "task_track_changed_file",
    "run_journal_get",
    "run_journal_list_events",
    "run_checkpoint_create",
    "run_journal_reconcile",
    "attention_queue_get",
    "attention_queue_list_events",
    "attention_queue_acknowledge",
    "attention_queue_resolve",
    "attention_queue_reconcile",
    "browser_navigate",
    "browser_screenshot",
    "browser_get_dom",
    "browser_runtime_list_profiles",
    "browser_runtime_create_profile",
    "browser_runtime_get_profile",
    "browser_runtime_delete_profile",
    "browser_runtime_launch_profile",
    "browser_runtime_list_sessions",
    "browser_runtime_get_session",
    "browser_runtime_list_tabs",
    "browser_runtime_observe",
    "browser_runtime_navigate",
    "browser_runtime_perform",
    "browser_runtime_close_session",
    "browser_runtime_list_runtimes",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCapabilities {
    pub app_version: String,
    pub schema_version: u32,
    pub supported_commands: Vec<String>,
}

#[tauri::command]
pub fn get_backend_capabilities() -> Result<BackendCapabilities, String> {
    Ok(BackendCapabilities {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: SCHEMA_VERSION,
        supported_commands: SUPPORTED_COMMANDS
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_commands_include_incremental_runs() {
        let caps = get_backend_capabilities().unwrap();
        assert!(caps
            .supported_commands
            .contains(&"list_runs_since".to_string()));
        assert!(caps
            .supported_commands
            .contains(&"get_backend_capabilities".to_string()));
    }

    #[test]
    fn supported_commands_include_task_core() {
        let caps = get_backend_capabilities().unwrap();
        for command in [
            "task_create",
            "task_get",
            "task_list",
            "task_list_events",
            "task_update_status",
            "task_link_run",
            "task_link_artifact",
            "task_set_quality_gate",
            "task_set_review_decision",
            "task_set_merge_decision",
            "task_reconcile_after_restart",
            "task_set_worktree",
            "task_track_changed_file",
        ] {
            assert!(
                caps.supported_commands.contains(&command.to_string()),
                "missing {command}"
            );
        }
    }

    #[test]
    fn supported_commands_include_run_journal() {
        let caps = get_backend_capabilities().unwrap();
        for command in [
            "run_journal_get",
            "run_journal_list_events",
            "run_checkpoint_create",
            "run_journal_reconcile",
        ] {
            assert!(
                caps.supported_commands.contains(&command.to_string()),
                "missing {command}"
            );
        }
        assert_eq!(caps.schema_version, 5);
    }

    #[test]
    fn supported_commands_include_attention_queue() {
        let caps = get_backend_capabilities().unwrap();
        for command in [
            "attention_queue_get",
            "attention_queue_list_events",
            "attention_queue_acknowledge",
            "attention_queue_resolve",
            "attention_queue_reconcile",
        ] {
            assert!(
                caps.supported_commands.contains(&command.to_string()),
                "missing {command}"
            );
        }
        assert_eq!(caps.schema_version, 5);
    }

    #[test]
    fn supported_commands_include_browser_lite() {
        let caps = get_backend_capabilities().unwrap();
        for command in ["browser_navigate", "browser_screenshot", "browser_get_dom"] {
            assert!(
                caps.supported_commands.contains(&command.to_string()),
                "missing {command}"
            );
        }
    }
}
