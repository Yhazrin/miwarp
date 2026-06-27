//! Platform routing: resolve which platform_id drives credential / base_url injection,
//! and map models array → (env_key, env_value) tier pairs for CLI injection.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! Pure logic — no Tauri state, no I/O. Safe to unit-test in isolation.

use crate::storage;

/// Resolve which `platform_id` drives credential / base_url injection.
///
/// API mode: honor IPC param → run snapshot → global active platform.
/// CLI mode: normally skip platform routing (CLI OAuth manages official auth), except
/// key-optional local proxies (CC Switch, CCR, Ollama) which still need
/// `ANTHROPIC_BASE_URL`. When none is selected, infer from `~/.claude/settings.json`
/// env (CC Switch writes there).
pub(crate) fn effective_platform_id(
    auth_mode: &str,
    ipc_platform_id: Option<&str>,
    run_platform_id: Option<&str>,
    active_platform_id: Option<&str>,
) -> Option<String> {
    let candidate = ipc_platform_id
        .or(run_platform_id)
        .or(active_platform_id)
        .map(str::to_string);

    if auth_mode == "cli" {
        if let Some(ref pid) = candidate {
            if storage::settings::is_key_optional_platform(pid) {
                return Some(pid.clone());
            }
        }
        if let Some(base_url) = crate::storage::cli_config::read_cli_env_var("ANTHROPIC_BASE_URL") {
            if let Some(pid) = infer_local_proxy_platform_id(&base_url) {
                return Some(pid.to_string());
            }
        }
        return None;
    }

    candidate
}

/// Map a local-proxy base URL to a known key-optional platform id.
pub(crate) fn infer_local_proxy_platform_id(base_url: &str) -> Option<&'static str> {
    let lower = base_url.to_ascii_lowercase();
    if lower.contains("127.0.0.1:15721") || lower.contains("localhost:15721") {
        return Some("ccswitch");
    }
    if lower.contains("127.0.0.1:3456") || lower.contains("localhost:3456") {
        return Some("ccr");
    }
    if lower.contains(":11434") {
        return Some("ollama");
    }
    None
}

/// Heuristic: does this base URL point to a local proxy (loopback host)?
/// Used to short-circuit global platform routing when CLI mode is active.
pub(crate) fn is_local_proxy_base_url(base_url: &str) -> bool {
    let lower = base_url.to_ascii_lowercase();
    lower.contains("127.0.0.1") || lower.contains("localhost")
}

/// Resolve models array into `(env_key, env_value)` pairs for CLI injection.
///
/// | `models.len()` | Opus | Sonnet | Haiku |
/// |----------------|------|--------|-------|
/// | 1              | [0]  | [0]    | [0]   |
/// | 2              | [0]  | [0]    | [1]   |
/// | 3+             | [0]¹ | [1]²   | [2]¹  |
///
/// ¹ Empty element inherits Sonnet.
/// ² If Sonnet (index 1) is empty in 3+ element arrays → no injection (user left all
/// meaningful fields blank).
pub fn resolve_model_tiers(models: &[String]) -> Vec<(&'static str, String)> {
    if models.is_empty() {
        return vec![];
    }
    let (opus, sonnet, haiku) = match models.len() {
        1 => (&models[0], &models[0], &models[0]),
        2 => (&models[0], &models[0], &models[1]),
        _ => {
            // 3+ elements: Sonnet (index 1) is the anchor.
            // If Sonnet is empty → no injection (user left all meaningful fields blank).
            let sonnet = &models[1];
            if sonnet.is_empty() {
                return vec![];
            }
            let opus = if models[0].is_empty() {
                sonnet
            } else {
                &models[0]
            };
            let haiku = if models[2].is_empty() {
                sonnet
            } else {
                &models[2]
            };
            (opus, sonnet, haiku)
        }
    };
    log::debug!(
        "[session] resolve_model_tiers: opus={}, sonnet={}, haiku={}",
        opus,
        sonnet,
        haiku
    );
    vec![
        ("ANTHROPIC_MODEL", sonnet.clone()),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", opus.clone()),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", sonnet.clone()),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", haiku.clone()),
    ]
}
