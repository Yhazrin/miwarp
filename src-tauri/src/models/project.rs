use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStack {
    pub typescript: bool,
    pub rust: bool,
    pub python: bool,
    pub go: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCommands {
    pub test: Vec<String>,
    pub build: Vec<String>,
    pub dev: Vec<String>,
    pub lint: Vec<String>,
    pub start: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocExcerpt {
    pub exists: bool,
    pub excerpt: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub stack: ProjectStack,
    pub commands: ProjectCommands,
    pub claude_md: DocExcerpt,
    pub readme: DocExcerpt,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCommit {
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub time_iso: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitStatus {
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub dirty_count: u32,
    pub last_commit: Option<LastCommit>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNotes {
    pub content: String,
    pub modified_at: Option<String>,
}
