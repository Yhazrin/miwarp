use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamConfig {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "createdAt", default)]
    pub created_at: u64,
    #[serde(rename = "leadAgentId", default)]
    pub lead_agent_id: String,
    #[serde(rename = "leadSessionId", default)]
    pub lead_session_id: String,
    #[serde(default)]
    pub members: Vec<TeamMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    #[serde(rename = "agentId")]
    pub agent_id: String,
    pub name: String,
    #[serde(rename = "agentType", default)]
    pub agent_type: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub color: String,
    #[serde(rename = "planModeRequired", default)]
    pub plan_mode_required: bool,
    #[serde(rename = "joinedAt", default)]
    pub joined_at: u64,
    #[serde(rename = "tmuxPaneId", default)]
    pub tmux_pane_id: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub subscriptions: Vec<String>,
    #[serde(rename = "backendType", default)]
    pub backend_type: String,
    /// The prompt given to spawned teammates (not present on leader)
    #[serde(default)]
    pub prompt: String,
    /// Runtime active status (set by setMemberActive in Claude Code SDK)
    #[serde(rename = "isActive", default)]
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamInboxMessage {
    #[serde(default)]
    pub from: String,
    pub text: String,
    #[serde(default)]
    pub summary: String,
    pub timestamp: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub read: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamTask {
    pub id: String,
    pub subject: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "activeForm", default)]
    pub active_form: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(rename = "blockedBy", default)]
    pub blocked_by: Vec<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSummary {
    pub name: String,
    pub description: String,
    pub member_count: usize,
    pub task_count: usize,
    pub created_at: u64,
}

// ── Plugin types ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TeamRunStatus {
    Created,
    Planning,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for TeamRunStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TeamRunStatus::Created => write!(f, "created"),
            TeamRunStatus::Planning => write!(f, "planning"),
            TeamRunStatus::Running => write!(f, "running"),
            TeamRunStatus::Completed => write!(f, "completed"),
            TeamRunStatus::Failed => write!(f, "failed"),
            TeamRunStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TeamMemberStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPresetMember {
    pub id: String,
    pub name: String,
    pub role: String,
    pub system_prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub members: Vec<TeamPresetMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberRun {
    pub id: String,
    pub member_id: String,
    pub member_name: String,
    pub role: String,
    pub task: String,
    pub status: TeamMemberStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamRun {
    pub id: String,
    pub team_name: String,
    pub preset_id: String,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_run_id: Option<String>,
    pub prompt: String,
    #[serde(default = "default_team_mode")]
    pub mode: String,
    pub status: TeamRunStatus,
    pub member_runs: Vec<TeamMemberRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_plan: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_team_mode() -> String {
    "plan_first".to_string()
}
