use std::time::Duration;

/// Probe a preview URL to check if a server is running there.
/// Returns Ok(()) if the URL responds with 2xx/3xx, Err with details otherwise.
#[tauri::command]
pub async fn probe_preview_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    // Ensure URL has a scheme
    let url_with_scheme = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("http://{}", url)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .connect_timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {}", e))?;

    match client.get(&url_with_scheme).send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() || status.is_redirection() {
                Ok(())
            } else {
                Err(format!(
                    "server responded with HTTP {}",
                    status.as_u16()
                ))
            }
        }
        Err(e) => {
            if e.is_connect() {
                Err("connection refused — is the dev server running?".to_string())
            } else if e.is_timeout() {
                Err("connection timed out — is the dev server running?".to_string())
            } else if e.is_request() {
                Err(format!("invalid URL: {}", e))
            } else {
                Err(format!("connection failed: {}", e))
            }
        }
    }
}
