pub mod agent;
pub mod attention_core;
pub mod browser;
pub mod cli_auto_sync;
pub mod commands;
pub mod diagnostics;
pub mod governor;
pub mod hooks;
pub mod http_client;
pub mod mcp;
pub mod models;
pub mod pricing;
pub mod process_ext;
pub mod run_core;
pub mod scheduler;
pub mod session;
pub mod skill_sources;
pub mod storage;
pub mod task_core;
pub mod web_server;
pub mod window_effect;

use agent::adapter::new_actor_session_map;
use agent::control::CliInfoCache;
use agent::spawn_locks::SpawnLocks;
use agent::stream::new_process_map;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::Arc;
use storage::events::EventWriter;
use tauri::tray::TrayIconEvent;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use web_server::broadcaster::BroadcastEmitter;

/// Effective web server port (may differ from configured port if busy)
pub type EffectiveWebPort = Arc<AtomicU16>;
/// Web-server-specific cancel token for restart support
pub type WebServerCancel = Arc<tokio::sync::Mutex<CancellationToken>>;
/// Token version — shared between IPC and web server for rotation detection
pub type SharedTokenVersion = Arc<AtomicU64>;
/// WS shutdown broadcast — token rotation triggers disconnect of all WS clients
pub type WsShutdownSender = Arc<broadcast::Sender<()>>;
/// Live token — hot-swappable via RwLock for immediate login/logout on rotation
pub type SharedLiveToken = Arc<tokio::sync::RwLock<String>>;
/// Mutex to serialize web server start/stop operations
pub type WebServerLock = Arc<tokio::sync::Mutex<()>>;
/// JoinHandle for the serve task — await during stop to ensure port release
pub type WebServerHandle = Arc<tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>>;
/// Generation counter — each spawn_server increments; stale tasks check before cleanup.
/// Newtype to avoid Tauri manage() collision with SharedTokenVersion (both Arc<AtomicU64>).
#[derive(Clone)]
pub struct WebServerGeneration(pub Arc<AtomicU64>);
/// Effective bind address — reflects actual running state (not settings).
/// Newtype to avoid Tauri manage() collision with SharedLiveToken (both Arc<RwLock<String>>).
#[derive(Clone)]
pub struct EffectiveWebBind(pub Arc<tokio::sync::RwLock<String>>);
/// Startup warning — populated when origins are degraded or other non-fatal startup issues.
#[derive(Clone)]
pub struct WebServerWarning(pub Arc<tokio::sync::RwLock<Option<String>>>);

/// One-shot gate to prevent concurrent shutdown tasks.
/// CAS ensures only the first caller proceeds; subsequent quit/close events are no-ops.
pub struct ShutdownGate(AtomicBool);

impl Default for ShutdownGate {
    fn default() -> Self {
        Self::new()
    }
}

impl ShutdownGate {
    pub fn new() -> Self {
        Self(AtomicBool::new(false))
    }
    /// Returns `true` if this call entered the gate (first caller wins).
    pub fn try_enter(&self) -> bool {
        self.0
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
}

pub fn run() {
    // Initialize logging — our crate at debug level by default
    // Override with RUST_LOG env var, e.g. RUST_LOG=warn cargo tauri dev
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("miwarp_desktop_lib=debug,warn"),
    )
    .format_timestamp_millis()
    .init();

    log::info!("MiWarp Desktop starting");

    // Set up Windows Job Object so child processes are killed on crash/force-quit.
    // No-op on non-Windows.
    process_ext::setup_job_kill_on_close();

    // Reconcile orphaned runs first, then move interrupted active tasks into
    // an explicit operator-attention state instead of silently leaving them running.
    storage::runs::reconcile_orphaned_runs();
    let journal_reconcile = storage::run_journal::reconcile_after_restart();
    if journal_reconcile.restart_reconciled > 0
        || journal_reconcile.recovered_pending_mutations > 0
        || !journal_reconcile.failures.is_empty()
    {
        log::info!(
            "[run-journal] startup reconcile: scanned={}, recovered_pending={}, restart_reconciled={}, uncertain={}, impossible={}, failures={}",
            journal_reconcile.scanned,
            journal_reconcile.recovered_pending_mutations,
            journal_reconcile.restart_reconciled,
            journal_reconcile.marked_uncertain,
            journal_reconcile.impossible_resume,
            journal_reconcile.failures.len()
        );
    }
    let task_reconcile = storage::tasks::reconcile_after_restart();
    if task_reconcile.moved_to_needs_attention > 0 || !task_reconcile.failures.is_empty() {
        log::info!(
            "[task-core] startup reconcile: scanned={}, recovered_pending={}, attention={}, failures={}",
            task_reconcile.scanned,
            task_reconcile.recovered_pending_mutations,
            task_reconcile.moved_to_needs_attention,
            task_reconcile.failures.len()
        );
    }
    let attention_reconcile = match storage::attention_queue::reconcile() {
        Ok(report) => report,
        Err(error) => {
            log::warn!("[attention-queue] startup reconcile failed: {error}");
            crate::attention_core::AttentionReconcileReport::default()
        }
    };
    if attention_reconcile.raised > 0
        || attention_reconcile.refreshed > 0
        || attention_reconcile.reopened > 0
        || attention_reconcile.auto_resolved > 0
        || attention_reconcile.recovered_pending_mutations > 0
        || !attention_reconcile.failures.is_empty()
    {
        log::info!(
            "[attention-queue] startup reconcile: tasks={}, runs={}, raised={}, refreshed={}, reopened={}, auto_resolved={}, recovered_pending={}, failures={}",
            attention_reconcile.scanned_tasks,
            attention_reconcile.scanned_runs,
            attention_reconcile.raised,
            attention_reconcile.refreshed,
            attention_reconcile.reopened,
            attention_reconcile.auto_resolved,
            attention_reconcile.recovered_pending_mutations,
            attention_reconcile.failures.len()
        );
    }

    // Clean up legacy hook-bridge (removed: was redundant with stream-json mode)
    hooks::setup::cleanup_hook_bridge();

    // Global cancellation token — shared with all session actors for graceful shutdown
    let cancel_token = CancellationToken::new();
    let cancel_for_exit = cancel_token.clone();

    // Shared flag: true if system tray was successfully created
    let tray_ok = Arc::new(AtomicBool::new(false));
    let tray_ok_for_event = tray_ok.clone();

    // Web server shared state
    let ws_shutdown_sender: WsShutdownSender = Arc::new(broadcast::channel::<()>(1).0);
    let shared_token_version: SharedTokenVersion = Arc::new(AtomicU64::new(0));
    let shared_live_token: SharedLiveToken = {
        use rand::Rng;
        let token: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(32)
            .map(char::from)
            .collect();
        log::debug!("[app] ephemeral web token generated (masked)");
        Arc::new(tokio::sync::RwLock::new(token))
    };
    let effective_web_port: EffectiveWebPort = Arc::new(AtomicU16::new(0));
    let ws_cancel: WebServerCancel = Arc::new(tokio::sync::Mutex::new(CancellationToken::new()));
    let ws_lock: WebServerLock = Arc::new(tokio::sync::Mutex::new(()));
    let ws_handle: WebServerHandle = Arc::new(tokio::sync::Mutex::new(None));
    let ws_generation = WebServerGeneration(Arc::new(AtomicU64::new(0)));
    let ws_effective_bind = EffectiveWebBind(Arc::new(tokio::sync::RwLock::new(String::new())));
    let ws_warning = WebServerWarning(Arc::new(tokio::sync::RwLock::new(None)));

    let app =
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .manage(new_process_map())
            .manage(new_actor_session_map())
            .manage(CliInfoCache::new())
            .manage(commands::runtime_hub::RuntimeControlPlaneState::default())
            .manage(Arc::new(EventWriter::new()))
            .manage(SpawnLocks::new())
            .manage(crate::agent::runtime_recovery::new_recovery_registry())
            .manage(crate::agent::runtime_health::RuntimeHealthStore::new())
            .manage(Arc::new(commands::browser::BrowserLiteState::default()))
            .manage(commands::browser_runtime::build_registry().expect(
                "[browser-runtime] failed to build registry — chrome profile dir unreadable",
            ))
            .manage(ShutdownGate::new())
            .manage(cancel_token)
            .manage(ws_shutdown_sender)
            .manage(shared_token_version)
            .manage(shared_live_token)
            .manage(effective_web_port)
            .manage(ws_cancel)
            .manage(ws_lock)
            .manage(ws_handle)
            .manage(ws_generation)
            .manage(ws_effective_bind)
            .manage(ws_warning)
            // NOTE: Currently ~60 IPC commands. If approaching 80+, consider grouping
            // into Tauri command modules or using a single dispatch command with typed payloads.
            .invoke_handler(tauri::generate_handler![
                commands::capabilities::get_backend_capabilities,
                commands::runs::list_runs,
                commands::runs::list_runs_lite,
                commands::runs::list_runs_since,
                commands::runs::get_run,
                commands::runs::start_run,
                commands::runs::stop_run,
                commands::runs::update_run_model,
                commands::runs::rename_run,
                commands::runs::generate_run_title,
                commands::runs::soft_delete_runs,
                commands::runs::search_prompts,
                commands::folders::list_all_session_folders,
                commands::folders::list_session_folders,
                commands::folders::create_session_folder,
                commands::folders::rename_session_folder,
                commands::folders::delete_session_folder,
                commands::folders::move_run_to_folder,
                commands::folders::batch_move_to_folder,
                commands::folders::hard_delete_runs,
                commands::history::search_runs,
                commands::history::get_run_files,
                commands::runs::add_prompt_favorite,
                commands::runs::remove_prompt_favorite,
                commands::runs::update_prompt_favorite_tags,
                commands::runs::update_prompt_favorite_note,
                commands::runs::list_prompt_favorites,
                commands::runs::list_prompt_tags,
                commands::chat::send_chat_message,
                commands::chat::get_tool_result,
                commands::events::get_run_events,
                commands::artifacts::get_run_artifacts,
                commands::settings::get_user_settings,
                commands::settings::update_user_settings,
                commands::settings::reset_user_settings,
                commands::settings::reset_personal_profile,
                commands::settings::get_agent_settings,
                commands::settings::update_agent_settings,
                commands::settings::detect_mimo_runtime,
                commands::fs::list_directory,
                commands::fs::check_is_directory,
                commands::fs::read_file_base64,
                commands::fs::issue_drop_grant,
                commands::remote_fs::list_remote_directory,
                commands::remote_fs::resolve_remote_home,
                commands::git::get_git_timeline,
                commands::git::get_git_summary,
                commands::git::get_git_branch,
                commands::git::get_git_diff,
                commands::git::get_git_status,
                commands::export::export_conversation,
                commands::export::write_html_export,
                commands::export::summarize_conversation,
                commands::files::validate_media_file,
                commands::files::read_text_file,
                commands::files::stat_text_file,
                commands::files::write_text_file,
                commands::files::read_task_output,
                commands::files::list_memory_files,
                commands::files::reveal_file_in_finder,
                commands::files::open_directory_in_finder,
                commands::stats::get_usage_overview,
                commands::stats::get_global_usage_overview,
                commands::stats::clear_usage_cache,
                commands::stats::get_heatmap_daily,
                commands::stats::get_changelog,
                commands::app_readme::read_app_readme,
                commands::app_readme::refresh_app_readme,
                commands::fleet::list_fleet,
                commands::fleet::get_fleet_member,
                commands::fleet::get_fleet_metrics,
                commands::fleet::send_to_fleet_member,
                commands::fleet::stop_fleet_member,
                commands::diagnostics::check_agent_cli,
                commands::diagnostics::check_cli_binary,
                commands::diagnostics::detect_cli_tool,
                commands::diagnostics::test_remote_host,
                commands::diagnostics::get_cli_dist_tags,
                commands::diagnostics::update_claude_cli,
                commands::diagnostics::update_codex_cli,
                commands::diagnostics::update_mimo_cli,
                commands::diagnostics::update_ccswitch,
                commands::diagnostics::run_cli_update,
                commands::diagnostics::check_project_init,
                commands::diagnostics::check_ssh_key,
                commands::diagnostics::generate_ssh_key,
                commands::diagnostics::run_diagnostics,
                commands::diagnostics::get_data_directory,
                commands::diagnostics::log_debug_event,
                commands::diagnostics::detect_local_proxy,
                commands::diagnostics::test_api_connectivity,
                commands::session::start_session,
                commands::session::send_session_message,
                commands::session::retry_session_recovery,
                commands::session::stop_session,
                commands::session::send_session_control,
                commands::session::broadcast_mcp_toggle,
                commands::session::get_bus_events,
                commands::session::fork_session,
                commands::session::side_question,
                commands::session::start_ralph_loop,
                commands::session::cancel_ralph_loop,
                commands::session::approve_session_tool,
                commands::session::cancel_control_request,
                commands::session::respond_permission,
                commands::session::respond_hook_callback,
                commands::session::respond_elicitation,
                commands::session::get_session_runtime_status,
                commands::control::get_cli_info,
                commands::runtime_hub::runtime_hub_list,
                commands::runtime_hub::runtime_hub_health,
                commands::runtime_hub::runtime_hub_diagnose,
                commands::runtime_hub::runtime_hub_set_default,
                commands::runtime_hub::runtime_hub_preview_config,
                commands::runtime_hub::runtime_hub_apply_config,
                commands::runtime_hub::runtime_hub_start_config_watch,
                commands::runtime_hub::runtime_hub_stop_config_watch,
                commands::runtime_health::runtime_health_get,
                commands::runtime_health::runtime_health_probe_now,
                commands::governor::governor_get_config,
                commands::governor::governor_update_config,
                commands::governor::governor_active_runs,
                commands::governor::governor_snapshot,
                commands::teams::list_teams,
                commands::teams::get_team_config,
                commands::teams::list_team_tasks,
                commands::teams::get_team_task,
                commands::teams::get_team_inbox,
                commands::teams::get_all_team_inboxes,
                commands::teams::delete_team,
                commands::team_runs::list_team_presets,
                commands::team_runs::create_team_run,
                commands::team_runs::list_team_runs,
                commands::team_runs::get_team_run,
                commands::team_runs::cancel_team_run,
                commands::team_runs::update_team_run_status,
                commands::team_runs::update_team_member_run,
                commands::team_runs::set_team_run_lead,
                commands::team_runs::set_team_member_task,
                commands::plugins::list_marketplaces,
                commands::plugins::list_marketplace_plugins,
                commands::plugins::list_standalone_skills,
                commands::plugins::get_skill_summary,
                commands::plugins::list_project_commands,
                commands::plugins::get_skill_content,
                commands::plugins::list_installed_plugins,
                commands::plugins::install_plugin,
                commands::plugins::uninstall_plugin,
                commands::plugins::enable_plugin,
                commands::plugins::disable_plugin,
                commands::plugins::update_plugin,
                commands::plugins::add_marketplace,
                commands::plugins::remove_marketplace,
                commands::plugins::update_marketplace,
                commands::plugins::create_skill,
                commands::plugins::update_skill,
                commands::plugins::delete_skill,
                commands::plugins::check_community_health,
                commands::plugins::search_community_skills,
                commands::plugins::get_community_skill_detail,
                commands::plugins::install_community_skill,
                commands::skill_sources::list_skill_sources,
                commands::skill_sources::create_skill_source,
                commands::skill_sources::update_skill_source,
                commands::skill_sources::delete_skill_source,
                commands::skill_sources::test_skill_source,
                commands::skill_sources::sync_skill_source,
                commands::skill_sources::preview_feishu_skill_doc,
                commands::skill_sources::install_remote_skill,
                commands::skill_sources::check_skill_source_updates,
                commands::agents::list_agents,
                commands::agents::read_agent_file,
                commands::agents::create_agent_file,
                commands::agents::update_agent_file,
                commands::agents::delete_agent_file,
                commands::clipboard::get_clipboard_files,
                commands::clipboard::read_clipboard_file,
                commands::clipboard::save_temp_attachment,
                commands::mcp::list_configured_mcp_servers,
                commands::mcp::add_mcp_server,
                commands::mcp::remove_mcp_server,
                commands::mcp::toggle_mcp_server_config,
                commands::mcp::get_disabled_mcp_servers,
                commands::mcp::check_mcp_registry_health,
                commands::notification::send_feishu_notification,
                commands::mcp::search_mcp_registry,
                commands::cli_config::get_cli_config,
                commands::cli_config::get_project_cli_config,
                commands::cli_config::update_cli_config,
                commands::cli_settings::get_cli_permissions,
                commands::cli_settings::update_cli_permissions,
                commands::onboarding::check_auth_status,
                commands::onboarding::detect_install_methods,
                commands::onboarding::run_claude_login,
                commands::onboarding::get_auth_overview,
                commands::onboarding::set_cli_api_key,
                commands::onboarding::remove_cli_api_key,
                commands::product_bootstrap::get_product_bootstrap_status,
                commands::product_bootstrap::run_product_bootstrap,
                commands::project_meta::list_project_metadata,
                commands::project_meta::list_project_git_status,
                commands::project_meta::read_project_notes,
                commands::project_meta::write_project_notes,
                commands::screenshot::capture_screenshot,
                commands::screenshot::update_screenshot_hotkey,
                commands::cli_sync::discover_cli_sessions,
                commands::cli_sync::import_cli_session,
                commands::cli_sync::sync_cli_session,
                commands::claude_history_migration::export_claude_code_history_archive,
                commands::claude_history_migration::import_claude_code_history_archive,
                commands::claude_history_migration::scan_claude_code_history,
                commands::updates::check_for_updates,
                commands::web_server::get_web_server_status,
                commands::web_server::get_web_server_token,
                commands::web_server::regenerate_web_server_token,
                commands::web_server::restart_web_server,
                commands::web_server::get_local_ip,
                commands::background::get_background_settings,
                commands::background::set_background_global,
                commands::background::set_background_session,
                commands::background::clear_background_session,
                commands::background::pick_background_image,
                commands::tasks::task_create,
                commands::tasks::task_get,
                commands::tasks::task_list,
                commands::tasks::task_list_events,
                commands::tasks::task_update_status,
                commands::tasks::task_link_run,
                commands::tasks::task_link_artifact,
                commands::tasks::task_set_quality_gate,
                commands::tasks::task_set_review_decision,
                commands::tasks::task_set_merge_decision,
                commands::tasks::task_reconcile_after_restart,
                commands::tasks::task_set_worktree,
                commands::tasks::task_track_changed_file,
                commands::run_journal::run_journal_get,
                commands::run_journal::run_journal_list_events,
                commands::run_journal::run_checkpoint_create,
                commands::run_journal::run_journal_reconcile,
                commands::attention_queue::attention_queue_get,
                commands::attention_queue::attention_queue_list_events,
                commands::attention_queue::attention_queue_acknowledge,
                commands::attention_queue::attention_queue_resolve,
                commands::attention_queue::attention_queue_reconcile,
                scheduler::list_scheduled_tasks,
                scheduler::create_scheduled_task,
                scheduler::update_scheduled_task,
                scheduler::delete_scheduled_task,
                scheduler::set_scheduled_task_enabled,
                scheduler::set_scheduled_task_skip_next,
                scheduler::run_scheduled_task_now,
                scheduler::list_scheduled_task_runs,
                scheduler::get_scheduled_task_run,
                commands::worktree::create_worktree,
                commands::worktree::auto_commit,
                commands::worktree::create_pull_request,
                commands::worktree::remove_worktree,
                commands::worktree::list_worktrees,
                commands::runtime_diagnostics::diagnostics_snapshot,
                commands::runtime_diagnostics::diagnostics_summary,
                commands::runtime_diagnostics::diagnostics_preview,
                commands::runtime_diagnostics::diagnostics_export,
                commands::runtime_diagnostics::diagnostics_export_bundle,
                commands::runtime_diagnostics::diagnostics_clear,
                // v1.1.0 / 110-A9 Browser Verification Lite (placeholder IPC).
                commands::browser::browser_navigate,
                commands::browser::browser_screenshot,
                commands::browser::browser_get_dom,
                // Browser Runtime (Real Chrome Mode) — Phase 2 IPC surface.
                commands::browser_runtime::browser_runtime_list_profiles,
                commands::browser_runtime::browser_runtime_create_profile,
                commands::browser_runtime::browser_runtime_get_profile,
                commands::browser_runtime::browser_runtime_delete_profile,
                commands::browser_runtime::browser_runtime_launch_profile,
                commands::browser_runtime::browser_runtime_list_sessions,
                commands::browser_runtime::browser_runtime_get_session,
                commands::browser_runtime::browser_runtime_list_tabs,
                commands::browser_runtime::browser_runtime_observe,
                commands::browser_runtime::browser_runtime_navigate,
                commands::browser_runtime::browser_runtime_perform,
                commands::browser_runtime::browser_runtime_close_session,
                commands::browser_runtime::browser_runtime_list_runtimes,
            ])
            .setup(move |app| {
                // Initialize runtime diagnostics observer (bounded ring buffer)
                commands::runtime_diagnostics::init_global_observer(diagnostics::DEFAULT_RING_CAP);

                // Phase 3: register the WebViewRuntime now that AppHandle is
                // available. The Chrome runtime was registered at builder time
                // (no AppHandle needed).
                {
                    let registry = app
                        .state::<Arc<crate::browser::BrowserRuntimeRegistry>>()
                        .inner()
                        .clone();
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        registry.register_default_webview_runtime(app_handle).await;
                    });
                }

                // Set up broadcast emitter (requires AppHandle, so must be in setup)
                let broadcaster = web_server::broadcaster::EventBroadcaster::new();
                let writer = app.state::<Arc<EventWriter>>().inner().clone();
                let emitter = Arc::new(web_server::broadcaster::BroadcastEmitter::new(
                    writer,
                    app.handle().clone(),
                    broadcaster.clone(),
                ));
                app.manage(broadcaster);
                app.manage(emitter.clone());

                // Resource Governor (110-S5) — manages concurrent run + memory
                // budgets. Must come after the emitter so budget-denied events
                // can be persisted + broadcast.
                let governor = crate::governor::ResourceGovernor::new(emitter.clone());
                app.manage(governor.clone());

                // Start web server (non-blocking, spawns async task)
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match web_server::start_server(&app_handle).await {
                        Ok(true) => log::debug!("[app] web server started"),
                        Ok(false) => log::debug!("[app] web server disabled"),
                        Err(e) => log::error!("[app] web server failed to start: {}", e),
                    }
                });

                // Start team file watcher for ~/.claude/teams/ and ~/.claude/tasks/
                let cancel = app.state::<CancellationToken>().inner().clone();
                hooks::team_watcher::start_team_watcher(app.handle().clone(), cancel.clone());

                cli_auto_sync::start_cli_auto_sync_loop(
                    app.handle().clone(),
                    cancel.clone(),
                    app.state::<Arc<EventWriter>>().inner().clone(),
                );

                // Start periodic runtime health probe (110-A4 Capability Matrix).
                // Initial probe runs immediately; subsequent rounds every 10 minutes.
                {
                    let health_store = app
                        .state::<crate::agent::runtime_health::RuntimeHealthStore>()
                        .inner()
                        .clone();
                    let emitter_for_probe = app.state::<Arc<BroadcastEmitter>>().inner().clone();
                    crate::agent::runtime_health::spawn_probe_loop(
                        health_store,
                        emitter_for_probe,
                        crate::agent::runtime_health::DEFAULT_PROBE_INTERVAL_SECS,
                        cancel.clone(),
                    );
                }

                // Start Resource Governor memory probe loop (110-S5). The
                // admission check itself runs synchronously inside start_session.
                {
                    let governor_for_probe = app
                        .state::<crate::governor::ResourceGovernor>()
                        .inner()
                        .clone();
                    crate::governor::spawn_probe_loop(governor_for_probe, cancel.clone());
                }

                // Start background scheduler for scheduled tasks
                scheduler::start_scheduler_loop(app.handle().clone(), cancel);

                // System tray — hide-to-tray on close, left-click to show
                // Non-fatal: if tray library is unavailable (e.g. some Linux desktops),
                // the app still works but window close = quit instead of hide-to-tray.
                match setup_tray(app) {
                    Ok(_) => {
                        tray_ok.store(true, Ordering::Relaxed);
                    }
                    Err(e) => {
                        log::warn!("[app] tray unavailable: {e}, window close = quit");
                    }
                }

                // Apply native window-level blur (vibrancy / mica / acrylic) to the
                // main window. Honors the `native_window_glass_enabled` user setting.
                // No-op on Linux. The conf.json `effects` field is also set as a
                // first-time hint; this runtime call lets us re-apply on toggle.
                window_effect::apply_for_setting(app.handle());

                // Global shortcut plugin — must be registered inside setup() with a handler
                // so the event dispatch loop is properly initialized
                {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    app.handle().plugin(
                        tauri_plugin_global_shortcut::Builder::new()
                            .with_handler(|app, _shortcut, event| {
                                if event.state == ShortcutState::Pressed {
                                    commands::screenshot::handle_global_shortcut(app);
                                }
                            })
                            .build(),
                    )?;
                }

                // Register screenshot hotkey from settings (must come after plugin init)
                commands::screenshot::init_screenshot_hotkey(app.handle());

                // Seed MiWarp recommended skills + default Claude append prompt on first run.
                {
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let result =
                            tokio::task::spawn_blocking(storage::product_bootstrap::run_if_needed)
                                .await
                                .map_err(|e| format!("bootstrap join error: {e}"));
                        match result {
                            Ok(Ok(run)) if !run.skipped => {
                                log::info!(
                                    "[app] product bootstrap applied: skills={}, append_prompt={}",
                                    run.skills_installed.len(),
                                    run.append_prompt_applied
                                );
                                let _ = app_handle.emit("product-bootstrap-applied", &run);
                            }
                            Ok(Ok(_)) => {}
                            Ok(Err(e)) => log::warn!("[app] product bootstrap failed: {e}"),
                            Err(e) => log::warn!("[app] product bootstrap task failed: {e}"),
                        }
                    });
                }

                Ok(())
            })
            .on_window_event(move |window, event| {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        // Only intercept close for the main window
                        if window.label() != "main" {
                            return;
                        }
                        api.prevent_close(); // always prevent default close
                        if tray_ok_for_event.load(Ordering::Relaxed) {
                            // Hide to tray instead of quitting
                            let _ = window.hide();
                            log::debug!("[app] window hidden to tray");
                        } else {
                            // No tray — graceful shutdown
                            log::debug!("[app] tray unavailable, starting graceful shutdown");
                            let app = window.app_handle().clone();
                            if let Some(gate) = app.try_state::<ShutdownGate>() {
                                if !gate.try_enter() {
                                    return; // shutdown already in progress
                                }
                            }
                            if let Some(ct) = app.try_state::<CancellationToken>() {
                                ct.cancel();
                            }
                            tauri::async_runtime::spawn(async move {
                                graceful_shutdown_actors(&app).await;
                                app.exit(0);
                            });
                        }
                    }
                    tauri::WindowEvent::Destroyed if window.label() == "main" => {
                        // Safety fallback: cancel actors if main window is truly destroyed (e.g. app.exit()).
                        // Skip for secondary windows (e.g. preview) — destroying them must not shut down the app.
                        cancel_for_exit.cancel();
                    }
                    _ => {}
                }
            })
            .build(tauri::generate_context!())
            .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // macOS: clicking the dock icon when all windows are hidden should reopen the window
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                show_main_window(app_handle);
                log::debug!("[app] reopened window from dock click");
            }
        }

        let _ = (app_handle, event); // suppress unused warnings on non-macOS
    });
}

/// Restore the main window: unminimize if needed, then show and focus.
fn show_main_window(handle: &impl tauri::Manager<tauri::Wry>) {
    if let Some(w) = handle.get_webview_window("main") {
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Create system tray with Show/Quit menu. Left-click shows the window.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};

    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;

    let tray_icon_bytes = include_bytes!("../icons/tray-icon.png");
    let tray_img =
        tauri::image::Image::from_bytes(tray_icon_bytes).expect("failed to load tray icon");

    TrayIconBuilder::new()
        .icon(tray_img)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                show_main_window(app);
            }
            "quit" => {
                if let Some(gate) = app.try_state::<ShutdownGate>() {
                    if !gate.try_enter() {
                        return; // shutdown already in progress
                    }
                }
                if let Some(ct) = app.try_state::<CancellationToken>() {
                    ct.cancel();
                }
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    graceful_shutdown_actors(&app).await;
                    app.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    log::debug!("[app] system tray created");
    Ok(())
}

/// Graceful shutdown: wait for actors to self-clean, then force-kill remaining processes.
///
/// Two-phase approach:
/// - Phase 1: Wait up to 3s for actors to exit (cancel token already fired → handle_stop → kill+wait).
/// - Phase 2: Drain remaining actors, try_send Stop, join with 2s timeout, abort if stuck.
/// - Then drain ProcessMap (stream processes).
async fn graceful_shutdown_actors(app: &tauri::AppHandle) {
    use crate::agent::adapter::ActorSessionMap;
    use crate::agent::session_actor::ActorCommand;
    use crate::agent::stream::ProcessMap;

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);

    // ── Phase 1: Wait for actors to self-cleanup (cancel already fired) ──
    if let Some(sessions) = app.try_state::<ActorSessionMap>() {
        loop {
            let count = sessions.lock().await.len();
            if count == 0 {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                log::warn!(
                    "[app] graceful shutdown: {} actors still alive, force stopping",
                    count
                );
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        // ── Phase 2: Force-stop remaining actors ──
        let remaining: Vec<_> = {
            let mut map = sessions.lock().await;
            map.drain().collect()
        };
        for (run_id, handle) in remaining {
            log::debug!("[app] force stopping actor: {}", run_id);
            // try_send avoids blocking if mailbox is full (bounded channel, 64 slots)
            let (reply_tx, _reply_rx) = tokio::sync::oneshot::channel();
            let _ = handle
                .cmd_tx
                .try_send(ActorCommand::Stop { reply: reply_tx });
            // Get AbortHandle before consuming JoinHandle in timeout
            let abort = handle.join_handle.abort_handle();
            match tokio::time::timeout(std::time::Duration::from_secs(2), handle.join_handle).await
            {
                Ok(Ok(())) => {
                    log::debug!("[app] actor {} exited cleanly", run_id);
                }
                Ok(Err(e)) => {
                    log::warn!("[app] actor {} join error: {}", run_id, e);
                }
                Err(_) => {
                    log::warn!("[app] actor {} did not exit in 2s, aborting task", run_id);
                    abort.abort();
                }
            }
        }
    }

    // ── Kill remaining stream processes ──
    // ProcessMap lock is only held briefly (run_agent/stop_process do remove-then-await),
    // but we keep a timeout as a defensive fallback.
    if let Some(process_map) = app.try_state::<ProcessMap>() {
        let to_kill = match tokio::time::timeout(std::time::Duration::from_secs(1), async {
            let mut map = process_map.lock().await;
            map.drain().collect::<Vec<_>>()
        })
        .await
        {
            Ok(vec) => vec,
            Err(_) => {
                log::warn!(
                    "[app] graceful shutdown: ProcessMap lock timeout, \
                     skipping (kill_on_drop / Job Object may handle)"
                );
                Vec::new()
            }
        };
        for (run_id, mut child) in to_kill {
            log::debug!("[app] graceful shutdown: killing stream process {}", run_id);
            let _ = child.kill().await;
            let _ = tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await;
        }
    }

    log::debug!("[app] graceful shutdown complete");
}
