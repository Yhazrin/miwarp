use serde_json::Value;

use crate::web_server::state::AppState;

use super::handlers;

/// Dispatch a JSON-RPC method call to the corresponding handler.
/// Returns Ok(result_value) or Err(error_string).
pub async fn dispatch_method(
    method: &str,
    params: Value,
    state: &AppState,
) -> Result<Value, String> {
    match method {
        // ── Runs ──
        "list_runs"
        | "list_runs_lite"
        | "list_runs_since"
        | "get_backend_capabilities"
        | "get_run"
        | "start_run"
        | "rename_run"
        | "generate_run_title"
        | "soft_delete_runs"
        | "update_run_model"
        | "stop_run"
        | "search_prompts"
        | "search_runs"
        | "get_run_files" => handlers::handle_runs(method, params, state).await,

        // ── Prompt Favorites ──
        "add_prompt_favorite"
        | "remove_prompt_favorite"
        | "update_prompt_favorite_tags"
        | "update_prompt_favorite_note"
        | "list_prompt_favorites"
        | "list_prompt_tags" => handlers::handle_prompt_favorites(method, params).await,

        // ── Events ──
        "get_run_events" | "get_bus_events" => handlers::handle_events(method, params).await,

        // ── Artifacts ──
        "get_run_artifacts" | "export_conversation" => {
            handlers::handle_artifacts(method, params).await
        }

        // ── Task Core ──
        "task_create"
        | "task_get"
        | "task_list"
        | "task_list_events"
        | "task_update_status"
        | "task_link_run"
        | "task_link_artifact"
        | "task_set_quality_gate"
        | "task_set_review_decision"
        | "task_set_merge_decision"
        | "task_reconcile_after_restart"
        | "task_set_worktree"
        | "task_track_changed_file"
        | "run_journal_get"
        | "run_journal_list_events"
        | "run_checkpoint_create"
        | "run_journal_reconcile"
        | "attention_queue_get"
        | "attention_queue_list_events"
        | "attention_queue_acknowledge"
        | "attention_queue_resolve"
        | "attention_queue_reconcile" => handlers::handle_task_core(method, params, state).await,

        // ── Settings ──
        "get_user_settings"
        | "update_user_settings"
        | "reset_personal_profile"
        | "get_agent_settings"
        | "update_agent_settings" => handlers::handle_settings(method, params, state).await,

        // ── Files ──
        "read_text_file" | "stat_text_file" | "write_text_file" | "read_task_output"
        | "list_memory_files" => handlers::handle_files(method, params),

        // ── FS ──
        "list_directory"
        | "check_is_directory"
        | "issue_drop_grant"
        | "read_file_base64"
        | "list_remote_directory"
        | "resolve_remote_home" => handlers::handle_fs(method, params).await,

        // ── Git ──
        "get_git_summary" | "get_git_branch" | "get_git_diff" | "get_git_status"
        | "get_git_timeline" => handlers::handle_git(method, params).await,

        // ── Teams ──
        "list_teams"
        | "get_team_config"
        | "list_team_tasks"
        | "get_team_task"
        | "get_team_inbox"
        | "get_all_team_inboxes"
        | "delete_team" => handlers::handle_teams(method, params),

        // ── Plugins / Skills ──
        "list_marketplaces"
        | "list_marketplace_plugins"
        | "list_standalone_skills"
        | "list_project_commands"
        | "list_installed_plugins"
        | "get_skill_content"
        | "create_skill"
        | "update_skill"
        | "delete_skill"
        | "install_plugin"
        | "uninstall_plugin"
        | "enable_plugin"
        | "disable_plugin"
        | "update_plugin"
        | "add_marketplace"
        | "remove_marketplace"
        | "update_marketplace"
        | "check_community_health"
        | "search_community_skills"
        | "get_community_skill_detail"
        | "install_community_skill" => handlers::handle_plugins(method, params).await,

        // ── Skill Sources ──
        "list_skill_sources"
        | "create_skill_source"
        | "update_skill_source"
        | "delete_skill_source"
        | "test_skill_source"
        | "sync_skill_source"
        | "preview_feishu_skill_doc"
        | "install_remote_skill"
        | "check_skill_source_updates" => handlers::handle_skill_sources(method, params).await,

        // ── CLI Config ──
        "get_cli_config" | "get_project_cli_config" | "update_cli_config" => {
            handlers::handle_cli_config(method, params)
        }

        // ── CLI Permissions ──
        "get_cli_permissions" | "update_cli_permissions" => {
            handlers::handle_cli_permissions(method, params).await
        }

        // ── MCP ──
        "list_configured_mcp_servers"
        | "add_mcp_server"
        | "remove_mcp_server"
        | "toggle_mcp_server_config"
        | "check_mcp_registry_health"
        | "search_mcp_registry" => handlers::handle_mcp(method, params).await,

        // ── Diagnostics ──
        "check_agent_cli"
        | "check_cli_binary"
        | "detect_cli_tool"
        | "check_project_init"
        | "run_diagnostics"
        | "get_cli_dist_tags"
        | "update_claude_cli"
        | "update_codex_cli"
        | "update_mimo_cli"
        | "update_ccswitch"
        | "run_cli_update"
        | "detect_local_proxy"
        | "test_api_connectivity"
        | "test_remote_host"
        | "check_ssh_key"
        | "generate_ssh_key" => handlers::handle_diagnostics(method, params).await,

        // ── Stats ──
        "get_usage_overview"
        | "get_global_usage_overview"
        | "clear_usage_cache"
        | "get_heatmap_daily"
        | "get_changelog"
        | "read_app_readme" => handlers::handle_stats(method, params).await,

        // ── Onboarding ──
        "check_auth_status"
        | "detect_install_methods"
        | "get_auth_overview"
        | "set_cli_api_key"
        | "remove_cli_api_key" => handlers::handle_onboarding(method, params).await,

        // ── Agents ──
        "list_agents" | "read_agent_file" | "create_agent_file" | "update_agent_file"
        | "delete_agent_file" => handlers::handle_agents(method, params).await,

        // ── CLI Sync ──
        "discover_cli_sessions" | "sync_cli_session" | "import_cli_session" => {
            handlers::handle_cli_sync(method, params, state).await
        }

        // ── Clipboard ──
        "read_clipboard_file" | "save_temp_attachment" => {
            handlers::handle_clipboard(method, params)
        }

        // ── Web Server Status ──
        "get_web_server_status" => handlers::handle_web_server_status(method, params, state),

        // ── Session management ──
        "start_session"
        | "send_session_message"
        | "stop_session"
        | "send_session_control"
        | "fork_session"
        | "approve_session_tool"
        | "respond_permission"
        | "respond_hook_callback"
        | "cancel_control_request"
        | "respond_elicitation" => handlers::handle_session(method, params, state).await,

        // ── CLI Info ──
        "get_cli_info" => handlers::handle_cli_info(method, params, state).await,

        // ── Desktop-only commands ──
        "runtime_hub_list"
        | "runtime_hub_health"
        | "runtime_hub_diagnose"
        | "runtime_hub_set_default"
        | "runtime_hub_preview_config"
        | "runtime_hub_apply_config"
        | "runtime_hub_start_config_watch"
        | "runtime_hub_stop_config_watch"
        | "diagnostics_snapshot"
        | "diagnostics_summary"
        | "diagnostics_preview"
        | "diagnostics_export"
        | "diagnostics_export_bundle"
        | "diagnostics_clear"
        | "browser_navigate"
        | "browser_screenshot"
        | "browser_get_dom"
        | "capture_screenshot"
        | "update_screenshot_hotkey"
        | "get_clipboard_files"
        | "run_claude_login"
        | "check_for_updates"
        | "send_chat_message" => Err("desktop only".to_string()),

        // ── IPC-only (not exposed over WS) ──
        "get_web_server_token" => Err("desktop only".to_string()),

        _ => Err(format!("unknown method: {}", method)),
    }
}
