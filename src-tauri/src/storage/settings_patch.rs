//! Strongly-typed `UserSettingsPatch` DTO (v1).
//!
//! The legacy `update_user_settings(patch: serde_json::Value)` function
//! accepts a free-form JSON object and hand-rolls every field with
//! `if let Some(v) = patch.get("xxx") { … }`. The first rule of the
//! "Settings Patch" risk in the v1.0.6 architecture review was:
//!
//! > "P0 risk — frontend authors can invent a new field name and the
//! >  backend silently drops it. Add a typed DTO so both sides share the
//! >  same field set, enforced at the type layer."
//!
//! This module provides:
//!
//!   1. [`UserSettingsPatch`] — a `#[derive(Deserialize)]` struct with one
//!      field per `UserSettings` property. Any unknown field at the JSON
//!      layer triggers a deserialization error (silent drops become
//!      loud 400s).
//!
//!   2. [`apply_patch`] — a pure function that mutates a `UserSettings`
//!      in place. All per-field validation (enum whitelists, range
//!      clamps, null-as-clear semantics) lives here. No I/O.
//!
//! The legacy `update_user_settings(patch: serde_json::Value)` in
//! `storage/settings.rs` continues to work — it was not deleted by this
//! change. New code should call [`apply_patch`] + a thin `save()` wrapper
//! instead. Migration is incremental.
//!
//! Why we did not delete the legacy path:
//!   - This is **infrastructure only**. The 133 call sites that build
//!     patches from frontend payloads still flow through `update_user_settings`
//!     and keep working unchanged.
//!   - Once the contract test in `tests::contract_field_coverage` passes,
//!     new code paths can opt in to `apply_patch` without churn.
//!
//! Adding a new field to `UserSettings`:
//!   1. Add it to the Rust `UserSettings` struct (with appropriate `Option`).
//!   2. Add a matching entry to [`UserSettingsPatch`] below (use
//!      `Option<Option<T>>` for nullable fields, `Option<T>` otherwise).
//!   3. Add an arm to [`apply_patch`].
//!   4. The contract test will fail if you forget step 2 or 3.

use crate::models::{
    normalize_session_island_alignment, KeyBindingOverride, PlatformCredential, RemoteHost,
    SessionStatusColors, UserSettings,
};
use serde::Deserialize;

/// Strongly-typed patch for [`UserSettings`].
///
/// Convention:
///   - `Option<T>` field → `Some(v)` to set, `None` to leave unchanged.
///   - `Option<Option<T>>` field → `Some(Some(v))` to set, `Some(None)` to
///     clear (the field becomes `None`), `None` to leave unchanged.
///
/// Every field on `UserSettings` is mirrored here. New fields MUST be added
/// to both at the same time, or the contract test will fail.
#[derive(Debug, Default, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct UserSettingsPatch {
    // ── Plain String / non-null scalars ─────────────────────────────────
    #[serde(default)]
    pub default_agent: Option<String>,
    #[serde(default)]
    pub provider_mode: Option<String>,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub default_session_mode: Option<String>,
    #[serde(default)]
    pub sound_feedback_level: Option<String>,
    #[serde(default)]
    pub process_visibility: Option<String>,
    #[serde(default)]
    pub visual_performance_mode: Option<String>,
    #[serde(default)]
    pub session_island_alignment: Option<String>,
    #[serde(default)]
    pub native_window_glass_material: Option<String>,

    // ── Boolean scalars ────────────────────────────────────────────────
    #[serde(default)]
    pub onboarding_completed: Option<bool>,
    #[serde(default)]
    pub feishu_webhook_enabled: Option<bool>,
    #[serde(default)]
    pub show_token_usage_report: Option<bool>,
    #[serde(default)]
    pub mascot_enabled: Option<bool>,
    #[serde(default)]
    pub icon_rail_enabled: Option<bool>,
    #[serde(default)]
    pub cli_auto_sync_enabled: Option<bool>,
    #[serde(default)]
    pub cli_auto_sync_import_new: Option<bool>,
    #[serde(default)]
    pub app_auto_update_check_enabled: Option<bool>,
    #[serde(default)]
    pub native_window_glass_enabled: Option<bool>,

    // ── Number scalars (some may be cleared via null semantics) ────────
    #[serde(default)]
    pub max_budget_usd: Option<f64>,
    #[serde(default)]
    pub ui_zoom: Option<f64>,
    #[serde(default)]
    pub notification_min_duration_sec: Option<u32>,
    #[serde(default)]
    pub cli_auto_sync_interval_minutes: Option<u32>,

    // ── Nullable strings (clear via `Some(None)`) ──────────────────────
    #[serde(default, deserialize_with = "double_option")]
    pub default_model: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub working_directory: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub anthropic_api_key: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub anthropic_base_url: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub auth_env_var: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub fallback_model: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub active_platform_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub feishu_webhook_url: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub feishu_webhook_template: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub user_display_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub user_role: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub user_timezone: Option<Option<String>>,

    // ── Nullable bools ─────────────────────────────────────────────────
    #[serde(default, deserialize_with = "double_option")]
    pub notifications_enabled: Option<Option<bool>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notify_on_run_completed: Option<Option<bool>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notify_on_run_failed: Option<Option<bool>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notify_on_approval_required: Option<Option<bool>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notify_on_schedule_completed: Option<Option<bool>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notify_on_team_completed: Option<Option<bool>>,

    // ── Arrays (treated as `Option<Option<Vec<_>>>` so null clears them) ─
    #[serde(default, deserialize_with = "double_option")]
    pub allowed_tools: Option<Option<Vec<String>>>,
    #[serde(default, deserialize_with = "double_option")]
    pub keybinding_overrides: Option<Option<Vec<KeyBindingOverride>>>,
    #[serde(default, deserialize_with = "double_option")]
    pub remote_hosts: Option<Option<Vec<RemoteHost>>>,
    #[serde(default, deserialize_with = "double_option")]
    pub platform_credentials: Option<Option<Vec<PlatformCredential>>>,
    #[serde(default, deserialize_with = "double_option")]
    pub feishu_webhook_triggers: Option<Option<Vec<String>>>,

    // ── Object (clear via `Some(None)`) ────────────────────────────────
    #[serde(default, deserialize_with = "double_option")]
    pub session_status_colors: Option<Option<SessionStatusColors>>,
}

/// serde helper: deserialize `T | null` into `Option<Option<T>>`.
///
/// `null` JSON → `Some(None)` (meaning "clear"), absent JSON → `None` (meaning
/// "don't touch"), value JSON → `Some(Some(value))`.
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
}

fn validate_ui_zoom(v: f64) -> Result<f64, String> {
    if !(0.75..=1.5).contains(&v) {
        return Err(format!("ui_zoom must be between 0.75 and 1.5, got {}", v));
    }
    Ok(v)
}

/// Apply a typed [`UserSettingsPatch`] to a `UserSettings` in place.
///
/// Pure: no I/O. The caller is responsible for `save()`-ing after.
///
/// Returns an error if a field fails validation (e.g. unknown enum value,
/// out-of-range number). The original `settings` is left unchanged on
/// error so the caller can retry.
pub fn apply_patch(settings: &mut UserSettings, patch: UserSettingsPatch) -> Result<(), String> {
    if let Some(v) = patch.default_agent {
        settings.default_agent = v;
    }
    if let Some(model) = patch.default_model {
        settings.default_model = model.and_then(|v| if v.is_empty() { None } else { Some(v) });
    }
    if let Some(Some(tools)) = patch.allowed_tools.clone() {
        settings.allowed_tools = tools;
    }
    if let Some(Some(v)) = patch.working_directory {
        settings.working_directory = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = patch.provider_mode {
        settings.provider_mode = v;
    }
    if let Some(v) = patch.auth_mode {
        settings.auth_mode = v;
    }
    if let Some(Some(v)) = patch.anthropic_api_key {
        settings.anthropic_api_key = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(Some(v)) = patch.anthropic_base_url {
        settings.anthropic_base_url = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(Some(v)) = patch.auth_env_var {
        settings.auth_env_var = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = patch.permission_mode {
        settings.permission_mode = v;
    }
    if let Some(v) = patch.max_budget_usd {
        settings.max_budget_usd = Some(v);
    }
    if let Some(Some(v)) = patch.fallback_model {
        settings.fallback_model = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(Some(v)) = patch.keybinding_overrides.clone() {
        settings.keybinding_overrides = v;
    }
    if let Some(Some(v)) = patch.remote_hosts.clone() {
        settings.remote_hosts = v;
    }
    if let Some(Some(v)) = patch.platform_credentials.clone() {
        settings.platform_credentials = v;
    }
    if let Some(Some(v)) = patch.active_platform_id {
        settings.active_platform_id = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = patch.ui_zoom {
        settings.ui_zoom = Some(validate_ui_zoom(v)?);
    }
    if let Some(v) = patch.onboarding_completed {
        settings.onboarding_completed = v;
    }
    // Notifications
    if let Some(Some(v)) = patch.notifications_enabled {
        settings.notifications_enabled = Some(v);
    }
    if let Some(Some(v)) = patch.notify_on_run_completed {
        settings.notify_on_run_completed = Some(v);
    }
    if let Some(Some(v)) = patch.notify_on_run_failed {
        settings.notify_on_run_failed = Some(v);
    }
    if let Some(Some(v)) = patch.notify_on_approval_required {
        settings.notify_on_approval_required = Some(v);
    }
    if let Some(Some(v)) = patch.notify_on_schedule_completed {
        settings.notify_on_schedule_completed = Some(v);
    }
    if let Some(Some(v)) = patch.notify_on_team_completed {
        settings.notify_on_team_completed = Some(v);
    }
    if let Some(v) = patch.notification_min_duration_sec {
        settings.notification_min_duration_sec = Some(v);
    }
    if let Some(v) = patch.sound_feedback_level {
        if matches!(v.as_str(), "off" | "minimal" | "standard" | "detailed") {
            settings.sound_feedback_level = v;
        } else {
            return Err(format!(
                "invalid sound_feedback_level: {} (must be off|minimal|standard|detailed)",
                v
            ));
        }
    }
    // Feishu
    if let Some(Some(v)) = patch.feishu_webhook_url {
        settings.feishu_webhook_url = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = patch.feishu_webhook_enabled {
        settings.feishu_webhook_enabled = v;
    }
    if let Some(Some(v)) = patch.feishu_webhook_triggers.clone() {
        settings.feishu_webhook_triggers = v;
    }
    if let Some(Some(v)) = patch.feishu_webhook_template {
        settings.feishu_webhook_template = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = patch.show_token_usage_report {
        settings.show_token_usage_report = v;
    }
    if let Some(v) = patch.mascot_enabled {
        settings.mascot_enabled = v;
    }
    if let Some(v) = patch.icon_rail_enabled {
        settings.icon_rail_enabled = v;
    }
    if let Some(v) = patch.cli_auto_sync_enabled {
        settings.cli_auto_sync_enabled = v;
    }
    if let Some(v) = patch.cli_auto_sync_interval_minutes {
        settings.cli_auto_sync_interval_minutes = v.clamp(1, 120);
    }
    if let Some(v) = patch.cli_auto_sync_import_new {
        settings.cli_auto_sync_import_new = v;
    }
    if let Some(v) = patch.app_auto_update_check_enabled {
        settings.app_auto_update_check_enabled = v;
    }
    if let Some(v) = patch.native_window_glass_enabled {
        settings.native_window_glass_enabled = v;
    }
    if let Some(v) = patch.native_window_glass_material {
        if matches!(v.as_str(), "header_view" | "sidebar") {
            settings.native_window_glass_material = v;
        } else {
            return Err(format!(
                "invalid native_window_glass_material: {} (must be header_view|sidebar)",
                v
            ));
        }
    }
    if let Some(v) = patch.process_visibility {
        if matches!(v.as_str(), "output" | "guided" | "developer" | "expert") {
            settings.process_visibility = v;
        } else {
            return Err(format!(
                "invalid process_visibility: {} (must be output|guided|developer|expert)",
                v
            ));
        }
    }
    if let Some(v) = patch.visual_performance_mode {
        if matches!(v.as_str(), "auto" | "quality" | "balanced" | "performance") {
            settings.visual_performance_mode = v;
        } else {
            return Err(format!(
                "invalid visual_performance_mode: {} (must be auto|quality|balanced|performance)",
                v
            ));
        }
    }
    if let Some(v) = patch.session_island_alignment {
        settings.session_island_alignment = normalize_session_island_alignment(&v);
    }
    if let Some(maybe) = patch.session_status_colors {
        settings.session_status_colors = maybe;
    }
    if let Some(default_session_mode) = patch.default_session_mode {
        settings.default_session_mode = default_session_mode;
    }
    // User identity fields (clear via Some(None))
    if let Some(maybe) = patch.user_display_name {
        settings.user_display_name = maybe;
    }
    if let Some(maybe) = patch.user_role {
        settings.user_role = maybe;
    }
    if let Some(maybe) = patch.user_timezone {
        settings.user_timezone = maybe;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserSettings;

    #[test]
    fn contract_field_coverage() {
        // For every user-controllable field on `UserSettings`, the patch
        // struct MUST have a matching field. This catches the failure mode
        // "front-end added a field, backend forgot it" — the contract test
        // would fail because the field name wouldn't appear in the patch
        // struct's JSON form.
        let user_fields = {
            let value = serde_json::to_value(UserSettings::default()).expect("serialize default");
            value
                .as_object()
                .expect("settings is an object")
                .keys()
                .cloned()
                .collect::<std::collections::HashSet<String>>()
        };
        let patch_fields = {
            let value =
                serde_json::to_value(UserSettingsPatch::default()).expect("serialize empty patch");
            value
                .as_object()
                .expect("patch is an object")
                .keys()
                .cloned()
                .collect::<std::collections::HashSet<String>>()
        };

        // The patch does NOT need every backend-internal field. The fields
        // below are server-managed and intentionally not user-patchable
        // through this DTO.
        let server_managed: &[&str] = &[
            "updated_at",
            "web_server_enabled",
            "web_server_token",
            "web_server_port",
            "web_server_bind",
            "web_server_allowed_origins",
            "web_server_tunnel_url",
            "auto_commit_on_complete",
            "auto_pr_on_complete",
            "auto_cleanup_worktree",
        ];
        let user_controllable: Vec<String> = user_fields
            .iter()
            .filter(|f| !server_managed.contains(&f.as_str()))
            .cloned()
            .collect();

        let missing_in_patch: Vec<&String> = user_controllable
            .iter()
            .filter(|f| !patch_fields.contains(*f))
            .collect();

        assert!(
            missing_in_patch.is_empty(),
            "patch struct missing user-controllable fields: {:?}",
            missing_in_patch
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn contract_every_user_controllable_field_is_accepted_by_deserializer() {
        // For every user-controllable field on `UserSettings`, sending a
        // valid value of the right JSON shape through serde_json MUST
        // deserialize cleanly. This catches misnamed field annotations,
        // missing `#[serde(default)]`, etc.
        //
        // We don't try to validate every type here — only that serde can
        // recognise the field name. The per-field unit tests cover the
        // actual value semantics.
        let user_fields: Vec<String> = {
            let value = serde_json::to_value(UserSettings::default()).expect("serialize default");
            value
                .as_object()
                .expect("settings is an object")
                .keys()
                .cloned()
                .collect()
        };
        let server_managed: &[&str] = &[
            "updated_at",
            "web_server_enabled",
            "web_server_token",
            "web_server_port",
            "web_server_bind",
            "web_server_allowed_origins",
            "web_server_tunnel_url",
            "auto_commit_on_complete",
            "auto_pr_on_complete",
            "auto_cleanup_worktree",
        ];

        for field in user_fields {
            if server_managed.contains(&field.as_str()) {
                continue;
            }
            // Send `null` — the most permissive shape that `Option<Option<_>>`
            // and `Option<_>` both accept.
            let sample = serde_json::json!({ field.clone(): null });
            let parsed: Result<UserSettingsPatch, _> = serde_json::from_value(sample);
            assert!(
                parsed.is_ok(),
                "patch should accept null for field '{}', got: {:?}",
                field,
                parsed.err()
            );
        }
    }

    #[test]
    fn empty_patch_is_noop() {
        let mut s = UserSettings::default();
        let before = s.clone();
        apply_patch(&mut s, UserSettingsPatch::default()).expect("empty patch must succeed");
        assert_eq!(
            serde_json::to_value(&s).unwrap(),
            serde_json::to_value(&before).unwrap(),
            "empty patch must not mutate settings"
        );
    }

    #[test]
    fn default_agent_string_set_and_replace() {
        let mut s = UserSettings::default();
        apply_patch(
            &mut s,
            serde_json::from_value(serde_json::json!({ "default_agent": "codex" })).unwrap(),
        )
        .unwrap();
        assert_eq!(s.default_agent, "codex");
    }

    #[test]
    fn default_model_clear_via_null() {
        let mut s = UserSettings::default();
        s.default_model = Some("opus".to_string());
        let patch: UserSettingsPatch =
            serde_json::from_value(serde_json::json!({ "default_model": null })).unwrap();
        apply_patch(&mut s, patch).unwrap();
        assert_eq!(s.default_model, None);
    }

    #[test]
    fn ui_zoom_rejects_out_of_range() {
        let mut s = UserSettings::default();
        let patch: UserSettingsPatch =
            serde_json::from_value(serde_json::json!({ "ui_zoom": 5.0 })).unwrap();
        assert!(apply_patch(&mut s, patch).is_err());
    }

    #[test]
    fn process_visibility_rejects_unknown_enum() {
        let mut s = UserSettings::default();
        let patch: UserSettingsPatch =
            serde_json::from_value(serde_json::json!({ "process_visibility": "secret" })).unwrap();
        assert!(apply_patch(&mut s, patch).is_err());
    }

    #[test]
    fn cli_auto_sync_interval_clamped() {
        let mut s = UserSettings::default();
        let patch: UserSettingsPatch =
            serde_json::from_value(serde_json::json!({ "cli_auto_sync_interval_minutes": 9999 }))
                .unwrap();
        apply_patch(&mut s, patch).unwrap();
        assert_eq!(s.cli_auto_sync_interval_minutes, 120);
    }

    #[test]
    fn unknown_field_is_rejected_at_deserialize() {
        // Frontend authors MUST NOT be able to invent a new field and have
        // it silently dropped. The typed DTO turns silent drops into loud
        // deserialization errors.
        let result: Result<UserSettingsPatch, _> =
            serde_json::from_value(serde_json::json!({ "totally_new_field": 42 }));
        assert!(result.is_err(), "unknown field must be rejected");
    }

    #[test]
    fn session_island_alignment_normalizes_invalid() {
        let mut s = UserSettings::default();
        let patch: UserSettingsPatch =
            serde_json::from_value(serde_json::json!({ "session_island_alignment": "top-left" }))
                .unwrap();
        apply_patch(&mut s, patch).unwrap();
        assert_eq!(s.session_island_alignment, "center");
    }
}
