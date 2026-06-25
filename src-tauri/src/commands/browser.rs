//! v1.1.0 / 110-A9 Browser Verification Lite — placeholder IPC commands.
//!
//! This module provides three thin placeholder Tauri commands:
//! - `browser_navigate(url)` — record the URL the user wants to visit
//!   and return a stable `BrowserSessionId`. The actual browser launch
//!   will be wired into a future release; this command just tracks the
//!   navigation intent for audit and link-previews.
//! - `browser_screenshot(session_id)` — return a placeholder base64
//!   PNG header. A future release will integrate a headless browser
//!   to capture real screenshots.
//! - `browser_get_dom(selector)` — return a placeholder DOM payload
//!   (the selector echoed back + a count of zero). Real implementation
//!   will use a headless browser's evaluate hook.
//!
//! These placeholders are deliberately lightweight — the goal is to
//! unblock frontend integration work without committing to a specific
//! browser-automation backend (chromium / playwright / webrider).
//!
//! All commands are pure functions over the in-memory session map and
//! do not require any Tauri-managed state beyond a `Mutex` HashMap.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// Stable handle returned from `browser_navigate` and required by
/// `browser_screenshot`. Pure ASCII so it can be safely embedded in
/// logs / API responses.
pub type BrowserSessionId = String;

/// State shared by the placeholder commands. Stored as a Tauri
/// `State<Arc<BrowserLiteState>>` so IPC handlers and tests can share
/// it. The state is intentionally tiny — a HashMap of session id ->
/// session metadata.
#[derive(Default)]
pub struct BrowserLiteState {
    sessions: Mutex<HashMap<BrowserSessionId, BrowserSession>>,
}

/// Metadata for a single browser session. We keep this on the Rust
/// side so frontend tests can assert on it via the IPC contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrowserSession {
    pub session_id: BrowserSessionId,
    pub url: String,
    pub created_at_ms: u64,
}

impl BrowserLiteState {
    /// Open a new session, returning its id. Always succeeds (id is
    /// generated client-side from a UUID v4).
    pub fn open_session(&self, url: String) -> BrowserSession {
        let session_id = Uuid::new_v4().to_string();
        let session = BrowserSession {
            session_id: session_id.clone(),
            url,
            created_at_ms: crate::models::now_epoch_ms(),
        };
        let mut guard = self
            .sessions
            .lock()
            .expect("BrowserLiteState lock poisoned");
        guard.insert(session_id, session.clone());
        session
    }

    /// Look up an existing session by id. Used by screenshot / dom
    /// commands to verify the session exists before issuing the
    /// placeholder call.
    pub fn get_session(&self, session_id: &str) -> Option<BrowserSession> {
        self.sessions
            .lock()
            .expect("BrowserLiteState lock poisoned")
            .get(session_id)
            .cloned()
    }
}

/// Result of a placeholder browser call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BrowserNavigateResult {
    pub session_id: BrowserSessionId,
    pub url: String,
    pub status: String,
    /// Always `"placeholder"` until the real backend lands.
    pub backend: String,
}

/// Result of `browser_screenshot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BrowserScreenshotResult {
    pub session_id: BrowserSessionId,
    /// Base64-encoded PNG header (1x1 transparent PNG). The frontend
    /// can use this to validate the IPC contract end-to-end without
    /// depending on a real browser.
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub backend: String,
}

/// Result of `browser_get_dom`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BrowserDomResult {
    pub session_id: BrowserSessionId,
    pub selector: String,
    pub match_count: u32,
    /// Always empty for the placeholder.
    pub html: String,
    pub backend: String,
}

const MAX_URL_BYTES: usize = 2048;
const MAX_SELECTOR_BYTES: usize = 512;

/// Inner implementation — accepts a plain `Arc<BrowserLiteState>` so
/// tests and the web_server dispatcher can call it without faking a
/// `tauri::State`.
fn navigate_inner(
    state: &Arc<BrowserLiteState>,
    url: String,
) -> Result<BrowserNavigateResult, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("browser_navigate: url must not be empty".to_string());
    }
    if trimmed.len() > MAX_URL_BYTES {
        return Err(format!(
            "browser_navigate: url exceeds {MAX_URL_BYTES} bytes"
        ));
    }
    let session = state.open_session(trimmed.to_string());
    Ok(BrowserNavigateResult {
        session_id: session.session_id,
        url: session.url,
        status: "placeholder_session_opened".to_string(),
        backend: "placeholder".to_string(),
    })
}

/// v1.1.0 / 110-A9 placeholder for navigating to a URL. The real
/// browser launch will replace this with a call into the future
/// headless-browser module; today it just opens a session and returns
/// the assigned id.
#[tauri::command]
pub fn browser_navigate(
    url: String,
    state: tauri::State<'_, Arc<BrowserLiteState>>,
) -> Result<BrowserNavigateResult, String> {
    navigate_inner(state.inner(), url)
}

fn screenshot_inner(
    state: &Arc<BrowserLiteState>,
    session_id: String,
) -> Result<BrowserScreenshotResult, String> {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return Err("browser_screenshot: session_id must not be empty".to_string());
    }
    if state.get_session(trimmed).is_none() {
        return Err(format!(
            "browser_screenshot: unknown session_id {trimmed}"
        ));
    }
    Ok(BrowserScreenshotResult {
        session_id: trimmed.to_string(),
        png_base64: TRANSPARENT_PNG_BASE64.to_string(),
        width: 1,
        height: 1,
        backend: "placeholder".to_string(),
    })
}

/// v1.1.0 / 110-A9 placeholder for screenshotting a session. Returns a
/// 1x1 transparent PNG payload (encoded as base64) so the frontend
/// can validate the IPC contract end-to-end.
#[tauri::command]
pub fn browser_screenshot(
    session_id: String,
    state: tauri::State<'_, Arc<BrowserLiteState>>,
) -> Result<BrowserScreenshotResult, String> {
    screenshot_inner(state.inner(), session_id)
}

fn get_dom_inner(
    state: &Arc<BrowserLiteState>,
    session_id: String,
    selector: String,
) -> Result<BrowserDomResult, String> {
    let trimmed_sid = session_id.trim();
    if trimmed_sid.is_empty() {
        return Err("browser_get_dom: session_id must not be empty".to_string());
    }
    if state.get_session(trimmed_sid).is_none() {
        return Err(format!(
            "browser_get_dom: unknown session_id {trimmed_sid}"
        ));
    }
    let trimmed_sel = selector.trim();
    if trimmed_sel.is_empty() {
        return Err("browser_get_dom: selector must not be empty".to_string());
    }
    if trimmed_sel.len() > MAX_SELECTOR_BYTES {
        return Err(format!(
            "browser_get_dom: selector exceeds {MAX_SELECTOR_BYTES} bytes"
        ));
    }
    Ok(BrowserDomResult {
        session_id: trimmed_sid.to_string(),
        selector: trimmed_sel.to_string(),
        match_count: 0,
        html: String::new(),
        backend: "placeholder".to_string(),
    })
}

/// v1.1.0 / 110-A9 placeholder for extracting a DOM slice by CSS
/// selector. Returns `match_count: 0` and an empty HTML payload for
/// the placeholder. The real implementation will integrate a
/// headless-browser DOM query.
#[tauri::command]
pub fn browser_get_dom(
    session_id: String,
    selector: String,
    state: tauri::State<'_, Arc<BrowserLiteState>>,
) -> Result<BrowserDomResult, String> {
    get_dom_inner(state.inner(), session_id, selector)
}

/// 1x1 transparent PNG encoded as base64. Used as the placeholder
/// payload so the frontend IPC contract is verifiable without a
/// real browser.
const TRANSPARENT_PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_state() -> Arc<BrowserLiteState> {
        Arc::new(BrowserLiteState::default())
    }

    #[test]
    fn open_session_assigns_unique_ids() {
        let state = fresh_state();
        let a = state.open_session("https://example.com".into());
        let b = state.open_session("https://example.org".into());
        assert_ne!(a.session_id, b.session_id);
        assert_eq!(a.url, "https://example.com");
        assert_eq!(b.url, "https://example.org");
    }

    #[test]
    fn get_session_returns_none_for_unknown_id() {
        let state = fresh_state();
        assert!(state.get_session("missing").is_none());
    }

    #[test]
    fn get_session_returns_stored_session() {
        let state = fresh_state();
        let s = state.open_session("https://example.com".into());
        let fetched = state.get_session(&s.session_id).unwrap();
        assert_eq!(fetched, s);
    }

    #[test]
    fn navigate_then_screenshot_returns_placeholder_png() {
        let state = fresh_state();
        let nav = navigate_inner(&state, "https://example.com".into()).unwrap();
        let screenshot = screenshot_inner(&state, nav.session_id.clone()).unwrap();
        assert_eq!(screenshot.session_id, nav.session_id);
        assert_eq!(screenshot.width, 1);
        assert_eq!(screenshot.height, 1);
        assert!(!screenshot.png_base64.is_empty());
    }

    #[test]
    fn screenshot_for_unknown_session_errors() {
        let state = fresh_state();
        let result = screenshot_inner(&state, "nope".into());
        assert!(result.is_err());
    }

    #[test]
    fn dom_for_unknown_session_errors() {
        let state = fresh_state();
        let result = get_dom_inner(&state, "nope".into(), "div".into());
        assert!(result.is_err());
    }

    #[test]
    fn dom_for_known_session_returns_zero_match_count() {
        let state = fresh_state();
        let nav = navigate_inner(&state, "https://example.com".into()).unwrap();
        let dom = get_dom_inner(&state, nav.session_id.clone(), "div.foo".into()).unwrap();
        assert_eq!(dom.match_count, 0);
        assert!(dom.html.is_empty());
        assert_eq!(dom.selector, "div.foo");
    }

    #[test]
    fn navigate_rejects_empty_url() {
        let state = fresh_state();
        let r = navigate_inner(&state, "".into());
        assert!(r.is_err());
    }

    #[test]
    fn navigate_rejects_oversized_url() {
        let state = fresh_state();
        let r = navigate_inner(&state, "a".repeat(2049));
        assert!(r.is_err());
    }

    #[test]
    fn navigate_rejects_whitespace_only_url() {
        let state = fresh_state();
        let r = navigate_inner(&state, "   ".into());
        assert!(r.is_err());
    }

    #[test]
    fn screenshot_rejects_empty_session_id() {
        let state = fresh_state();
        let r = screenshot_inner(&state, "".into());
        assert!(r.is_err());
    }

    #[test]
    fn dom_rejects_empty_selector() {
        let state = fresh_state();
        let nav = navigate_inner(&state, "https://example.com".into()).unwrap();
        let r = get_dom_inner(&state, nav.session_id, "".into());
        assert!(r.is_err());
    }

    #[test]
    fn dom_rejects_oversized_selector() {
        let state = fresh_state();
        let nav = navigate_inner(&state, "https://example.com".into()).unwrap();
        let r = get_dom_inner(&state, nav.session_id, "a".repeat(513));
        assert!(r.is_err());
    }

    #[test]
    fn transparent_png_base64_decodes_to_non_empty_bytes() {
        let bytes = base64_decode(TRANSPARENT_PNG_BASE64);
        assert!(bytes.len() > 8, "expected non-trivial PNG bytes");
        // PNG magic: 89 50 4E 47 0D 0A 1A 0A
        assert_eq!(&bytes[..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    fn base64_decode(input: &str) -> Vec<u8> {
        // Tiny inline decoder so tests don't depend on an extra crate.
        // We only need a sanity check that the placeholder decodes.
        let bytes = input.as_bytes();
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let lookup = |c: u8| alphabet.iter().position(|x| *x == c).map(|p| p as u8);
        let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
        let mut buf: u32 = 0;
        let mut bits: u32 = 0;
        for &b in bytes {
            if b == b'=' {
                break;
            }
            let v = match lookup(b) {
                Some(v) => v as u32,
                None => continue,
            };
            buf = (buf << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push(((buf >> bits) & 0xFF) as u8);
                buf &= (1 << bits) - 1;
            }
        }
        out
    }
}
