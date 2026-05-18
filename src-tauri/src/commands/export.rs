use crate::storage;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct SummarizeResult {
    pub summary: String,
    pub markdown: String,
}

#[tauri::command]
pub fn export_conversation(run_id: String) -> Result<String, String> {
    log::debug!("[export] export_conversation: run_id={}", run_id);
    storage::runs::get_run(&run_id).ok_or_else(|| format!("Run {} not found", run_id))?;
    let events = storage::events::list_events(&run_id, 0);
    let mut md = String::new();
    md.push_str(&format!("# Conversation — {}\n\n", run_id));

    for event in events {
        let type_str = format!("{}", event.event_type);
        if type_str != "user" && type_str != "assistant" {
            continue;
        }
        let text = event
            .payload
            .get("text")
            .or_else(|| event.payload.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let role = if type_str == "user" {
            "User"
        } else {
            "Assistant"
        };
        md.push_str(&format!("## {}\n\n{}\n\n---\n\n", role, text));
    }

    Ok(md)
}

#[tauri::command]
pub async fn write_html_export(path: String, content: String) -> Result<(), String> {
    log::debug!(
        "[export] write_html_export: path={}, content_len={}",
        path,
        content.len()
    );

    let ext = Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("html") | Some("htm") => {}
        _ => {
            log::error!(
                "[export] write_html_export rejected non-html path: {}",
                path
            );
            return Err("write_html_export: only .html/.htm paths allowed".into());
        }
    }

    tokio::fs::write(&path, content).await.map_err(|e| {
        log::error!("[export] write_html_export failed: {}", e);
        e.to_string()
    })
}

#[tauri::command]
pub async fn summarize_conversation(run_id: String) -> Result<SummarizeResult, String> {
    log::debug!("[export] summarize_conversation: run_id={}", run_id);

    let source =
        storage::runs::get_run(&run_id).ok_or_else(|| format!("Run {} not found", run_id))?;
    let events = storage::events::list_events(&run_id, 0);

    // Build conversation text for summarization
    let mut conversation_lines = Vec::new();
    for event in events {
        let type_str = format!("{}", event.event_type);
        if type_str != "user" && type_str != "assistant" {
            continue;
        }
        let text = event
            .payload
            .get("text")
            .or_else(|| event.payload.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let role = if type_str == "user" {
            "User"
        } else {
            "Assistant"
        };
        conversation_lines.push(format!("{}: {}", role, text));
    }

    // Extract key information from the run
    let agent = source.agent;
    let model = source.model.unwrap_or_else(|| "unknown".to_string());

    // Generate a summary based on conversation content
    let user_turns = conversation_lines
        .iter()
        .filter(|l| l.starts_with("User:"))
        .count();
    let assistant_turns = conversation_lines
        .iter()
        .filter(|l| l.starts_with("Assistant:"))
        .count();

    let summary = format!(
        "This conversation involved {} user messages and {} assistant responses, \
         conducted with the {} agent using the {} model. \
         The session focused on various tasks and discussions \
         as part of the project work in progress.",
        user_turns, assistant_turns, agent, model
    );

    // Extract key topics from conversation
    let mut topics = Vec::new();
    for line in conversation_lines.iter().take(20) {
        if line.starts_with("User:") {
            let content = line.trim_start_matches("User: ").trim();
            if content.len() > 10 {
                // Take first 100 chars of each user message as topic hint
                let topic = if content.len() > 100 {
                    format!("{}...", &content[..100])
                } else {
                    content.to_string()
                };
                if !topics.contains(&topic) && topics.len() < 5 {
                    topics.push(topic);
                }
            }
        }
    }

    let markdown = if topics.is_empty() {
        format!(
            "- {} user messages processed\n- {} assistant responses generated",
            user_turns, assistant_turns
        )
    } else {
        topics
            .iter()
            .map(|t| format!("- {}", t))
            .collect::<Vec<_>>()
            .join("\n")
    };

    Ok(SummarizeResult { summary, markdown })
}
