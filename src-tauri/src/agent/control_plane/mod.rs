//! Runtime Control Plane orchestrator.

pub mod adapter;
pub mod adapters;
pub mod config_transaction;
pub mod config_watcher;
pub mod redaction;
pub mod state;

pub use config_watcher::ConfigWatchEvent;

use crate::agent::control_plane::adapters::{adapter_for_id, all_adapters};
use crate::agent::control_plane::config_transaction::{
    ConfigTransactionPreview, ConfigTransactionResult,
};
use crate::agent::control_plane::config_watcher::ConfigWatcher;
use crate::agent::control_plane::state::RuntimeSnapshot;
use crate::agent::hub::{RuntimeDescriptor, RuntimeDiagnosis, RuntimeHealth, RuntimeVersion};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

const SNAPSHOT_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeControlPlaneList {
    pub runtimes: Vec<RuntimeSnapshot>,
    pub default_runtime_id: String,
    pub fetched_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHubHealthResponse {
    pub runtime_id: String,
    pub health: RuntimeHealth,
    pub snapshot: RuntimeSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHubDiagnoseResponse {
    pub runtime_id: String,
    pub diagnosis: RuntimeDiagnosis,
    pub health: RuntimeHealth,
}

struct CachedSnapshot {
    snapshot: RuntimeSnapshot,
    fetched_at: Instant,
}

pub struct RuntimeControlPlane {
    default_runtime_id: RwLock<String>,
    cache: Mutex<HashMap<String, CachedSnapshot>>,
    watcher: ConfigWatcher,
}

impl Default for RuntimeControlPlane {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeControlPlane {
    pub fn new() -> Self {
        Self {
            default_runtime_id: RwLock::new("claude-code".to_string()),
            cache: Mutex::new(HashMap::new()),
            watcher: ConfigWatcher::new(),
        }
    }

    pub fn list(&self, force: bool) -> RuntimeControlPlaneList {
        let adapters = all_adapters();
        let mut runtimes = Vec::with_capacity(adapters.len());
        for adapter in adapters {
            runtimes.push(self.snapshot_for(adapter.as_ref(), force));
        }
        let default_runtime_id = self
            .default_runtime_id
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "claude-code".to_string());
        RuntimeControlPlaneList {
            fetched_at_ms: state::now_ms(),
            runtimes,
            default_runtime_id,
        }
    }

    pub fn health(
        &self,
        runtime_id: &str,
        force: bool,
    ) -> Result<RuntimeHubHealthResponse, String> {
        let adapter =
            adapter_for_id(runtime_id).ok_or_else(|| format!("unknown runtime: {}", runtime_id))?;
        let snapshot = self.snapshot_for(adapter.as_ref(), force);
        Ok(RuntimeHubHealthResponse {
            runtime_id: runtime_id.to_string(),
            health: snapshot.health.clone(),
            snapshot,
        })
    }

    pub fn diagnose(&self, runtime_id: &str) -> Result<RuntimeHubDiagnoseResponse, String> {
        let adapter =
            adapter_for_id(runtime_id).ok_or_else(|| format!("unknown runtime: {}", runtime_id))?;
        let snapshot = self.snapshot_for(adapter.as_ref(), true);
        let diagnosis = snapshot
            .diagnosis
            .clone()
            .or(snapshot.health.last_diagnosis.clone())
            .ok_or_else(|| "no diagnosis available".to_string())?;
        Ok(RuntimeHubDiagnoseResponse {
            runtime_id: runtime_id.to_string(),
            diagnosis,
            health: snapshot.health,
        })
    }

    pub fn set_default(&self, runtime_id: &str) -> Result<String, String> {
        let adapter =
            adapter_for_id(runtime_id).ok_or_else(|| format!("unknown runtime: {}", runtime_id))?;
        let snapshot = adapter.probe();
        if !snapshot.installed {
            return Err(format!("runtime {} is not installed", runtime_id));
        }
        let mut guard = self
            .default_runtime_id
            .write()
            .map_err(|e| format!("lock default: {}", e))?;
        *guard = runtime_id.to_string();
        Ok(runtime_id.to_string())
    }

    pub fn get_default(&self) -> String {
        self.default_runtime_id
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "claude-code".to_string())
    }

    pub fn preview_config(
        &self,
        runtime_id: &str,
        patch: Value,
    ) -> Result<ConfigTransactionPreview, String> {
        let adapter =
            adapter_for_id(runtime_id).ok_or_else(|| format!("unknown runtime: {}", runtime_id))?;
        adapter.preview_config_change(&patch)
    }

    pub fn apply_config(
        &self,
        runtime_id: &str,
        patch: Value,
    ) -> Result<ConfigTransactionResult, String> {
        let adapter =
            adapter_for_id(runtime_id).ok_or_else(|| format!("unknown runtime: {}", runtime_id))?;
        let result = adapter.apply_config_change(&patch)?;
        if result.success {
            self.invalidate(runtime_id);
        }
        Ok(result)
    }

    pub fn watch_config(
        &self,
        runtime_id: &str,
        callback: Arc<dyn Fn(ConfigWatchEvent) + Send + Sync>,
    ) -> Result<u64, String> {
        let adapter =
            adapter_for_id(runtime_id).ok_or_else(|| format!("unknown runtime: {}", runtime_id))?;
        self.watcher
            .watch(runtime_id, adapter.config_paths(), None, callback)
    }

    pub fn unwatch_config(&self, runtime_id: &str) -> bool {
        self.watcher.unwatch(runtime_id)
    }

    pub fn descriptor_for(&self, runtime_id: &str) -> Option<RuntimeDescriptor> {
        let adapter = adapter_for_id(runtime_id)?;
        let snapshot = adapter.probe();
        let version = snapshot.version.as_deref().and_then(parse_runtime_version);
        Some(RuntimeDescriptor::local(
            adapter.runtime_id(),
            adapter.kind(),
            crate::models::RuntimeProtocolKind::StreamJson,
            snapshot.binary_path.clone().unwrap_or_default(),
            version.unwrap_or(RuntimeVersion::Unknown),
            adapter.capabilities(),
            default_launch_spec(),
        ))
    }

    fn snapshot_for(&self, adapter: &dyn adapter::RuntimeAdapter, force: bool) -> RuntimeSnapshot {
        let id = adapter.runtime_id().to_string();
        if !force {
            if let Ok(cache) = self.cache.lock() {
                if let Some(entry) = cache.get(&id) {
                    if entry.fetched_at.elapsed() < SNAPSHOT_TTL {
                        let mut snap = entry.snapshot.clone();
                        snap.stale = entry.fetched_at.elapsed() > SNAPSHOT_TTL / 2;
                        return snap;
                    }
                }
            }
        }

        let snapshot = adapter.probe();
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(
                id,
                CachedSnapshot {
                    snapshot: snapshot.clone(),
                    fetched_at: Instant::now(),
                },
            );
        }
        snapshot
    }

    fn invalidate(&self, runtime_id: &str) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.remove(runtime_id);
        }
        let _ = self.watcher.bump_generation(runtime_id);
    }
}

fn parse_runtime_version(raw: &str) -> Option<RuntimeVersion> {
    let nums: Vec<u32> = raw
        .trim_start_matches('v')
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();
    match nums.as_slice() {
        [major, minor, patch] => Some(RuntimeVersion::Known {
            major: *major,
            minor: *minor,
            patch: *patch,
        }),
        [major, minor] => Some(RuntimeVersion::Known {
            major: *major,
            minor: *minor,
            patch: 0,
        }),
        _ => None,
    }
}

fn default_launch_spec() -> crate::agent::hub::RuntimeLaunchSpec {
    use crate::agent::hub::{AuthCheckSpec, CwdPolicy, HealthCheckSpec, RuntimeLaunchSpec};
    use std::collections::BTreeMap;
    RuntimeLaunchSpec {
        binary: String::new(),
        base_args: vec![],
        env: BTreeMap::new(),
        cwd_policy: CwdPolicy::ProjectRoot,
        spawn_timeout: Duration::from_secs(30),
        health_check: HealthCheckSpec {
            probe_args: vec!["--version".to_string()],
            probe_timeout: Duration::from_secs(10),
            min_version: None,
            auth_check: AuthCheckSpec::Noop,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_includes_all_five_runtimes() {
        let plane = RuntimeControlPlane::new();
        let list = plane.list(true);
        assert_eq!(list.runtimes.len(), 5);
        let ids: Vec<_> = list
            .runtimes
            .iter()
            .map(|r| r.runtime_id.as_str())
            .collect();
        assert!(ids.contains(&"claude-code"));
        assert!(ids.contains(&"codex"));
        assert!(ids.contains(&"mimo-code"));
        assert!(ids.contains(&"opencode"));
        assert!(ids.contains(&"cursor-agent"));
    }

    use crate::agent::control_plane::state::CapabilityField;

    #[test]
    fn unsupported_capability_is_typed_not_empty_array() {
        let plane = RuntimeControlPlane::new();
        let list = plane.list(true);
        let codex = list
            .runtimes
            .iter()
            .find(|r| r.runtime_id == "codex")
            .expect("codex");
        match &codex.mcp {
            CapabilityField::Unsupported { capability } => {
                assert_eq!(capability, "supports_mcp");
            }
            CapabilityField::Supported { value } => {
                assert!(value.is_empty(), "must not fake empty arrays");
                panic!("expected unsupported");
            }
        }
    }
}
