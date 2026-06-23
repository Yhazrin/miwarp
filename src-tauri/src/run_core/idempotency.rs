use super::RunIdempotencyClass;

/// Conservative classification: known read-only tools only; unknown writes are
/// non-idempotent. Never assume optimistic safe retry for unrecognized tools.
pub fn classify_tool_idempotency(tool_name: &str) -> RunIdempotencyClass {
    let normalized = tool_name.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "read" | "glob" | "grep" | "list" | "ls" | "search" | "webfetch" | "web_fetch"
        | "websearch" | "web_search" | "think" | "todo_read" | "diagnostics" | "git_status"
        | "git_diff" | "git_log" | "git_show" => RunIdempotencyClass::ReadOnly,
        // A full-content write is repeatable to the same final state. Patch,
        // notebook and agent/task tools are deliberately not included: their
        // retry semantics depend on mutable context and require confirmation.
        "write" => RunIdempotencyClass::IdempotentWrite,
        _ => RunIdempotencyClass::NonIdempotent,
    }
}
