//! Shared constants for opt-in runtime real E2E tests.

pub const ENV_ENABLE: &str = "MIWARP_RUNTIME_REAL_E2E";
pub const ENV_RUNTIMES: &str = "MIWARP_RUNTIME_REAL_E2E_RUNTIMES";
pub const ENV_PROBE_ONLY: &str = "MIWARP_RUNTIME_E2E_PROBE_ONLY";
pub const ENV_SMOKE_TIMEOUT_SECS: &str = "MIWARP_RUNTIME_SMOKE_TIMEOUT_SECS";
pub const ENV_PROBE_TIMEOUT_SECS: &str = "MIWARP_RUNTIME_PROBE_TIMEOUT_SECS";

pub const SKIPPED_ENVIRONMENT: &str = "SKIPPED_ENVIRONMENT";

/// Fixed, non-sensitive smoke prompt — never log this string in diagnostics output.
pub const SMOKE_PROMPT: &str = "Reply with exactly: MIWARP_SMOKE_OK";
pub const SMOKE_TOKEN: &str = "MIWARP_SMOKE_OK";

pub const DEFAULT_SMOKE_TIMEOUT_SECS: u64 = 120;
pub const DEFAULT_PROBE_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_CANCEL_GRACE_MS: u64 = 5_000;

pub const STARTABLE_RUNTIMES: &[&str] = &["claude", "codex", "mimo", "opencode", "cursor"];
