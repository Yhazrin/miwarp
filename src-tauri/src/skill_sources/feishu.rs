//! Feishu (Lark) document fetch via local CLI — never exposes tokens to frontend.
use crate::models::{RemoteSkillDocumentContent, SkillSourceHealth};
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;

const FETCH_TIMEOUT_SECS: u64 = 120;

fn preferred_cli_binary() -> PathBuf {
    std::env::var("MIWARP_FEISHU_CLI")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("lark-cli"))
}

/// Derive opaque remote id — doc token substring from canonical Feishu / Lark URLs.
pub fn derive_remote_doc_id(doc_url: &str) -> String {
    doc_url.replace(':', "/").chars().take(520).collect()
}

fn normalize_doc_identifier(url_or_token: &str) -> Result<String, String> {
    let t = url_or_token.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        return Ok(t.to_string());
    }
    if !t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') || t.len() < 8 {
        return Err("Provide a Feishu doc/wiki URL or a valid doc_token".into());
    }
    Ok(t.to_string())
}

pub async fn test_cli_available() -> SkillSourceHealth {
    match run_cli_quick_version().await {
        Ok(()) => SkillSourceHealth {
            ok: true,
            message: Some("Feishu CLI reachable".into()),
        },
        Err(e) => SkillSourceHealth {
            ok: false,
            message: Some(e),
        },
    }
}

async fn run_cli_quick_version() -> Result<(), String> {
    let bin = preferred_cli_binary();
    let out = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new(&bin).arg("--version").output(),
    )
    .await
    .map_err(|_: tokio::time::error::Elapsed| "timeout waiting for Feishu CLI".to_string())?
    .map_err(|e| format!("cannot execute '{}': {}", bin.display(), e))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let combo = if stderr.trim().is_empty() {
            stdout.into_owned()
        } else {
            stderr.into_owned()
        };
        return Err(format!(
            "Feishu CLI not ready: {}\nSet MIWARP_FEISHU_CLI or install lark-cli on PATH.",
            combo.chars().take(480).collect::<String>()
        ));
    }
    Ok(())
}

/// Fetch Markdown for a doc URL/token using `docs +fetch` subsyntax (lark-cli / feishu open tools).
pub async fn fetch_single_doc(doc_url_or_token: &str, auth_profile: Option<&str>) -> Result<RemoteSkillDocumentContent, String> {
    let id_arg = normalize_doc_identifier(doc_url_or_token)?;
    let bin = preferred_cli_binary();

    // Profile is passed ONLY as env hint for CLIs that read it — never echoed to frontend.
    let mut cmd = Command::new(&bin);
    cmd.kill_on_drop(true);
    if let Some(p) = auth_profile.filter(|s| !s.is_empty()) {
        cmd.env("LARK_CLI_PROFILE", p).env("FEISHU_PROFILE", p);
    }
    // Common surface: docs +fetch <url|token> --api-version v2 --format markdown
    cmd.args(["docs", "+fetch"]);
    cmd.arg(&id_arg);
    cmd.arg("--api-version");
    cmd.arg("v2");
    cmd.arg("--format");
    cmd.arg("markdown");

    let child = tokio::time::timeout(Duration::from_secs(FETCH_TIMEOUT_SECS), cmd.output())
        .await
        .map_err(|_| format!("Feishu CLI timed out after {}s", FETCH_TIMEOUT_SECS))?
        .map_err(|e| format!("spawn Feishu CLI: {}", e))?;

    let code = child.status.code().unwrap_or(-1);
    if !child.status.success() {
        let err = String::from_utf8_lossy(&child.stderr);
        let out = String::from_utf8_lossy(&child.stdout);
        let combined = if err.trim().is_empty() { out.into_owned() } else { err.into_owned() };
        return Err(format!(
            "lark-cli docs +fetch exited {}:\n{}",
            code,
            combined.chars().take(4000).collect::<String>()
        ));
    }

    let markdown = String::from_utf8_lossy(&child.stdout).to_string();
    if markdown.trim().is_empty() {
        return Err("Feishu CLI returned empty body".into());
    }

    let title = markdown
        .lines()
        .find(|l| l.trim().starts_with('#'))
        .map(|l| {
            l.trim()
                .trim_start_matches('#')
                .trim()
                .chars()
                .take(240)
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| derive_remote_doc_id(&id_arg).chars().take(80).collect());

    Ok(RemoteSkillDocumentContent {
        remote_id: derive_remote_doc_id(&id_arg),
        title,
        markdown,
        updated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        raw: Some(id_arg.clone()),
    })
}
