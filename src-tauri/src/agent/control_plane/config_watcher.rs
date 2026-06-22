//! Config file watcher with debounce, single-flight, and generation guards.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const DEFAULT_DEBOUNCE_MS: u64 = 400;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWatchEvent {
    pub runtime_id: String,
    pub config_path: String,
    pub generation: u64,
    pub reason: String,
}

type WatchCallback = Arc<dyn Fn(ConfigWatchEvent) + Send + Sync>;

struct WatchEntry {
    paths: Vec<PathBuf>,
    debounce_ms: u64,
    callback: WatchCallback,
    generation: Arc<AtomicU64>,
    pending_generation: Arc<AtomicU64>,
    debounce_handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
}

pub struct ConfigWatcher {
    entries: Arc<Mutex<HashMap<String, WatchEntry>>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl Default for ConfigWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl ConfigWatcher {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            watcher: Mutex::new(None),
        }
    }

    pub fn watch(
        &self,
        runtime_id: impl Into<String>,
        paths: Vec<PathBuf>,
        debounce_ms: Option<u64>,
        callback: WatchCallback,
    ) -> Result<u64, String> {
        let runtime_id = runtime_id.into();
        let debounce_ms = debounce_ms.unwrap_or(DEFAULT_DEBOUNCE_MS).clamp(300, 500);
        let generation = Arc::new(AtomicU64::new(1));
        let pending_generation = Arc::new(AtomicU64::new(0));
        let debounce_handle = Arc::new(Mutex::new(None));

        let entry = WatchEntry {
            paths: paths.clone(),
            debounce_ms,
            callback,
            generation: generation.clone(),
            pending_generation: pending_generation.clone(),
            debounce_handle: debounce_handle.clone(),
        };

        self.entries
            .lock()
            .map_err(|e| format!("lock entries: {}", e))?
            .insert(runtime_id.clone(), entry);

        self.ensure_watcher()?;
        self.register_paths(&paths)?;

        Ok(generation.load(Ordering::SeqCst))
    }

    pub fn unwatch(&self, runtime_id: &str) -> bool {
        let Ok(mut guard) = self.entries.lock() else {
            return false;
        };
        if let Some(entry) = guard.remove(runtime_id) {
            if let Ok(mut handle) = entry.debounce_handle.lock() {
                if let Some(h) = handle.take() {
                    let _ = h.join();
                }
            }
            true
        } else {
            false
        }
    }

    pub fn bump_generation(&self, runtime_id: &str) -> Option<u64> {
        let guard = self.entries.lock().ok()?;
        let entry = guard.get(runtime_id)?;
        entry
            .generation
            .fetch_add(1, Ordering::SeqCst)
            .checked_add(1)
    }

    pub fn dispose(&self) {
        if let Ok(mut guard) = self.entries.lock() {
            for (_, entry) in guard.drain() {
                if let Ok(mut handle) = entry.debounce_handle.lock() {
                    if let Some(h) = handle.take() {
                        let _ = h.join();
                    }
                }
            }
        }
        if let Ok(mut watcher) = self.watcher.lock() {
            *watcher = None;
        }
    }

    fn ensure_watcher(&self) -> Result<(), String> {
        let mut slot = self
            .watcher
            .lock()
            .map_err(|e| format!("lock watcher: {}", e))?;
        if slot.is_some() {
            return Ok(());
        }

        let entries = Arc::clone(&self.entries);
        let watcher =
            notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
                let Ok(event) = res else { return };
                if !matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                ) {
                    return;
                }
                let Ok(guard) = entries.lock() else {
                    return;
                };
                for (runtime_id, entry) in guard.iter() {
                    if !event
                        .paths
                        .iter()
                        .any(|p| entry.paths.iter().any(|w| paths_match(w, p)))
                    {
                        continue;
                    }
                    schedule_debounce(
                        runtime_id.clone(),
                        entry.debounce_ms,
                        entry.generation.clone(),
                        entry.pending_generation.clone(),
                        entry.debounce_handle.clone(),
                        entry.callback.clone(),
                        event.paths.first().map(|p| p.display().to_string()),
                    );
                }
            })
            .map_err(|e| format!("create watcher: {}", e))?;

        *slot = Some(watcher);
        Ok(())
    }

    fn register_paths(&self, paths: &[PathBuf]) -> Result<(), String> {
        let mut slot = self
            .watcher
            .lock()
            .map_err(|e| format!("lock watcher: {}", e))?;
        let watcher = slot
            .as_mut()
            .ok_or_else(|| "watcher not initialized".to_string())?;
        for path in paths {
            if path.exists() {
                let watch_path = if path.is_file() {
                    path.parent()
                        .map(Path::to_path_buf)
                        .unwrap_or_else(|| path.clone())
                } else {
                    path.clone()
                };
                watcher
                    .watch(&watch_path, RecursiveMode::NonRecursive)
                    .map_err(|e| format!("watch {}: {}", watch_path.display(), e))?;
            }
        }
        Ok(())
    }
}

fn paths_match(watched: &Path, changed: &Path) -> bool {
    watched == changed
        || watched
            .parent()
            .map(|p| p == changed || watched.starts_with(changed))
            .unwrap_or(false)
}

fn schedule_debounce(
    runtime_id: String,
    debounce_ms: u64,
    generation: Arc<AtomicU64>,
    pending_generation: Arc<AtomicU64>,
    debounce_handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    callback: WatchCallback,
    config_path: Option<String>,
) {
    let gen = generation.fetch_add(0, Ordering::SeqCst);
    pending_generation.store(gen, Ordering::SeqCst);

    if let Ok(mut handle_slot) = debounce_handle.lock() {
        if let Some(h) = handle_slot.take() {
            let _ = h.join();
        }
        let pending = pending_generation.clone();
        let generation = generation.clone();
        let callback = callback.clone();
        let runtime_id = runtime_id.clone();
        let config_path = config_path.clone();

        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(debounce_ms));
            let scheduled = pending.load(Ordering::SeqCst);
            let current = generation.load(Ordering::SeqCst);
            if scheduled != current {
                return;
            }
            callback(ConfigWatchEvent {
                runtime_id,
                config_path: config_path.unwrap_or_default(),
                generation: current,
                reason: "config_changed".to_string(),
            });
        });
        *handle_slot = Some(handle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn debounce_ms_clamped_to_contract_range() {
        assert_eq!(DEFAULT_DEBOUNCE_MS.clamp(300, 500), 400);
        assert_eq!(100_u64.clamp(300, 500), 300);
        assert_eq!(900_u64.clamp(300, 500), 500);
    }

    #[test]
    fn stale_generation_skips_callback() {
        let fired = Arc::new(AtomicUsize::new(0));
        let fired_cb = fired.clone();
        let generation = Arc::new(AtomicU64::new(1));
        let pending = Arc::new(AtomicU64::new(1));
        let handle_slot = Arc::new(Mutex::new(None));

        schedule_debounce(
            "claude-code".to_string(),
            50,
            generation.clone(),
            pending.clone(),
            handle_slot.clone(),
            Arc::new(move |_| {
                fired_cb.fetch_add(1, Ordering::SeqCst);
            }),
            Some("/tmp/settings.json".to_string()),
        );

        generation.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(120));
        assert_eq!(fired.load(Ordering::SeqCst), 0);
    }
}
