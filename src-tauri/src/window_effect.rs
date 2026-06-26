//! Apply native window-level blur/vibrancy effects for the main window.
//!
//! - macOS: NSVisualEffectMaterial on the whole window so the left
//!   sidebar can show desktop content through the chrome. Material is
//!   user-selectable: `sidebar` (default, heavier frost) or `header_view`
//!   (lighter). CSS perf tiers add a complementary backdrop blur on top.
//! - Windows: mica (preferred), acrylic (fallback), blur (last resort).
//! - Linux / unsupported: no-op; CSS `backdrop-filter` still gives a
//!   pleasant glass look in the fallback layer.
//!
//! The effect can be toggled at runtime via the
//! `native_window_glass_enabled` user setting. Re-apply on toggle by
//! calling [`apply_for_setting`].

use tauri::{Manager, WebviewWindow};

/// Apply (or clear) the native blur effect for the main window based on
/// the saved `native_window_glass_enabled` and
/// `native_window_glass_material` settings. Safe to call from setup or
/// after settings change; never panics, only logs.
pub fn apply_for_setting<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let s = crate::storage::settings::get_user_settings();
    if let Some(window) = app.get_webview_window("main") {
        apply_to_window(
            &window,
            s.native_window_glass_enabled,
            &s.native_window_glass_material,
        );
    }
}

/// Apply or clear the effect on a specific window. When `enabled` is
/// false the effect is reset to the OS default (solid background). The
/// `material` arg is one of `header_view` (default) or `sidebar` and is
/// only consulted on macOS.
pub fn apply_to_window<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
    material: &str,
) {
    if !enabled {
        clear(window);
        return;
    }
    match apply(window, material) {
        Ok(()) => log::info!("[window_effect] native blur applied (material={material})"),
        Err(e) => log::warn!("[window_effect] failed to apply blur: {e}"),
    }
}

// `material` is only consulted on macOS (sidebar vs header-view vibrancy).
// Other platforms ignore it; silence the unused-variable warning rather
// than invent a fake use-site.
#[allow(unused_variables)]
fn apply<R: tauri::Runtime>(window: &WebviewWindow<R>, material: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        // `sidebar` is the default — traditional material (~30–40px blur).
        // `header_view` is lighter (~15–20px) for users who want less frost.
        let mat = match material {
            "header_view" => NSVisualEffectMaterial::HeaderView,
            _ => NSVisualEffectMaterial::Sidebar,
        };
        apply_vibrancy(window, mat, Some(NSVisualEffectState::Active), None)
            .map_err(|e| e.to_string())
    }

    #[cfg(target_os = "windows")]
    {
        // Prefer mica (Win11). Fall back to acrylic (Win10 1903+) and
        // then plain blur if neither is available.
        // Color is RGBA (u8, u8, u8, u8) — (0,0,0,0) is fully transparent
        // so the CSS sidebar surface shows through with the OS blur on top.
        use window_vibrancy::apply_mica;
        if apply_mica(window, Some(false)).is_ok() {
            return Ok(());
        }
        use window_vibrancy::apply_acrylic;
        if apply_acrylic(window, Some((0, 0, 0, 0))).is_ok() {
            return Ok(());
        }
        use window_vibrancy::apply_blur;
        apply_blur(window, Some((0, 0, 0, 0))).map_err(|e| e.to_string())
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let _ = window;
        let _ = material;
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
