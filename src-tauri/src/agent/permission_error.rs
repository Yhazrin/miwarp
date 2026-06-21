//! Typed permission error contract.
//!
//! Mirrors `src/lib/chat/permission-coordinator/types.ts`.
//! Wire format: a `PermissionError { code, message, retryable }` JSON
//! object. The frontend `PermissionError` class deserializes this and
//! surfaces it through the coordinator's `failed` transition.
//!
//! Contract: every `respond_permission` / `respond_hook_callback`
//! failure path MUST classify the failure into one of these codes
//! before returning to the caller. Free-form `String` errors are
//! reserved for backend startup failures (actor dead, session not
//! found) where the contract is genuinely unknown.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionErrorCode {
    UnknownRequest,
    AlreadyCancelled,
    RunMismatch,
    Duplicate,
    DangerToolBlocked,
    Transport,
    Timeout,
    Unknown,
}

impl PermissionErrorCode {
    pub fn wire(self) -> &'static str {
        match self {
            Self::UnknownRequest => "unknown_request",
            Self::AlreadyCancelled => "already_cancelled",
            Self::RunMismatch => "run_mismatch",
            Self::Duplicate => "duplicate",
            Self::DangerToolBlocked => "danger_tool_blocked",
            Self::Transport => "transport",
            Self::Timeout => "timeout",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct PermissionError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl PermissionError {
    pub fn new(code: PermissionErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.wire(),
            message: message.into(),
            retryable,
        }
    }
}

impl std::fmt::Display for PermissionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for PermissionError {}

/// Tools whose permanent allow is forbidden.
/// Mirrors `storage::shared::NEVER_ALLOW_TOOLS` and the frontend
/// `permission-mode-contract.ts::NEVER_ALLOW_TOOLS` list.
pub const NEVER_ALLOW_TOOLS: &[&str] = &["ExitPlanMode", "EnterPlanMode"];

pub fn is_permanent_allow_blocked(tool_name: &str) -> bool {
    NEVER_ALLOW_TOOLS.contains(&tool_name)
}
