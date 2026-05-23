use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundConfig {
    pub image_url: String,
    pub opacity: u8,           // 0-100
    pub blur: u8,              // 0-50
    pub position_x: u8,        // 0-100 percentage
    pub position_y: u8,        // 0-100 percentage
    pub sizing_mode: String,   // stretch|fill|fit|tile|cover
    pub color_overlay: String, // hex color
    pub scope: String,         // global|session
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundSettings {
    pub global: BackgroundConfig,
    pub per_session: HashMap<String, BackgroundConfig>,
}

impl Default for BackgroundConfig {
    fn default() -> Self {
        Self {
            image_url: String::new(),
            opacity: 30,
            blur: 0,
            position_x: 50,
            position_y: 50,
            sizing_mode: "cover".to_string(),
            color_overlay: String::new(),
            scope: "global".to_string(),
        }
    }
}

fn settings_path() -> PathBuf {
    crate::storage::data_dir().join("background-settings.json")
}

fn load() -> BackgroundSettings {
    let path = settings_path();
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(settings) => {
                    log::debug!(
                        "[storage/background] loaded settings from {}",
                        path.display()
                    );
                    return settings;
                }
                Err(e) => {
                    log::warn!("[storage/background] failed to parse settings: {}", e);
                }
            },
            Err(e) => {
                log::warn!("[storage/background] failed to read settings: {}", e);
            }
        }
    }
    log::debug!("[storage/background] using default settings");
    let defaults = BackgroundSettings::default();
    let _ = save(&defaults);
    defaults
}

fn save(settings: &BackgroundSettings) -> Result<(), String> {
    log::debug!("[storage/background] saving settings");
    let path = settings_path();
    crate::storage::ensure_dir(path.parent().ok_or("settings path has no parent")?)
        .map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, &json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_background_settings() -> BackgroundSettings {
    log::debug!("[background] get_background_settings");
    load()
}

#[tauri::command]
pub fn set_background_global(config: BackgroundConfig) -> Result<(), String> {
    log::debug!("[background] set_background_global");
    let mut settings = load();
    settings.global = config;
    save(&settings)
}

#[tauri::command]
pub fn set_background_session(session_id: String, config: BackgroundConfig) -> Result<(), String> {
    log::debug!(
        "[background] set_background_session: session_id={}",
        session_id
    );
    let mut settings = load();
    settings.per_session.insert(session_id, config);
    save(&settings)
}

#[tauri::command]
pub fn clear_background_session(session_id: String) -> Result<(), String> {
    log::debug!(
        "[background] clear_background_session: session_id={}",
        session_id
    );
    let mut settings = load();
    settings.per_session.remove(&session_id);
    save(&settings)
}

#[tauri::command]
pub async fn pick_background_image(app: tauri::AppHandle) -> Result<String, String> {
    log::debug!("[background] pick_background_image");
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .add_filter(
            "Images",
            &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
        )
        .pick_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    match rx.recv() {
        Ok(Some(path)) => {
            let path_str = path.to_string();
            log::debug!("[background] picked file: {}", path_str);
            Ok(path_str)
        }
        Ok(None) => {
            log::debug!("[background] file picker cancelled");
            Err("File selection cancelled".to_string())
        }
        Err(e) => {
            log::error!("[background] file picker channel error: {}", e);
            Err("File picker failed".to_string())
        }
    }
}
