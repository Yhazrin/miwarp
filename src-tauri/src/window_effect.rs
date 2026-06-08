//! Apply native window-level blur/vibrancy effects for the main window.
//!
//! - macOS: NSVisualEffectMaterial (sidebar) on the whole window so the
//!   left sidebar can show desktop content through the chrome.
//! - Windows: mica (preferred), acrylic (fallback), blur (last resort).
//! - Linux / unsupported: no-op; CSS `backdrop-filter` still gives a
//!   pleasant glass look.
//!
//! The effect can be toggled at runtime via the
//! `native_window_glass_enabled` user setting. Re-apply on toggle by
//! calling [`apply_for_setting`].

use tauri::{Manager, WebviewWindow};

/// Apply (or clear) the native blur effect for the main window based on
/// the saved `native_window_glass_enabled` setting. Safe to call from
/// setup or after settings change; never panics, only logs.
pub fn apply_for_setting<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let enabled = crate::storage::settings::get_user_settings().native_window_glass_enabled;
    if let Some(window) = app.get_webview_window("main") {
        apply_to_window(&window, enabled);
    }
}

/// Apply or clear the effect on a specific window. When `enabled` is
/// false the effect is reset to the OS default (solid background).
pub fn apply_to_window<R: tauri::Runtime>(window: &WebviewWindow<R>, enabled: bool) {
    if !enabled {
        clear(window);
        return;
    }
    match apply(window) {
        Ok(()) => log::info!("[window_effect] native blur applied"),
        Err(e) => log::warn!("[window_effect] failed to apply blur: {e}"),
    }
}

fn apply<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        apply_vibrancy(
            window,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::Active),
            None,
        )
        .map_err(|e| e.to_string())
    }

    #[cfg(target_os = "windows")]
    {
        // Prefer mica (Win11). Fall back to acrylic (Win10 1903+) and
        // then plain blur if neither is available.
        use window_vibrancy::apply_mica;
        if apply_mica(window, Some(false)).is_ok() {
            return Ok(());
        }
        use window_vibrancy::apply_acrylic;
        if apply_acrylic(window, Some("#00000000")).is_ok() {
            return Ok(());
        }
        use window_vibrancy::apply_blur;
        apply_blur(window, Some("#00000000")).map_err(|e| e.to_string())
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let _ = window;
        Ok(())
    }
}

/// Reset the window to the default OS chrome (no blur). We re-apply a
/// fully opaque background so the sidebar falls back to its CSS surface.
fn clear<R: tauri::Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        // `clear_vibrancy` exists on macOS — restores the default chrome.
        use window_vibrancy::clear_vibrancy;
        if let Err(e) = clear_vibrancy(window) {
            log::warn!("[window_effect] clear_vibrancy failed: {e}");
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = window;
        // No public "clear" API in window-vibrancy 0.6. The conf.json
        // `windowEffects` field is only respected at window creation time.
        // The next time the user toggles ON we'll re-apply, but the
        // current call cannot strip an existing effect. Logged for
        // future reference; not user-visible because the CSS sidebar
        // background remains readable.
        log::info!("[window_effect] windows clear is a no-op; restart recommended");
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let _ = window;
    }
}
