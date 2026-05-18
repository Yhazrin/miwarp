//! Disk cache for remote skill candidates (install reads from here).
use crate::models::SkillRemoteRef;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::storage;

#[derive(Debug, Serialize, Deserialize)]
pub struct CandidateBundle {
    pub id: String,
    pub source_id: String,
    pub skill_md_full: String,
    pub remote_ref_stub: SkillRemoteRef,
}

fn cache_root() -> PathBuf {
    storage::data_dir().join("skill_source_cache").join("candidates")
}

fn candidate_path(id: &str) -> PathBuf {
    let safe = sanitize_id_segment(id);
    cache_root().join(format!("{}.json", safe))
}

fn sanitize_id_segment(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(220)
        .collect()
}

pub fn save_candidate_bundle(bundle: &CandidateBundle) -> Result<(), String> {
    let root = cache_root();
    storage::ensure_dir(&root).map_err(|e| e.to_string())?;
    let p = candidate_path(&bundle.id);
    let j = serde_json::to_string_pretty(bundle).map_err(|e| e.to_string())?;
    std::fs::write(p, j).map_err(|e| e.to_string())
}

pub fn load_candidate_bundle(id: &str) -> Result<Option<CandidateBundle>, String> {
    let p = candidate_path(id);
    if !p.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map(Some).map_err(|e| e.to_string())
}

pub fn purge_candidates_for_source(source_id: &str) -> Result<(), String> {
    let dir = cache_root();
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(bundle) = serde_json::from_str::<CandidateBundle>(&text) {
                if bundle.source_id == source_id {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
    Ok(())
}
