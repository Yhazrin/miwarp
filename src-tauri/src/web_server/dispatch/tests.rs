mod tests {
    use super::*;

    #[test]
    fn test_camel_to_snake() {
        assert_eq!(camel_to_snake("runId"), "run_id");
        assert_eq!(camel_to_snake("sessionId"), "session_id");
        assert_eq!(camel_to_snake("sinceSeq"), "since_seq");
        assert_eq!(camel_to_snake("run_id"), "run_id"); // already snake_case
        assert_eq!(camel_to_snake("id"), "id");
    }

    #[test]
    fn test_update_cli_permissions_missing_rules_param() {
        // Simulate the dispatch param extraction for update_cli_permissions.
        // When "rules" key is absent, dispatch should produce an error.
        let params = json!({ "scope": "user", "category": "allow" });
        let result: Result<Vec<String>, String> = params
            .get("rules")
            .ok_or_else(|| "Missing required parameter: rules".to_string())
            .and_then(|v| {
                serde_json::from_value::<Vec<String>>(v.clone())
                    .map_err(|e| format!("Invalid rules: {}", e))
            });
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Missing required parameter: rules");
    }

    #[test]
    fn test_update_cli_permissions_invalid_rules_type() {
        // "rules" present but wrong type (string instead of array)
        let params = json!({ "scope": "user", "category": "allow", "rules": "not-an-array" });
        let result: Result<Vec<String>, String> = params
            .get("rules")
            .ok_or_else(|| "Missing required parameter: rules".to_string())
            .and_then(|v| {
                serde_json::from_value::<Vec<String>>(v.clone())
                    .map_err(|e| format!("Invalid rules: {}", e))
            });
        assert!(result.is_err());
        assert!(result.unwrap_err().starts_with("Invalid rules:"));
    }

    #[test]
    fn test_normalize_top_level_only() {
        let input = json!({
            "runId": "abc",
            "params": {
                "nestedCamel": "should_not_change"
            }
        });
        let output = normalize_top_level_keys(input);
        assert_eq!(output.get("run_id").unwrap(), "abc");
        // Nested keys should NOT be converted
        let nested = output.get("params").unwrap();
        assert!(nested.get("nestedCamel").is_some());
        assert!(nested.get("nested_camel").is_none());
    }

    #[test]
    fn test_search_runs_filters_deserialization() {
        let raw = serde_json::json!({
            "filters": {
                "dateFrom": "2024-01-01",
                "costMin": 0.5,
                "statuses": ["completed", "failed"],
                "sortBy": "cost"
            }
        });
        let params = normalize_top_level_keys(raw);
        let filters_val = params.get("filters").unwrap().clone();
        let filters: crate::models::RunSearchFilters = serde_json::from_value(filters_val).unwrap();
        assert_eq!(filters.date_from.unwrap(), "2024-01-01");
        assert!(filters.cost_min.unwrap() > 0.4);
        assert_eq!(
            filters.statuses.unwrap(),
            vec![
                crate::models::RunStatus::Completed,
                crate::models::RunStatus::Failed
            ]
        );
        assert_eq!(filters.sort_by.unwrap(), "cost");
    }

    #[test]
    fn test_task_set_worktree_params_normalize() {
        let params = normalize_top_level_keys(json!({
            "id": "task-1",
            "worktreePath": "/tmp/miwarp-task",
            "worktreeBranch": "feat/task-core"
        }));

        assert_eq!(extract_str(&params, "id").unwrap(), "task-1");
        assert_eq!(
            extract_str(&params, "worktree_path").unwrap(),
            "/tmp/miwarp-task"
        );
        assert_eq!(
            extract_str(&params, "worktree_branch").unwrap(),
            "feat/task-core"
        );
    }

    #[test]
    fn test_task_create_input_deserialization_preserves_nested_keys() {
        let params = normalize_top_level_keys(json!({
            "input": {
                "title": "Implement task core",
                "objective": "Create durable Task aggregate",
                "workspace_cwd": "/repo",
                "verification_commands": [
                    { "command": "npm run check", "cwd": "/repo" }
                ]
            }
        }));

        let input_val = params.get("input").unwrap().clone();
        let input: crate::task_core::TaskCreateInput =
            serde_json::from_value(input_val).expect("task create input");

        assert_eq!(input.title, "Implement task core");
        assert_eq!(input.objective, "Create durable Task aggregate");
        assert_eq!(input.workspace_cwd.as_deref(), Some("/repo"));
        assert_eq!(input.verification_commands.len(), 1);
        assert_eq!(input.verification_commands[0].command, "npm run check");
    }
}
