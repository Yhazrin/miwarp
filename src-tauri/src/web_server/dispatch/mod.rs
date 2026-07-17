use serde_json::{json, Value};
use std::time::Instant;

use crate::agent::attachment::AttachmentData;
use crate::agent::session_actor::ActorCommand;
use crate::models::SessionMode;
use crate::storage;
use crate::web_server::state::AppState;

/// Dispatch a JSON-RPC method call to the corresponding command handler.
/// Returns Ok(result_value) or Err(error_string).
pub async fn dispatch_command(
    method: &str,
    params: Value,
    state: &AppState,
) -> Result<Value, String> {
    let start = Instant::now();
    // Normalize camelCase → snake_case for top-level param keys only
    let params = normalize_top_level_keys(params);

    log::debug!("[dispatch] method={}", method);

    let result = match method {
        // ── Runs ──
        "list_runs" => {
            let runs = crate::commands::runs::list_runs().await?;
            serde_json::to_value(runs).map_err(|e| e.to_string())
        }
        "list_runs_lite" => {
            let runs = crate::commands::runs::list_runs_lite().await?;
            serde_json::to_value(runs).map_err(|e| e.to_string())
        }
        "list_runs_since" => {
            let since = extract_str(&params, "since")?;
            let runs = crate::commands::runs::list_runs_since(since).await?;
            serde_json::to_value(runs).map_err(|e| e.to_string())
        }
        "get_backend_capabilities" => {
            let capabilities = crate::commands::capabilities::get_backend_capabilities()?;
            serde_json::to_value(capabilities).map_err(|e| e.to_string())
        }
        "get_run" => {
            let id = extract_str(&params, "id")?;
            let run = crate::commands::runs::get_run(id)?;
            serde_json::to_value(run).map_err(|e| e.to_string())
        }
        "start_run" => {
            let prompt = extract_str(&params, "prompt")?;
            let cwd = extract_str(&params, "cwd")?;
            let agent = extract_str(&params, "agent")?;
            let model = params
                .get("model")
                .and_then(|v| v.as_str())
                .map(String::from);
            let remote_host_name = params
                .get("remote_host_name")
                .and_then(|v| v.as_str())
                .map(String::from);
            let platform_id = params
                .get("platform_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let execution_path = params
                .get("execution_path")
                .and_then(|v| v.as_str())
                .map(String::from);
            let run_surface = params
                .get("run_surface")
                .and_then(|v| v.as_str())
                .map(String::from);
            let creation_mode = params
                .get("creation_mode")
                .and_then(|v| v.as_str())
                .map(String::from);
            let folder_id = params
                .get("folder_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let task_id = params
                .get("task_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let run = crate::commands::runs::start_run(
                prompt,
                cwd,
                agent,
                model,
                remote_host_name,
                platform_id,
                execution_path,
                run_surface,
                creation_mode,
                folder_id,
                task_id,
            )?;
            serde_json::to_value(run).map_err(|e| e.to_string())
        }
        "rename_run" => {
            let id = extract_str(&params, "id")?;
            let name = extract_str(&params, "name")?;
            crate::commands::runs::rename_run(id, name)?;
            Ok(json!(true))
        }
        "generate_run_title" => {
            let run_id = extract_str(&params, "runId")?;
            // Web-server path: pass the session map so the title can route
            // through the actor mailbox when the session is alive.
            let title = crate::agent::title_generator::generate_for_run(
                &run_id,
                Some(state.sessions.clone()),
            )
            .await?;
            Ok(json!({ "title": title }))
        }
        "soft_delete_runs" => {
            let ids: Vec<String> = params
                .get("ids")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let count = crate::commands::runs::soft_delete_runs(ids)?;
            Ok(json!(count))
        }
        "update_run_model" => {
            let id = extract_str(&params, "id")?;
            let model = extract_str(&params, "model")?;
            crate::commands::runs::update_run_model(id, model)?;
            Ok(json!(true))
        }
        "stop_run" => {
            let id = extract_str(&params, "id")?;
            let result = stop_run_impl(id, state).await?;
            Ok(json!(result))
        }
        "search_prompts" => {
            let query = extract_str(&params, "query")?;
            let max_results = params
                .get("max_results")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize);
            let result = crate::commands::runs::search_prompts(query, max_results).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "search_runs" => {
            let filters_val = params
                .get("filters")
                .cloned()
                .unwrap_or(serde_json::json!({}));
            let filters: crate::models::RunSearchFilters = serde_json::from_value(filters_val)
                .map_err(|e| format!("Invalid filters: {}", e))?;
            let result = crate::commands::history::search_runs(filters).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_run_files" => {
            let run_id = extract_str(&params, "run_id")?;
            let result = crate::commands::history::get_run_files(run_id).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── Prompt Favorites ──
        "add_prompt_favorite" => {
            let run_id = extract_str(&params, "run_id")?;
            let seq = extract_u64(&params, "seq")?;
            let text = extract_str(&params, "text")?;
            let result = crate::commands::runs::add_prompt_favorite(run_id, seq, text)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "remove_prompt_favorite" => {
            let run_id = extract_str(&params, "run_id")?;
            let seq = extract_u64(&params, "seq")?;
            crate::commands::runs::remove_prompt_favorite(run_id, seq)?;
            Ok(json!(true))
        }
        "update_prompt_favorite_tags" => {
            let run_id = extract_str(&params, "run_id")?;
            let seq = extract_u64(&params, "seq")?;
            let tags: Vec<String> = params
                .get("tags")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            crate::storage::favorites::update_favorite_tags(&run_id, seq, tags)?;
            Ok(json!(true))
        }
        "update_prompt_favorite_note" => {
            let run_id = extract_str(&params, "run_id")?;
            let seq = extract_u64(&params, "seq")?;
            let note = extract_str(&params, "note")?;
            crate::commands::runs::update_prompt_favorite_note(run_id, seq, note)?;
            Ok(json!(true))
        }
        "list_prompt_favorites" => {
            let result = crate::commands::runs::list_prompt_favorites()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_prompt_tags" => {
            let result = crate::commands::runs::list_prompt_tags()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── Events ──
        "get_run_events" => {
            let id = extract_str(&params, "id")?;
            let since_seq = params.get("since_seq").and_then(|v| v.as_u64());
            let events = crate::commands::events::get_run_events(id, since_seq)?;
            serde_json::to_value(events).map_err(|e| e.to_string())
        }
        "get_bus_events" => {
            let id = extract_str(&params, "id")?;
            let since_seq = params.get("since_seq").and_then(|v| v.as_u64());
            // Validate run exists
            crate::storage::runs::get_run(&id).ok_or_else(|| format!("Run {} not found", id))?;
            let run_id = id.clone();
            let events = tokio::task::spawn_blocking(move || {
                crate::storage::events::list_bus_events(&run_id, since_seq)
            })
            .await
            .map_err(|e| format!("spawn_blocking failed: {}", e))?;
            Ok(Value::Array(events))
        }

        // ── Artifacts ──
        "get_run_artifacts" => {
            let id = extract_str(&params, "id")?;
            let result = crate::commands::artifacts::get_run_artifacts(id)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "export_conversation" => {
            let run_id = extract_str(&params, "run_id")?;
            let md = crate::commands::export::export_conversation(run_id)?;
            Ok(json!(md))
        }

        // ── Task Core ──
        "task_create" => {
            let input_val = params
                .get("input")
                .cloned()
                .ok_or_else(|| "missing required param: input".to_string())?;
            let input: crate::task_core::TaskCreateInput =
                serde_json::from_value(input_val).map_err(|e| format!("Invalid input: {e}"))?;
            let task = crate::commands::tasks::task_create(input)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_get" => {
            let id = extract_str(&params, "id")?;
            let task = crate::commands::tasks::task_get(id)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_list" => {
            let tasks = crate::commands::tasks::task_list()?;
            serde_json::to_value(tasks).map_err(|e| e.to_string())
        }
        "task_list_events" => {
            let id = extract_str(&params, "id")?;
            let since_seq = params.get("since_seq").and_then(serde_json::Value::as_u64);
            let events = crate::commands::tasks::task_list_events(id, since_seq)?;
            serde_json::to_value(events).map_err(|e| e.to_string())
        }
        "task_update_status" => {
            let id = extract_str(&params, "id")?;
            let status_val = params
                .get("status")
                .cloned()
                .ok_or_else(|| "missing required param: status".to_string())?;
            let status: crate::task_core::TaskStatus =
                serde_json::from_value(status_val).map_err(|e| format!("Invalid status: {e}"))?;
            let task = crate::commands::tasks::task_update_status(id, status)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_link_run" => {
            let input_val = params
                .get("input")
                .cloned()
                .ok_or_else(|| "missing required param: input".to_string())?;
            let input: crate::commands::tasks::TaskLinkRunInput =
                serde_json::from_value(input_val).map_err(|e| format!("Invalid input: {e}"))?;
            let task = crate::commands::tasks::task_link_run(input)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_link_artifact" => {
            let input_val = params
                .get("input")
                .cloned()
                .ok_or_else(|| "missing required param: input".to_string())?;
            let input: crate::commands::tasks::TaskLinkArtifactInput =
                serde_json::from_value(input_val).map_err(|e| format!("Invalid input: {e}"))?;
            let task = crate::commands::tasks::task_link_artifact(input)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_set_quality_gate" => {
            let id = extract_str(&params, "id")?;
            let gate_val = params
                .get("gate")
                .cloned()
                .ok_or_else(|| "missing required param: gate".to_string())?;
            let gate: crate::task_core::TaskQualityGate =
                serde_json::from_value(gate_val).map_err(|e| format!("Invalid gate: {e}"))?;
            let task = crate::commands::tasks::task_set_quality_gate(id, gate)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_set_review_decision" => {
            let id = extract_str(&params, "id")?;
            let decision_val = params
                .get("decision")
                .cloned()
                .ok_or_else(|| "missing required param: decision".to_string())?;
            let decision: crate::task_core::TaskReviewDecision =
                serde_json::from_value(decision_val)
                    .map_err(|e| format!("Invalid decision: {e}"))?;
            let task = crate::commands::tasks::task_set_review_decision(id, decision)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_set_merge_decision" => {
            let id = extract_str(&params, "id")?;
            let decision_val = params
                .get("decision")
                .cloned()
                .ok_or_else(|| "missing required param: decision".to_string())?;
            let decision: crate::task_core::TaskMergeDecision =
                serde_json::from_value(decision_val)
                    .map_err(|e| format!("Invalid merge decision: {e}"))?;
            let task = crate::commands::tasks::task_set_merge_decision(id, decision)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_reconcile_after_restart" => {
            let report = crate::commands::tasks::task_reconcile_after_restart()?;
            serde_json::to_value(report).map_err(|e| e.to_string())
        }
        "task_set_worktree" => {
            let id = extract_str(&params, "id")?;
            let worktree_path = extract_str(&params, "worktree_path")?;
            let worktree_branch = extract_str(&params, "worktree_branch")?;
            let task =
                crate::commands::tasks::task_set_worktree(id, worktree_path, worktree_branch)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "task_track_changed_file" => {
            let id = extract_str(&params, "id")?;
            let path = extract_str(&params, "path")?;
            let task = crate::commands::tasks::task_track_changed_file(id, path)?;
            serde_json::to_value(task).map_err(|e| e.to_string())
        }
        "run_journal_get" => {
            let run_id = extract_str(&params, "runId")?;
            let snapshot = crate::commands::run_journal::run_journal_get(run_id)?;
            serde_json::to_value(snapshot).map_err(|e| e.to_string())
        }
        "run_journal_list_events" => {
            let run_id = extract_str(&params, "runId")?;
            let since_seq = params.get("sinceSeq").and_then(serde_json::Value::as_u64);
            let events = crate::commands::run_journal::run_journal_list_events(run_id, since_seq)?;
            serde_json::to_value(events).map_err(|e| e.to_string())
        }
        "run_checkpoint_create" => {
            let run_id = extract_str(&params, "runId")?;
            let label = params
                .get("label")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let checkpoint = crate::commands::run_journal::run_checkpoint_create(run_id, label)?;
            serde_json::to_value(checkpoint).map_err(|e| e.to_string())
        }
        "run_journal_reconcile" => {
            let report = crate::commands::run_journal::run_journal_reconcile()?;
            serde_json::to_value(report).map_err(|e| e.to_string())
        }
        "attention_queue_get" => {
            let snapshot = crate::commands::attention_queue::attention_queue_get()?;
            serde_json::to_value(snapshot).map_err(|e| e.to_string())
        }
        "attention_queue_list_events" => {
            let since_seq = params.get("since_seq").and_then(|value| value.as_u64());
            let events = crate::commands::attention_queue::attention_queue_list_events(since_seq)?;
            serde_json::to_value(events).map_err(|e| e.to_string())
        }
        "attention_queue_acknowledge" => {
            let id = extract_str(&params, "id")?;
            let actor = params
                .get("actor")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let snapshot = storage::attention_queue::acknowledge(&id, actor)?;
            crate::commands::attention_queue::emit_changed(
                &state.emitter,
                &snapshot,
                Some(id.clone()),
            );
            serde_json::to_value(snapshot).map_err(|e| e.to_string())
        }
        "attention_queue_resolve" => {
            let id = extract_str(&params, "id")?;
            let action: crate::attention_core::AttentionAction = params
                .get("action")
                .ok_or_else(|| "action is required".to_string())
                .and_then(|value| {
                    serde_json::from_value(value.clone()).map_err(|e| e.to_string())
                })?;
            let actor = params
                .get("actor")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let note = params
                .get("note")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let snapshot = storage::attention_queue::resolve(&id, action, actor, note)?;
            crate::commands::attention_queue::emit_changed(
                &state.emitter,
                &snapshot,
                Some(id.clone()),
            );
            serde_json::to_value(snapshot).map_err(|e| e.to_string())
        }
        "attention_queue_reconcile" => {
            let report = storage::attention_queue::reconcile()?;
            // Refetch snapshot for typed AttentionChanged counts.
            if let Ok(snapshot) = storage::attention_queue::get() {
                crate::commands::attention_queue::emit_changed(&state.emitter, &snapshot, None);
            } else {
                state.emitter.emit_realtime(
                    "attention_queue_changed",
                    &serde_json::json!({}),
                    None,
                );
            }
            serde_json::to_value(report).map_err(|e| e.to_string())
        }

        // ── Settings ──
        "get_user_settings" => {
            let settings = crate::storage::settings::get_user_settings();
            let mut val = serde_json::to_value(settings).map_err(|e| e.to_string())?;
            // Strip token for WS clients (security: don't expose token over WS)
            if let Some(obj) = val.as_object_mut() {
                obj.remove("web_server_token");
            }
            Ok(val)
        }
        "update_user_settings" => {
            let patch = params.get("patch").cloned().unwrap_or(params.clone());
            let result = crate::commands::settings::update_user_settings_with_rotation(
                patch,
                &state.token_version,
                &state.ws_shutdown,
                &state.token,
            )
            .await?;
            let mut val = serde_json::to_value(result).map_err(|e| e.to_string())?;
            if let Some(obj) = val.as_object_mut() {
                obj.remove("web_server_token");
            }
            Ok(val)
        }
        "reset_personal_profile" => {
            let result = crate::commands::settings::reset_personal_profile()?;
            let mut val = serde_json::to_value(result).map_err(|e| e.to_string())?;
            if let Some(obj) = val.as_object_mut() {
                obj.remove("web_server_token");
            }
            Ok(val)
        }
        "get_agent_settings" => {
            let agent = extract_str(&params, "agent")?;
            let settings = crate::commands::settings::get_agent_settings(agent);
            serde_json::to_value(settings).map_err(|e| e.to_string())
        }
        "update_agent_settings" => {
            let agent = extract_str(&params, "agent")?;
            let patch = params.get("patch").cloned().unwrap_or(json!({}));
            let result = crate::commands::settings::update_agent_settings(agent, patch)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── Files ──
        "read_text_file" => {
            let path = extract_str(&params, "path")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let content = crate::commands::files::read_text_file(path, cwd)?;
            Ok(json!(content))
        }
        "stat_text_file" => {
            let path = extract_str(&params, "path")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let size = crate::commands::files::stat_text_file(path, cwd)?;
            Ok(json!(size))
        }
        "write_text_file" => {
            let path = extract_str(&params, "path")?;
            let content = extract_str(&params, "content")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            crate::commands::files::write_text_file(path, content, cwd)?;
            Ok(json!(true))
        }
        "read_task_output" => {
            let path = extract_str(&params, "path")?;
            let content = crate::commands::files::read_task_output(path)?;
            Ok(json!(content))
        }
        "list_memory_files" => {
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::files::list_memory_files(cwd)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── FS ──
        "list_directory" => {
            let path = extract_str(&params, "path")?;
            let show_hidden = params.get("show_hidden").and_then(|v| v.as_bool());
            let result = crate::commands::fs::list_directory(path, show_hidden)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "check_is_directory" => {
            let path = extract_str(&params, "path")?;
            Ok(json!(crate::commands::fs::check_is_directory(path)))
        }
        "issue_drop_grant" => {
            let paths = params
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect::<Vec<String>>()
                })
                .unwrap_or_default();
            let result = crate::commands::fs::issue_drop_grant(paths)?;
            Ok(json!(result))
        }
        "read_file_base64" => {
            let path = extract_str(&params, "path")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let grant = params
                .get("grant")
                .and_then(|v| v.as_str())
                .map(String::from);
            let result = crate::commands::fs::read_file_base64(path, cwd, grant)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_remote_directory" => {
            let host_name = extract_str(&params, "host_name")?;
            let path = extract_str(&params, "path")?;
            let show_hidden = params.get("show_hidden").and_then(|v| v.as_bool());
            let result =
                crate::commands::remote_fs::list_remote_directory(host_name, path, show_hidden)
                    .await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "resolve_remote_home" => {
            let host_name = extract_str(&params, "host_name")?;
            let result = crate::commands::remote_fs::resolve_remote_home(host_name).await?;
            Ok(json!(result))
        }

        // ── Git ──
        "get_git_summary" => {
            let cwd = extract_str(&params, "cwd")?;
            let result = crate::commands::git::get_git_summary(cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_git_branch" => {
            let cwd = extract_str(&params, "cwd")?;
            let result = crate::commands::git::get_git_branch(cwd).await?;
            Ok(json!(result))
        }
        "get_git_diff" => {
            let cwd = extract_str(&params, "cwd")?;
            let staged = params
                .get("staged")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let file = params
                .get("file")
                .and_then(|v| v.as_str())
                .map(String::from);
            let result = crate::commands::git::get_git_diff(cwd, staged, file).await?;
            Ok(json!(result))
        }
        "get_git_status" => {
            let cwd = extract_str(&params, "cwd")?;
            let result = crate::commands::git::get_git_status(cwd).await?;
            Ok(json!(result))
        }
        "get_git_timeline" => {
            let cwd = extract_str(&params, "cwd")?;
            let limit = params
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let result = crate::commands::git::get_git_timeline(cwd, limit).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── Teams ──
        "list_teams" => {
            let result = crate::commands::teams::list_teams()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_team_config" => {
            let name = extract_str(&params, "name")?;
            let result = crate::commands::teams::get_team_config(name)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_team_tasks" => {
            let team_name = extract_str(&params, "team_name")?;
            let result = crate::commands::teams::list_team_tasks(team_name)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_team_task" => {
            let team_name = extract_str(&params, "team_name")?;
            let task_id = extract_str(&params, "task_id")?;
            let result = crate::commands::teams::get_team_task(team_name, task_id)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_team_inbox" => {
            let team_name = extract_str(&params, "team_name")?;
            let member_name = extract_str(&params, "member_name")?;
            let result = crate::commands::teams::get_team_inbox(team_name, member_name)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_all_team_inboxes" => {
            let name = extract_str(&params, "name")?;
            let result = crate::commands::teams::get_all_team_inboxes(name)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "delete_team" => {
            let name = extract_str(&params, "name")?;
            crate::commands::teams::delete_team(name)?;
            Ok(json!(true))
        }

        // ── Plugins / Skills ──
        "list_marketplaces" => {
            let result = crate::commands::plugins::list_marketplaces()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_marketplace_plugins" => {
            let result = crate::commands::plugins::list_marketplace_plugins()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_standalone_skills" => {
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::plugins::list_standalone_skills(cwd)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_project_commands" => {
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::plugins::list_project_commands(cwd)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_installed_plugins" => {
            let result = crate::commands::plugins::list_installed_plugins().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_skill_content" => {
            let path = extract_str(&params, "path")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::plugins::get_skill_content(path, cwd)?;
            Ok(json!(result))
        }
        "create_skill" => {
            let name = extract_str(&params, "name")?;
            let description = extract_str(&params, "description")?;
            let content = extract_str(&params, "content")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result =
                crate::commands::plugins::create_skill(name, description, content, scope, cwd)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "update_skill" => {
            let path = extract_str(&params, "path")?;
            let content = extract_str(&params, "content")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            crate::commands::plugins::update_skill(path, content, cwd)?;
            Ok(json!(true))
        }
        "delete_skill" => {
            let path = extract_str(&params, "path")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            crate::commands::plugins::delete_skill(path, cwd)?;
            Ok(json!(true))
        }
        "install_plugin" => {
            let name = extract_str(&params, "name")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::plugins::install_plugin(name, scope, cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "uninstall_plugin" => {
            let name = extract_str(&params, "name")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::plugins::uninstall_plugin(name, scope, cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "enable_plugin" => {
            let name = extract_str(&params, "name")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::plugins::enable_plugin(name, scope, cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "disable_plugin" => {
            let name = extract_str(&params, "name")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::plugins::disable_plugin(name, scope, cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "update_plugin" => {
            let name = extract_str(&params, "name")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::plugins::update_plugin(name, scope, cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "add_marketplace" => {
            let source = extract_str(&params, "source")?;
            let result = crate::commands::plugins::add_marketplace(source).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "remove_marketplace" => {
            let name = extract_str(&params, "name")?;
            let result = crate::commands::plugins::remove_marketplace(name).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "update_marketplace" => {
            let name = params
                .get("name")
                .and_then(|v| v.as_str())
                .map(String::from);
            let result = crate::commands::plugins::update_marketplace(name).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "check_community_health" => {
            let result = crate::commands::plugins::check_community_health().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "search_community_skills" => {
            let query = extract_str(&params, "query")?;
            let limit = params
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
            let result = crate::commands::plugins::search_community_skills(query, limit).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_community_skill_detail" => {
            let source = extract_str(&params, "source")?;
            let skill_id = extract_str(&params, "skill_id")?;
            let result =
                crate::commands::plugins::get_community_skill_detail(source, skill_id).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "install_community_skill" => {
            let source = extract_str(&params, "source")?;
            let skill_id = extract_str(&params, "skill_id")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result =
                crate::commands::plugins::install_community_skill(source, skill_id, scope, cwd)
                    .await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── Skill sources (Feishu / GitHub / folder — MVP: Feishu doc URL)
        "list_skill_sources" => {
            let result = crate::commands::skill_sources::list_skill_sources()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "create_skill_source" => {
            let config_val = params
                .get("config")
                .ok_or_else(|| "Missing required parameter: config".to_string())?;
            let config: crate::models::SkillSourceConfig =
                serde_json::from_value(config_val.clone())
                    .map_err(|e| format!("Bad config: {}", e))?;
            let result = crate::commands::skill_sources::create_skill_source(config)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "update_skill_source" => {
            let id = extract_str(&params, "id")?;
            let patch_val = params
                .get("patch")
                .ok_or_else(|| "Missing required parameter: patch".to_string())?;
            let patch: crate::models::SkillSourceConfig = serde_json::from_value(patch_val.clone())
                .map_err(|e| format!("Bad patch: {}", e))?;
            let result = crate::commands::skill_sources::update_skill_source(id, patch)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "delete_skill_source" => {
            let id = extract_str(&params, "id")?;
            crate::commands::skill_sources::delete_skill_source(id)?;
            Ok(json!(true))
        }
        "test_skill_source" => {
            let id = extract_str(&params, "id")?;
            let result = crate::commands::skill_sources::test_skill_source(id).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "sync_skill_source" => {
            let id = extract_str(&params, "id")?;
            let result = crate::commands::skill_sources::sync_skill_source(id).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "preview_feishu_skill_doc" => {
            let doc_url = extract_str(&params, "doc_url")?;
            let auth_profile = params
                .get("auth_profile")
                .and_then(|v| v.as_str())
                .map(String::from);
            let parser_mode = params
                .get("parser_mode")
                .and_then(|v| v.as_str())
                .map(String::from);
            let source_id_hint = params
                .get("source_id_hint")
                .and_then(|v| v.as_str())
                .map(String::from);
            let result = crate::commands::skill_sources::preview_feishu_skill_doc(
                doc_url,
                auth_profile,
                parser_mode,
                source_id_hint,
            )
            .await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "install_remote_skill" => {
            let candidate_id = extract_str(&params, "candidate_id")?;
            let scope = params
                .get("scope")
                .and_then(|v| v.as_str())
                .map(String::from);
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let conflict_resolution = params
                .get("conflict_resolution")
                .and_then(|v| v.as_str())
                .map(String::from);
            let result = crate::commands::skill_sources::install_remote_skill(
                candidate_id,
                scope,
                cwd,
                conflict_resolution,
            )?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "check_skill_source_updates" => {
            let id = extract_str(&params, "id")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result =
                crate::commands::skill_sources::check_skill_source_updates(id, cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── CLI Config ──
        "get_cli_config" => {
            let result = crate::commands::cli_config::get_cli_config()?;
            Ok(result)
        }
        "get_project_cli_config" => {
            let cwd = extract_str(&params, "cwd")?;
            let result = crate::commands::cli_config::get_project_cli_config(cwd)?;
            Ok(result)
        }
        "update_cli_config" => {
            let patch = params.get("patch").cloned().unwrap_or(params.clone());
            let result = crate::commands::cli_config::update_cli_config(patch)?;
            Ok(result)
        }

        // ── CLI Permissions ──
        "get_cli_permissions" => {
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::cli_settings::get_cli_permissions(cwd).await?;
            Ok(result)
        }
        "update_cli_permissions" => {
            let scope = extract_str(&params, "scope")?;
            let category = extract_str(&params, "category")?;
            let rules_val = params
                .get("rules")
                .ok_or_else(|| "Missing required parameter: rules".to_string())?;
            let rules: Vec<String> = serde_json::from_value(rules_val.clone())
                .map_err(|e| format!("Invalid rules: {}", e))?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            crate::commands::cli_settings::update_cli_permissions(scope, category, rules, cwd)
                .await?;
            Ok(json!(true))
        }

        // ── MCP ──
        "list_configured_mcp_servers" => {
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::mcp::list_configured_mcp_servers(cwd)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "add_mcp_server" => {
            let name = extract_str(&params, "name")?;
            let transport = extract_str(&params, "transport")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let config_json = params
                .get("config_json")
                .and_then(|v| v.as_str())
                .map(String::from);
            let url = params.get("url").and_then(|v| v.as_str()).map(String::from);
            let env_vars: Option<std::collections::HashMap<String, String>> = params
                .get("env_vars")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let headers: Option<std::collections::HashMap<String, String>> = params
                .get("headers")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let result = crate::commands::mcp::add_mcp_server(
                name,
                transport,
                scope,
                cwd,
                config_json,
                url,
                env_vars,
                headers,
            )
            .await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "remove_mcp_server" => {
            let name = extract_str(&params, "name")?;
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::mcp::remove_mcp_server(name, scope, cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "toggle_mcp_server_config" => {
            let name = extract_str(&params, "name")?;
            let enabled = params
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let scope = extract_str(&params, "scope")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::mcp::toggle_mcp_server_config(name, enabled, scope, cwd)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "check_mcp_registry_health" => {
            let result = crate::commands::mcp::check_mcp_registry_health().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "search_mcp_registry" => {
            let query = extract_str(&params, "query")?;
            let limit = params
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
            let cursor = params
                .get("cursor")
                .and_then(|v| v.as_str())
                .map(String::from);
            let result = crate::commands::mcp::search_mcp_registry(query, limit, cursor).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── Diagnostics ──
        "check_agent_cli" => {
            let agent = extract_str(&params, "agent")?;
            let result = crate::commands::diagnostics::check_agent_cli(agent).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "check_cli_binary" => {
            let name = extract_str(&params, "name")?;
            let result = crate::commands::diagnostics::check_cli_binary(name).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "detect_cli_tool" => {
            let tool_id = extract_str(&params, "tool_id")?;
            let result = crate::commands::diagnostics::detect_cli_tool(tool_id).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "check_project_init" => {
            let cwd = extract_str(&params, "cwd")?;
            let result = crate::commands::diagnostics::check_project_init(cwd)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "run_diagnostics" => {
            let cwd = extract_str(&params, "cwd")?;
            let result = crate::commands::diagnostics::run_diagnostics(cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_cli_dist_tags" => {
            let result = crate::commands::diagnostics::get_cli_dist_tags().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "update_claude_cli" => {
            let result = crate::commands::diagnostics::update_claude_cli().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "update_codex_cli" => {
            let result = crate::commands::diagnostics::update_codex_cli().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "update_mimo_cli" => {
            let result = crate::commands::diagnostics::update_mimo_cli().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "update_ccswitch" => {
            let result = crate::commands::diagnostics::update_ccswitch().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "run_cli_update" => {
            let tool_id = extract_str(&params, "tool_id")?;
            let result = crate::commands::diagnostics::run_cli_update(tool_id).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "detect_local_proxy" => {
            let proxy_id = extract_str(&params, "proxy_id")?;
            let base_url = extract_str(&params, "base_url")?;
            let result =
                crate::commands::diagnostics::detect_local_proxy(proxy_id, base_url).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "test_api_connectivity" => {
            let api_key = extract_str(&params, "api_key")?;
            let base_url = extract_str(&params, "base_url")?;
            let auth_env_var = extract_str(&params, "auth_env_var")?;
            let model = extract_str(&params, "model")?;
            let result = crate::commands::diagnostics::test_api_connectivity(
                api_key,
                base_url,
                auth_env_var,
                model,
            )
            .await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "test_remote_host" => {
            let host = extract_str(&params, "host")?;
            let user = extract_str(&params, "user")?;
            let port = params
                .get("port")
                .and_then(|v| v.as_u64())
                .map(|n| n as u16);
            let key_path = params
                .get("key_path")
                .and_then(|v| v.as_str())
                .map(String::from);
            let remote_claude_path = params
                .get("remote_claude_path")
                .and_then(|v| v.as_str())
                .map(String::from);
            let result = crate::commands::diagnostics::test_remote_host(
                host,
                user,
                port,
                key_path,
                remote_claude_path,
            )
            .await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "check_ssh_key" => {
            let result = crate::commands::diagnostics::check_ssh_key()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "generate_ssh_key" => {
            let result = crate::commands::diagnostics::generate_ssh_key()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── Stats ──
        "get_usage_overview" => {
            let days = params
                .get("days")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
            let project_id = params
                .get("project_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let tz = params.get("tz").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::stats::get_usage_overview(days, project_id, tz).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_global_usage_overview" => {
            let days = params
                .get("days")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
            let result = crate::commands::stats::get_global_usage_overview(days)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "clear_usage_cache" => {
            crate::commands::stats::clear_usage_cache()?;
            Ok(json!(true))
        }
        "get_heatmap_daily" => {
            let scope = extract_str(&params, "scope")?;
            let result = crate::commands::stats::get_heatmap_daily(scope).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_changelog" => {
            let result = crate::commands::stats::get_changelog().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "read_app_readme" => {
            let locale = params
                .get("locale")
                .and_then(|v| v.as_str())
                .map(String::from);
            let result =
                crate::commands::app_readme::read_app_readme_impl(locale.as_deref(), None)?;
            Ok(json!(result))
        }

        // ── Onboarding ──
        "check_auth_status" => {
            let result = crate::commands::onboarding::check_auth_status().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "detect_install_methods" => {
            let result = crate::commands::onboarding::detect_install_methods().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_auth_overview" => {
            let result = crate::commands::onboarding::get_auth_overview().await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "set_cli_api_key" => {
            let key = extract_str(&params, "key")?;
            crate::commands::onboarding::set_cli_api_key(key).await?;
            Ok(json!(true))
        }
        "remove_cli_api_key" => {
            crate::commands::onboarding::remove_cli_api_key().await?;
            Ok(json!(true))
        }

        // ── Agents ──
        "list_agents" => {
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::agents::list_agents(cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "read_agent_file" => {
            let scope = extract_str(&params, "scope")?;
            let file_name = extract_str(&params, "file_name")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            let result = crate::commands::agents::read_agent_file(scope, file_name, cwd)?;
            Ok(json!(result))
        }
        "create_agent_file" => {
            let scope = extract_str(&params, "scope")?;
            let file_name = extract_str(&params, "file_name")?;
            let content = extract_str(&params, "content")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            crate::commands::agents::create_agent_file(scope, file_name, content, cwd)?;
            Ok(json!(true))
        }
        "update_agent_file" => {
            let scope = extract_str(&params, "scope")?;
            let file_name = extract_str(&params, "file_name")?;
            let content = extract_str(&params, "content")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            crate::commands::agents::update_agent_file(scope, file_name, content, cwd)?;
            Ok(json!(true))
        }
        "delete_agent_file" => {
            let scope = extract_str(&params, "scope")?;
            let file_name = extract_str(&params, "file_name")?;
            let cwd = params.get("cwd").and_then(|v| v.as_str()).map(String::from);
            crate::commands::agents::delete_agent_file(scope, file_name, cwd)?;
            Ok(json!(true))
        }

        // ── CLI Sync ──
        "discover_cli_sessions" => {
            let cwd = extract_str(&params, "cwd")?;
            let result = crate::commands::cli_sync::discover_cli_sessions(cwd).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        // ── Clipboard (partial browser support) ──
        "read_clipboard_file" => {
            let path = extract_str(&params, "path")?;
            let as_text = params
                .get("as_text")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let result = crate::commands::clipboard::read_clipboard_file(path, as_text)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "save_temp_attachment" => {
            let name = extract_str(&params, "name")?;
            let content_base64 = extract_str(&params, "content_base64")?;
            let path = crate::commands::clipboard::save_temp_attachment(name, content_base64)?;
            Ok(json!(path))
        }

        // ── Web Server Status ──
        "get_web_server_status" => {
            let port = state
                .effective_port
                .load(std::sync::atomic::Ordering::Relaxed);
            Ok(crate::web_server::build_status(
                port,
                state.bind_addr.as_str(),
                &None,
            ))
        }

        // ── Session management ──
        "start_session" => {
            let run_id = extract_str(&params, "run_id")?;
            let mode: Option<SessionMode> = params
                .get("mode")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let session_id = params
                .get("session_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let initial_message = params
                .get("initial_message")
                .and_then(|v| v.as_str())
                .map(String::from);
            let attachments: Option<Vec<AttachmentData>> = params
                .get("attachments")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let platform_id = params
                .get("platform_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let permission_mode_override = params
                .get("permission_mode_override")
                .and_then(|v| v.as_str())
                .map(String::from);
            let client_message_id: Option<String> = params
                .get("client_message_id")
                .and_then(|v| v.as_str().map(|s| s.to_string()));
            crate::commands::session::start_session_impl(
                &state.emitter,
                &state.sessions,
                &state.spawn_locks,
                &state.cancel_token,
                &state.recovery_registry,
                &state.governor,
                run_id,
                mode,
                session_id,
                initial_message,
                attachments,
                platform_id,
                permission_mode_override,
                client_message_id,
            )
            .await?;
            Ok(json!(true))
        }
        "send_session_message" => {
            let run_id = extract_str(&params, "run_id")?;
            let message = extract_str(&params, "message")?;
            let attachments: Vec<AttachmentData> = params
                .get("attachments")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let client_message_id: Option<String> = params
                .get("client_message_id")
                .and_then(|v| v.as_str().map(|s| s.to_string()));
            log::debug!(
                "[dispatch] send_session_message: run_id={}, msg_len={}, attachments={}, client_message_id={:?}",
                run_id,
                message.len(),
                attachments.len(),
                client_message_id,
            );
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::SendMessage {
                    text: message,
                    attachments,
                    reply: reply_tx,
                    client_message_id: None,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            Ok(json!(true))
        }
        "stop_session" => {
            let run_id = extract_str(&params, "run_id")?;
            crate::commands::session::stop_session_impl(
                &state.emitter,
                &state.sessions,
                &state.spawn_locks,
                &state.governor,
                run_id,
            )
            .await?;
            Ok(json!(true))
        }
        "send_session_control" => {
            let run_id = extract_str(&params, "run_id")?;
            let subtype = extract_str(&params, "subtype")?;
            let ctrl_params = params.get("params").cloned();
            log::debug!(
                "[dispatch] send_session_control: run_id={}, subtype={}",
                run_id,
                subtype
            );
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let mut request = json!({ "subtype": subtype });
            if let Some(p) = ctrl_params {
                if let Some(obj) = p.as_object() {
                    for (k, v) in obj {
                        request[k] = v.clone();
                    }
                }
            }
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::SendControl {
                    request,
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            let (request_id, response_rx) = reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            match tokio::time::timeout(std::time::Duration::from_secs(10), response_rx).await {
                Ok(Ok(response)) => {
                    log::debug!(
                        "[dispatch] control response received for req_id={}",
                        request_id
                    );
                    Ok(response)
                }
                Ok(Err(_)) => Err("Control response channel closed".to_string()),
                Err(_) => Err("Timeout waiting for control response".to_string()),
            }
        }
        "fork_session" => {
            let run_id = extract_str(&params, "run_id")?;
            let new_id = crate::commands::session::fork_session_impl(
                &state.emitter,
                &state.sessions,
                &state.spawn_locks,
                run_id,
            )
            .await?;
            Ok(json!(new_id))
        }
        "approve_session_tool" => {
            let run_id = extract_str(&params, "run_id")?;
            let tool_name = extract_str(&params, "tool_name")?;
            crate::commands::session::approve_session_tool_impl(
                &state.emitter,
                &state.sessions,
                &state.spawn_locks,
                &state.cancel_token,
                run_id,
                tool_name,
            )
            .await?;
            Ok(json!(true))
        }
        "respond_permission" => {
            let run_id = extract_str(&params, "run_id")?;
            let request_id = extract_str(&params, "request_id")?;
            let behavior = extract_str(&params, "behavior")?;
            let updated_permissions: Option<Vec<Value>> = params
                .get("updated_permissions")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let updated_input = params.get("updated_input").cloned();
            let deny_message = params
                .get("deny_message")
                .and_then(|v| v.as_str())
                .map(String::from);
            let interrupt = params.get("interrupt").and_then(|v| v.as_bool());
            let tool_name = params
                .get("tool_name")
                .and_then(|v| v.as_str())
                .map(String::from);
            log::debug!(
                "[dispatch] respond_permission: run_id={}, req_id={}, behavior={}",
                run_id,
                request_id,
                behavior
            );
            // ── Behavior parity with Tauri command ──
            if behavior != "allow" && behavior != "deny" {
                return Err(format!(
                    r#"{{"code":"unknown","message":"invalid behavior: {behavior}","retryable":false}}"#
                ));
            }
            // ── Permanent allow parity with Tauri command ──
            if let (Some(perms), Some(tool)) = (updated_permissions.as_ref(), tool_name.as_ref()) {
                let attempts_permanent = perms.iter().any(|p| {
                    p.get("type").and_then(|v| v.as_str()) == Some("addRules")
                        || p.get("destination").and_then(|v| v.as_str()) == Some("userSettings")
                });
                if attempts_permanent
                    && crate::agent::permission_error::is_permanent_allow_blocked(tool)
                {
                    log::warn!(
                        "[dispatch] respond_permission: permanent allow blocked for tool={}",
                        tool
                    );
                    return Err(crate::agent::permission_error::PermissionError::new(
                        crate::agent::permission_error::PermissionErrorCode::DangerToolBlocked,
                        format!("Permanent allow refused for {tool}"),
                        false,
                    )
                    .to_string());
                }
            }
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let mut response = if behavior == "allow" {
                let input_val = updated_input.unwrap_or_else(|| json!({}));
                json!({
                    "behavior": "allow",
                    "updatedInput": input_val,
                })
            } else {
                let msg = deny_message.unwrap_or_else(|| "User denied permission".to_string());
                let mut deny_obj = json!({
                    "behavior": "deny",
                    "message": msg,
                });
                if interrupt == Some(true) {
                    deny_obj["interrupt"] = json!(true);
                }
                deny_obj
            };
            if let Some(perms) = updated_permissions {
                if behavior == "allow" && !perms.is_empty() {
                    response["updatedPermissions"] = Value::Array(perms);
                }
            }
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::RespondPermission {
                    request_id,
                    response,
                    tool_name: tool_name.clone(),
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            let outcome = reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())?;
            outcome?;
            Ok(json!(true))
        }
        "respond_hook_callback" => {
            let run_id = extract_str(&params, "run_id")?;
            let request_id = extract_str(&params, "request_id")?;
            let decision = extract_str(&params, "decision")?;
            let updated_input = params.get("updated_input").cloned();
            log::debug!(
                "[dispatch] respond_hook_callback: run_id={}, req_id={}, decision={}, has_updated_input={}",
                run_id,
                request_id,
                decision,
                updated_input.is_some(),
            );
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let mut response = json!({ "decision": decision });
            if decision == "allow" {
                if let Some(input) = updated_input {
                    response["updatedInput"] = input;
                }
            }
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::RespondHookCallback {
                    request_id,
                    response,
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            Ok(json!(true))
        }
        "cancel_control_request" => {
            let run_id = extract_str(&params, "run_id")?;
            let request_id = extract_str(&params, "request_id")?;
            log::debug!(
                "[dispatch] cancel_control_request: run_id={}, req_id={}",
                run_id,
                request_id
            );
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::CancelControlRequest {
                    request_id,
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            Ok(json!(true))
        }

        "respond_elicitation" => {
            let run_id = extract_str(&params, "run_id")?;
            let request_id = extract_str(&params, "request_id")?;
            let action = extract_str(&params, "action")?;
            let content = params.get("content").cloned();
            log::debug!(
                "[dispatch] respond_elicitation: run_id={}, req_id={}, action={}",
                run_id,
                request_id,
                action
            );
            if !matches!(action.as_str(), "accept" | "decline" | "cancel") {
                return Err(format!("Invalid elicitation action: {}", action));
            }
            let response = match action.as_str() {
                "accept" => {
                    let c = content.unwrap_or(json!({}));
                    if !c.is_object() {
                        return Err("content must be a JSON object for accept".into());
                    }
                    json!({"action": "accept", "content": c})
                }
                other => json!({"action": other}),
            };
            let cmd_tx = {
                let map = state.sessions.lock().await;
                map.get(&run_id)
                    .map(|h| h.cmd_tx.clone())
                    .ok_or_else(|| format!("Session {} not found", run_id))?
            };
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            cmd_tx
                .send(ActorCommand::RespondElicitation {
                    request_id,
                    response,
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Actor dead".to_string())?;
            reply_rx
                .await
                .map_err(|_| "Actor dropped reply".to_string())??;
            Ok(json!(true))
        }

        // ── CLI Info ──
        "get_cli_info" => {
            let force = params
                .get("force_refresh")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let agent = params.get("agent").and_then(|v| v.as_str());
            let runtime_kind = agent
                .map(crate::models::AgentRuntimeKind::from_agent)
                .unwrap_or_default();
            match crate::agent::control::get_cli_info(&state.cli_info_cache, agent, force).await {
                Ok(info) => serde_json::to_value(info).map_err(|e| e.to_string()),
                Err(e) => {
                    log::warn!(
                        "[dispatch] CLI info failed ({}): {}, using fallback",
                        e.code,
                        e.message
                    );
                    serde_json::to_value(crate::agent::control::fallback_cli_info_for(
                        &runtime_kind,
                    ))
                    .map_err(|e| e.to_string())
                }
            }
        }

        // ── CLI Sync (additional) ──
        "sync_cli_session" => {
            let run_id = extract_str(&params, "run_id")?;
            let writer = state.writer.clone();
            let result = tokio::task::spawn_blocking(move || {
                crate::storage::cli_sessions::sync_session(&run_id, writer)
            })
            .await
            .map_err(|e| format!("spawn_blocking: {}", e))?;
            let sync_result = result?;
            serde_json::to_value(sync_result).map_err(|e| e.to_string())
        }
        "import_cli_session" => {
            let session_id = extract_str(&params, "session_id")?;
            let cwd = extract_str(&params, "cwd")?;
            let writer = state.writer.clone();
            let result = tokio::task::spawn_blocking(move || {
                crate::storage::cli_sessions::import_session(&session_id, &cwd, writer)
            })
            .await
            .map_err(|e| format!("spawn_blocking: {}", e))?;
            let import_result = result?;
            serde_json::to_value(import_result).map_err(|e| e.to_string())
        }

        // ── Desktop-only commands ──
        // Runtime configuration operates on the desktop host's local CLI files.
        "runtime_hub_list" => Err("desktop only".to_string()),
        "runtime_hub_health" => Err("desktop only".to_string()),
        "runtime_hub_diagnose" => Err("desktop only".to_string()),
        "runtime_hub_set_default" => Err("desktop only".to_string()),
        "runtime_hub_preview_config" => Err("desktop only".to_string()),
        "runtime_hub_apply_config" => Err("desktop only".to_string()),
        "runtime_hub_start_config_watch" => Err("desktop only".to_string()),
        "runtime_hub_stop_config_watch" => Err("desktop only".to_string()),
        // Diagnostics export and retention are intentionally local to the desktop host.
        "diagnostics_snapshot" => Err("desktop only".to_string()),
        "diagnostics_summary" => Err("desktop only".to_string()),
        "diagnostics_preview" => Err("desktop only".to_string()),
        "diagnostics_export" => Err("desktop only".to_string()),
        "diagnostics_export_bundle" => Err("desktop only".to_string()),
        "diagnostics_clear" => Err("desktop only".to_string()),
        // v1.1.0 / 110-A9 Browser Verification Lite — placeholder. Desktop
        // has the real (currently placeholder) implementation; web falls
        // through to "desktop only" so remote clients don't silently
        // launch browser sessions on the server.
        "browser_navigate" => Err("desktop only".to_string()),
        "browser_screenshot" => Err("desktop only".to_string()),
        "browser_get_dom" => Err("desktop only".to_string()),
        "capture_screenshot"
        | "update_screenshot_hotkey"
        | "get_clipboard_files"
        | "run_claude_login"
        | "check_for_updates"
        | "send_chat_message" => Err("desktop only".to_string()),

        // ── IPC-only (not exposed over WS) ──
        "get_web_server_token" => Err("desktop only".to_string()),

        _ => Err(format!("unknown method: {}", method)),
    };

    let elapsed = start.elapsed();
    if elapsed.as_millis() > 100 {
        log::debug!(
            "[dispatch] method={} took {}ms",
            method,
            elapsed.as_millis()
        );
    }

    result
}

// ── Parameter extraction helpers ──

fn extract_str(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| format!("missing required param: {}", key))
}

fn extract_u64(params: &Value, key: &str) -> Result<u64, String> {
    params
        .get(key)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("missing required param: {}", key))
}

/// Normalize top-level camelCase keys to snake_case.
/// Does NOT recurse into nested objects (preserving CLI protocol payloads).
fn normalize_top_level_keys(params: Value) -> Value {
    match params {
        Value::Object(map) => {
            let normalized: serde_json::Map<String, Value> = map
                .into_iter()
                .map(|(k, v)| (camel_to_snake(&k), v))
                .collect();
            Value::Object(normalized)
        }
        other => other,
    }
}

// ── Inline _impl functions for State-dependent commands ──

/// stop_run logic extracted from commands::runs::stop_run
async fn stop_run_impl(id: String, state: &AppState) -> Result<bool, String> {
    use crate::agent::session_actor::ActorCommand;
    use crate::models::RunStatus;

    log::debug!("[dispatch] stop_run_impl: id={}", id);

    // Try actor session first
    let actor_stopped = {
        let handle = {
            let mut map = state.sessions.lock().await;
            map.remove(&id)
        };
        if let Some(handle) = handle {
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            if handle
                .cmd_tx
                .send(ActorCommand::Stop { reply: reply_tx })
                .await
                .is_ok()
            {
                let _ = reply_rx.await;
            }
            let _ =
                tokio::time::timeout(std::time::Duration::from_secs(5), handle.join_handle).await;
            true
        } else {
            false
        }
    };

    if actor_stopped {
        if let Err(e) = crate::storage::runs::update_status(
            &id,
            RunStatus::Stopped,
            None,
            Some("Stopped by user".to_string()),
        ) {
            log::warn!("[dispatch] stop_run: failed to update status: {}", e);
        }
        return Ok(true);
    }

    // Fall through to pipe mode (Codex)
    crate::agent::stream::stop_process(&state.process_map, &id).await;
    if let Err(e) = crate::storage::runs::update_status(
        &id,
        RunStatus::Stopped,
        None,
        Some("Stopped by user".to_string()),
    ) {
        log::warn!("[dispatch] stop_run: failed to update status: {}", e);
    }
    Ok(true)
}

/// Convert a camelCase string to snake_case
fn camel_to_snake(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + 4);
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('_');
            }
            result.push(c.to_ascii_lowercase());
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
