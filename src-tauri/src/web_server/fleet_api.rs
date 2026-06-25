//! Fleet View REST API (v1.2.0)
//!
//! Exposes the fleet aggregation commands over HTTP under `/api/fleet/*`.
//! Auth: reuses the existing bearer token (same `Authorization: Bearer <token>`
//! or `X-MiWarp-Token: <token>` or `?token=` query patterns accepted by the
//! `/ws` endpoint). Implemented as a custom extractor `BearerAuth` to avoid
//! axum middleware type gymnastics.
//!
//! Routes (under `/api/fleet` prefix):
//!   GET    /members            → FleetMemberSummary[]
//!   GET    /members/{id}       → FleetMemberDetail
//!   POST   /members/{id}/send  → FleetSendResult
//!   POST   /members/{id}/stop  → { stopped: bool }
//!   GET    /metrics            → FleetMetrics
//!
//! The live-update WebSocket lives in `web_server::fleet_ws` and is wired
//! into `router::build_router` directly (not via this module).

use axum::body::Body;
use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::http::{Response, StatusCode};
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::commands::fleet;
use crate::web_server::state::AppState;

/// Result of stop endpoint.
#[derive(Serialize)]
struct StopResult {
    stopped: bool,
}

/// Custom extractor that validates the bearer token.
/// On success, the handler runs. On failure, returns 403 JSON.
pub struct BearerAuth;

#[axum::async_trait]
impl FromRequestParts<AppState> for BearerAuth {
    type Rejection = Response<Body>;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let headers = &parts.headers;

        let from_auth = headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.strip_prefix("Bearer ")
                    .or_else(|| v.strip_prefix("bearer "))
                    .map(|s| s.to_string())
            });

        let from_x = headers
            .get("x-miwarp-token")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let from_query = parts.uri.query().and_then(|q| {
            q.split('&')
                .find_map(|p| p.strip_prefix("token=").map(|s| s.to_string()))
        });

        let candidate = from_auth.or(from_x).or(from_query);
        let token_ok = matches!(candidate, Some(t) if t == *state.token.read().await);

        if !token_ok {
            log::debug!("[fleet_api] BearerAuth rejected: invalid or missing token");
            return Err(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"error": "invalid or missing token"}).to_string(),
                ))
                .unwrap_or_else(|_| {
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Body::empty())
                        .expect("fallback")
                }));
        }

        Ok(BearerAuth)
    }
}

/// Build the fleet API router. Returns `Router<AppState>` — caller is
/// responsible for `with_state()` at the top level.
pub fn build_fleet_router() -> Router<AppState> {
    Router::new()
        .route("/members", get(list_members_handler))
        .route("/members/:id", get(get_member_handler))
        .route("/members/:id/send", post(send_to_member_handler))
        .route("/members/:id/stop", post(stop_member_handler))
        .route("/metrics", get(metrics_handler))
}

// ── Handlers ────────────────────────────────────────────────────────

/// Query string for `GET /members`. `include_archived=true` is opt-in; the
/// default is to hide archived members, matching the desktop UI.
#[derive(Debug, Deserialize, Default)]
struct ListMembersQuery {
    #[serde(default)]
    include_archived: bool,
}

async fn list_members_handler(
    State(state): State<AppState>,
    _auth: BearerAuth,
    Query(q): Query<ListMembersQuery>,
) -> impl IntoResponse {
    let sessions = state.sessions.clone();
    match fleet::list_fleet_inner(sessions, q.include_archived).await {
        Ok(v) => Json(json!(v)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn get_member_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _auth: BearerAuth,
) -> impl IntoResponse {
    let sessions = state.sessions.clone();
    match fleet::get_fleet_member_inner(id, sessions).await {
        Ok(v) => Json(json!(v)).into_response(),
        Err(e) if e.contains("not found") => {
            (StatusCode::NOT_FOUND, Json(json!({"error": e}))).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn send_to_member_handler(
    State(state): State<AppState>,
    _auth: BearerAuth,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let prompt = body
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if prompt.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "prompt is required"})),
        )
            .into_response();
    }
    let sessions = state.sessions.clone();
    match fleet::send_to_fleet_member_inner(sessions, id, prompt).await {
        Ok(v) => Json(json!(v)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn stop_member_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _auth: BearerAuth,
) -> impl IntoResponse {
    let sessions = state.sessions.clone();
    let process_map = state.process_map.clone();
    match fleet::stop_fleet_member_inner(id, sessions, process_map).await {
        Ok(stopped) => Json(json!(StopResult { stopped })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

async fn metrics_handler(
    State(state): State<AppState>,
    _auth: BearerAuth,
    Query(q): Query<ListMembersQuery>,
) -> impl IntoResponse {
    let sessions = state.sessions.clone();
    match fleet::get_fleet_metrics_inner(sessions, q.include_archived).await {
        Ok(v) => Json(json!(v)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}
