use super::*;

#[test]
fn test_check_project_init_no_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let nonexistent = tmp.path().join("nonexistent_subdir");
    let result = check_project_init(nonexistent.to_string_lossy().into()).unwrap();
    assert!(!result.has_claude_md);
}

#[test]
fn test_check_project_init_empty_dir() {
    let dir = tempfile::tempdir().unwrap();
    let result = check_project_init(dir.path().to_string_lossy().into()).unwrap();
    assert!(!result.has_claude_md);
}

#[test]
fn test_check_project_init_with_claude_md() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("CLAUDE.md"), "# Project").unwrap();
    let result = check_project_init(dir.path().to_string_lossy().into()).unwrap();
    assert!(result.has_claude_md);
}

// ── run_diagnostics sub-check tests ──

#[test]
fn test_validate_settings_invalid_json() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    std::fs::write(home.join("settings.json"), "{ invalid json }").unwrap();
    let issues = validate_config_files_at(home, "/nonexistent", false);
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "error");
    assert!(issues[0].message.contains("Invalid JSON"));
}

#[test]
fn test_validate_settings_valid_json() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    std::fs::write(home.join("settings.json"), r#"{"key": "value"}"#).unwrap();
    let issues = validate_config_files_at(home, "/nonexistent", false);
    assert!(issues.is_empty());
}

#[test]
fn test_invalid_cwd_skips_project_scope() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    // Write project-scope settings — should be skipped when cwd invalid
    let proj_dir = dir.path().join("project").join(".claude");
    std::fs::create_dir_all(&proj_dir).unwrap();
    std::fs::write(proj_dir.join("settings.json"), "invalid").unwrap();
    let issues = validate_config_files_at(home, "/nonexistent_xyz", false);
    // Only user scope checked, no project scope issue
    assert!(issues.iter().all(|i| i.scope == "user" || i.scope == "env"));
}

#[test]
fn test_validate_keybindings_non_object() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    std::fs::write(home.join("keybindings.json"), "[]").unwrap();
    let issues = validate_keybindings_at(home);
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "error");
    assert!(issues[0].message.contains("must be an object"));
}

#[test]
fn test_check_env_vars_out_of_range() {
    // Temporarily set an env var with an out-of-range value
    let key = "CLAUDE_CODE_MAX_OUTPUT_TOKENS";
    let orig = std::env::var(key).ok();
    std::env::set_var(key, "999999");
    let issues = check_env_vars();
    // Restore
    match orig {
        Some(v) => std::env::set_var(key, v),
        None => std::env::remove_var(key),
    }
    let found = issues.iter().any(|i| i.message.contains(key));
    assert!(found, "Expected warning for out-of-range {}", key);
}

#[test]
fn test_scan_claude_md_files_at() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home_claude");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(home.join("CLAUDE.md"), "# Global").unwrap();

    let cwd_dir = dir.path().join("project");
    std::fs::create_dir_all(&cwd_dir).unwrap();
    std::fs::write(cwd_dir.join("CLAUDE.md"), "# Project content here").unwrap();

    let files = scan_claude_md_files_at(&home, &cwd_dir.to_string_lossy(), true);
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].size_chars, 8); // "# Global"
    assert_eq!(files[1].size_chars, 22); // "# Project content here"
}

#[test]
fn test_validate_mcp_stdio_missing_command() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    std::fs::write(
        home.join("settings.json"),
        r#"{"mcpServers":{"s1":{"type":"stdio"}}}"#,
    )
    .unwrap();
    let issues = validate_mcp_configs_at(home, "/nonexistent", false);
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "error");
    assert!(issues[0].message.contains("missing \"command\""));
}

#[test]
fn test_validate_mcp_http_missing_url() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    std::fs::write(
        home.join("settings.json"),
        r#"{"mcpServers":{"s1":{"type":"http"}}}"#,
    )
    .unwrap();
    let issues = validate_mcp_configs_at(home, "/nonexistent", false);
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "error");
    assert!(issues[0].message.contains("missing \"url\""));
}

#[test]
fn test_validate_mcp_valid_entry() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    std::fs::write(
            home.join("settings.json"),
            r#"{"mcpServers":{"s1":{"command":"node","args":["server.js"]},"s2":{"type":"http","url":"http://localhost:3000"}}}"#,
        )
        .unwrap();
    let issues = validate_mcp_configs_at(home, "/nonexistent", false);
    assert!(issues.is_empty(), "Expected no issues, got: {:?}", issues);
}

// ── detect_local_proxy tests ──

#[tokio::test]
async fn test_detect_proxy_not_running() {
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        // Use a non-routable address to guarantee connection failure
        let url = "http://192.0.2.1:1";
        let result = detect_proxy_inner("test-proxy", url).await;
        assert!(
            !result.running,
            "expected not running, error={:?}",
            result.error
        );
        assert!(!result.needs_auth);
        assert!(result.error.is_some());
    });
    timeout.await.expect("test timed out");
}

#[tokio::test]
async fn test_detect_proxy_running_200() {
    use tokio::io::AsyncWriteExt;
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // Spawn a minimal HTTP server that returns 200
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await;
                let resp = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]";
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        let result = detect_proxy_inner("test-proxy", &url).await;
        assert!(result.running);
        assert!(!result.needs_auth);
        assert!(result.error.is_none());
    });
    timeout.await.expect("test timed out");
}

#[tokio::test]
async fn test_detect_proxy_running_401_needs_auth() {
    use tokio::io::AsyncWriteExt;
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // Spawn a minimal HTTP server that returns 401
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await;
                let resp = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n";
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        let result = detect_proxy_inner("test-proxy", &url).await;
        assert!(result.running);
        assert!(result.needs_auth);
        assert!(result.error.is_none());
    });
    timeout.await.expect("test timed out");
}

// ── test_api_connectivity tests ──

#[tokio::test]
async fn test_api_connectivity_success_200() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let _ = AsyncReadExt::read(&mut stream, &mut buf).await;
                let body = r#"{"content":[{"text":"Hello!"}]}"#;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        let result = test_api_inner("test-key", &url, "ANTHROPIC_API_KEY", "test-model").await;
        assert!(result.success);
        assert!(!result.partial);
        assert!(result.latency_ms > 0);
        assert_eq!(result.reply, Some("Hello!".to_string()));
        assert!(result.error.is_none());
    });
    timeout.await.expect("test timed out");
}

#[tokio::test]
async fn test_api_connectivity_auth_failure_401() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let _ = AsyncReadExt::read(&mut stream, &mut buf).await;
                let body = r#"{"error":{"message":"Invalid API key"}}"#;
                let resp = format!(
                    "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        let result = test_api_inner("bad-key", &url, "ANTHROPIC_API_KEY", "test-model").await;
        assert!(!result.success);
        assert!(
            result
                .error
                .as_deref()
                .unwrap()
                .contains("Authentication failed"),
            "error was: {:?}",
            result.error
        );
    });
    timeout.await.expect("test timed out");
}

#[tokio::test]
async fn test_api_connectivity_not_found_404() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let _ = AsyncReadExt::read(&mut stream, &mut buf).await;
                let resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        let result = test_api_inner("test-key", &url, "ANTHROPIC_API_KEY", "test-model").await;
        assert!(!result.success);
        assert!(
            result
                .error
                .as_deref()
                .unwrap()
                .contains("Endpoint not found"),
            "error was: {:?}",
            result.error
        );
    });
    timeout.await.expect("test timed out");
}

#[tokio::test]
async fn test_api_connectivity_header_x_api_key() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let n = AsyncReadExt::read(&mut stream, &mut buf).await.unwrap();
                let req_str = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = tx.send(req_str);
                let body = r#"{"content":[{"text":"ok"}]}"#;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        let result = test_api_inner("test-key-123", &url, "ANTHROPIC_API_KEY", "test-model").await;
        assert!(result.success);
        let req_str = rx.await.unwrap();
        let req_lower = req_str.to_lowercase();
        assert!(
            req_lower.contains("x-api-key: test-key-123"),
            "expected x-api-key header, got: {}",
            req_str
        );
    });
    timeout.await.expect("test timed out");
}

#[tokio::test]
async fn test_api_connectivity_header_bearer() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let n = AsyncReadExt::read(&mut stream, &mut buf).await.unwrap();
                let req_str = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = tx.send(req_str);
                let body = r#"{"content":[{"text":"ok"}]}"#;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        let result = test_api_inner(
            "test-bearer-key",
            &url,
            "ANTHROPIC_AUTH_TOKEN",
            "test-model",
        )
        .await;
        assert!(result.success);
        let req_str = rx.await.unwrap();
        let req_lower = req_str.to_lowercase();
        assert!(
            req_lower.contains("authorization: bearer test-bearer-key"),
            "expected Bearer header, got: {}",
            req_str
        );
    });
    timeout.await.expect("test timed out");
}

#[tokio::test]
async fn test_api_connectivity_probe_partial_success() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let _ = AsyncReadExt::read(&mut stream, &mut buf).await;
                // Simulate a 400 "model not found" response
                let body = r#"{"error":{"message":"model: claude-sonnet-4-6 not found"}}"#;
                let resp = format!(
                    "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        // model="" triggers probe mode
        let result = test_api_inner("test-key", &url, "ANTHROPIC_API_KEY", "").await;
        assert!(result.success, "expected partial success");
        assert!(result.partial, "expected partial=true");
        assert!(result.error.is_none());
    });
    timeout.await.expect("test timed out");
}

#[tokio::test]
async fn test_api_connectivity_non_probe_400_is_failure() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let _ = AsyncReadExt::read(&mut stream, &mut buf).await;
                let body = r#"{"error":{"message":"model: foo not found"}}"#;
                let resp = format!(
                    "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        let url = format!("http://127.0.0.1:{}", port);
        // model="foo" — NOT probe mode, so 400 should be a real failure
        let result = test_api_inner("test-key", &url, "ANTHROPIC_API_KEY", "foo").await;
        assert!(!result.success, "expected failure for non-probe 400");
        assert!(!result.partial);
        assert!(result.error.is_some());
    });
    timeout.await.expect("test timed out");
}
