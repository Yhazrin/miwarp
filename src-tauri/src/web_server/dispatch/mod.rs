mod handlers;
mod middleware;
mod routes;
mod session_handlers;

// Re-export public helpers for backward compatibility
pub use middleware::{camel_to_snake, extract_str, extract_u64, normalize_top_level_keys};

use serde_json::Value;
use std::time::Instant;

use crate::web_server::state::AppState;

/// Dispatch a JSON-RPC method call to the corresponding command handler.
/// Returns Ok(result_value) or Err(error_string).
pub async fn dispatch_command(
    method: &str,
    params: Value,
    state: &AppState,
) -> Result<Value, String> {
    let start = Instant::now();
    // Normalize camelCase → snake_case for top-level param keys only
    let params = normalize_top_level_keys(params);

    log::debug!("[dispatch] method={}", method);

    let result = routes::dispatch_method(method, params, state).await;

    let elapsed = start.elapsed();
    if elapsed.as_millis() > 100 {
        log::debug!(
            "[dispatch] method={} took {}ms",
            method,
            elapsed.as_millis()
        );
    }

    result
}

#[cfg(test)]
mod tests;
