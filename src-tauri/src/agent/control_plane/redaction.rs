//! Redact secrets from config snapshots, logs, and wire payloads.

use serde_json::Value;
use std::collections::BTreeSet;

const SENSITIVE_KEY_FRAGMENTS: &[&str] = &[
    "apikey",
    "api_key",
    "secret",
    "token",
    "password",
    "authorization",
    "bearer",
    "private_key",
    "credential",
];

const SENSITIVE_ENV_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "CURSOR_API_KEY",
    "MIMO_API_KEY",
    "CODEX_API_KEY",
    "GITHUB_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
];

pub const REDACTED: &str = "***REDACTED***";

pub fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SENSITIVE_KEY_FRAGMENTS
        .iter()
        .any(|frag| lower.contains(frag))
}

pub fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                if is_sensitive_key(k) {
                    out.insert(k.clone(), Value::String(REDACTED.to_string()));
                } else {
                    out.insert(k.clone(), redact_value(v));
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        Value::String(s) => Value::String(redact_string(s)),
        other => other.clone(),
    }
}

pub fn redact_string(input: &str) -> String {
    let mut out = input.to_string();
    for var in SENSITIVE_ENV_VARS {
        if let Ok(val) = std::env::var(var) {
            if !val.is_empty() {
                out = out.replace(&val, REDACTED);
            }
        }
    }
    out
}

pub fn redact_env_keys(env: &[(String, String)]) -> Vec<(String, String)> {
    env.iter()
        .map(|(k, v)| {
            if SENSITIVE_ENV_VARS.contains(&k.as_str()) || is_sensitive_key(k) {
                (k.clone(), REDACTED.to_string())
            } else {
                (k.clone(), v.clone())
            }
        })
        .collect()
}

pub fn collect_env_key_names() -> BTreeSet<String> {
    SENSITIVE_ENV_VARS
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redacts_nested_api_keys() {
        let input = json!({
            "model": "claude-opus-4",
            "apiKey": "sk-secret-123",
            "env": { "ANTHROPIC_API_KEY": "sk-secret-123" }
        });
        let out = redact_value(&input);
        assert_eq!(out["apiKey"], REDACTED);
        assert_eq!(out["env"]["ANTHROPIC_API_KEY"], REDACTED);
        assert_eq!(out["model"], "claude-opus-4");
    }

    #[test]
    fn redact_string_masks_env_values() {
        std::env::set_var("ANTHROPIC_API_KEY", "sk-test-value");
        let out = redact_string("key=sk-test-value");
        assert!(!out.contains("sk-test-value"));
        std::env::remove_var("ANTHROPIC_API_KEY");
    }
}
