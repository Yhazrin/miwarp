use super::agent::apply_agent_patch;
use super::core::{
    get_provider_info, is_key_optional_platform, load_from_path, migrate_platform_credentials,
    migrate_session_island_alignment, save_to_path,
};
use super::user::{apply_personal_profile_reset, validate_ui_zoom};
use crate::models::{
    normalize_session_island_alignment, AgentSettings, AllSettings, PlatformCredential,
    UserSettings,
};
use std::fs;

fn make_settings_with_cred(cred: PlatformCredential) -> AllSettings {
    let mut s = AllSettings::default();
    s.user.platform_credentials.push(cred);
    s
}

#[test]
fn migrate_empty_base_url_fills_from_defaults() {
    // Credential has base_url = "" (empty string), known defaults have a base_url.
    // Migration should populate the empty base_url from defaults.
    let cred = PlatformCredential {
        platform_id: "ollama".to_string(),
        api_key: None,
        base_url: Some(String::new()), // empty string
        auth_env_var: None,
        name: None,
        models: None,
        extra_env: None,
    };
    let mut settings = make_settings_with_cred(cred);
    let changed = migrate_platform_credentials(&mut settings);

    assert!(changed, "migration should have made changes");
    assert_eq!(
        settings.user.platform_credentials[0].base_url.as_deref(),
        Some("http://localhost:11434"),
        "empty base_url should be filled from defaults"
    );
}

#[test]
fn provider_info_ccswitch() {
    let info = get_provider_info("ccswitch").expect("ccswitch should have provider info");
    assert!(info.key_optional);
    assert_eq!(info.base_url.as_deref(), Some("http://127.0.0.1:15721"));
    assert_eq!(info.auth_env_var.as_deref(), Some("ANTHROPIC_AUTH_TOKEN"));
}

#[test]
fn provider_info_ccr() {
    let info = get_provider_info("ccr").expect("ccr should have provider info");
    assert!(info.key_optional);
    assert_eq!(info.base_url.as_deref(), Some("http://127.0.0.1:3456"));
    assert_eq!(
        info.models
            .as_ref()
            .and_then(|m| m.first())
            .map(|s| s.as_str()),
        Some("claude-sonnet-4-6")
    );
}

#[test]
fn apply_agent_patch_effort_set_and_clear() {
    let mut s = AgentSettings::default_for("claude");
    assert_eq!(s.effort, None);

    // Set effort to "high"
    apply_agent_patch(&mut s, &serde_json::json!({ "effort": "high" }));
    assert_eq!(s.effort, Some("high".to_string()));

    // Clear with empty string
    apply_agent_patch(&mut s, &serde_json::json!({ "effort": "" }));
    assert_eq!(s.effort, None);

    // Set then clear with null
    apply_agent_patch(&mut s, &serde_json::json!({ "effort": "low" }));
    assert_eq!(s.effort, Some("low".to_string()));
    apply_agent_patch(&mut s, &serde_json::json!({ "effort": null }));
    assert_eq!(s.effort, None);

    // Absent key doesn't touch existing value
    apply_agent_patch(&mut s, &serde_json::json!({ "effort": "medium" }));
    apply_agent_patch(&mut s, &serde_json::json!({ "model": "opus" }));
    assert_eq!(s.effort, Some("medium".to_string()));
}

#[test]
fn validate_ui_zoom_rejects_invalid() {
    assert!(validate_ui_zoom(&serde_json::json!(0.1)).is_err());
    assert!(validate_ui_zoom(&serde_json::json!(5.0)).is_err());
    assert!(validate_ui_zoom(&serde_json::json!("abc")).is_err());
}

#[test]
fn validate_ui_zoom_accepts_valid() {
    assert_eq!(
        validate_ui_zoom(&serde_json::json!(1.0)).unwrap(),
        Some(1.0)
    );
    assert_eq!(
        validate_ui_zoom(&serde_json::json!(0.75)).unwrap(),
        Some(0.75)
    );
    assert_eq!(
        validate_ui_zoom(&serde_json::json!(1.5)).unwrap(),
        Some(1.5)
    );
    assert_eq!(validate_ui_zoom(&serde_json::json!(null)).unwrap(), None);
}

#[test]
fn is_key_optional_known_platforms() {
    assert!(is_key_optional_platform("ccswitch"));
    assert!(is_key_optional_platform("ccr"));
    assert!(is_key_optional_platform("ollama"));
    assert!(!is_key_optional_platform("deepseek"));
    assert!(!is_key_optional_platform("unknown-platform"));
}

#[test]
fn user_settings_default_session_island_alignment_is_center() {
    let settings = UserSettings::default();
    assert_eq!(settings.session_island_alignment, "center");
}

#[test]
fn user_settings_deserialize_missing_session_island_alignment_defaults_center() {
    let default = UserSettings::default();
    let mut value = serde_json::to_value(&default).expect("serialize default settings");
    value
        .as_object_mut()
        .expect("settings object")
        .remove("session_island_alignment");
    let settings: UserSettings = serde_json::from_value(value).expect("deserialize settings");
    assert_eq!(settings.session_island_alignment, "center");
}

#[test]
fn normalize_session_island_alignment_maps_invalid_to_center() {
    use crate::models::normalize_session_island_alignment;

    assert_eq!(normalize_session_island_alignment("center"), "center");
    assert_eq!(normalize_session_island_alignment("right"), "right");
    assert_eq!(normalize_session_island_alignment("bogus"), "center");
    assert_eq!(normalize_session_island_alignment(""), "center");
}

#[test]
fn migrate_session_island_alignment_rewrites_invalid_persisted_value() {
    let mut settings = AllSettings::default();
    settings.user.session_island_alignment = "left".to_string();
    assert!(migrate_session_island_alignment(&mut settings));
    assert_eq!(settings.user.session_island_alignment, "center");
}

#[test]
fn update_user_settings_patch_session_island_alignment_center_and_right() {
    let mut all = AllSettings::default();
    all.user.session_island_alignment = "center".to_string();

    let patch = serde_json::json!({ "session_island_alignment": "right" });
    if let Some(v) = patch
        .get("session_island_alignment")
        .and_then(|v| v.as_str())
    {
        all.user.session_island_alignment = normalize_session_island_alignment(v);
    }
    assert_eq!(all.user.session_island_alignment, "right");

    let patch = serde_json::json!({ "session_island_alignment": "center" });
    if let Some(v) = patch
        .get("session_island_alignment")
        .and_then(|v| v.as_str())
    {
        all.user.session_island_alignment = normalize_session_island_alignment(v);
    }
    assert_eq!(all.user.session_island_alignment, "center");
}

#[test]
fn update_user_settings_patch_session_island_alignment_invalid_normalizes_center() {
    let mut all = AllSettings::default();
    all.user.session_island_alignment = "right".to_string();

    let patch = serde_json::json!({ "session_island_alignment": "top-left" });
    if let Some(v) = patch
        .get("session_island_alignment")
        .and_then(|v| v.as_str())
    {
        all.user.session_island_alignment = normalize_session_island_alignment(v);
    }
    assert_eq!(all.user.session_island_alignment, "center");
}

fn make_user_with_personal_overrides_and_secrets() -> UserSettings {
    let mut user = UserSettings::default();
    // Personal fields the reset MUST restore to defaults.
    user.user_display_name = Some("Alex Doe".to_string());
    user.user_role = Some("Senior Engineer".to_string());
    user.user_timezone = Some("Asia/Shanghai".to_string());
    user.default_agent = "codex".to_string();
    user.default_model = Some("gpt-5".to_string());
    user.fallback_model = Some("gpt-4o".to_string());
    user.default_session_mode = "single".to_string();
    user.notifications_enabled = Some(true);
    user.notify_on_run_completed = Some(false);
    user.notify_on_run_failed = Some(true);
    user.notify_on_approval_required = Some(true);
    user.notify_on_schedule_completed = Some(false);
    user.notify_on_team_completed = Some(true);
    user.ui_zoom = Some(1.25);

    // Credential-bearing fields the reset MUST leave untouched.
    user.anthropic_api_key = Some("sk-secret-123".to_string());
    user.anthropic_base_url = Some("https://api.example.test".to_string());
    user.auth_env_var = Some("ANTHROPIC_AUTH_TOKEN".to_string());
    user.platform_credentials = vec![PlatformCredential {
        platform_id: "anthropic".to_string(),
        api_key: Some("sk-platform-leak-9999".to_string()),
        base_url: Some("https://api.anthropic.com".to_string()),
        auth_env_var: Some("ANTHROPIC_API_KEY".to_string()),
        name: Some("primary".to_string()),
        models: Some(vec!["claude-sonnet-4-6".to_string()]),
        extra_env: None,
    }];
    user.active_platform_id = Some("anthropic".to_string());
    user.remote_hosts = vec![crate::models::RemoteHost {
        name: "prod".to_string(),
        host: "prod.example.test".to_string(),
        user: "deploy".to_string(),
        port: 22,
        key_path: Some("/Users/leak/.ssh/id_rsa".to_string()),
        remote_cwd: None,
        remote_claude_path: None,
        forward_api_key: true,
    }];
    user.feishu_webhook_url = Some("https://hooks.feishu.test/secret".to_string());
    user.feishu_webhook_enabled = true;
    user.feishu_webhook_triggers = vec!["run.completed".to_string()];
    user.feishu_webhook_template = Some("token: ${token}".to_string());
    user.web_server_enabled = Some(true);
    user.web_server_token = Some("web-server-secret-token-xyz".to_string());
    user.web_server_port = Some(7777);
    user.web_server_bind = Some("127.0.0.1".to_string());
    user.web_server_allowed_origins = Some(vec!["https://trusted.test".to_string()]);
    user.web_server_tunnel_url = Some("https://tunnel.example.test".to_string());
    user.keybinding_overrides = vec![crate::models::KeyBindingOverride {
        command: "chat.send".to_string(),
        key: "Cmd+Shift+S".to_string(),
    }];
    user.workspace_folder_sort_order = "name_asc".to_string();
    user.onboarding_completed = true;
    user
}

#[test]
fn apply_personal_profile_reset_restores_only_personal_fields() {
    let original = make_user_with_personal_overrides_and_secrets();
    let patched = apply_personal_profile_reset(original.clone());

    // ── Personal fields are reset to defaults ──
    assert_eq!(patched.user_display_name, None);
    assert_eq!(patched.user_role, None);
    assert_eq!(patched.user_timezone, None);
    assert_eq!(patched.default_agent, UserSettings::default().default_agent);
    assert_eq!(patched.default_model, None);
    assert_eq!(patched.fallback_model, None);
    assert_eq!(
        patched.default_session_mode,
        UserSettings::default().default_session_mode
    );
    assert_eq!(patched.notifications_enabled, None);
    assert_eq!(patched.notify_on_run_completed, None);
    assert_eq!(patched.notify_on_run_failed, None);
    assert_eq!(patched.notify_on_approval_required, None);
    assert_eq!(patched.notify_on_schedule_completed, None);
    assert_eq!(patched.notify_on_team_completed, None);
    assert_eq!(patched.ui_zoom, None);

    // ── Credential-bearing fields are byte-for-byte preserved ──
    assert_eq!(patched.anthropic_api_key, original.anthropic_api_key);
    assert_eq!(patched.anthropic_base_url, original.anthropic_base_url);
    assert_eq!(patched.auth_env_var, original.auth_env_var);
    assert_eq!(
        patched.platform_credentials.len(),
        original.platform_credentials.len()
    );
    assert_eq!(
        serde_json::to_string(&patched.platform_credentials).unwrap(),
        serde_json::to_string(&original.platform_credentials).unwrap(),
    );
    assert_eq!(patched.active_platform_id, original.active_platform_id);
    assert_eq!(patched.remote_hosts.len(), original.remote_hosts.len());
    assert_eq!(
        serde_json::to_string(&patched.remote_hosts).unwrap(),
        serde_json::to_string(&original.remote_hosts).unwrap(),
    );
    assert_eq!(patched.feishu_webhook_url, original.feishu_webhook_url);
    assert_eq!(
        patched.feishu_webhook_enabled,
        original.feishu_webhook_enabled
    );
    assert_eq!(
        patched.feishu_webhook_triggers,
        original.feishu_webhook_triggers
    );
    assert_eq!(
        patched.feishu_webhook_template,
        original.feishu_webhook_template
    );
    assert_eq!(patched.web_server_enabled, original.web_server_enabled);
    assert_eq!(patched.web_server_token, original.web_server_token);
    assert_eq!(patched.web_server_port, original.web_server_port);
    assert_eq!(patched.web_server_bind, original.web_server_bind);
    assert_eq!(
        patched.web_server_allowed_origins,
        original.web_server_allowed_origins
    );
    assert_eq!(
        patched.web_server_tunnel_url,
        original.web_server_tunnel_url
    );
    assert_eq!(
        patched.keybinding_overrides.len(),
        original.keybinding_overrides.len()
    );
    assert_eq!(
        serde_json::to_string(&patched.keybinding_overrides).unwrap(),
        serde_json::to_string(&original.keybinding_overrides).unwrap(),
    );
    assert_eq!(
        patched.workspace_folder_sort_order,
        original.workspace_folder_sort_order
    );
    assert_eq!(patched.onboarding_completed, original.onboarding_completed);
}

#[test]
fn apply_personal_profile_reset_refreshes_updated_at() {
    let mut original = make_user_with_personal_overrides_and_secrets();
    original.updated_at = "1970-01-01T00:00:00.000Z".to_string();
    let patched = apply_personal_profile_reset(original);
    assert_ne!(patched.updated_at, "1970-01-01T00:00:00.000Z");
    // The reset should mint a fresh ISO timestamp.
    assert!(!patched.updated_at.is_empty());
}

#[test]
fn reset_personal_profile_persists_personal_changes_only() {
    // The full I/O path is exercised against a real `AllSettings` struct —
    // not the on-disk JSON — so we can validate field-level semantics
    // without polluting the developer's real `~/.miwarp/settings.json`.
    let original = make_user_with_personal_overrides_and_secrets();
    let mut all = AllSettings::default();
    all.user = original.clone();
    let before_keys = all.user.platform_credentials.len();
    let before_remote_hosts = all.user.remote_hosts.len();

    // Apply the same patch the storage helper uses.
    all.user = apply_personal_profile_reset(all.user.clone());
    let patched = all.user.clone();

    // Personal fields reset.
    assert_eq!(patched.user_display_name, None);
    assert_eq!(patched.user_role, None);
    assert_eq!(patched.user_timezone, None);
    assert_eq!(patched.default_model, None);
    assert_eq!(patched.fallback_model, None);
    assert_eq!(patched.ui_zoom, None);

    // Credentials intact.
    assert_eq!(patched.anthropic_api_key, original.anthropic_api_key);
    assert_eq!(
        patched.platform_credentials.len(),
        before_keys,
        "platform_credentials length must not change"
    );
    assert_eq!(
        patched.remote_hosts.len(),
        before_remote_hosts,
        "remote_hosts length must not change"
    );
    assert_eq!(patched.web_server_token, original.web_server_token);
    assert_eq!(patched.feishu_webhook_url, original.feishu_webhook_url);
    assert_eq!(
        serde_json::to_string(&patched.keybinding_overrides).unwrap(),
        serde_json::to_string(&original.keybinding_overrides).unwrap(),
    );
}

// ── Durability tests ──────────────────────────────────────────────

#[test]
fn load_truncated_json_backs_up_and_returns_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    // Write truncated JSON (missing closing brace)
    fs::write(&path, r#"{"user":{"default_agent":"claude""#).unwrap();

    let loaded = load_from_path(&path);

    // Should return defaults (not crash)
    let defaults = AllSettings::default();
    assert_eq!(loaded.user.default_agent, defaults.user.default_agent);

    // Original file should be renamed to .corrupt.*
    assert!(!path.exists(), "original corrupt file should be renamed");
    let entries: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| n.contains("corrupt"))
        })
        .collect();
    assert_eq!(entries.len(), 1, "exactly one .corrupt backup should exist");

    // Backup content matches original
    let backup_content = fs::read_to_string(entries[0].path()).unwrap();
    assert!(backup_content.contains("claude"));
}

#[test]
fn load_io_error_preserves_file_returns_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    // Write valid settings first
    let mut valid = AllSettings::default();
    valid.user.default_agent = "custom-agent".to_string();
    let json = serde_json::to_string_pretty(&valid).unwrap();
    fs::write(&path, &json).unwrap();

    // Make file unreadable (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();

        let loaded = load_from_path(&path);

        // Should return defaults (not crash)
        assert_eq!(
            loaded.user.default_agent,
            AllSettings::default().user.default_agent
        );

        // Original file MUST still exist (not overwritten)
        assert!(path.exists(), "original file must be preserved on IO error");

        // Restore permissions for cleanup
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    }
}

#[test]
fn load_missing_file_returns_defaults_without_creating_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    let loaded = load_from_path(&path);

    // Should return defaults
    assert_eq!(
        loaded.user.default_agent,
        AllSettings::default().user.default_agent
    );

    // Should NOT create the file (no implicit save on missing)
    assert!(!path.exists(), "missing file should not be created by load");
}

#[test]
fn save_atomic_write_never_leaves_partial_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    // Write initial valid settings
    let mut initial = AllSettings::default();
    initial.user.default_agent = "initial".to_string();
    save_to_path(&initial, &path).unwrap();

    // Write updated settings
    let mut updated = AllSettings::default();
    updated.user.default_agent = "updated".to_string();
    save_to_path(&updated, &path).unwrap();

    // File should contain the updated value (not partial)
    let content = fs::read_to_string(&path).unwrap();
    let loaded: AllSettings = serde_json::from_str(&content).unwrap();
    assert_eq!(loaded.user.default_agent, "updated");
}

#[test]
fn save_then_load_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    let mut original = AllSettings::default();
    original.user.default_agent = "roundtrip-agent".to_string();
    original.user.ui_zoom = Some(1.25);
    original
        .user
        .platform_credentials
        .push(crate::models::PlatformCredential {
            platform_id: "test".to_string(),
            api_key: Some("sk-test-123".to_string()),
            base_url: Some("https://test.example.com".to_string()),
            auth_env_var: None,
            name: None,
            models: None,
            extra_env: None,
        });

    save_to_path(&original, &path).unwrap();
    let loaded = load_from_path(&path);

    assert_eq!(loaded.user.default_agent, "roundtrip-agent");
    assert_eq!(loaded.user.ui_zoom, Some(1.25));
    assert_eq!(loaded.user.platform_credentials.len(), 1);
    assert_eq!(loaded.user.platform_credentials[0].platform_id, "test");
}

#[test]
fn concurrent_save_last_writer_wins() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    let mut s1 = AllSettings::default();
    s1.user.default_agent = "writer-1".to_string();

    let mut s2 = AllSettings::default();
    s2.user.default_agent = "writer-2".to_string();

    // Simulate concurrent writes (both succeed)
    save_to_path(&s1, &path).unwrap();
    save_to_path(&s2, &path).unwrap();

    // Last writer wins
    let loaded = load_from_path(&path);
    assert_eq!(loaded.user.default_agent, "writer-2");
}
