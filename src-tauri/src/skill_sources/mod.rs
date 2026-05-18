//! Pluggable skill sources (Feishu, GitHub, …). Frontend talks only via Tauri commands.
mod cache;
mod feishu;
pub mod parser;

use crate::models::{
    InstallRemoteSkillResult, RemoteSkillCandidate, RemoteSkillUpdateItem, SkillRemoteRef,
    SkillSourceConfig, SkillSourceHealth, SkillSourceSyncResult, SkillSourceUpdateCheck,
};
use crate::skill_sources::parser::{parse_skill_markdown, SkillParserMode};
use crate::storage;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

const SOURCES_STORE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Default)]
struct SkillSourcesFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    sources: Vec<SkillSourceConfig>,
}

fn sources_path() -> std::path::PathBuf {
    storage::data_dir().join("skill_sources.json")
}

pub fn load_all_sources() -> Result<Vec<SkillSourceConfig>, String> {
    let p = sources_path();
    if !p.is_file() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| format!("read skill_sources: {}", e))?;
    let file: SkillSourcesFile =
        serde_json::from_str(&raw).map_err(|e| format!("parse skill_sources: {}", e))?;
    Ok(file.sources)
}

fn persist_sources(list: &[SkillSourceConfig]) -> Result<(), String> {
    storage::ensure_dir(&storage::data_dir()).map_err(|e| e.to_string())?;
    let body = SkillSourcesFile {
        version: SOURCES_STORE_VERSION,
        sources: list.to_vec(),
    };
    let tmp = sources_path().with_extension("tmp");
    serde_json::to_string_pretty(&body)
        .map_err(|e| e.to_string())
        .and_then(|s| {
            std::fs::write(&tmp, s).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, sources_path()).map_err(|e| e.to_string())
        })
}

pub fn create_source(mut config: SkillSourceConfig) -> Result<SkillSourceConfig, String> {
    let mut list = load_all_sources()?;
    if list.iter().any(|s| s.id == config.id) {
        return Err(format!("skill source '{}' already exists", config.id));
    }
    normalize_new_source(&mut config);
    list.push(config.clone());
    persist_sources(&list)?;
    Ok(config)
}

pub fn update_source(id: &str, mut patch: SkillSourceConfig) -> Result<SkillSourceConfig, String> {
    let mut list = load_all_sources()?;
    let idx = list
        .iter()
        .position(|s| s.id == id)
        .ok_or_else(|| format!("skill source '{}' not found", id))?;
    patch.id = id.to_string();
    patch.created_at = list[idx].created_at.clone();
    patch.updated_at = chrono_now();
    list[idx] = patch;
    persist_sources(&list)?;
    Ok(list[idx].clone())
}

pub fn delete_source(id: &str) -> Result<(), String> {
    let mut list = load_all_sources()?;
    let n = list.len();
    list.retain(|s| s.id != id);
    if list.len() == n {
        return Err(format!("skill source '{}' not found", id));
    }
    persist_sources(&list)?;
    cache::purge_candidates_for_source(id)?;
    Ok(())
}

fn normalize_new_source(cfg: &mut SkillSourceConfig) {
    let now = chrono_now();
    if cfg.created_at.is_empty() {
        cfg.created_at = now.clone();
    }
    cfg.updated_at = now;
}

fn chrono_now() -> String {
    chrono_lite_iso()
}

/// ISO-8601 UTC timestamps for sync metadata.
fn chrono_lite_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub async fn test_source(id: &str) -> Result<SkillSourceHealth, String> {
    let cfg = find_source(id)?;
    if !cfg.enabled {
        return Ok(SkillSourceHealth {
            ok: false,
            message: Some("source disabled".into()),
        });
    }
    match cfg.r#type.as_str() {
        "feishu" => Ok(feishu::test_cli_available().await),
        other => Ok(SkillSourceHealth {
            ok: false,
            message: Some(format!("type '{}' not implemented yet", other)),
        }),
    }
}

pub async fn preview_feishu_doc(
    doc_url: &str,
    auth_profile: Option<String>,
    parser_mode: SkillParserMode,
    source_id_hint: Option<String>,
) -> Result<RemoteSkillCandidate, String> {
    let doc = feishu::fetch_single_doc(doc_url, auth_profile.as_deref()).await?;
    let remote_id = doc.remote_id.clone();
    let mode = parser_mode;
    let outcome =
        parse_skill_markdown(&doc.markdown, doc.title.clone(), remote_id.clone(), doc_url, mode)?;
    match outcome {
        parser::ParsedSkillOutcome::Skipped(reason) => Ok(RemoteSkillCandidate {
            id: Uuid::new_v4().to_string(),
            source_id: source_id_hint.unwrap_or_else(|| "preview".into()),
            remote_id,
            name: doc.title.clone(),
            description: String::new(),
            category: "custom".into(),
            tags: vec![],
            content_hash: parser::content_hash_normalized(&doc.markdown),
            remote_url: Some(doc_url.to_string()),
            status: "not_installed".into(),
            skipped: true,
            skip_reason: Some(reason),
        }),
        parser::ParsedSkillOutcome::Ok(parsed) => {
            let id = Uuid::new_v4().to_string();
            let cand = RemoteSkillCandidate {
                name: parsed.name.clone(),
                description: parsed.description.clone(),
                category: parsed.category.clone(),
                tags: parsed.tags.clone(),
                content_hash: parsed.content_hash.clone(),
                remote_url: Some(doc_url.to_string()),
                status: "not_installed".into(),
                skipped: false,
                skip_reason: None,
                id: id.clone(),
                source_id: source_id_hint.unwrap_or_else(|| "preview".into()),
                remote_id: remote_id.clone(),
            };
            let full_md = parsed.full_skill_md;
            cache::save_candidate_bundle(&cache::CandidateBundle {
                id: id.clone(),
                source_id: cand.source_id.clone(),
                skill_md_full: full_md,
                remote_ref_stub: SkillRemoteRef {
                    source_id: cand.source_id.clone(),
                    source_type: "feishu".into(),
                    remote_id: cand.remote_id.clone(),
                    remote_url: cand.remote_url.clone(),
                    etag: None,
                    content_hash: cand.content_hash.clone(),
                    last_synced_at: chrono_lite_iso(),
                },
            })?;
            Ok(cand)
        }
    }
}

pub async fn sync_source(id: &str) -> Result<SkillSourceSyncResult, String> {
    let cfg = find_source(id)?;
    let mut result = SkillSourceSyncResult {
        source_id: id.to_string(),
        ..Default::default()
    };

    if cfg.r#type != "feishu" {
        result.errors.push("only feishu sync implemented".into());
        return Ok(result);
    }

    let fe = cfg.feishu.clone().ok_or_else(|| "missing feishu config".to_string())?;
    let parser_mode = if fe.parser_mode == "loose" {
        SkillParserMode::Loose
    } else {
        SkillParserMode::Strict
    };

    let urls: Vec<String> = fe.doc_urls.iter().cloned().collect();
    if urls.is_empty() {
        result
            .errors
            .push("Feishu source has no doc_urls — add URLs for MVP sync".into());
        return Ok(result);
    }

    let auth = fe.auth_profile.clone();
    let mut patched = cfg.clone();
    for url in urls {
        match feishu::fetch_single_doc(&url, auth.as_deref()).await {
            Ok(doc_content) => {
                let pid = doc_content.remote_id.clone();
                let parsed = parse_skill_markdown(
                    &doc_content.markdown,
                    doc_content.title.clone(),
                    pid.clone(),
                    &url,
                    parser_mode,
                );
                match parsed {
                    Ok(parser::ParsedSkillOutcome::Skipped(r)) => {
                        result.skipped += 1;
                        let sid = Uuid::new_v4().to_string();
                        result.candidates.push(RemoteSkillCandidate {
                            id: sid.clone(),
                            source_id: cfg.id.clone(),
                            remote_id: pid,
                            name: doc_content.title,
                            description: String::new(),
                            category: "custom".into(),
                            tags: vec![],
                            content_hash: parser::content_hash_normalized(&doc_content.markdown),
                            remote_url: Some(url.clone()),
                            status: "not_installed".into(),
                            skipped: true,
                            skip_reason: Some(r),
                        });
                    }
                    Ok(parser::ParsedSkillOutcome::Ok(parsed_skill)) => {
                        result.fetched += 1;
                        let cid = Uuid::new_v4().to_string();
                        let mut cand = RemoteSkillCandidate {
                            id: cid.clone(),
                            source_id: cfg.id.clone(),
                            remote_id: pid,
                            name: parsed_skill.name.clone(),
                            description: parsed_skill.description.clone(),
                            category: parsed_skill.category.clone(),
                            tags: parsed_skill.tags.clone(),
                            content_hash: parsed_skill.content_hash.clone(),
                            remote_url: Some(url.clone()),
                            status: "not_installed".into(),
                            skipped: false,
                            skip_reason: None,
                        };
                        let _ = cache::save_candidate_bundle(&cache::CandidateBundle {
                            id: cid,
                            source_id: cfg.id.clone(),
                            skill_md_full: parsed_skill.full_skill_md,
                            remote_ref_stub: SkillRemoteRef {
                                source_id: cfg.id.clone(),
                                source_type: "feishu".into(),
                                remote_id: cand.remote_id.clone(),
                                remote_url: cand.remote_url.clone(),
                                etag: None,
                                content_hash: cand.content_hash.clone(),
                                last_synced_at: chrono_lite_iso(),
                            },
                        });
                        annotate_install_status(&mut cand, "")?;
                        result.candidates.push(cand);
                    }
                    Err(e) => result.errors.push(e),
                }
            }
            Err(e) => result.errors.push(e),
        }
    }

    patched.sync.last_synced_at = Some(chrono_lite_iso());
    patched.sync.last_status = Some(if result.errors.is_empty() {
        "success".into()
    } else if result.fetched > 0 {
        "partial".into()
    } else {
        "failed".into()
    });
    patched.sync.last_error = if result.errors.is_empty() {
        None
    } else {
        Some(result.errors.join("; "))
    };
    patched.updated_at = chrono_lite_iso();
    let _ = update_source(id, patched);

    Ok(result)
}

fn annotate_install_status(cand: &mut RemoteSkillCandidate, cwd: &str) -> Result<(), String> {
    let skills = crate::storage::plugins::list_standalone_skills(cwd);
    annotate_with_skills(cand, &skills)
}

fn annotate_with_skills(
    cand: &mut RemoteSkillCandidate,
    skills: &[crate::models::StandaloneSkill],
) -> Result<(), String> {
    let by_remote: Vec<_> = skills
        .iter()
        .filter(|s| {
            s.remote_ref
                .as_ref()
                .map(|r| r.source_id == cand.source_id && r.remote_id == cand.remote_id)
                .unwrap_or(false)
        })
        .collect();
    if by_remote.len() >= 2 {
        cand.status = "conflict".into();
        return Ok(());
    }
    if let Some(s) = by_remote.first() {
        let local_hash = &s.remote_ref.as_ref().unwrap().content_hash;
        if local_hash != &cand.content_hash {
            cand.status = "update_available".into();
        } else {
            cand.status = "installed".into();
        }
        return Ok(());
    }
    let name_hit: Vec<_> = skills
        .iter()
        .filter(|s| s.name.to_lowercase() == cand.name.to_lowercase())
        .collect();
    if !name_hit.is_empty() {
        cand.status = "conflict".into();
    } else {
        cand.status = "not_installed".into();
    }
    Ok(())
}

pub fn install_candidate(
    candidate_id: &str,
    scope: &str,
    cwd: &str,
    resolution: &str,
) -> Result<InstallRemoteSkillResult, String> {
    let bundle = cache::load_candidate_bundle(candidate_id)?
        .ok_or_else(|| "candidate expired — run preview or sync again".to_string())?;

    let skill_name_original = yaml_name_from_skill_md(&bundle.skill_md_full)
        .unwrap_or_else(|| "feishu-skill".to_string());

    let skills_all = flatten_all_skills(cwd)?;

    let name_conflict = conflict_by_name(
        skill_name_original.trim(),
        bundle.remote_ref_stub.remote_id.as_str(),
        bundle.remote_ref_stub.source_id.as_str(),
        &skills_all,
    );

    let mut chosen_name = skill_name_original.trim().to_string();
    match (name_conflict.as_ref(), resolution) {
        (Some((_path, ConflictKind::RemoteMatchSameSource)), _) => {
            return Err(
                "same skill from this remote/source already installed — use update flow later".into(),
            );
        }
        (Some((_path, ConflictKind::NameOnly)), "abort") | (Some((_path, ConflictKind::NameOnly)), "") => {
            return Ok(InstallRemoteSkillResult {
                success: false,
                message: "name conflict".into(),
                skill_path: None,
                conflict_name: Some(skill_name_original),
            });
        }
        (Some((_path, ConflictKind::NameOnly)), "copy") => {
            chosen_name = uniquify_name(&chosen_name, scope, cwd)?;
        }
        (Some((_path, ConflictKind::NameOnly)), "replace") => {
            if let Some((path, _)) = name_conflict.as_ref() {
                crate::storage::plugins::delete_skill(path, cwd).map_err(|e| {
                    format!("replace: failed to delete existing skill dir: {}", e)
                })?;
            }
        }
        (None, _) => {}
        (Some((_path, ConflictKind::NameOnly)), _) => {
            return Err(format!("unknown conflict resolution {:?}", resolution));
        }
    };

    crate::storage::plugins::validate_skill_name(&chosen_name)?;

    let desc = yaml_description_from_skill_md(&bundle.skill_md_full).unwrap_or_default();
    let body_only = strip_frontmatter_for_create(&bundle.skill_md_full);

    let created = crate::storage::plugins::create_skill(&chosen_name, &desc, &body_only, scope, cwd)?;
    let skill_dir = skill_install_path(scope, cwd, &chosen_name)?;
    write_remote_stub(&skill_dir, &bundle.remote_ref_stub)?;

    Ok(InstallRemoteSkillResult {
        success: true,
        message: "installed".into(),
        skill_path: Some(created.path.clone()),
        conflict_name: None,
    })
}

enum ConflictKind {
    RemoteMatchSameSource,
    NameOnly,
}

fn conflict_by_name(
    name: &str,
    remote_id: &str,
    source_id: &str,
    skills: &[crate::models::StandaloneSkill],
) -> Option<(String, ConflictKind)> {
    for s in skills {
        if let Some(rr) = &s.remote_ref {
            if rr.remote_id == remote_id && rr.source_id == source_id {
                return Some((s.path.clone(), ConflictKind::RemoteMatchSameSource));
            }
        }
        if s.name.eq_ignore_ascii_case(name) {
            return Some((s.path.clone(), ConflictKind::NameOnly));
        }
    }
    None
}

fn flatten_all_skills(cwd: &str) -> Result<Vec<crate::models::StandaloneSkill>, String> {
    Ok(crate::storage::plugins::list_standalone_skills(cwd))
}

fn skill_install_path(scope: &str, cwd: &str, name: &str) -> Result<PathBuf, String> {
    let base = crate::storage::plugins::resolve_skill_dir(scope, cwd)?;
    Ok(base.join(name))
}

fn write_remote_stub(dir: &PathBuf, meta: &SkillRemoteRef) -> Result<(), String> {
    let p = dir.join(".miwarp_remote.json");
    let j = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(p, j).map_err(|e| e.to_string())
}

fn uniquify_name(base: &str, scope: &str, cwd: &str) -> Result<String, String> {
    let mut i = 2u32;
    while i < 256 {
        let candidate = format!("{}-{}", base, i);
        crate::storage::plugins::validate_skill_name(&candidate)?;
        let p = skill_install_path(scope, cwd, &candidate)?;
        if !p.exists() {
            return Ok(candidate);
        }
        i += 1;
    }
    let tail = uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("copy").to_string();
    let candidate = format!("{}-{}", base, tail);
    crate::storage::plugins::validate_skill_name(&candidate)?;
    Ok(candidate)
}

fn yaml_name_from_skill_md(md: &str) -> Option<String> {
    if !md.starts_with("---") {
        return None;
    }
    let end = md[3..].find("---")? + 3;
    let fm = &md[3..end - 3];
    for line in fm.lines() {
        if let Some(v) = line.trim().strip_prefix("name:") {
            let t = v.trim().trim_matches('"').trim_matches('\'').to_string();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

fn yaml_description_from_skill_md(md: &str) -> Option<String> {
    if !md.starts_with("---") {
        return None;
    }
    let rest = &md[3..];
    let end = rest.find("---")? + 3;
    let fm = &rest[..end - 3];
    for line in fm.lines() {
        if let Some(v) = line.trim().strip_prefix("description:") {
            let t = v.trim().trim_matches('"').trim_matches('\'').to_string();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

fn strip_frontmatter_for_create(md: &str) -> String {
    if !md.starts_with("---") {
        return md.to_string();
    }
    if let Some(pos) = md[3..].find("---") {
        md[6 + pos..].trim_start().to_string()
    } else {
        md.to_string()
    }
}

fn find_source(id: &str) -> Result<SkillSourceConfig, String> {
    load_all_sources()?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("skill source '{}' not found", id))
}

pub async fn check_updates(id: &str, cwd: &str) -> Result<SkillSourceUpdateCheck, String> {
    let cfg = find_source(id)?;
    let skills = flatten_all_skills(cwd)?;
    let mut updates = Vec::new();
    for s in &skills {
        let rr = match &s.remote_ref {
            Some(r) if r.source_id == cfg.id => r.clone(),
            _ => continue,
        };
        let url = rr.remote_url.clone().unwrap_or_default();
        if url.is_empty() {
            continue;
        }
        if let Ok(doc) = feishu::fetch_single_doc(&url, cfg.feishu.as_ref().and_then(|f| f.auth_profile.as_deref())).await {
            let hash = parser::content_hash_normalized(&doc.markdown);
            if hash != rr.content_hash {
                updates.push(RemoteSkillUpdateItem {
                    skill_path: s.path.clone(),
                    skill_name: s.name.clone(),
                    remote_id: rr.remote_id,
                    local_hash: rr.content_hash,
                    remote_hash: hash,
                });
            }
        }
    }
    Ok(SkillSourceUpdateCheck {
        source_id: cfg.id,
        updates,
    })
}

