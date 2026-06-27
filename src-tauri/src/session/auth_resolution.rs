//! Auth resolution: API key / auth token / base URL / models / extra_env for spawning CLI.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! Pure logic — no Tauri state, no I/O, no process spawn. Safe to unit-test in isolation.
//!
//! `ResolvedAuth` is the canonical shape returned to `process_spawn` (env injection) and
//! `actor_control` (CLI build args). The two top-level functions in this module
//! (`resolve_auth_env` and `resolve_auth_env_for_platform`) differ only in platform
//! awareness:
//!   - `resolve_auth_env` — global, single source of truth for legacy callers.
//!   - `resolve_auth_env_for_platform` — per-platform override, with keyless local proxy
//!     fallbacks (CC Switch / CCR / Ollama use `PROXY_MANAGED` placeholder token).

use crate::models::{RemoteHost, UserSettings};
use crate::storage;

/// Resolved authentication and environment info for spawning CLI.
pub struct ResolvedAuth {
    pub api_key: Option<String>,
    pub auth_token: Option<String>,
    pub base_url: Option<String>,
    /// Full models array from credential/preset (tier mapping applied at injection time).
    pub models: Option<Vec<String>>,
    pub extra_env: Option<std::collections::HashMap<String, String>>,
}

/// Resolve API authentication environment variables.
///
/// Returns `ResolvedAuth` with `(api_key, auth_token, base_url, models, extra_env)`.
/// - `api_key`: for Anthropic official (`x-api-key` header)
/// - `auth_token`: for third-party platforms (`Authorization: Bearer` header)
/// - `base_url`: custom API endpoint
///
/// `api_key` and `auth_token` are mutually exclusive.
pub(crate) fn resolve_auth_env(
    remote: &Option<RemoteHost>,
    settings: &UserSettings,
) -> ResolvedAuth {
    let base_url = settings
        .anthropic_base_url
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned();

    // SSH remote: forward_api_key=false → no credentials forwarded
    if let Some(r) = remote.as_ref() {
        if !r.forward_api_key {
            return ResolvedAuth {
                api_key: None,
                auth_token: None,
                base_url: None,
                models: None,
                extra_env: None,
            };
        }
        // forward_api_key=true: fall through to normal resolution
    }

    // Local API Key mode (also used for remote with forward_api_key=true)
    if settings.auth_mode == "api" {
        if let Some(ref key) = settings.anthropic_api_key {
            if !key.is_empty() {
                // Use auth_env_var from platform preset to decide which header to use.
                // "ANTHROPIC_AUTH_TOKEN" → Bearer header (most third-party platforms)
                // "ANTHROPIC_API_KEY" (or unset) → x-api-key header (Anthropic, AiHubMix, Kimi Coding)
                let use_bearer = settings.auth_env_var.as_deref() == Some("ANTHROPIC_AUTH_TOKEN");

                if use_bearer {
                    return ResolvedAuth {
                        api_key: None,
                        auth_token: Some(key.clone()),
                        base_url,
                        models: None,
                        extra_env: None,
                    };
                } else {
                    return ResolvedAuth {
                        api_key: Some(key.clone()),
                        auth_token: None,
                        base_url,
                        models: None,
                        extra_env: None,
                    };
                }
            }
        }
    }

    // CLI mode: defer to CC Switch / CC Router env in ~/.claude/settings.json first.
    if settings.auth_mode == "cli" {
        if let Some(proxy) = resolve_cli_managed_proxy_auth() {
            log::debug!(
                "[session] resolve_auth_env: using CLI settings local proxy base_url={:?}",
                proxy.base_url
            );
            return proxy;
        }
        return ResolvedAuth {
            api_key: None,
            auth_token: None,
            base_url: None,
            models: None,
            extra_env: None,
        };
    }

    ResolvedAuth {
        api_key: None,
        auth_token: None,
        base_url,
        models: None,
        extra_env: None,
    }
}

/// Build `ResolvedAuth` with `PROXY_MANAGED` placeholder token for keyless local proxies.
pub(crate) fn make_placeholder_auth(
    use_bearer: bool,
    base_url: Option<String>,
    models: Option<Vec<String>>,
    extra_env: Option<std::collections::HashMap<String, String>>,
) -> ResolvedAuth {
    if use_bearer {
        ResolvedAuth {
            api_key: None,
            auth_token: Some("PROXY_MANAGED".to_string()),
            base_url,
            models,
            extra_env,
        }
    } else {
        ResolvedAuth {
            api_key: Some("PROXY_MANAGED".to_string()),
            auth_token: None,
            base_url,
            models,
            extra_env,
        }
    }
}

/// In CLI mode, honor CC Switch / CC Router env written to `~/.claude/settings.json`.
/// MiWarp must not override these with shell-level official API keys.
pub(crate) fn resolve_cli_managed_proxy_auth() -> Option<ResolvedAuth> {
    let base_url = crate::storage::cli_config::read_cli_env_var("ANTHROPIC_BASE_URL")?;
    if !super::platform_routing::is_local_proxy_base_url(&base_url) {
        return None;
    }

    let cli_token = crate::storage::cli_config::read_cli_env_var("ANTHROPIC_AUTH_TOKEN");
    let cli_key = crate::storage::cli_config::read_cli_env_var("ANTHROPIC_API_KEY");

    let pid = super::platform_routing::infer_local_proxy_platform_id(&base_url);
    let info = pid.and_then(storage::settings::get_provider_info);

    let use_bearer = info
        .as_ref()
        .and_then(|i| i.auth_env_var.as_deref())
        .is_some_and(|v| v == "ANTHROPIC_AUTH_TOKEN")
        || cli_token.is_some();

    if use_bearer {
        let token = cli_token
            .or(cli_key)
            .or_else(|| Some("PROXY_MANAGED".to_string()));
        return Some(ResolvedAuth {
            api_key: None,
            auth_token: token,
            base_url: Some(base_url),
            models: info.as_ref().and_then(|i| i.models.clone()),
            extra_env: info.as_ref().and_then(|i| i.extra_env.clone()),
        });
    }

    Some(ResolvedAuth {
        api_key: cli_key,
        auth_token: None,
        base_url: Some(base_url),
        models: info.as_ref().and_then(|i| i.models.clone()),
        extra_env: info.as_ref().and_then(|i| i.extra_env.clone()),
    })
}

/// Resolve auth env using per-session `platform_id`.
///
/// Looks up the credential from `settings.platform_credentials` by `platform_id`,
/// then returns `ResolvedAuth` matching the credential's `auth_env_var`.
/// Falls back to global [`resolve_auth_env`] if `platform_id` is `None` or credential
/// not found.
///
/// For keyless local proxies (ccswitch, ccr, ollama): uses `PROXY_MANAGED` placeholder
/// token with known defaults for `base_url` and `auth_env_var`.
///
/// For SSH remote sessions:
/// - `forward_api_key=true`: resolve credentials normally (platform-aware) and forward them
/// - `forward_api_key=false`: return empty `ResolvedAuth` — remote uses its own auth
pub(crate) fn resolve_auth_env_for_platform(
    remote: &Option<RemoteHost>,
    settings: &UserSettings,
    platform_id: Option<&str>,
) -> ResolvedAuth {
    // SSH remote with forward_api_key=false: don't forward any credentials
    if let Some(r) = remote.as_ref() {
        if !r.forward_api_key {
            log::debug!("[session] resolve_auth_env_for_platform: remote forward_api_key=false, no credentials forwarded");
            return ResolvedAuth {
                api_key: None,
                auth_token: None,
                base_url: None,
                models: None,
                extra_env: None,
            };
        }
        // forward_api_key=true: fall through to normal platform-aware resolution
    }

    // If we have a platform_id, try to find a matching credential
    if let Some(pid) = platform_id {
        if let Some(cred) = settings
            .platform_credentials
            .iter()
            .find(|c| c.platform_id == pid)
        {
            let key = cred.api_key.as_ref().filter(|k| !k.is_empty()).cloned();
            let base_url = cred.base_url.as_ref().filter(|s| !s.is_empty()).cloned();
            let use_bearer = cred.auth_env_var.as_deref() == Some("ANTHROPIC_AUTH_TOKEN");
            let models = cred.models.clone().filter(|m| !m.is_empty());
            let extra_env = cred.extra_env.clone();

            if let Some(k) = key {
                log::debug!(
                    "[session] resolve_auth_env_for_platform: platform={}, use_bearer={}, has_base_url={}, models={:?}, extra_env_count={}",
                    pid,
                    use_bearer,
                    base_url.is_some(),
                    models,
                    extra_env.as_ref().map_or(0, |e| e.len())
                );
                return if use_bearer {
                    ResolvedAuth {
                        api_key: None,
                        auth_token: Some(k),
                        base_url,
                        models,
                        extra_env,
                    }
                } else {
                    ResolvedAuth {
                        api_key: Some(k),
                        auth_token: None,
                        base_url,
                        models,
                        extra_env,
                    }
                };
            }
            // Credential found but no API key — check if key_optional platform
            if storage::settings::is_key_optional_platform(pid) {
                let info = storage::settings::get_provider_info(pid);

                // auth_env_var: known defaults take priority over credential (prevents dirty data)
                let effective_auth = info
                    .as_ref()
                    .and_then(|i| i.auth_env_var.clone())
                    .or_else(|| cred.auth_env_var.clone());
                let effective_bearer = effective_auth.as_deref() == Some("ANTHROPIC_AUTH_TOKEN");

                // base_url fallback: credential → known defaults
                let effective_url =
                    base_url.or_else(|| info.as_ref().and_then(|i| i.base_url.clone()));

                // models / extra_env fallback: credential → defaults
                let effective_models = models.or_else(|| {
                    info.as_ref()
                        .and_then(|i| i.models.clone())
                        .filter(|m| !m.is_empty())
                });
                let effective_extra =
                    extra_env.or_else(|| info.as_ref().and_then(|i| i.extra_env.clone()));

                log::info!(
                    "[session] platform '{}': key_optional, credential config with placeholder (base_url={:?})",
                    pid,
                    effective_url
                );
                return make_placeholder_auth(
                    effective_bearer,
                    effective_url,
                    effective_models,
                    effective_extra,
                );
            }
            log::warn!(
                "[session] resolve_auth_env_for_platform: credential for platform '{}' has no api_key, falling back to global",
                pid
            );
        } else {
            // No credential entry — check if key_optional platform with known defaults
            if let Some(info) = storage::settings::get_provider_info(pid) {
                if info.key_optional {
                    let use_bearer = info.auth_env_var.as_deref() == Some("ANTHROPIC_AUTH_TOKEN");
                    let models = info.models.clone().filter(|m| !m.is_empty());
                    log::info!(
                        "[session] platform '{}': no credential, using known defaults (key_optional, base_url={:?})",
                        pid,
                        info.base_url
                    );
                    return make_placeholder_auth(
                        use_bearer,
                        info.base_url,
                        models,
                        info.extra_env,
                    );
                }
            }
            log::warn!(
                "[session] resolve_auth_env_for_platform: no credential found for platform '{}', falling back to global",
                pid
            );
        }
    }

    // Fallback to global auth env
    resolve_auth_env(remote, settings)
}

// ── Shell config auth injection (CLI mode only) ──

/// Pure decision: should we skip injecting shell auth based on existing process env?
/// If EITHER `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is in process env (non-empty),
/// child inherits it — injecting the other would trigger `env_remove` mutual exclusion
/// (see `spawn_cli_process` key/token branches).
pub fn should_skip_env_injection(key_val: Option<&str>, token_val: Option<&str>) -> bool {
    let has_key = key_val.is_some_and(|v| !v.trim().is_empty());
    let has_token = token_val.is_some_and(|v| !v.trim().is_empty());
    has_key || has_token
}

/// Read CLI auth env vars missing from process environment, using shell config as fallback.
/// Only reads `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` (not `BASE_URL` — see
/// `augment_with_shell_auth` doc).
///
/// Shell config parsing limitations (inherited from `onboarding.rs:289
/// read_env_from_shell_config`):
/// - Supported: `export VAR=value`, `VAR=value`, single/double quoted values
/// - NOT supported: variable expansion (`$OTHER_VAR`), command substitution `$(cmd)`,
///   multi-line values, conditional blocks (`if`/`fi`), sourced sub-files
/// - Returns the FIRST match found across shell config files (`.zshrc` → `.zprofile` →
///   `.bashrc` → `.bash_profile` → `.profile`)
pub fn resolve_shell_auth() -> (Option<String>, Option<String>) {
    use crate::commands::onboarding::read_env_from_shell_config;

    let key_val = std::env::var("ANTHROPIC_API_KEY").ok();
    let token_val = std::env::var("ANTHROPIC_AUTH_TOKEN").ok();
    if should_skip_env_injection(key_val.as_deref(), token_val.as_deref()) {
        log::trace!("[session] shell_auth: process env has auth var, skip injection");
        return (None, None);
    }

    // Neither in process env — try shell config (key first, then token)
    if let Some((val, path)) = read_env_from_shell_config("ANTHROPIC_API_KEY") {
        log::debug!("[session] shell_auth: ANTHROPIC_API_KEY from {}", path);
        return (Some(val), None);
    }
    if let Some((val, path)) = read_env_from_shell_config("ANTHROPIC_AUTH_TOKEN") {
        log::debug!("[session] shell_auth: ANTHROPIC_AUTH_TOKEN from {}", path);
        return (None, Some(val));
    }

    (None, None)
}

/// Pure function: check if a JSON config value contains a non-empty auth key.
/// Checks both `apiKey` and `primaryApiKey` (used by Max/Team plans).
/// See `SENSITIVE_KEYS` in `cli_config.rs:78`.
pub fn config_value_has_auth_key(config: &serde_json::Value) -> bool {
    const AUTH_KEYS: &[&str] = &["apiKey", "primaryApiKey"];
    AUTH_KEYS.iter().any(|k| {
        config
            .get(k)
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.trim().is_empty())
    })
}

/// Check if any CLI config (user-level or project-level) contains an API key.
pub(crate) fn cli_config_has_auth_key(cwd: &str) -> bool {
    let user_config = crate::storage::cli_config::load_cli_config();
    if config_value_has_auth_key(&user_config) {
        log::trace!("[session] shell_auth: user-level CLI config has auth key, skip");
        return true;
    }

    let project_config = crate::storage::cli_config::load_project_cli_config(cwd);
    if config_value_has_auth_key(&project_config) {
        log::trace!("[session] shell_auth: project-level CLI config has auth key, skip");
        return true;
    }

    false
}

/// In CLI auth mode (local only), supplement resolved auth with shell config credentials.
///
/// Guards:
/// - CLI mode only (API mode manages its own credentials)
/// - Local only (remote respects `forward_api_key=false` — never inject)
/// - No existing credentials (don't override what `resolve_auth_env` produced)
/// - CLI config has no `apiKey`/`primaryApiKey` (user-level + project-level)
///
/// OAuth safety: CLI's own auth priority is OAuth > `settings.json` > env vars.
/// Even if we inject an env var, CLI will still prefer OAuth — the injected key
/// is only used when CLI has no higher-priority auth source.
///
/// Does NOT inject `ANTHROPIC_BASE_URL`: injecting a `base_url` would (a) trigger
/// `preflight_check_base_url` which blocks session start if unreachable, and
/// (b) affect routing even when CLI has OAuth that doesn't need a custom URL.
/// Users who need key+url together should use API mode in Settings.
pub fn augment_with_shell_auth(
    resolved: ResolvedAuth,
    auth_mode: &str,
    is_remote: bool,
    cwd: &str,
) -> ResolvedAuth {
    if auth_mode != "cli" {
        return resolved;
    }
    if is_remote {
        return resolved;
    }
    // CC Switch / CC Router write routing to ~/.claude/settings.json — never override with shell keys.
    if crate::storage::cli_config::read_cli_env_var("ANTHROPIC_BASE_URL").is_some() {
        log::debug!("[session] CLI settings env has ANTHROPIC_BASE_URL, skip shell auth injection");
        return resolved;
    }
    if resolved.base_url.is_some() || resolved.api_key.is_some() || resolved.auth_token.is_some() {
        return resolved;
    }
    if cli_config_has_auth_key(cwd) {
        return resolved;
    }

    let (key, token) = resolve_shell_auth();
    if key.is_some() || token.is_some() {
        log::debug!(
            "[session] CLI+local: supplementing auth from shell config (key={}, token={})",
            key.is_some(),
            token.is_some()
        );
        ResolvedAuth {
            api_key: key,
            auth_token: token,
            ..resolved
        }
    } else {
        resolved
    }
}
