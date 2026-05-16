use crate::storage;

// Feishu interactive cards (custom bot webhook):
// - Wide "cover-style" image: use an `elements[]` item with tag `img`, `img_key`, and
//   `mode: "fit_horizontal"` (width fills the card). See:
//   https://open.feishu.cn/document/ukTMukTMukTM/uUjNwUjL1YDM14SN2ATN
// - Small icon beside the title (not a full-width cover): `header.icon.img_key`. See:
//   https://open.feishu.cn/document/ukTMukTMukTM/ukTNwUjL5UDM14SO1ATN
// - `img_key` values come from the image upload API, e.g.:
//   https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/image/create

/// Public HTTPS URL for a CodeIsland mascot GIF (same files as MiWarp `static/vendor/...`).
fn feishu_mascot_image_url(mascot: &str) -> Option<String> {
    const BASE: &str =
        "https://raw.githubusercontent.com/wxtsky/CodeIsland/main/docs/images/mascots";
    let file = match mascot.trim() {
        "claude" => "claude.gif",
        "codex" => "codex.gif",
        "gemini" => "gemini.gif",
        "cursor" => "cursor.gif",
        "qoder" => "qoder.gif",
        "factory" => "factory.gif",
        "codebuddy" => "codebuddy.gif",
        "opencode" => "opencode.gif",
        "cline" => "cline.gif",
        _ => return None,
    };
    Some(format!("{BASE}/{file}"))
}

/// Color template for the card header based on status.
fn status_template(status: &str) -> &'static str {
    match status {
        "completed" | "test" => "turquoise",
        "failed" | "error" => "red",
        "cancelled" => "orange",
        _ => "blue",
    }
}

/// Status display with emoji.
fn status_display(status: &str) -> &'static str {
    match status {
        "completed" => "✅ 已完成",
        "failed" => "❌ 失败",
        "cancelled" => "⚠️ 已取消",
        "test" => "🔔 测试",
        _ => "ℹ️ 未知",
    }
}

/// Build an interactive card payload for Feishu webhook.
fn build_card_payload(
    title: &str,
    body: &str,
    status: &str,
    link: Option<&str>,
    time: &str,
    card_img_key: Option<&str>,
    card_image_url: Option<&str>,
) -> serde_json::Value {
    let mut elements = Vec::new();

    if let Some(key) = card_img_key.map(str::trim).filter(|k| !k.is_empty()) {
        elements.push(serde_json::json!({
            "tag": "img",
            "img_key": key,
            "alt": { "tag": "plain_text", "content": "MiWarp" },
            "mode": "fit_horizontal"
        }));
    } else if let Some(url) = card_image_url
        .map(str::trim)
        .filter(|u| u.starts_with("https://"))
    {
        elements.push(serde_json::json!({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": format!("![]({})", url)
            }
        }));
    }

    // Main content block
    let mut content = format!(
        "**任务:** {}\n**状态:** {}\n**时间:** {}",
        body,
        status_display(status),
        time,
    );
    if let Some(l) = link {
        if !l.is_empty() {
            content.push_str(&format!("\n**链接:** [点击查看]({})", l));
        }
    }
    elements.push(serde_json::json!({
        "tag": "div",
        "text": { "tag": "lark_md", "content": content }
    }));

    // Divider + footer
    elements.push(serde_json::json!({ "tag": "hr" }));
    elements.push(serde_json::json!({
        "tag": "note",
        "elements": [{ "tag": "plain_text", "content": "MiWarp · 自动通知" }]
    }));

    serde_json::json!({
        "msg_type": "interactive",
        "card": {
            "config": { "wide_screen_mode": true },
            "header": {
                "title": { "tag": "plain_text", "content": title },
                "template": status_template(status)
            },
            "elements": elements
        }
    })
}

/// Fire-and-forget: POST a pre-built payload to a Feishu webhook URL.
pub fn fire_webhook(url: String, payload: serde_json::Value) {
    tokio::spawn(async move {
        match reqwest::Client::new()
            .post(&url)
            .json(&payload)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
        {
            Ok(resp) => {
                if !resp.status().is_success() {
                    log::warn!(
                        "[notification] Feishu webhook returned status {}: {}",
                        resp.status(),
                        resp.text().await.unwrap_or_default()
                    );
                } else {
                    log::debug!("[notification] Feishu webhook sent successfully");
                }
            }
            Err(e) => {
                log::warn!("[notification] Feishu webhook request failed: {}", e);
            }
        }
    });
}

/// Build a card payload from current settings and send it.
/// Used by both the Tauri command and the scheduler.
pub fn dispatch_feishu_card(title: &str, body: &str, status: &str, link: Option<&str>) {
    let settings = storage::settings::get_user_settings();
    if !settings.feishu_webhook_enabled {
        return;
    }
    let webhook_url = match settings.feishu_webhook_url {
        Some(ref url) => url.clone(),
        None => return,
    };
    if !webhook_url.starts_with("https://open.feishu.cn/open-apis/bot/v2/hook/")
        && !webhook_url.starts_with("https://open.larksuite.com/open-apis/bot/v2/hook/")
    {
        log::warn!("[notification] invalid Feishu webhook URL, skipping");
        return;
    }

    let time = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let header_title = format!("MiWarp · {}", title);

    let payload = if let Some(ref template) = settings.feishu_webhook_template {
        let message_text = template
            .replace("{title}", title)
            .replace("{body}", body)
            .replace("{status}", status)
            .replace("{link}", link.unwrap_or(""))
            .replace("{time}", &time);
        serde_json::json!({
            "msg_type": "text",
            "content": { "text": message_text }
        })
    } else {
        let resolved_image_url = settings
            .feishu_webhook_card_image_url
            .as_deref()
            .map(str::trim)
            .filter(|u| u.starts_with("https://"))
            .map(ToString::to_string)
            .or_else(|| {
                settings
                    .feishu_webhook_card_mascot
                    .as_deref()
                    .and_then(feishu_mascot_image_url)
            });
        build_card_payload(
            &header_title,
            body,
            status,
            link,
            &time,
            settings.feishu_webhook_card_img_key.as_deref(),
            resolved_image_url.as_deref(),
        )
    };

    fire_webhook(webhook_url, payload);
}

/// Send a Feishu webhook notification as an interactive card.
/// Called from the frontend when a run or scheduled task completes.
#[tauri::command]
pub async fn send_feishu_notification(
    title: String,
    body: String,
    status: Option<String>,
    link: Option<String>,
) -> Result<(), String> {
    let settings = storage::settings::get_user_settings();
    if !settings.feishu_webhook_enabled {
        return Err("Feishu webhook is disabled".into());
    }
    if settings.feishu_webhook_url.is_none() {
        return Err("Feishu webhook URL not configured".into());
    }

    let status_str = status.as_deref().unwrap_or("completed");
    dispatch_feishu_card(&title, &body, status_str, link.as_deref());
    Ok(())
}
