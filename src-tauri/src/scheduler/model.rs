use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Agent {
    Claude,
    Codex,
}

impl Default for Agent {
    fn default() -> Self {
        Self::Claude
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ScheduleType {
    Cron,
    OneTime,
    Interval,
}

impl Default for ScheduleType {
    fn default() -> Self {
        Self::Cron
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub cwd: String,
    #[serde(default)]
    pub remote_host_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleConfig {
    #[serde(rename = "type", default)]
    pub schedule_type: ScheduleType,
    #[serde(default)]
    pub cron_expression: Option<String>,
    #[serde(default)]
    pub fire_at: Option<String>,
    #[serde(default)]
    pub interval_minutes: Option<u32>,
    #[serde(default)]
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub prompt: String,
    pub workspace: WorkspaceInfo,
    #[serde(default)]
    pub agent: Agent,
    #[serde(default)]
    pub schedule: ScheduleConfig,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default = "default_true")]
    pub notify_on_completion: bool,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub last_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRun {
    pub id: String,
    pub task_id: String,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub started_at: String,
    #[serde(default)]
    pub ended_at: Option<String>,
    pub status: RunStatus,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

/// Input for creating a new scheduled task.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub prompt: String,
    pub workspace: WorkspaceInfo,
    #[serde(default)]
    pub agent: Agent,
    pub schedule: ScheduleConfig,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default = "default_true")]
    pub notify_on_completion: bool,
}

/// Partial update for an existing scheduled task.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<Option<String>>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub workspace: Option<WorkspaceInfo>,
    #[serde(default)]
    pub agent: Option<Agent>,
    #[serde(default)]
    pub schedule: Option<ScheduleConfig>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub permission_mode: Option<Option<String>>,
    #[serde(default)]
    pub model: Option<Option<String>>,
    #[serde(default)]
    pub provider: Option<Option<String>>,
    #[serde(default)]
    pub notify_on_completion: Option<bool>,
}
