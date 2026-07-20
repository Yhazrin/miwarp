use super::run::RunStatus;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalProxyStatus {
    pub proxy_id: String,
    pub running: bool,
    pub needs_auth: bool,
    pub base_url: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub reply: Option<String>,
    pub error: Option<String>,
    /// True when auth+connectivity OK but probe model was rejected (no user model configured).
    pub partial: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryFileCandidate {
    pub path: String,
    pub label: String,
    pub scope: String, // "project" | "global" | "memory"
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<DirEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDelta {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDone {
    pub ok: bool,
    pub code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    #[serde(rename = "type")]
    pub mime_type: String,
    pub size: u64,
    #[serde(rename = "contentBase64")]
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSearchResult {
    pub run_id: String,
    pub run_name: Option<String>,
    pub run_prompt: String,
    pub agent: String,
    pub model: Option<String>,
    pub status: RunStatus,
    pub started_at: String,
    pub matched_text: String,
    pub matched_seq: u64,
    pub matched_ts: String,
    /// Stable event ID: uuid (user_message) or message_id (message_complete).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_event_id: Option<String>,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptFavorite {
    pub run_id: String,
    pub seq: u64,
    pub text: String,
    pub tags: Vec<String>,
    pub note: String,
    pub created_at: String,
}

// ── History search ──

/// History 页面搜索过滤条件
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchFilters {
    pub query: Option<String>,
    pub projects: Option<Vec<String>>,
    pub tools: Option<Vec<String>>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub cost_min: Option<f64>,
    pub cost_max: Option<f64>,
    pub statuses: Option<Vec<RunStatus>>,
    pub has_errors: Option<bool>,
    pub agents: Option<Vec<String>>,
    pub sort_by: Option<String>,
    pub sort_asc: Option<bool>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// History 搜索结果条目
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchResult {
    pub run_id: String,
    pub cwd: String,
    pub agent: String,
    pub model: Option<String>,
    pub status: RunStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub name: Option<String>,
    pub prompt_preview: String,
    pub tools_used: Vec<String>,
    pub tool_call_count: u32,
    pub files_touched_count: u32,
    pub total_cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub duration_ms: u64,
    pub num_turns: u64,
    pub has_errors: bool,
    pub error_summary: Option<String>,
}

/// Facet 统计（用于 filter UI 下拉选项）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetCount {
    pub value: String,
    pub count: usize,
}

/// History 页面 facets
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchFacets {
    pub projects: Vec<FacetCount>,
    pub tools: Vec<FacetCount>,
    pub agents: Vec<FacetCount>,
    pub cost_range: [f64; 2],
    pub date_range: [String; 2],
    pub total_runs: usize,
    pub total_cost: f64,
}

/// History 搜索响应（结果 + facets + 总数）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchResponse {
    pub results: Vec<RunSearchResult>,
    pub facets: RunSearchFacets,
    pub total_matching: usize,
}
