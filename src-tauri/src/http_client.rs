/**
 * v1.0.6 / 10.4: Shared singleton HTTP client.
 *
 * Creating a `reqwest::Client` per request is expensive (TLS setup, connection pool).
 * This module provides a single shared instance with sensible defaults that all
 * backend modules can reuse.
 */
use std::sync::LazyLock;

/// Shared HTTP client with connection pooling and reasonable timeouts.
/// Use this instead of `reqwest::Client::builder().build()` in individual modules.
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .pool_max_idle_per_host(4)
        .user_agent("miwarp")
        .build()
        .unwrap_or_default()
});

/// Get a clone of the shared HTTP client (cheap — clones Arc internally).
pub fn http_client() -> reqwest::Client {
    HTTP_CLIENT.clone()
}
