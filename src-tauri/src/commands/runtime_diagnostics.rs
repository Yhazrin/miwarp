//! Runtime diagnostics Tauri commands.
//!
//! Exposes the diagnostic ring buffer to the frontend via five
//! IPC commands: snapshot, summary, preview, export, clear.
//! All commands access the `DiagnosticObserverImpl` through a
//! global singleton initialized in app setup.

use crate::diagnostics::{
    build_manifest, default_export_path, estimate_export_size, validate_export_path,
    DiagnosticCategory, DiagnosticEvent, DiagnosticExportError, DiagnosticExportOutput,
    DiagnosticObserver, DiagnosticObserverImpl, DiagnosticSeverity, ExportTimeRange,
    MAX_EXPORT_BYTES,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

/// Summary view for the diagnostics panel — aggregated counts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DiagnosticsSummary {
    pub total_events: usize,
    pub capacity: usize,
    pub by_category: std::collections::HashMap<String, usize>,
    pub by_severity: std::collections::HashMap<String, usize>,
    pub error_count: usize,
    pub warn_count: usize,
    pub recent_errors: Vec<DiagnosticEvent>,
    pub recovery_count: usize,
    pub permission_fail_count: usize,
    pub send_fail_count: usize,
}

/// Filter for snapshot queries.
#[derive(Debug, Clone, Deserialize)]
pub struct DiagnosticsFilter {
    #[serde(default)]
    pub from_ms: Option<u64>,
    #[serde(default)]
    pub to_ms: Option<u64>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub runtime_id: Option<String>,
    #[serde(default, rename = "limit")]
    pub max_events: Option<usize>,
}

/// Export request parameters.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct DiagnosticsExportRequest {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub overwrite: bool,
    #[serde(default)]
    pub from_ms: Option<u64>,
    #[serde(default)]
    pub to_ms: Option<u64>,
    #[serde(default)]
    pub max_events: Option<usize>,
}

/// Result of an export or preview operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct DiagnosticsExportResult {
    pub success: bool,
    pub path: String,
    pub event_count: usize,
    pub truncated: bool,
    pub file_size_bytes: usize,
}

/// Preview of what an export would contain, without writing to disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct DiagnosticsPreviewResult {
    pub event_count: usize,
    pub estimated_bytes: usize,
    pub truncated: bool,
    pub manifest: crate::diagnostics::DiagnosticExportManifest,
}

// ── Helpers ──

fn matches_filter(event: &DiagnosticEvent, filter: &DiagnosticsFilter) -> bool {
    if let Some(ref cat) = filter.category {
        let cat_str = serde_json::to_string(&event.category)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        if &cat_str != cat {
            return false;
        }
    }
    if let Some(ref sev) = filter.severity {
        let sev_str = serde_json::to_string(&event.severity)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        if &sev_str != sev {
            return false;
        }
    }
    if let Some(ref sid) = filter.session_id {
        match &event.session_id {
            Some(s) if s == sid => {}
            _ => return false,
        }
    }
    if let Some(ref rid) = filter.runtime_id {
        match &event.runtime_id {
            Some(r) if r == rid => {}
            _ => return false,
        }
    }
    true
}

// ── Commands ──

/// Snapshot the diagnostics buffer with optional filters.
#[tauri::command]
pub async fn diagnostics_snapshot(
    filter: Option<DiagnosticsFilter>,
) -> Result<Vec<DiagnosticEvent>, String> {
    let observer = get_global_observer().ok_or("diagnostics not initialized")?;

    let events = if let Some(ref f) = filter {
        observer.snapshot_range(f.from_ms, f.to_ms).await
    } else {
        observer.snapshot().await
    };

    let mut result: Vec<DiagnosticEvent> = events
        .into_iter()
        .filter(|e| {
            if let Some(ref f) = filter {
                matches_filter(e, f)
            } else {
                true
            }
        })
        .collect();

    if let Some(limit) = filter.as_ref().and_then(|f| f.max_events) {
        result.truncate(limit);
    }

    Ok(result)
}

/// Get an aggregated summary of diagnostics state.
#[tauri::command]
pub async fn diagnostics_summary() -> Result<DiagnosticsSummary, String> {
    let observer = get_global_observer().ok_or("diagnostics not initialized")?;
    let events = observer.snapshot().await;

    let mut by_category = std::collections::HashMap::new();
    let mut by_severity = std::collections::HashMap::new();
    let mut error_count = 0usize;
    let mut warn_count = 0usize;
    let mut recovery_count = 0usize;
    let mut permission_fail_count = 0usize;
    let mut send_fail_count = 0usize;

    for e in &events {
        let cat = serde_json::to_string(&e.category)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let sev = serde_json::to_string(&e.severity)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();

        *by_category.entry(cat).or_insert(0) += 1;
        *by_severity.entry(sev).or_insert(0) += 1;

        match e.severity {
            DiagnosticSeverity::Error => error_count += 1,
            DiagnosticSeverity::Warn => warn_count += 1,
            _ => {}
        }

        match e.category {
            DiagnosticCategory::Recovery => recovery_count += 1,
            DiagnosticCategory::PermissionTx if e.severity == DiagnosticSeverity::Error => {
                permission_fail_count += 1;
            }
            DiagnosticCategory::SendTx if e.severity == DiagnosticSeverity::Error => {
                send_fail_count += 1;
            }
            _ => {}
        }
    }

    let mut recent_errors: Vec<DiagnosticEvent> = events
        .iter()
        .filter(|e| e.severity == DiagnosticSeverity::Error)
        .cloned()
        .collect();
    recent_errors.reverse();
    recent_errors.truncate(10);

    Ok(DiagnosticsSummary {
        total_events: events.len(),
        capacity: observer.capacity(),
        by_category,
        by_severity,
        error_count,
        warn_count,
        recent_errors,
        recovery_count,
        permission_fail_count,
        send_fail_count,
    })
}

/// Preview what an export would contain without writing to disk.
#[tauri::command]
pub async fn diagnostics_preview(
    request: Option<DiagnosticsExportRequest>,
) -> Result<DiagnosticsPreviewResult, String> {
    let observer = get_global_observer().ok_or("diagnostics not initialized")?;
    let req = request.unwrap_or_default();
    let events = observer.snapshot_range(req.from_ms, req.to_ms).await;

    let mut events = events;
    if let Some(limit) = req.max_events {
        events.truncate(limit);
    }

    let all_count = events.len();
    let estimated = estimate_export_size(&events);
    let truncated = estimated > MAX_EXPORT_BYTES;
    let included = if truncated {
        // Binary search for how many fit
        let mut lo = 0;
        let mut hi = all_count;
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            let slice = &events[..mid];
            match serde_json::to_vec(slice) {
                Ok(bytes) if bytes.len() <= MAX_EXPORT_BYTES => lo = mid,
                _ => hi = mid - 1,
            }
        }
        lo
    } else {
        all_count
    };

    let time_range = if !events.is_empty() {
        Some(ExportTimeRange {
            from_ms: events.first().unwrap().timestamp_ms,
            to_ms: events.last().unwrap().timestamp_ms,
        })
    } else {
        None
    };

    let manifest = build_manifest(&events[..included], all_count, truncated, time_range);

    Ok(DiagnosticsPreviewResult {
        event_count: included,
        estimated_bytes: if truncated {
            estimate_export_size(&events[..included])
        } else {
            estimated
        },
        truncated,
        manifest,
    })
}

/// Export diagnostics to a JSON file with manifest. Writes atomically
/// (temp file + rename) and validates path safety.
#[tauri::command]
pub async fn diagnostics_export(
    request: Option<DiagnosticsExportRequest>,
) -> Result<DiagnosticsExportResult, String> {
    let observer = get_global_observer().ok_or("diagnostics not initialized")?;
    let req = request.unwrap_or_default();
    let events = observer.snapshot_range(req.from_ms, req.to_ms).await;

    let mut events = events;
    if let Some(limit) = req.max_events {
        events.truncate(limit);
    }

    let all_count = events.len();

    let path = match req.path {
        Some(p) => PathBuf::from(p),
        None => default_export_path(),
    };

    let allowed_base = crate::storage::data_dir();
    let safe_path = validate_export_path(&path, &allowed_base).map_err(|e| e.to_string())?;

    let (_bytes, truncated, omitted) =
        crate::diagnostics::export::serialize_events_bounded(&events, MAX_EXPORT_BYTES);

    if truncated && omitted == all_count {
        return Err(DiagnosticExportError::TooLarge {
            estimated_bytes: estimate_export_size(&events),
            limit: MAX_EXPORT_BYTES,
        }
        .to_string());
    }

    let included_count = all_count - omitted;

    let time_range = if !events.is_empty() {
        let included = &events[..included_count];
        Some(ExportTimeRange {
            from_ms: included.first().unwrap().timestamp_ms,
            to_ms: included.last().unwrap().timestamp_ms,
        })
    } else {
        None
    };

    let manifest = build_manifest(&events[..included_count], all_count, truncated, time_range);

    let output = DiagnosticExportOutput {
        manifest: manifest.clone(),
        events: events[..included_count].to_vec(),
    };
    let json = serde_json::to_vec_pretty(&output)
        .map_err(|e| DiagnosticExportError::SerializeError(e.to_string()).to_string())?;

    if safe_path.exists() && !req.overwrite {
        return Err(DiagnosticExportError::FileExists {
            path: safe_path.display().to_string(),
        }
        .to_string());
    }

    // Atomic write: write to temp file in same dir, then rename
    if let Some(parent) = safe_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| DiagnosticExportError::IoError(e.to_string()).to_string())?;
    }

    let tmp_path = safe_path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json)
        .map_err(|e| DiagnosticExportError::IoError(e.to_string()).to_string())?;
    std::fs::rename(&tmp_path, &safe_path)
        .map_err(|e| DiagnosticExportError::IoError(e.to_string()).to_string())?;

    // Write manifest companion atomically
    let manifest_path = PathBuf::from(format!("{}.manifest.json", safe_path.display()));
    let manifest_json = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| DiagnosticExportError::SerializeError(e.to_string()).to_string())?;
    let manifest_tmp = manifest_path.with_extension("json.tmp");
    std::fs::write(&manifest_tmp, &manifest_json)
        .map_err(|e| DiagnosticExportError::IoError(e.to_string()).to_string())?;
    std::fs::rename(&manifest_tmp, &manifest_path)
        .map_err(|e| DiagnosticExportError::IoError(e.to_string()).to_string())?;

    let file_size = json.len();

    log::info!(
        "[diagnostics] export: {} ({} events, {} bytes)",
        safe_path.display(),
        manifest.event_count,
        file_size
    );

    Ok(DiagnosticsExportResult {
        success: true,
        path: safe_path.display().to_string(),
        event_count: manifest.event_count,
        truncated: manifest.truncated,
        file_size_bytes: file_size,
    })
}

/// Clear all diagnostics from the ring buffer.
#[tauri::command]
pub async fn diagnostics_clear() -> Result<(), String> {
    let observer = get_global_observer().ok_or("diagnostics not initialized")?;
    observer.clear().await;
    log::info!("[diagnostics] buffer cleared");
    Ok(())
}

/// v1.1.0 / 110-S2: Doctor bundle export — packs the recent trace window
/// into a ZIP at `~/Downloads/miwarp-diagnostics-{ts}.zip` (or
/// `~/.miwarp/exports/miwarp-diagnostics-{ts}.zip` if `~/Downloads` is
/// missing). The bundle contains `events.json`, `manifest.json`, and
/// `metadata.json`. All event metadata is already redacted by the
/// `DiagnosticRingBuffer` at push time; the bundle is a pure packaging
/// layer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DiagnosticsBundleRequest {
    /// Optional window: only events newer than `now - since_hours` are
    /// included. `None` exports the full buffer.
    #[serde(default)]
    pub since_hours: Option<u32>,
    /// Optional explicit output path. Overrides the default location
    /// (`~/Downloads/miwarp-diagnostics-{ts}.zip`).
    #[serde(default)]
    pub output_path: Option<String>,
}

/// Result returned to the frontend after a bundle export.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct DiagnosticsBundleResult {
    pub success: bool,
    pub path: String,
    pub event_count: usize,
    pub truncated: bool,
    pub bundle_size_bytes: u64,
    pub redaction_rules_applied: usize,
}

#[tauri::command]
pub async fn diagnostics_export_bundle(
    request: Option<DiagnosticsBundleRequest>,
) -> Result<DiagnosticsBundleResult, String> {
    use crate::diagnostics::{bundle_diagnostics, since_hours_to_from_ms};

    let observer = get_global_observer().ok_or("diagnostics not initialized")?;
    let req = request.unwrap_or(DiagnosticsBundleRequest {
        since_hours: None,
        output_path: None,
    });

    let now_ms = chrono::Utc::now().timestamp_millis() as u64;
    let from_ms = since_hours_to_from_ms(now_ms, req.since_hours);
    let to_ms = Some(now_ms);
    let mut events = observer.snapshot_range(from_ms, to_ms).await;

    let all_count = events.len();

    // If the caller asked for an explicit path, we don't use the bundle
    // helper (which chooses Downloads / exports automatically). Fall back
    // to writing a plain JSON file at that location.
    if let Some(out) = req.output_path.as_ref() {
        let path = std::path::PathBuf::from(out);
        let allowed_base = crate::storage::data_dir();
        let safe_path = validate_export_path(&path, &allowed_base).map_err(|e| e.to_string())?;

        let manifest = build_manifest(&events, all_count, false, None);
        if let Err(e) = write_export_at(&safe_path, &events, &manifest) {
            return Err(e.to_string());
        }
        return Ok(DiagnosticsBundleResult {
            success: true,
            path: safe_path.display().to_string(),
            event_count: manifest.event_count,
            truncated: manifest.truncated,
            bundle_size_bytes: std::fs::metadata(&safe_path).map(|m| m.len()).unwrap_or(0),
            redaction_rules_applied: manifest.redaction_rules_applied.len(),
        });
    }

    let time_range = if events.is_empty() {
        None
    } else {
        let first = events.first().unwrap().timestamp_ms;
        let last = events.last().unwrap().timestamp_ms;
        Some(ExportTimeRange {
            from_ms: first,
            to_ms: last,
        })
    };

    let bundle_path = bundle_diagnostics(&events, time_range, None).map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&bundle_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let truncated = events.len() != all_count;
    events.clear();

    Ok(DiagnosticsBundleResult {
        success: true,
        path: bundle_path.display().to_string(),
        event_count: all_count,
        truncated,
        bundle_size_bytes: size,
        redaction_rules_applied: crate::diagnostics::default_rules().len(),
    })
}

// Small adapter so the bundle path with `output_path` doesn't pull in the
// public `write_export` (which takes a permission flag we don't expose here).
fn write_export_at(
    path: &std::path::Path,
    events: &[DiagnosticEvent],
    manifest: &crate::diagnostics::DiagnosticExportManifest,
) -> Result<(), DiagnosticExportError> {
    crate::diagnostics::write_export(path, events, manifest, true)
}

// ── Global observer singleton ──

use std::sync::OnceLock;

static GLOBAL_OBSERVER: OnceLock<Arc<DiagnosticObserverImpl>> = OnceLock::new();

/// Initialize the global diagnostics observer. Called once from app setup.
pub fn init_global_observer(capacity: usize) -> Arc<DiagnosticObserverImpl> {
    GLOBAL_OBSERVER
        .get_or_init(|| Arc::new(DiagnosticObserverImpl::new(capacity)))
        .clone()
}

/// Get a reference to the global observer.
pub fn get_global_observer() -> Option<&'static DiagnosticObserverImpl> {
    GLOBAL_OBSERVER.get().map(|arc| arc.as_ref())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::{
        make_event, DiagnosticCategory, DiagnosticRingBuffer, DiagnosticSeverity,
    };

    fn test_event(
        cat: DiagnosticCategory,
        sev: DiagnosticSeverity,
        phase: &str,
        meta: &str,
        ts: u64,
    ) -> DiagnosticEvent {
        let mut e = make_event(cat, sev, phase, meta);
        e.timestamp_ms = ts;
        e
    }

    #[tokio::test]
    async fn summary_counts_correctly() {
        let _obs = init_global_observer(100);
        let obs = get_global_observer().unwrap();
        obs.clear().await;

        obs.record(test_event(
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Info,
            "recovered",
            "retry ok",
            1000,
        ))
        .await;
        obs.record(test_event(
            DiagnosticCategory::SendTx,
            DiagnosticSeverity::Error,
            "failed",
            "ws disconnect",
            1001,
        ))
        .await;
        obs.record(test_event(
            DiagnosticCategory::PermissionTx,
            DiagnosticSeverity::Error,
            "denied",
            "tool blocked",
            1002,
        ))
        .await;

        let summary = diagnostics_summary().await.unwrap();
        assert_eq!(summary.total_events, 3);
        assert_eq!(summary.error_count, 2);
        assert_eq!(summary.recovery_count, 1);
        assert_eq!(summary.send_fail_count, 1);
        assert_eq!(summary.permission_fail_count, 1);
    }

    #[tokio::test]
    async fn snapshot_filter_by_category() {
        let obs = DiagnosticObserverImpl::new(100);
        obs.record(test_event(
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Info,
            "r1",
            "m1",
            100,
        ))
        .await;
        obs.record(test_event(
            DiagnosticCategory::SendTx,
            DiagnosticSeverity::Error,
            "s1",
            "m2",
            200,
        ))
        .await;
        obs.record(test_event(
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Warn,
            "r2",
            "m3",
            300,
        ))
        .await;

        let filter = DiagnosticsFilter {
            from_ms: None,
            to_ms: None,
            category: Some("recovery".to_string()),
            severity: None,
            session_id: None,
            runtime_id: None,
            max_events: None,
        };
        let events: Vec<DiagnosticEvent> = obs
            .snapshot()
            .await
            .into_iter()
            .filter(|e| matches_filter(e, &filter))
            .collect();
        assert_eq!(events.len(), 2);
        assert!(events
            .iter()
            .all(|e| e.category == DiagnosticCategory::Recovery));
    }

    #[tokio::test]
    async fn snapshot_filter_by_severity() {
        let obs = DiagnosticObserverImpl::new(100);
        obs.record(test_event(
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Info,
            "r1",
            "m1",
            100,
        ))
        .await;
        obs.record(test_event(
            DiagnosticCategory::SendTx,
            DiagnosticSeverity::Error,
            "s1",
            "m2",
            200,
        ))
        .await;

        let filter = DiagnosticsFilter {
            from_ms: None,
            to_ms: None,
            category: None,
            severity: Some("error".to_string()),
            session_id: None,
            runtime_id: None,
            max_events: None,
        };
        let events: Vec<DiagnosticEvent> = obs
            .snapshot()
            .await
            .into_iter()
            .filter(|e| matches_filter(e, &filter))
            .collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].severity, DiagnosticSeverity::Error);
    }

    #[tokio::test]
    async fn snapshot_filter_by_session_id() {
        let obs = DiagnosticObserverImpl::new(100);
        let mut e1 = test_event(
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Info,
            "r1",
            "m1",
            100,
        );
        e1.session_id = Some("sess-aaa".to_string());
        obs.record(e1).await;

        let mut e2 = test_event(
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Info,
            "r2",
            "m2",
            200,
        );
        e2.session_id = Some("sess-bbb".to_string());
        obs.record(e2).await;

        let filter = DiagnosticsFilter {
            from_ms: None,
            to_ms: None,
            category: None,
            severity: None,
            session_id: Some("sess-aaa".to_string()),
            runtime_id: None,
            max_events: None,
        };
        let events: Vec<DiagnosticEvent> = obs
            .snapshot()
            .await
            .into_iter()
            .filter(|e| matches_filter(e, &filter))
            .collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id.as_deref(), Some("sess-aaa"));
    }

    #[tokio::test]
    async fn snapshot_filter_by_runtime_id() {
        let obs = DiagnosticObserverImpl::new(100);
        let mut e1 = test_event(
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Info,
            "r1",
            "m1",
            100,
        );
        e1.runtime_id = Some("claude-code".to_string());
        obs.record(e1).await;

        let mut e2 = test_event(
            DiagnosticCategory::Recovery,
            DiagnosticSeverity::Info,
            "r2",
            "m2",
            200,
        );
        e2.runtime_id = Some("codex".to_string());
        obs.record(e2).await;

        let filter = DiagnosticsFilter {
            from_ms: None,
            to_ms: None,
            category: None,
            severity: None,
            session_id: None,
            runtime_id: Some("claude-code".to_string()),
            max_events: None,
        };
        let events: Vec<DiagnosticEvent> = obs
            .snapshot()
            .await
            .into_iter()
            .filter(|e| matches_filter(e, &filter))
            .collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].runtime_id.as_deref(), Some("claude-code"));
    }

    #[tokio::test]
    async fn snapshot_limit_applied() {
        let obs = DiagnosticObserverImpl::new(100);
        for i in 0..10 {
            obs.record(test_event(
                DiagnosticCategory::Recovery,
                DiagnosticSeverity::Info,
                "tick",
                &format!("ev{i}"),
                i * 100,
            ))
            .await;
        }

        let filter = DiagnosticsFilter {
            from_ms: None,
            to_ms: None,
            category: None,
            severity: None,
            session_id: None,
            runtime_id: None,
            max_events: Some(3),
        };
        let mut events: Vec<DiagnosticEvent> = obs
            .snapshot()
            .await
            .into_iter()
            .filter(|e| matches_filter(e, &filter))
            .collect();
        events.truncate(filter.max_events.unwrap());
        assert_eq!(events.len(), 3);
    }

    #[tokio::test]
    async fn clear_empties_buffer() {
        let obs = DiagnosticObserverImpl::new(10);
        obs.record(test_event(
            DiagnosticCategory::Spawn,
            DiagnosticSeverity::Warn,
            "phase",
            "data",
            100,
        ))
        .await;
        assert_eq!(obs.len().await, 1);
        obs.clear().await;
        assert_eq!(obs.len().await, 0);
    }

    #[test]
    fn filter_default() {
        let f = DiagnosticsFilter {
            from_ms: None,
            to_ms: None,
            category: None,
            severity: None,
            session_id: None,
            runtime_id: None,
            max_events: None,
        };
        assert!(f.from_ms.is_none());
        assert!(f.session_id.is_none());
        assert!(f.runtime_id.is_none());
    }

    #[test]
    fn export_request_default() {
        let req = DiagnosticsExportRequest::default();
        assert!(req.path.is_none());
        assert!(!req.overwrite);
        assert!(req.from_ms.is_none());
        assert!(req.to_ms.is_none());
        assert!(req.max_events.is_none());
    }

    #[tokio::test]
    async fn concurrent_push_is_safe() {
        let buf = DiagnosticRingBuffer::new(500);
        let buf = Arc::new(buf);
        let mut handles = vec![];

        for task_id in 0..10 {
            let buf = buf.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..100 {
                    let mut e = make_event(
                        DiagnosticCategory::Recovery,
                        DiagnosticSeverity::Info,
                        "concurrent",
                        format!("task{task_id}-ev{i}"),
                    );
                    e.timestamp_ms = (task_id * 100 + i) as u64;
                    buf.push(e).await;
                }
            }));
        }

        for h in handles {
            h.await.unwrap();
        }

        let len = buf.len().await;
        assert!(len <= 500, "len={len} should be <= 500");
        assert!(len > 0);
    }
}
