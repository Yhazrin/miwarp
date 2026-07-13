use axum::extract::State;
use axum::http::{header, Method};
use axum::response::Json;
use axum::routing::{get, post};
use axum::Router;
use serde_json::json;
use std::sync::atomic::Ordering;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::mcp::fleet_server;
use crate::web_server::auth;
use crate::web_server::fleet_api;
use crate::web_server::fleet_ws;
use crate::web_server::state::AppState;
use crate::web_server::ws;

/// Build the axum Router with all routes and middleware layers.
pub fn build_router(state: AppState) -> Router {
    let state_for_cors = state.clone();
    let state_port = state.effective_port.load(Ordering::Relaxed);

    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/health", get(health))
        .route("/auth", post(auth::auth_handler))
        .route("/login", get(auth::login_page));

    // WebSocket route (self-authenticating inside handler)
    let ws_routes = Router::new().route("/ws", get(ws::ws_handler));

    // Fleet REST + WS (v1.2.0) — bearer-token authenticated.
    // REST sub-router uses a custom BearerAuth extractor; the WS upgrade
    // self-authenticates inside its handler (same pattern as /ws).
    let fleet_routes = Router::new()
        .merge(fleet_api::build_fleet_router())
        .route("/ws", get(fleet_ws::fleet_ws_handler));

    // Local MCP server for ChatGPT / external MCP clients (v1.2.0).
    // Bearer-authenticated at the handler level (same BearerAuth extractor).
    let mcp_routes = fleet_server::build_mcp_router();

    // Cookie-protected routes (SPA static files)
    let cookie_routes =
        Router::new()
            .fallback(get(serve_spa))
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                auth::session_cookie_middleware,
            ));

    // Assemble with CORS + Origin check
    let cors_layer = build_cors_layer(state_for_cors, state_port);

    Router::new()
        .merge(public_routes)
        .merge(ws_routes)
        .nest("/api/fleet", fleet_routes)
        .merge(mcp_routes)
        .merge(cookie_routes)
        .layer(cors_layer)
        .with_state(state)
}

/// Health endpoint — public, minimal info only.
///
/// Returns a self-check payload so the desktop settings UI can verify
/// end-to-end reachability without auth. The fields are intentionally
/// non-sensitive: no token, no host-internal data.
async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let port = state.effective_port.load(Ordering::Relaxed);
    let bind = state.bind_addr.as_str();
    let host = effective_browser_host(bind, port);
    let mcp_endpoint = if port > 0 {
        Some(format!("{host}/mcp/fleet"))
    } else {
        None
    };
    let auth_endpoint = if port > 0 {
        Some(format!("{host}/auth"))
    } else {
        None
    };

    let payload = json!({
        "status": "ok",
        "service": "miwarp-web",
        "version": env!("CARGO_PKG_VERSION"),
        "running": port > 0,
        "bind": bind,
        "port": port,
        "host": host,
        "mcp_endpoint": mcp_endpoint,
        "auth_endpoint": auth_endpoint,
        "auth_required": true,
        "cors_localhost_default": true,
    });

    Json(payload)
}

/// Build a loopback/LAN browser-friendly origin string from bind+port.
///
/// `0.0.0.0` / `::` / `[::]` collapse to `localhost` so the URL is usable
/// from desktop WebView. Other binds (e.g. `192.168.1.5`) pass through.
fn effective_browser_host(bind: &str, port: u16) -> String {
    let bare = bind.trim_start_matches('[').trim_end_matches(']');
    let host = if bare == "0.0.0.0" || bare == "::" {
        "localhost".to_string()
    } else {
        bare.to_string()
    };
    if host.contains(':') {
        format!("http://[{host}]:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

/// SPA fallback — serve index.html for all unmatched routes (client-side routing).
///
/// In release builds: serves from embedded build/ assets.
/// In debug builds: reverse-proxies HTTP requests to Vite dev server at :1420.
/// Note: Vite HMR WebSocket is NOT proxied — use :1420 directly for HMR dev.
async fn serve_spa(
    State(_state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::body::Body;
    use axum::http::{Response, StatusCode};

    let path = req.uri().path().trim_start_matches('/');

    // During `tauri dev`, always serve the live Vite tree first. A previous
    // production build can still exist at `build/`; checking embedded assets
    // before Vite silently gives browser clients stale JS, even though the
    // desktop window is hot-reloading from :1420.
    #[cfg(debug_assertions)]
    {
        let uri = req.uri().to_string();
        let vite_url = format!("http://localhost:1420{}", uri);
        log::trace!("[router] dev proxy: {} → {}", uri, vite_url);
        match dev_proxy(&vite_url).await {
            Ok(resp) => return resp,
            Err(e) => {
                log::debug!(
                    "[router] dev proxy failed, falling back to embedded assets: {}",
                    e
                );
            }
        }
    }

    // Try to serve the exact file from embedded assets
    if let Some(content) = get_embedded_file(path) {
        let mime = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();
        return Response::builder()
            .status(StatusCode::OK)
            .header("content-type", mime)
            .header("cache-control", "public, max-age=3600")
            .body(Body::from(content))
            .unwrap_or_else(|_| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::empty())
                    .unwrap()
            });
    }

    // Fallback to index.html for SPA routing
    if let Some(index) = get_embedded_file("index.html") {
        return Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/html; charset=utf-8")
            .header("cache-control", "no-cache")
            .body(Body::from(index))
            .unwrap_or_else(|_| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::empty())
                    .unwrap()
            });
    }

    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::from(
            "Not Found (no embedded assets, Vite dev server unreachable)",
        ))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .expect("fallback")
        })
}

/// Proxy an HTTP request to the Vite dev server (debug builds only).
#[cfg(debug_assertions)]
async fn dev_proxy(url: &str) -> Result<axum::response::Response, String> {
    use axum::body::Body;
    use axum::http::Response;

    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    if status >= 500 {
        return Err(format!("Vite returned HTTP {status}"));
    }
    let mut builder = Response::builder().status(status);
    for (key, value) in resp.headers() {
        // Forward content-type and other relevant headers
        if let Ok(v) = value.to_str() {
            builder = builder.header(key.as_str(), v);
        }
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    builder.body(Body::from(bytes)).map_err(|e| e.to_string())
}

/// Get file content from embedded build directory.
/// In dev mode, this returns None (frontend is served by Vite dev server).
fn get_embedded_file(path: &str) -> Option<&'static [u8]> {
    use include_dir::{include_dir, Dir};

    // Embed the built frontend at compile time
    // In dev builds, the build/ directory may not exist — that's fine, we return None
    static BUILD_DIR: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../build");

    BUILD_DIR.get_file(path).map(|f| f.contents())
}

/// Build CORS layer with origin checking
fn build_cors_layer(state: AppState, port: u16) -> CorsLayer {
    let allowed_origins = state.allowed_origins.clone();

    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(move |origin, _| {
            let s = match origin.to_str() {
                Ok(s) => s,
                Err(_) => return false,
            };
            is_allowed_cors_origin(s, &allowed_origins, port)
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            header::COOKIE,
        ])
        .allow_credentials(true)
}

/// Decide whether a browser origin may access the local web server.
///
/// In development, the Tauri window is served by Vite on port 1420 while the
/// local server commonly runs on 9476. This is intentionally a narrow
/// exception: arbitrary local ports remain denied, and release builds only
/// allow the configured origins or the server's own local origin.
fn is_allowed_cors_origin(
    origin: &str,
    allowed_origins: &Option<Vec<String>>,
    server_port: u16,
) -> bool {
    // No Origin header = non-browser request (curl, wscat) → allow.
    // Browsers always send Origin on cross-origin requests.
    if origin.is_empty() {
        return true;
    }

    let Ok(parsed) = url::Url::parse(origin) else {
        return false;
    };

    // 1. Check configured allowed origins (reverse proxy domains).
    if let Some(allowed) = allowed_origins {
        if allowed
            .iter()
            .any(|candidate| origin_matches(origin, candidate))
        {
            return true;
        }
    }

    // 2. Tauri dev loads the renderer from Vite, not from the local server.
    if cfg!(debug_assertions) && is_vite_dev_origin(&parsed) {
        return true;
    }

    // 3. Default: allow local origins with the server's own port.
    let host = parsed.host_str().unwrap_or("");
    let host_ok = host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host == "[::1]"
        || is_local_ip(host);
    let port_ok = parsed.port_or_known_default() == Some(server_port);
    host_ok && port_ok
}

/// Vite's fixed Tauri development origin from `tauri.conf.json`.
fn is_vite_dev_origin(origin: &url::Url) -> bool {
    let host = origin.host_str().unwrap_or("");
    origin.scheme() == "http"
        && matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
        && origin.port_or_known_default() == Some(1420)
}

/// Compare two origins by (scheme, host, port) triple
fn origin_matches(origin: &str, allowed: &str) -> bool {
    let (Ok(o), Ok(a)) = (url::Url::parse(origin), url::Url::parse(allowed)) else {
        return false;
    };
    o.scheme() == a.scheme()
        && o.host() == a.host()
        && o.port_or_known_default() == a.port_or_known_default()
}

/// Check if a host string is a local IP address
fn is_local_ip(host: &str) -> bool {
    use std::net::IpAddr;
    let Ok(ip) = host.parse::<IpAddr>() else {
        return false;
    };
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

#[cfg(test)]
mod tests {
    use super::is_allowed_cors_origin;

    #[test]
    fn allows_vite_dev_origin_without_manual_configuration() {
        assert!(is_allowed_cors_origin("http://localhost:1420", &None, 9476));
        assert!(is_allowed_cors_origin("http://127.0.0.1:1420", &None, 9476));
    }

    #[test]
    fn rejects_unrelated_local_origin() {
        assert!(!is_allowed_cors_origin(
            "http://localhost:1421",
            &None,
            9476
        ));
    }

    #[test]
    fn allows_the_local_server_origin_and_configured_origins() {
        assert!(is_allowed_cors_origin("http://127.0.0.1:9476", &None, 9476));
        assert!(is_allowed_cors_origin(
            "https://miwarp.example.test",
            &Some(vec!["https://miwarp.example.test".into()]),
            9476
        ));
    }
}
