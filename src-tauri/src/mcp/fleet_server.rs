//! Local MCP server for the Fleet View (v1.2.0)
//!
//! Exposes MiWarp's digital-employee surface to any MCP-compatible client
//! (ChatGPT Custom Connector, Claude Desktop, etc.) over the local web_server.
//!
//! Transport: Streamable HTTP per [MCP 2025-03-26 spec][spec] — simplified
//! v1.2.0 MVP:
//! - `POST /mcp/fleet`     → JSON-RPC 2.0 request/response
//! - `GET  /mcp/fleet`     → 405 (SSE server-initiated stream deferred to v1.2.1)
//! - `DELETE /mcp/fleet`   → 200 (session termination, no-op for v1.2.0)
//!
//! Auth: same bearer token as the REST fleet API. The router's
//! `bearer_middleware` enforces this before the handler runs.
//!
//! Supported JSON-RPC methods:
//! - `initialize`             → server info + capabilities
//! - `tools/list`             → list of 8 fleet tools
//! - `tools/call`             → dispatch to fleet commands
//! - `resources/list`         → list of `miwarp://` resource templates
//! - `resources/read`         → fetch a resource snapshot
//! - `ping`                   → returns empty
//!
//! [spec]: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{Response, StatusCode};
use axum::routing::post;
use axum::Router;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::commands::fleet;
use crate::models::FleetMemberSummary;
use crate::web_server::fleet_api::BearerAuth;
use crate::web_server::state::AppState;

// ── JSON-RPC 2.0 envelope ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

// JSON-RPC 2.0 standard error codes
const ERR_PARSE: i32 = -32700;
const ERR_INVALID_REQUEST: i32 = -32600;
const ERR_METHOD_NOT_FOUND: i32 = -32601;
const ERR_INVALID_PARAMS: i32 = -32602;
const ERR_INTERNAL: i32 = -32603;

fn ok(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

fn err(id: Value, code: i32, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    })
}

// ── Build the sub-router ─────────────────────────────────────────

/// Build the MCP fleet server router. Returns `Router<AppState>` — caller
/// is responsible for `with_state()` at the top level.
pub fn build_mcp_router() -> Router<AppState> {
    Router::new().route(
        "/mcp/fleet",
        post(post_handler).get(get_handler).delete(delete_handler),
    )
}

/// POST /mcp/fleet — JSON-RPC request/response handler.
async fn post_handler(
    _auth: BearerAuth,
    State(state): State<AppState>,
    body: Bytes,
) -> Response<Body> {
    // Parse JSON-RPC
    let parsed: Result<JsonRpcRequest, _> = serde_json::from_slice(&body);
    let rpc = match parsed {
        Ok(r) => r,
        Err(e) => {
            return json_response(err(Value::Null, ERR_PARSE, &format!("invalid JSON: {e}")));
        }
    };

    if rpc.jsonrpc != "2.0" {
        let id = rpc.id.clone().unwrap_or(Value::Null);
        return json_response(err(id, ERR_INVALID_REQUEST, "jsonrpc must be \"2.0\""));
    }

    let id = rpc.id.clone().unwrap_or(Value::Null);

    // Dispatch
    let response = match rpc.method.as_str() {
        "initialize" => handle_initialize(id, rpc.params),
        "ping" => ok(id, json!({})),
        "tools/list" => handle_tools_list(id),
        "tools/call" => handle_tools_call(id, rpc.params, state).await,
        "resources/list" => handle_resources_list(id),
        "resources/read" => handle_resources_read(id, rpc.params, state).await,
        other => err(
            id,
            ERR_METHOD_NOT_FOUND,
            &format!("method not found: {other}"),
        ),
    };

    json_response(response)
}

/// GET /mcp/fleet — SSE stream (deferred to v1.2.1).
async fn get_handler() -> Response<Body> {
    Response::builder()
        .status(StatusCode::METHOD_NOT_ALLOWED)
        .header("allow", "POST, DELETE")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"error": "SSE server-initiated stream not yet implemented; use POST for request/response"})
                .to_string(),
        ))
        .unwrap()
}

/// DELETE /mcp/fleet — session termination (no-op for v1.2.0).
async fn delete_handler() -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .body(Body::empty())
        .unwrap()
}

fn json_response(v: Value) -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(Body::from(v.to_string()))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .expect("fallback")
        })
}

// ── initialize ───────────────────────────────────────────────────

const SERVER_INFO: &str = "MiWarp Fleet MCP Server";
const SERVER_VERSION: &str = "1.2.0";
const PROTOCOL_VERSION: &str = "2025-03-26";

fn handle_initialize(id: Value, _params: Option<Value>) -> Value {
    ok(
        id,
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {
                "tools": { "listChanged": false },
                "resources": { "subscribe": false, "listChanged": false }
            },
            "serverInfo": {
                "name": SERVER_INFO,
                "version": SERVER_VERSION
            }
        }),
    )
}

// ── tools/list ───────────────────────────────────────────────────

fn handle_tools_list(id: Value) -> Value {
    ok(
        id,
        json!({
            "tools": [
                tool_schema(
                    "list_employees",
                    "List all digital employees (active session actors).",
                    json!({
                        "type": "object",
                        "properties": {
                            "status": { "type": "string", "enum": ["idle", "running", "awaiting_permission", "error", "stopped", "detached"] },
                            "agent": { "type": "string" }
                        }
                    }),
                ),
                tool_schema(
                    "get_employee",
                    "Get details for a single employee (run_id).",
                    json!({
                        "type": "object",
                        "properties": { "id": { "type": "string" } },
                        "required": ["id"]
                    }),
                ),
                tool_schema(
                    "send_to_employee",
                    "Send a prompt to an existing employee (creates a new run if actor is gone).",
                    json!({
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "prompt": { "type": "string" }
                        },
                        "required": ["id", "prompt"]
                    }),
                ),
                tool_schema(
                    "stop_employee",
                    "Stop a running employee (kills the actor).",
                    json!({
                        "type": "object",
                        "properties": { "id": { "type": "string" } },
                        "required": ["id"]
                    }),
                ),
                tool_schema(
                    "list_runs",
                    "List recent runs (optionally filtered by employee id).",
                    json!({
                        "type": "object",
                        "properties": {
                            "employee_id": { "type": "string" },
                            "limit": { "type": "integer", "default": 50 }
                        }
                    }),
                ),
                tool_schema(
                    "get_run",
                    "Get details for a specific run.",
                    json!({
                        "type": "object",
                        "properties": { "run_id": { "type": "string" } },
                        "required": ["run_id"]
                    }),
                ),
                tool_schema(
                    "fleet_metrics",
                    "Get aggregate fleet metrics (total / by-status / by-agent / today's tokens + cost).",
                    json!({ "type": "object", "properties": {} }),
                ),
                tool_schema(
                    "search_memory",
                    "Search prompt history across all runs (case-insensitive substring).",
                    json!({
                        "type": "object",
                        "properties": {
                            "query": { "type": "string" },
                            "limit": { "type": "integer", "default": 20 }
                        },
                        "required": ["query"]
                    }),
                ),
            ]
        }),
    )
}

fn tool_schema(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema
    })
}

// ── tools/call ───────────────────────────────────────────────────

async fn handle_tools_call(id: Value, params: Option<Value>, state: AppState) -> Value {
    let Some(params) = params else {
        return err(id, ERR_INVALID_PARAMS, "params is required for tools/call");
    };
    let tool_name = match params.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return err(id, ERR_INVALID_PARAMS, "params.name is required"),
    };
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    match tool_name.as_str() {
        "list_employees" => {
            let sessions = state.sessions.clone();
            match fleet::list_fleet_inner(sessions).await {
                Ok(mut members) => {
                    // Client-side filter (server-side filter would need query parsing
                    // — deferring to v1.2.1)
                    if let Some(status) = args.get("status").and_then(|v| v.as_str()) {
                        members.retain(|m: &FleetMemberSummary| m.status.to_string() == status);
                    }
                    if let Some(agent) = args.get("agent").and_then(|v| v.as_str()) {
                        members.retain(|m| m.agent == agent);
                    }
                    tool_ok(
                        id,
                        &serde_json::to_string(&members).unwrap_or_else(|_| "[]".into()),
                    )
                }
                Err(e) => tool_err(id, &e),
            }
        }
        "get_employee" => {
            let emp_id = match args.get("id").and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => return err(id, ERR_INVALID_PARAMS, "arguments.id is required"),
            };
            let sessions = state.sessions.clone();
            match fleet::get_fleet_member_inner(emp_id, sessions).await {
                Ok(d) => tool_ok(
                    id,
                    &serde_json::to_string(&d).unwrap_or_else(|_| "{}".into()),
                ),
                Err(e) if e.contains("not found") => {
                    tool_err(id, &format!("Employee not found: {e}"))
                }
                Err(e) => tool_err(id, &e),
            }
        }
        "send_to_employee" => {
            let emp_id = args
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let prompt = args
                .get("prompt")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let (Some(emp_id), Some(prompt)) = (emp_id, prompt) else {
                return err(
                    id,
                    ERR_INVALID_PARAMS,
                    "arguments.id and arguments.prompt are required",
                );
            };
            match fleet::send_to_fleet_member(emp_id, prompt).await {
                Ok(r) => tool_ok(
                    id,
                    &serde_json::to_string(&r).unwrap_or_else(|_| "{}".into()),
                ),
                Err(e) => tool_err(id, &e),
            }
        }
        "stop_employee" => {
            let emp_id = match args.get("id").and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => return err(id, ERR_INVALID_PARAMS, "arguments.id is required"),
            };
            let sessions = state.sessions.clone();
            let process_map = state.process_map.clone();
            match fleet::stop_fleet_member_inner(emp_id, sessions, process_map).await {
                Ok(_) => tool_ok(id, r#"{"stopped": true}"#),
                Err(e) => tool_err(id, &e),
            }
        }
        "fleet_metrics" => {
            let sessions = state.sessions.clone();
            match fleet::get_fleet_metrics_inner(sessions).await {
                Ok(m) => tool_ok(
                    id,
                    &serde_json::to_string(&m).unwrap_or_else(|_| "{}".into()),
                ),
                Err(e) => tool_err(id, &e),
            }
        }
        "list_runs" => {
            // v1.2.0 MVP: returns all recent runs (no employee_id filter yet —
            // the metadata doesn't carry employee_id, but RunMeta.id IS the
            // employee id, so client-side filter is trivial).
            let mut out = crate::storage::runs::list_runs_lite();
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize)
                .unwrap_or(50);
            out.truncate(limit);
            tool_ok(
                id,
                &serde_json::to_string(&out).unwrap_or_else(|_| "[]".into()),
            )
        }
        "get_run" => {
            let run_id = match args.get("run_id").and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => return err(id, ERR_INVALID_PARAMS, "arguments.run_id is required"),
            };
            match crate::storage::runs::get_run(&run_id) {
                Some(meta) => {
                    let task_run = meta.to_task_run(None, None, None);
                    tool_ok(
                        id,
                        &serde_json::to_string(&task_run).unwrap_or_else(|_| "{}".into()),
                    )
                }
                None => tool_err(id, &format!("Run {run_id} not found")),
            }
        }
        "search_memory" => {
            let query = match args.get("query").and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => return err(id, ERR_INVALID_PARAMS, "arguments.query is required"),
            };
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize)
                .unwrap_or(20);
            // Defer to chat-side search by reusing `search_prompts` storage logic.
            // For v1.2.0 MVP we just call the same storage path; full feature
            // parity with `commands::runs::search_prompts` is straightforward.
            match crate::storage::prompt_index::build_or_update_index() {
                Ok(entries) => {
                    let query_lower = query.to_lowercase();
                    let matched: Vec<_> = entries
                        .into_iter()
                        .filter(|e| e.text.to_lowercase().contains(&query_lower))
                        .take(limit)
                        .collect();
                    tool_ok(
                        id,
                        &serde_json::to_string(&matched).unwrap_or_else(|_| "[]".into()),
                    )
                }
                Err(e) => tool_err(id, &e),
            }
        }
        other => err(
            id,
            ERR_METHOD_NOT_FOUND,
            &format!("tool not found: {other}"),
        ),
    }
}

fn tool_ok(id: Value, text: &str) -> Value {
    ok(
        id,
        json!({
            "content": [{ "type": "text", "text": text }],
            "isError": false
        }),
    )
}

fn tool_err(id: Value, message: &str) -> Value {
    ok(
        id,
        json!({
            "content": [{ "type": "text", "text": format!("Error: {message}") }],
            "isError": true
        }),
    )
}

// ── resources/list + resources/read ─────────────────────────────

fn handle_resources_list(id: Value) -> Value {
    ok(
        id,
        json!({
            "resources": [
                {
                    "uri": "miwarp://employees",
                    "name": "Fleet employees",
                    "description": "Snapshot of all current digital employees",
                    "mimeType": "application/json"
                },
                {
                    "uri": "miwarp://metrics",
                    "name": "Fleet metrics",
                    "description": "Aggregate fleet counts and token usage",
                    "mimeType": "application/json"
                }
            ]
        }),
    )
}

async fn handle_resources_read(id: Value, params: Option<Value>, state: AppState) -> Value {
    let Some(uri) = params
        .as_ref()
        .and_then(|p| p.get("uri"))
        .and_then(|v| v.as_str())
    else {
        return err(id, ERR_INVALID_PARAMS, "params.uri is required");
    };

    match uri {
        "miwarp://employees" => {
            let sessions = state.sessions.clone();
            match fleet::list_fleet_inner(sessions).await {
                Ok(members) => ok(
                    id,
                    json!({
                        "contents": [{
                            "uri": uri,
                            "mimeType": "application/json",
                            "text": serde_json::to_string(&members).unwrap_or_else(|_| "[]".into())
                        }]
                    }),
                ),
                Err(e) => err(id, ERR_INTERNAL, &e),
            }
        }
        "miwarp://metrics" => {
            let sessions = state.sessions.clone();
            match fleet::get_fleet_metrics_inner(sessions).await {
                Ok(m) => ok(
                    id,
                    json!({
                        "contents": [{
                            "uri": uri,
                            "mimeType": "application/json",
                            "text": serde_json::to_string(&m).unwrap_or_else(|_| "{}".into())
                        }]
                    }),
                ),
                Err(e) => err(id, ERR_INTERNAL, &e),
            }
        }
        other if other.starts_with("miwarp://employees/") => {
            let emp_id = other.trim_start_matches("miwarp://employees/").to_string();
            let sessions = state.sessions.clone();
            match fleet::get_fleet_member_inner(emp_id, sessions).await {
                Ok(detail) => ok(
                    id,
                    json!({
                        "contents": [{
                            "uri": uri,
                            "mimeType": "application/json",
                            "text": serde_json::to_string(&detail).unwrap_or_else(|_| "{}".into())
                        }]
                    }),
                ),
                Err(e) => err(id, ERR_INTERNAL, &e),
            }
        }
        other => err(
            id,
            ERR_INVALID_PARAMS,
            &format!("unknown resource: {other}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_info_is_static() {
        assert_eq!(SERVER_INFO, "MiWarp Fleet MCP Server");
        assert_eq!(SERVER_VERSION, "1.2.0");
        assert_eq!(PROTOCOL_VERSION, "2025-03-26");
    }

    #[test]
    fn ok_envelope_includes_jsonrpc_field() {
        let v = ok(json!(1), json!({}));
        assert_eq!(v["jsonrpc"], "2.0");
        assert_eq!(v["id"], 1);
    }

    #[test]
    fn err_envelope_carries_code() {
        let v = err(json!(1), ERR_METHOD_NOT_FOUND, "nope");
        assert_eq!(v["error"]["code"], ERR_METHOD_NOT_FOUND);
        assert_eq!(v["error"]["message"], "nope");
    }

    #[test]
    fn tool_ok_wraps_text() {
        let v = tool_ok(json!(1), "hello");
        assert_eq!(v["result"]["content"][0]["text"], "hello");
        assert_eq!(v["result"]["isError"], false);
    }

    #[test]
    fn tool_err_marks_error_flag() {
        let v = tool_err(json!(1), "boom");
        assert_eq!(v["result"]["isError"], true);
        assert!(v["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("boom"));
    }

    #[test]
    fn initialize_returns_required_fields() {
        let r = handle_initialize(json!(1), None);
        assert_eq!(r["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert!(r["result"]["capabilities"]["tools"].is_object());
        assert!(r["result"]["capabilities"]["resources"].is_object());
        assert_eq!(r["result"]["serverInfo"]["name"], SERVER_INFO);
    }

    #[test]
    fn tools_list_has_eight_tools() {
        let r = handle_tools_list(json!(1));
        let tools = r["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 8);
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"list_employees"));
        assert!(names.contains(&"get_employee"));
        assert!(names.contains(&"send_to_employee"));
        assert!(names.contains(&"stop_employee"));
        assert!(names.contains(&"list_runs"));
        assert!(names.contains(&"get_run"));
        assert!(names.contains(&"fleet_metrics"));
        assert!(names.contains(&"search_memory"));
    }

    #[test]
    fn resources_list_returns_two() {
        let r = handle_resources_list(json!(1));
        let resources = r["result"]["resources"].as_array().unwrap();
        assert_eq!(resources.len(), 2);
        assert_eq!(resources[0]["uri"], "miwarp://employees");
        assert_eq!(resources[1]["uri"], "miwarp://metrics");
    }

    #[test]
    fn ping_returns_empty_object() {
        let r = ok(json!(1), json!({}));
        assert_eq!(r["result"], json!({}));
    }

    #[test]
    fn unknown_method_returns_minus_32601() {
        let r = err(json!(1), ERR_METHOD_NOT_FOUND, "x");
        assert_eq!(r["error"]["code"], -32601);
    }
}
