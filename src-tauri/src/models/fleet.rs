use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use super::run::TaskRun;

pub enum FleetStatus {
    /// Actor alive, no active turn
    Idle,
    /// Actor actively processing a turn
    Running,
    /// Waiting for user permission / approval / input
    AwaitingPermission,
    /// Process exited with non-zero / actor entered error state
    Error,
    /// User-initiated stop or actor completed
    Stopped,
    /// Meta exists but actor is gone (orphaned / detached)
    Detached,
}

impl std::fmt::Display for FleetStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            FleetStatus::Idle => "idle",
            FleetStatus::Running => "running",
            FleetStatus::AwaitingPermission => "awaiting_permission",
            FleetStatus::Error => "error",
            FleetStatus::Stopped => "stopped",
            FleetStatus::Detached => "detached",
        };
        f.write_str(s)
    }
}

/// Per-employee runtime metrics.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FleetMemberMetrics {
    pub uptime_secs: u64,
    pub tool_calls: u32,
    pub tokens_used: u64,
    pub cost_usd_estimate: f64,
    pub message_count: u32,
}

/// Lightweight per-employee summary for grid display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetMemberSummary {
    pub id: String,
    pub agent: String,
    pub status: FleetStatus,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_alias: Option<String>,
    pub started_at: String,
    pub last_activity_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_task_preview: Option<String>,
    pub metrics: FleetMemberMetrics,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// Detailed per-employee view (drawer / MCP get_employee).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetMemberDetail {
    #[serde(flatten)]
    pub summary: FleetMemberSummary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub team_ids: Vec<String>,
    #[serde(default)]
    pub recent_runs: Vec<TaskRun>,
}

/// Aggregate fleet metrics for header / MCP fleet_metrics.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FleetMetrics {
    pub total: u32,
    pub by_status: std::collections::HashMap<String, u32>,
    pub by_agent: std::collections::HashMap<String, u32>,
    pub total_tokens_today: u64,
    pub total_cost_today_usd: f64,
}

/// Result of fleet_send (forwarded from start_run).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetSendResult {
    pub run_id: String,
    pub accepted: bool,
}
