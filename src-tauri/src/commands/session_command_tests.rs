//! Unit tests for the session command façade.
//!
//! These were originally defined inside `commands::session.rs`. They exercise
//! the pure helpers in `session::auth_resolution` and `session::platform_routing`.
//! The names and assertions are preserved verbatim.

#[cfg(test)]
mod session_cmd_tests {
    use crate::models::PlatformCredential;
    use crate::models::UserSettings;

    fn default_user_settings() -> UserSettings {
        UserSettings {
            auth_mode: "api".to_string(),
            ..Default::default()
        }
    }

    fn make_cred(
        pid: &str,
        key: Option<&str>,
        base_url: Option<&str>,
        auth_env_var: Option<&str>,
    ) -> PlatformCredential {
        PlatformCredential {
            platform_id: pid.to_string(),
            api_key: key.map(|s| s.to_string()),
            base_url: base_url.map(|s| s.to_string()),
            auth_env_var: auth_env_var.map(|s| s.to_string()),
            name: None,
            models: None,
            extra_env: None,
        }
    }

    #[test]
    fn cli_mode_uses_key_optional_local_proxy() {
        let mut settings = default_user_settings();
        settings.auth_mode = "cli".to_string();
        settings.active_platform_id = Some("ccr".to_string());

        let pid = crate::session::platform_routing::effective_platform_id(
            &settings.auth_mode,
            None,
            None,
            settings.active_platform_id.as_deref(),
        );
        assert_eq!(pid.as_deref(), Some("ccr"));

        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            pid.as_deref(),
        );
        assert_eq!(resolved.base_url.as_deref(), Some("http://127.0.0.1:3456"));
        assert_eq!(resolved.auth_token.as_deref(), Some("PROXY_MANAGED"));
    }

    #[test]
    fn cli_mode_ignores_non_local_platform() {
        let mut settings = default_user_settings();
        settings.auth_mode = "cli".to_string();
        settings.active_platform_id = Some("deepseek".to_string());

        let pid = crate::session::platform_routing::effective_platform_id(
            &settings.auth_mode,
            None,
            None,
            settings.active_platform_id.as_deref(),
        );
        assert_eq!(pid, None);
    }

    #[test]
    fn key_optional_no_credential_uses_defaults() {
        let settings = default_user_settings();
        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            Some("ccswitch"),
        );

        assert_eq!(resolved.auth_token.as_deref(), Some("PROXY_MANAGED"));
        assert!(resolved.api_key.is_none());
        assert_eq!(resolved.base_url.as_deref(), Some("http://127.0.0.1:15721"));
    }

    #[test]
    fn key_optional_credential_empty_key_with_base_url() {
        let mut settings = default_user_settings();
        settings.platform_credentials.push(make_cred(
            "ccswitch",
            None,
            Some("http://custom:15721"),
            Some("ANTHROPIC_AUTH_TOKEN"),
        ));

        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            Some("ccswitch"),
        );

        assert_eq!(resolved.auth_token.as_deref(), Some("PROXY_MANAGED"));
        assert_eq!(resolved.base_url.as_deref(), Some("http://custom:15721"));
    }

    #[test]
    fn key_optional_credential_has_key_uses_key() {
        let mut settings = default_user_settings();
        settings.platform_credentials.push(make_cred(
            "ccswitch",
            Some("real-key-123"),
            Some("http://127.0.0.1:15721"),
            Some("ANTHROPIC_AUTH_TOKEN"),
        ));

        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            Some("ccswitch"),
        );

        assert_eq!(resolved.auth_token.as_deref(), Some("real-key-123"));
        assert!(resolved.api_key.is_none());
    }

    #[test]
    fn non_key_optional_empty_key_falls_back_global() {
        let mut settings = default_user_settings();
        settings.anthropic_api_key = Some("global-key".to_string());
        settings.platform_credentials.push(make_cred(
            "deepseek",
            None,
            Some("https://api.deepseek.com/anthropic"),
            None,
        ));

        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            Some("deepseek"),
        );

        assert_eq!(resolved.api_key.as_deref(), Some("global-key"));
        assert!(resolved.auth_token.is_none());
    }

    #[test]
    fn unknown_platform_no_credential_falls_back_global() {
        let mut settings = default_user_settings();
        settings.anthropic_api_key = Some("global-key".to_string());

        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            Some("unknown-platform-xyz"),
        );

        assert_eq!(resolved.api_key.as_deref(), Some("global-key"));
    }

    #[test]
    fn key_optional_missing_auth_env_var_uses_defaults() {
        let mut settings = default_user_settings();
        settings.platform_credentials.push(make_cred(
            "ccswitch",
            None,
            Some("http://127.0.0.1:15721"),
            None, // auth_env_var missing
        ));

        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            Some("ccswitch"),
        );

        assert_eq!(resolved.auth_token.as_deref(), Some("PROXY_MANAGED"));
        assert!(resolved.api_key.is_none());
    }

    #[test]
    fn key_optional_wrong_auth_env_var_overridden_by_defaults() {
        let mut settings = default_user_settings();
        settings.platform_credentials.push(make_cred(
            "ccswitch",
            None,
            Some("http://127.0.0.1:15721"),
            Some("ANTHROPIC_API_KEY"), // wrong — defaults should override
        ));

        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            Some("ccswitch"),
        );

        assert_eq!(resolved.auth_token.as_deref(), Some("PROXY_MANAGED"));
        assert!(resolved.api_key.is_none());
    }

    #[test]
    fn ccr_no_credential_includes_default_model() {
        let settings = default_user_settings();
        let resolved = crate::session::auth_resolution::resolve_auth_env_for_platform(
            &None,
            &settings,
            Some("ccr"),
        );

        assert_eq!(resolved.auth_token.as_deref(), Some("PROXY_MANAGED"));
        assert_eq!(resolved.base_url.as_deref(), Some("http://127.0.0.1:3456"));
        assert_eq!(
            resolved.models.as_deref(),
            Some(vec!["claude-sonnet-4-6".to_string()].as_slice())
        );
    }

    // ── is_local_url tests ──

    #[test]
    fn is_local_url_loopback_variants() {
        assert!(crate::session::process_spawn::is_local_url(
            "http://127.0.0.1:15721"
        ));
        assert!(crate::session::process_spawn::is_local_url(
            "http://127.99.1:8080"
        ));
        assert!(crate::session::process_spawn::is_local_url(
            "http://localhost:11434"
        ));
        assert!(crate::session::process_spawn::is_local_url(
            "http://[::1]:8080"
        ));
        assert!(crate::session::process_spawn::is_local_url(
            "http://0.0.0.0:3000"
        ));
    }

    #[test]
    fn is_local_url_remote_not_matched() {
        assert!(!crate::session::process_spawn::is_local_url(
            "https://api.deepseek.com"
        ));
        assert!(!crate::session::process_spawn::is_local_url(
            "https://127.example.com"
        ));
        assert!(!crate::session::process_spawn::is_local_url(
            "https://example.com/path?host=127.0.0.1"
        ));
        assert!(!crate::session::process_spawn::is_local_url("not-a-url"));
    }

    // ── preflight_check_base_url tests ──

    #[tokio::test]
    async fn preflight_none_url_skips() {
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let result = crate::session::process_spawn::preflight_check_base_url(None, None).await;
            assert!(result.is_ok());
        });
        timeout.await.expect("test timed out");
    }

    #[tokio::test]
    async fn preflight_unreachable_returns_error() {
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            // RFC 5737 TEST-NET — guaranteed non-routable
            let result = crate::session::process_spawn::preflight_check_base_url(
                Some("http://192.0.2.1:1"),
                Some("ccswitch"),
            )
            .await;
            assert!(result.is_err());
            let err = result.unwrap_err();
            assert!(err.contains("unreachable"), "error: {}", err);
            assert!(err.contains("CC Switch"), "error: {}", err);
        });
        timeout.await.expect("test timed out");
    }

    #[tokio::test]
    async fn preflight_reachable_200_is_ok() {
        use tokio::io::AsyncWriteExt;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            tokio::spawn(async move {
                if let Ok((mut stream, _)) = listener.accept().await {
                    let mut buf = [0u8; 1024];
                    let _ = tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await;
                    let resp = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]";
                    let _ = stream.write_all(resp.as_bytes()).await;
                }
            });
            let url = format!("http://127.0.0.1:{}", port);
            let result = crate::session::process_spawn::preflight_check_base_url(
                Some(&url),
                Some("ccswitch"),
            )
            .await;
            assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        });
        timeout.await.expect("test timed out");
    }

    #[tokio::test]
    async fn preflight_reachable_401_is_ok() {
        use tokio::io::AsyncWriteExt;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            tokio::spawn(async move {
                if let Ok((mut stream, _)) = listener.accept().await {
                    let mut buf = [0u8; 1024];
                    let _ = tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await;
                    let resp = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n";
                    let _ = stream.write_all(resp.as_bytes()).await;
                }
            });
            let url = format!("http://127.0.0.1:{}", port);
            let result = crate::session::process_spawn::preflight_check_base_url(
                Some(&url),
                Some("deepseek"),
            )
            .await;
            assert!(result.is_ok(), "401 should be treated as reachable");
        });
        timeout.await.expect("test timed out");
    }

    #[tokio::test]
    async fn preflight_reachable_405_is_ok() {
        use tokio::io::AsyncWriteExt;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            tokio::spawn(async move {
                if let Ok((mut stream, _)) = listener.accept().await {
                    let mut buf = [0u8; 1024];
                    let _ = tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await;
                    let resp = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n";
                    let _ = stream.write_all(resp.as_bytes()).await;
                }
            });
            let url = format!("http://127.0.0.1:{}", port);
            let result =
                crate::session::process_spawn::preflight_check_base_url(Some(&url), Some("ollama"))
                    .await;
            assert!(result.is_ok(), "405 should be treated as reachable");
        });
        timeout.await.expect("test timed out");
    }

    // ── augment_with_shell_auth tests ──

    fn empty_resolved() -> crate::session::auth_resolution::ResolvedAuth {
        crate::session::auth_resolution::ResolvedAuth {
            api_key: None,
            auth_token: None,
            base_url: None,
            models: None,
            extra_env: None,
        }
    }

    #[test]
    fn augment_remote_never_injects() {
        let r = crate::session::auth_resolution::augment_with_shell_auth(
            empty_resolved(),
            "cli",
            true,
            "/tmp",
        );
        assert!(r.api_key.is_none() && r.auth_token.is_none());
    }

    #[test]
    fn augment_api_mode_never_injects() {
        let r = crate::session::auth_resolution::augment_with_shell_auth(
            empty_resolved(),
            "api",
            false,
            "/tmp",
        );
        assert!(r.api_key.is_none() && r.auth_token.is_none());
    }

    #[test]
    fn augment_preserves_existing_key() {
        let existing = crate::session::auth_resolution::ResolvedAuth {
            api_key: Some("k".into()),
            ..empty_resolved()
        };
        let r = crate::session::auth_resolution::augment_with_shell_auth(
            existing, "cli", false, "/tmp",
        );
        assert_eq!(r.api_key.as_deref(), Some("k"));
    }

    #[test]
    fn augment_preserves_existing_token() {
        let existing = crate::session::auth_resolution::ResolvedAuth {
            auth_token: Some("t".into()),
            ..empty_resolved()
        };
        let r = crate::session::auth_resolution::augment_with_shell_auth(
            existing, "cli", false, "/tmp",
        );
        assert_eq!(r.auth_token.as_deref(), Some("t"));
    }

    // ── should_skip_env_injection tests (pure function, zero env dependency) ──

    #[test]
    fn skip_env_injection_when_key_present() {
        assert!(crate::session::auth_resolution::should_skip_env_injection(
            Some("sk-123"),
            None
        ));
    }

    #[test]
    fn skip_env_injection_when_token_present() {
        assert!(crate::session::auth_resolution::should_skip_env_injection(
            None,
            Some("oauth-token")
        ));
    }

    #[test]
    fn skip_env_injection_when_both_present() {
        assert!(crate::session::auth_resolution::should_skip_env_injection(
            Some("sk-123"),
            Some("oauth-token")
        ));
    }

    #[test]
    fn no_skip_when_both_none() {
        assert!(!crate::session::auth_resolution::should_skip_env_injection(
            None, None
        ));
    }

    #[test]
    fn no_skip_when_whitespace_only() {
        assert!(!crate::session::auth_resolution::should_skip_env_injection(
            Some("  "),
            Some("")
        ));
    }

    // ── config_value_has_auth_key tests (pure function, zero filesystem dependency) ──

    #[test]
    fn config_value_detects_api_key() {
        let config = serde_json::json!({"apiKey": "sk-ant-123"});
        assert!(crate::session::auth_resolution::config_value_has_auth_key(
            &config
        ));
    }

    #[test]
    fn config_value_detects_primary_api_key() {
        let config = serde_json::json!({"primaryApiKey": "pk-team-456"});
        assert!(crate::session::auth_resolution::config_value_has_auth_key(
            &config
        ));
    }

    #[test]
    fn config_value_empty_config_returns_false() {
        let config = serde_json::json!({});
        assert!(!crate::session::auth_resolution::config_value_has_auth_key(
            &config
        ));
    }

    #[test]
    fn config_value_whitespace_only_key_returns_false() {
        let config = serde_json::json!({"apiKey": "  ", "primaryApiKey": ""});
        assert!(!crate::session::auth_resolution::config_value_has_auth_key(
            &config
        ));
    }

    // ── Integration: project config loading + auth key detection ──

    #[test]
    fn project_config_with_api_key_detected() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(claude_dir.join("settings.json"), r#"{"apiKey":"proj-key"}"#).unwrap();

        let config =
            crate::storage::cli_config::load_project_cli_config(tmp.path().to_str().unwrap());
        assert!(crate::session::auth_resolution::config_value_has_auth_key(
            &config
        ));
    }

    #[test]
    fn project_config_without_api_key_not_detected() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(claude_dir.join("settings.json"), r#"{"model":"sonnet"}"#).unwrap();

        let config =
            crate::storage::cli_config::load_project_cli_config(tmp.path().to_str().unwrap());
        assert!(!crate::session::auth_resolution::config_value_has_auth_key(
            &config
        ));
    }

    #[test]
    fn project_config_missing_dir_not_detected() {
        let tmp = tempfile::tempdir().unwrap();
        // No .claude/ dir at all
        let config =
            crate::storage::cli_config::load_project_cli_config(tmp.path().to_str().unwrap());
        assert!(!crate::session::auth_resolution::config_value_has_auth_key(
            &config
        ));
    }

    // ── resolve_model_tiers tests ──

    fn tier_env(result: &[(&str, String)], key: &str) -> String {
        result
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    }

    #[test]
    fn model_tiers_empty_returns_nothing() {
        let r = crate::session::platform_routing::resolve_model_tiers(&[]);
        assert!(r.is_empty());
    }

    #[test]
    fn model_tiers_single_all_same() {
        let r = crate::session::platform_routing::resolve_model_tiers(&["m".into()]);
        assert_eq!(tier_env(&r, "ANTHROPIC_MODEL"), "m");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_OPUS_MODEL"), "m");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_HAIKU_MODEL"), "m");
    }

    #[test]
    fn model_tiers_two_main_and_haiku() {
        let r =
            crate::session::platform_routing::resolve_model_tiers(&["main".into(), "eco".into()]);
        assert_eq!(tier_env(&r, "ANTHROPIC_MODEL"), "main");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_OPUS_MODEL"), "main");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_SONNET_MODEL"), "main");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_HAIKU_MODEL"), "eco");
    }

    #[test]
    fn model_tiers_three_independent() {
        let r = crate::session::platform_routing::resolve_model_tiers(&[
            "o".into(),
            "s".into(),
            "h".into(),
        ]);
        assert_eq!(tier_env(&r, "ANTHROPIC_MODEL"), "s");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_OPUS_MODEL"), "o");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_SONNET_MODEL"), "s");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_HAIKU_MODEL"), "h");
    }

    #[test]
    fn model_tiers_three_only_sonnet() {
        // ["", "s", ""] → all tiers = s
        let r = crate::session::platform_routing::resolve_model_tiers(&[
            "".into(),
            "s".into(),
            "".into(),
        ]);
        assert_eq!(tier_env(&r, "ANTHROPIC_MODEL"), "s");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_OPUS_MODEL"), "s");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_HAIKU_MODEL"), "s");
    }

    #[test]
    fn model_tiers_three_sonnet_and_haiku() {
        // ["", "s", "h"] → Opus inherits Sonnet
        let r = crate::session::platform_routing::resolve_model_tiers(&[
            "".into(),
            "s".into(),
            "h".into(),
        ]);
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_OPUS_MODEL"), "s");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_SONNET_MODEL"), "s");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_HAIKU_MODEL"), "h");
    }

    #[test]
    fn model_tiers_three_opus_sonnet_empty_haiku() {
        // ["o", "s", ""] → Haiku inherits Sonnet
        let r = crate::session::platform_routing::resolve_model_tiers(&[
            "o".into(),
            "s".into(),
            "".into(),
        ]);
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_OPUS_MODEL"), "o");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_SONNET_MODEL"), "s");
        assert_eq!(tier_env(&r, "ANTHROPIC_DEFAULT_HAIKU_MODEL"), "s");
    }

    #[test]
    fn model_tiers_three_all_empty_returns_nothing() {
        // ["", "", ""] → Sonnet empty → no injection
        let r = crate::session::platform_routing::resolve_model_tiers(&[
            "".into(),
            "".into(),
            "".into(),
        ]);
        assert!(r.is_empty());
    }

    #[test]
    fn model_tiers_three_sonnet_empty_with_others_returns_nothing() {
        // ["o", "", "h"] → Sonnet empty → no injection
        let r = crate::session::platform_routing::resolve_model_tiers(&[
            "o".into(),
            "".into(),
            "h".into(),
        ]);
        assert!(r.is_empty());
    }

    #[test]
    fn model_tiers_two_empty_first_returns_nothing() {
        // ["", ""] → first element empty → no injection (existing behavior)
        let r = crate::session::platform_routing::resolve_model_tiers(&["".into(), "".into()]);
        // 2-element branch uses [0] for opus/sonnet — empty string still produces envs
        // This is existing behavior; the empty-string guard only applies to 3+ elements
        assert_eq!(r.len(), 4);
    }
}
