use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub struct MarketplacePlugin {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<PluginAuthor>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    /// Raw source — string for local ("./plugins/name"), object for external
    #[serde(default)]
    pub source: Option<serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub strict: Option<bool>,
    #[serde(default, rename = "lspServers")]
    pub lsp_servers: Option<serde_json::Value>,
    // ── Fields enriched by our code (not from marketplace.json) ──
    #[serde(default)]
    pub marketplace_name: Option<String>,
    #[serde(default)]
    pub install_count: Option<u64>,
    /// Components discovered by scanning plugin subdirectories
    #[serde(default)]
    pub components: PluginComponents,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAuthor {
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginComponents {
    pub skills: Vec<String>,
    pub commands: Vec<String>,
    pub agents: Vec<String>,
    pub hooks: bool,
    pub mcp_servers: Vec<String>,
    pub lsp_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceInfo {
    pub name: String,
    pub source: serde_json::Value,
    pub install_location: String,
    pub last_updated: Option<String>,
    pub plugin_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StandaloneSkill {
    pub name: String,
    pub description: String,
    pub path: String,
    /// "user" or "project"
    #[serde(default)]
    pub scope: String,
    /// Present when installed from a remote skill source (read from .miwarp_remote.json).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_ref: Option<SkillRemoteRef>,
}

/// Lightweight skill count payload — returned by the `get_skill_summary` IPC
/// so cold-start pages (e.g. /personal hero stat) can render a number without
/// pulling every SKILL.md through the front-end or hydrating the full store.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub total: usize,
    /// Skills shipped by MiWarp itself (names listed in the built-in manifest
    /// that are present in `~/.claude/skills/`).
    pub built_in: usize,
    /// Skills the user added on top of the built-in catalogue.
    pub custom: usize,
}

// ── Skill source / remote skill registry ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRemoteRef {
    pub source_id: String,
    /// "feishu" | "github" | "folder" | "marketplace"
    pub source_type: String,
    pub remote_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    pub content_hash: String,
    pub last_synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceConfigFeishu {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wiki_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wiki_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_token: Option<String>,
    #[serde(default)]
    pub doc_tokens: Vec<String>,
    #[serde(default)]
    pub doc_urls: Vec<String>,
    #[serde(default)]
    pub include_children: bool,
    #[serde(default = "default_feishu_parser_mode")]
    pub parser_mode: String,
}

fn default_feishu_parser_mode() -> String {
    "strict".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceConfigSync {
    #[serde(default = "default_sync_mode")]
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

fn default_sync_mode() -> String {
    "manual".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceConfig {
    pub id: String,
    pub name: String,
    /// "feishu" | "github" | "folder" | "marketplace"
    pub r#type: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feishu: Option<SkillSourceConfigFeishu>,
    #[serde(default)]
    pub sync: SkillSourceConfigSync,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillDocumentContent {
    pub remote_id: String,
    pub title: String,
    pub markdown: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillDocument {
    pub content: RemoteSkillDocumentContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillCandidate {
    pub id: String,
    pub source_id: String,
    pub remote_id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub content_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    /// "not_installed" | "installed" | "update_available" | "conflict"
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceSyncResult {
    pub source_id: String,
    #[serde(default)]
    pub fetched: u32,
    #[serde(default)]
    pub skipped: u32,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub candidates: Vec<RemoteSkillCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceHealth {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRemoteSkillResult {
    pub success: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceUpdateCheck {
    pub source_id: String,
    #[serde(default)]
    pub updates: Vec<RemoteSkillUpdateItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillUpdateItem {
    pub skill_path: String,
    pub skill_name: String,
    pub remote_id: String,
    pub local_hash: String,
    pub remote_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPlugin {
    #[serde(default, alias = "id")]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub marketplace: Option<String>,
    #[serde(default, rename = "pluginId")]
    pub plugin_id: Option<String>,
    /// Project directory this plugin was installed in (project/local scope only).
    #[serde(
        default,
        rename = "projectPath",
        skip_serializing_if = "Option::is_none"
    )]
    pub project_path: Option<String>,
    /// Catch-all for unknown fields
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginOperationResult {
    pub success: bool,
    pub message: String,
}

// ── Community skill types ──

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CommunitySkillResult {
    pub id: String,
    pub name: String,
    pub skill_id: String,
    pub installs: u64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CommunitySkillDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub installs: u64,
    pub source: String,
    pub content: Option<String>,
    pub raw_url: Option<String>,
    pub skills_sh_url: Option<String>,
    pub github_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    pub available: bool,
    pub reason: Option<String>,
}

// ── MCP Registry API response types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRegistrySearchResult {
    pub servers: Vec<McpRegistryServer>,
    pub next_cursor: Option<String>,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryServer {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub packages: Vec<McpRegistryPackage>,
    #[serde(default)]
    pub remotes: Vec<McpRegistryRemote>,
    #[serde(default)]
    pub repository: Option<McpRegistryRepository>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryPackage {
    #[serde(default)]
    pub registry_type: String,
    #[serde(default)]
    pub identifier: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub environment_variables: Vec<McpRegistryEnvVar>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryRemote {
    #[serde(rename = "type", default)]
    pub remote_type: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: Vec<McpRegistryHeader>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryEnvVar {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_required: Option<bool>,
    #[serde(default)]
    pub is_secret: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryHeader {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub is_required: Option<bool>,
    #[serde(default)]
    pub is_secret: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryRepository {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

// ── Configured MCP server ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfiguredMcpServer {
    pub name: String,
    pub server_type: String,
    pub scope: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub env_keys: Vec<String>,
    #[serde(default)]
    pub header_keys: Vec<String>,
}

// ── Keybinding types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
