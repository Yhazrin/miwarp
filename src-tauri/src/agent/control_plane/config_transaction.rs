//! Atomic config transactions with snapshot, diff, validation, rollback.

use crate::agent::control_plane::redaction::redact_value;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFieldDiff {
    pub key: String,
    pub before: Value,
    pub after: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigTransactionPreview {
    pub runtime_id: String,
    pub config_path: String,
    pub diffs: Vec<ConfigFieldDiff>,
    pub redacted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigTransactionResult {
    pub success: bool,
    pub runtime_id: String,
    pub config_path: String,
    pub diffs: Vec<ConfigFieldDiff>,
    pub rolled_back: bool,
    pub probe_ok: bool,
    pub error: Option<String>,
}

struct TransactionContext {
    path: PathBuf,
    backup_path: PathBuf,
    original: Value,
}

fn backup_path_for(path: &Path) -> PathBuf {
    path.with_extension(format!("miwarp.bak.{}.json", std::process::id()))
}

fn read_json_object(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("read {}: {}", path.display(), e))?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("parse {}: {}", path.display(), e))?;
    if !value.is_object() {
        return Err(format!("{} is not a JSON object", path.display()));
    }
    Ok(value)
}

fn atomic_write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|e| format!("serialize: {}", e))?;
    let tmp = path.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::write(&tmp, &content).map_err(|e| format!("write tmp: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename: {}", e))
}

pub fn compute_diff(before: &Value, after: &Value) -> Vec<ConfigFieldDiff> {
    let mut diffs = Vec::new();
    let empty = serde_json::Map::new();
    let before_map = before.as_object().unwrap_or(&empty);
    let after_map = after.as_object().unwrap_or(&empty);

    let mut keys: Vec<&String> = before_map.keys().chain(after_map.keys()).collect();
    keys.sort();
    keys.dedup();

    for key in keys {
        let b = before_map.get(key).cloned().unwrap_or(Value::Null);
        let a = after_map.get(key).cloned().unwrap_or(Value::Null);
        if b != a {
            diffs.push(ConfigFieldDiff {
                key: key.clone(),
                before: redact_field_value(key, &b),
                after: redact_field_value(key, &a),
            });
        }
    }
    diffs
}

fn redact_field_value(key: &str, value: &Value) -> Value {
    if crate::agent::control_plane::redaction::is_sensitive_key(key) {
        Value::String(crate::agent::control_plane::redaction::REDACTED.to_string())
    } else {
        redact_value(value)
    }
}

pub fn preview_transaction(
    runtime_id: &str,
    config_path: &Path,
    patch: &Value,
) -> Result<ConfigTransactionPreview, String> {
    let patch_obj = patch
        .as_object()
        .ok_or_else(|| "patch must be a JSON object".to_string())?;
    let current = read_json_object(config_path)?;
    let mut next = current.clone();
    let map = next.as_object_mut().ok_or("config is not an object")?;
    for (key, value) in patch_obj {
        if value.is_null() {
            map.remove(key);
        } else {
            map.insert(key.clone(), value.clone());
        }
    }
    Ok(ConfigTransactionPreview {
        runtime_id: runtime_id.to_string(),
        config_path: config_path.display().to_string(),
        diffs: compute_diff(&current, &next),
        redacted: true,
    })
}

pub fn apply_transaction<F>(
    runtime_id: &str,
    config_path: &Path,
    patch: &Value,
    validate: F,
    probe: impl FnOnce() -> Result<(), String>,
) -> Result<ConfigTransactionResult, String>
where
    F: FnOnce(&Value) -> Result<(), String>,
{
    let ctx = begin_transaction(config_path)?;
    let mut next = ctx.original.clone();
    let map = next.as_object_mut().ok_or("config is not an object")?;
    let patch_obj = patch
        .as_object()
        .ok_or_else(|| "patch must be a JSON object".to_string())?;
    for (key, value) in patch_obj {
        if value.is_null() {
            map.remove(key);
        } else {
            map.insert(key.clone(), value.clone());
        }
    }

    validate(&next)?;
    let diffs = compute_diff(&ctx.original, &next);

    if let Err(e) = atomic_write_json(config_path, &next) {
        let _ = rollback(&ctx);
        return Ok(ConfigTransactionResult {
            success: false,
            runtime_id: runtime_id.to_string(),
            config_path: config_path.display().to_string(),
            diffs,
            rolled_back: true,
            probe_ok: false,
            error: Some(e),
        });
    }

    match probe() {
        Ok(()) => {
            let _ = fs::remove_file(&ctx.backup_path);
            Ok(ConfigTransactionResult {
                success: true,
                runtime_id: runtime_id.to_string(),
                config_path: config_path.display().to_string(),
                diffs,
                rolled_back: false,
                probe_ok: true,
                error: None,
            })
        }
        Err(probe_err) => {
            let rolled_back = rollback(&ctx).is_ok();
            Ok(ConfigTransactionResult {
                success: false,
                runtime_id: runtime_id.to_string(),
                config_path: config_path.display().to_string(),
                diffs,
                rolled_back,
                probe_ok: false,
                error: Some(probe_err),
            })
        }
    }
}

fn begin_transaction(config_path: &Path) -> Result<TransactionContext, String> {
    let original = read_json_object(config_path)?;
    let backup_path = backup_path_for(config_path);
    atomic_write_json(&backup_path, &original)?;
    Ok(TransactionContext {
        path: config_path.to_path_buf(),
        backup_path,
        original,
    })
}

fn rollback(ctx: &TransactionContext) -> Result<(), String> {
    atomic_write_json(&ctx.path, &ctx.original)?;
    let _ = fs::remove_file(&ctx.backup_path);
    Ok(())
}

pub fn preserve_unknown_fields_on_merge(base: &Value, patch: &Value) -> Value {
    let mut out = base.clone();
    let out_map = out.as_object_mut().expect("base object");
    if let Some(patch_map) = patch.as_object() {
        for (k, v) in patch_map {
            if v.is_null() {
                out_map.remove(k);
            } else {
                out_map.insert(k.clone(), v.clone());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn unknown_fields_preserved_on_merge() {
        let base = json!({ "model": "a", "hooks": { "foo": 1 } });
        let patch = json!({ "model": "b" });
        let merged = preserve_unknown_fields_on_merge(&base, &patch);
        assert_eq!(merged["model"], "b");
        assert_eq!(merged["hooks"]["foo"], 1);
    }

    #[test]
    fn transaction_rolls_back_on_probe_failure() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        let mut file = fs::File::create(&path).unwrap();
        writeln!(file, r#"{{"model":"old"}}"#).unwrap();

        let result = apply_transaction(
            "claude-code",
            &path,
            &json!({ "model": "new" }),
            |_| Ok(()),
            || Err("probe failed".to_string()),
        )
        .unwrap();

        assert!(!result.success);
        assert!(result.rolled_back);
        let restored: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(restored["model"], "old");
    }

    #[test]
    fn diff_redacts_secrets() {
        use crate::agent::control_plane::redaction::REDACTED;
        let before = json!({ "apiKey": "sk-abc" });
        let after = json!({ "apiKey": "sk-xyz" });
        let diffs = compute_diff(&before, &after);
        assert_eq!(diffs[0].before, REDACTED);
        assert_eq!(diffs[0].after, REDACTED);
    }
}
