use serde::{Deserialize, Serialize};
use serde_json::Value;
use super::run::{AgentRuntimeKind, RunMeta, RunStatus};

pub struct RawRunUsage {
    pub total_cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub duration_ms: u64,
    pub num_turns: u64,
    pub model_usage: HashMap<String, ModelUsageSummary>,
}

/// Per-run usage summary (RunMeta + usage data), returned by IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunUsageSummary {
    pub run_id: String,
    pub name: String,
    pub agent: String,
    pub model: Option<String>,
    pub status: RunStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub total_cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub duration_ms: u64,
    pub num_turns: u64,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub model_usage: HashMap<String, ModelUsageSummary>,
}

/// Per-model token and cost summary.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageSummary {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub cost_usd: f64,
}

/// Aggregated usage overview across all runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageOverview {
    pub total_cost_usd: f64,
    pub total_tokens: u64,
    pub total_runs: u32,
    pub avg_cost_per_run: f64,
    pub by_model: Vec<ModelAggregate>,
    pub daily: Vec<DailyAggregate>,
    pub runs: Vec<RunUsageSummary>,
    /// How the data was produced: "memory", "disk", "incremental", "full".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_mode: Option<String>,
    /// Number of days with activity.
    #[serde(default)]
    pub active_days: u32,
    /// Current consecutive active days (including today).
    #[serde(default)]
    pub current_streak: u32,
    /// Longest consecutive active days ever.
    #[serde(default)]
    pub longest_streak: u32,
}

/// Per-model aggregate stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelAggregate {
    pub model: String,
    pub runs: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub cost_usd: f64,
    pub pct: f64,
}

/// Daily aggregate stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyAggregate {
    pub date: String,
    pub cost_usd: f64,
    pub runs: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Message count (Global mode — from Claude Code stats-cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_count: Option<u32>,
    /// Session count (Global mode — from Claude Code stats-cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_count: Option<u32>,
    /// Tool call count (Global mode — from Claude Code stats-cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_count: Option<u32>,
    /// Per-model token breakdown (populated for last 30 daily entries only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_breakdown: Option<std::collections::HashMap<String, ModelTokens>>,
}

/// Per-model token counts for a single day (stacked chart).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelTokens {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

// ── CLI Control Protocol types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliModelInfo {
    pub value: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(
        default,
        rename = "supportsEffort",
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_effort: Option<bool>,
    #[serde(
        default,
        rename = "supportedEffortLevels",
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_effort_levels: Option<Vec<String>>,
    #[serde(
        default,
        rename = "supportsAdaptiveThinking",
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_adaptive_thinking: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliCommand {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliAccount {
    #[serde(default, rename = "tokenSource")]
    pub token_source: String,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliInfo {
    #[serde(default)]
    pub agent: String,
    pub runtime_kind: AgentRuntimeKind,
    pub models: Vec<CliModelInfo>,
    pub commands: Vec<CliCommand>,
    #[serde(default)]
    pub available_output_styles: Vec<String>,
    pub account: Option<CliAccount>,
    /// The model currently selected in Claude Code (from ~/.claude/settings.json)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_model: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliInfoError {
    pub code: String,
    pub message: String,
}

pub struct ModelUsageEntry {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub cache_write_tokens: u64,
    #[serde(default)]
    pub web_search_requests: u64,
    pub cost_usd: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    /// Maximum output tokens for this model (e.g. 32000).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u64>,
}

// ── MCP server info ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInfo {
    pub name: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Ralph Loop types ──

/// Reason a Ralph loop ended. Serializes to snake_case for frontend union matching.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
