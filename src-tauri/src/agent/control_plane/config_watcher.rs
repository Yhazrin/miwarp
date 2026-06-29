//! Config file watcher with debounce, single-flight, and generation guards.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

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

/// Pending debounce state for one entry: the worker wakes at `deadline`, then
/// fires `callback` IF `pending_generation == generation` at wake time. After
/// firing (or if generation mismatched), the worker goes back to waiting for a
/// new deadline. `None` means no pending event.
struct WatchEntry {
    paths: Vec<PathBuf>,
    debounce_ms: u64,
    callback: WatchCallback,
    generation: Arc<AtomicU64>,
    pending_generation: Arc<AtomicU64>,
    /// Shared between the event handler and the per-entry debounce worker thread.
    debounce_state: Arc<(Mutex<Option<DebouncePlan>>, Condvar)>,
    /// Worker thread join handle (set once at watch time).
    debounce_handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    /// Set to true when the entry is removed so the worker exits.
    shutdown: Arc<AtomicBool>,
}

#[derive(Clone)]
struct DebouncePlan {
    deadline: Instant,
    config_path: Option<String>,
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
        let debounce_state = Arc::new((Mutex::new(None), Condvar::new()));
        let debounce_handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>> =
            Arc::new(Mutex::new(None));
        let shutdown = Arc::new(AtomicBool::new(false));

        // Spawn the single persistent debounce worker for this entry.
        spawn_debounce_worker(
            runtime_id.clone(),
            generation.clone(),
            pending_generation.clone(),
            debounce_state.clone(),
            callback.clone(),
            shutdown.clone(),
            debounce_handle.clone(),
        );

        let entry = WatchEntry {
            paths: paths.clone(),
            debounce_ms,
            callback,
            generation: generation.clone(),
            pending_generation: pending_generation.clone(),
            debounce_state,
            debounce_handle,
            shutdown,
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
            entry.shutdown.store(true, Ordering::SeqCst);
            entry.debounce_state.1.notify_all();
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
                entry.shutdown.store(true, Ordering::SeqCst);
                entry.debounce_state.1.notify_all();
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
                        entry.debounce_state.clone(),
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

/// Spawn the single persistent debounce worker for an entry. One thread per
/// entry — bounded regardless of event rate. The worker loops until `shutdown`
/// is set: wait for a new deadline, fire the callback if generation still matches.
fn spawn_debounce_worker(
    runtime_id: String,
    generation: Arc<AtomicU64>,
    pending_generation: Arc<AtomicU64>,
    debounce_state: Arc<(Mutex<Option<DebouncePlan>>, Condvar)>,
    callback: WatchCallback,
    shutdown: Arc<AtomicBool>,
    debounce_handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
) {
    if let Ok(mut slot) = debounce_handle.lock() {
        if slot.is_some() {
            return; // Worker already spawned.
        }
        let handle = std::thread::spawn(move || {
            let (lock, cvar) = debounce_state.as_ref();
            loop {
                if shutdown.load(Ordering::SeqCst) {
                    return;
                }

                // Phase 1: wait until a deadline is scheduled. Wake on every
                // notify so we can re-check shutdown.
                let deadline = {
                    let mut state = lock.lock().unwrap_or_else(|p| p.into_inner());
                    loop {
                        if shutdown.load(Ordering::SeqCst) {
                            return;
                        }
                        if let Some(plan) = state.as_ref() {
                            break plan.deadline;
                        }
                        state = cvar.wait(state).unwrap_or_else(|p| p.into_inner());
                    }
                };

                // Phase 2: sleep until the deadline, but wake early if a newer
                // event arrives (which sets a later deadline) or shutdown is set.
                let plan = {
                    let mut state = lock.lock().unwrap_or_else(|p| p.into_inner());
                    loop {
                        if shutdown.load(Ordering::SeqCst) {
                            return;
                        }
                        let now = Instant::now();
                        match state.as_ref() {
                            Some(p) if p.deadline > now && p.deadline == deadline => {
                                let remaining = p.deadline - now;
                                let (g, _) = cvar.wait_timeout(state, remaining).unwrap();
                                state = g;
                            }
                            _ => break,
                        }
                    }
                    // Pop the plan (if it still matches our deadline — otherwise
                    // a newer event has superseded it and we loop back to phase 1).
                    match state.as_ref() {
                        Some(p) if p.deadline == deadline => state.take(),
                        _ => None,
                    }
                };

                // Phase 3: fire the callback if the generation still matches.
                let Some(plan) = plan else {
                    continue;
                };
                let current = generation.load(Ordering::SeqCst);
                let scheduled = pending_generation.load(Ordering::SeqCst);
                if scheduled != current {
                    continue;
                }
                callback(ConfigWatchEvent {
                    runtime_id: runtime_id.clone(),
                    config_path: plan.config_path.unwrap_or_default(),
                    generation: current,
                    reason: "config_changed".to_string(),
                });
            }
        });
        *slot = Some(handle);
    }
}

fn schedule_debounce(
    _runtime_id: String,
    debounce_ms: u64,
    generation: Arc<AtomicU64>,
    pending_generation: Arc<AtomicU64>,
    debounce_state: Arc<(Mutex<Option<DebouncePlan>>, Condvar)>,
    _callback: WatchCallback,
    config_path: Option<String>,
) {
    // Record the current generation as pending. Generation is only advanced
    // externally via `bump_generation` (which marks the previous debounce stale).
    let gen = generation.load(Ordering::SeqCst);
    pending_generation.store(gen, Ordering::SeqCst);

    let (lock, cvar) = debounce_state.as_ref();
    if let Ok(mut state) = lock.lock() {
        *state = Some(DebouncePlan {
            deadline: Instant::now() + Duration::from_millis(debounce_ms),
            config_path,
        });
        drop(state);
        cvar.notify_all();
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
        let state: Arc<(Mutex<Option<DebouncePlan>>, Condvar)> =
            Arc::new((Mutex::new(None), Condvar::new()));
        let handle_slot: Arc<Mutex<Option<std::thread::JoinHandle<()>>>> =
            Arc::new(Mutex::new(None));
        let shutdown = Arc::new(AtomicBool::new(false));

        spawn_debounce_worker(
            "claude-code".to_string(),
            generation.clone(),
            pending.clone(),
            state.clone(),
            Arc::new(move |_| {
                fired_cb.fetch_add(1, Ordering::SeqCst);
            }),
            shutdown.clone(),
            handle_slot.clone(),
        );

        // Simulate an in-flight scheduling: set pending = gen, then bump
        // generation before the deadline — the worker must skip the callback.
        pending.store(generation.load(Ordering::SeqCst), Ordering::SeqCst);
        generation.fetch_add(1, Ordering::SeqCst);
        let (lock, cvar) = state.as_ref();
        {
            let mut s = lock.lock().unwrap();
            *s = Some(DebouncePlan {
                deadline: Instant::now() + Duration::from_millis(50),
                config_path: Some("/tmp/settings.json".to_string()),
            });
            cvar.notify_all();
        }

        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(fired.load(Ordering::SeqCst), 0);

        shutdown.store(true, Ordering::SeqCst);
        cvar.notify_all();
        let handle = handle_slot.lock().unwrap().take();
        if let Some(h) = handle {
            let _ = h.join();
        }
    }
}
