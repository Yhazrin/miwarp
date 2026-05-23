//! Backend capability probe for frontend/backend version alignment.

use serde::Serialize;

/// Schema version bumps when IPC payloads or semantics change materially.
pub const SCHEMA_VERSION: u32 = 2;

/// Commands the current frontend may gate on. Keep in sync when adding new IPC.
const SUPPORTED_COMMANDS: &[&str] = &[
    "get_backend_capabilities",
    "list_runs",
    "list_runs_since",
    "get_run",
    "export_claude_code_history_archive",
    "import_claude_code_history_archive",
    "scan_claude_code_history",
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
}
