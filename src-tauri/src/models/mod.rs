// Submodules
pub mod run;
pub mod settings;
pub mod event;
pub mod diagnostics;
pub mod usage;
pub mod team;
pub mod fleet;
pub mod project;
pub mod plugin_skill;
pub mod misc;
pub mod protocol_state;

// Re-exports for backward compatibility
pub use run::RunStatus;
pub use run::RunSource;
pub use run::SessionCreationMode;
pub use run::ImportWatermark;
pub use run::RunEventType;
pub use run::ExecutionPath;
pub use run::AgentRuntimeKind;
pub use run::RuntimeProtocolKind;
pub use run::ConversationRef;
pub use run::RunSurface;
pub use run::ProjectDeskContextMeta;
pub use run::TaskRun;
pub use run::RunEvent;
pub use run::RunArtifact;
pub use run::RunMeta;
pub use settings::UserSettings;
pub use settings::SessionStatusColors;
pub use settings::normalize_workspace_folder_sort_order;
pub use settings::normalize_session_island_alignment;
pub use settings::RemoteHost;
pub use settings::RemoteTestResult;
pub use settings::PlatformCredential;
pub use settings::AgentSettings;
pub use settings::AllSettings;
pub use settings::SessionFolder;
pub use settings::KeyBindingOverride;
pub use settings::SshKeyInfo;
pub use settings::AuthCheckResult;
pub use settings::AuthOverview;
pub use settings::InstallMethod;
pub use event::RalphCompleteReason;
pub use event::BusEvent;
pub use event::SessionMode;
pub use diagnostics::CliCheckResult;
pub use diagnostics::CliDistTags;
pub use diagnostics::UpdateCliResult;
pub use diagnostics::ProjectInitStatus;
pub use diagnostics::DiagnosticsReport;
pub use diagnostics::CliDiagnostics;
pub use diagnostics::AuthDiagnostics;
pub use diagnostics::ProjectDiagnostics;
pub use diagnostics::ClaudeMdInfo;
pub use diagnostics::ConfigDiagnostics;
pub use diagnostics::ConfigIssue;
pub use diagnostics::ServicesDiagnostics;
pub use diagnostics::SystemDiagnostics;
pub use usage::RawRunUsage;
pub use usage::RunUsageSummary;
pub use usage::ModelUsageSummary;
pub use usage::UsageOverview;
pub use usage::ModelAggregate;
pub use usage::DailyAggregate;
pub use usage::ModelTokens;
pub use usage::CliModelInfo;
pub use usage::CliCommand;
pub use usage::CliAccount;
pub use usage::CliInfo;
pub use usage::CliInfoError;
pub use usage::ModelUsageEntry;
pub use usage::McpServerInfo;
pub use team::TeamConfig;
pub use team::TeamMember;
pub use team::TeamInboxMessage;
pub use team::TeamTask;
pub use team::TeamSummary;
pub use team::TeamRunStatus;
pub use team::TeamMemberStatus;
pub use team::TeamPresetMember;
pub use team::TeamPreset;
pub use team::TeamMemberRun;
pub use team::TeamRun;
pub use fleet::FleetStatus;
pub use fleet::FleetMemberMetrics;
pub use fleet::FleetMemberSummary;
pub use fleet::FleetMemberDetail;
pub use fleet::FleetMetrics;
pub use fleet::FleetSendResult;
pub use project::ProjectStack;
pub use project::ProjectCommands;
pub use project::DocExcerpt;
pub use project::ProjectMetadata;
pub use project::LastCommit;
pub use project::ProjectGitStatus;
pub use project::ProjectNotes;
pub use plugin_skill::MarketplacePlugin;
pub use plugin_skill::PluginAuthor;
pub use plugin_skill::PluginComponents;
pub use plugin_skill::MarketplaceInfo;
pub use plugin_skill::StandaloneSkill;
pub use plugin_skill::SkillSummary;
pub use plugin_skill::SkillRemoteRef;
pub use plugin_skill::SkillSourceConfigFeishu;
pub use plugin_skill::SkillSourceConfigSync;
pub use plugin_skill::SkillSourceConfig;
pub use plugin_skill::RemoteSkillDocumentContent;
pub use plugin_skill::RemoteSkillDocument;
pub use plugin_skill::RemoteSkillCandidate;
pub use plugin_skill::SkillSourceSyncResult;
pub use plugin_skill::SkillSourceHealth;
pub use plugin_skill::InstallRemoteSkillResult;
pub use plugin_skill::SkillSourceUpdateCheck;
pub use plugin_skill::RemoteSkillUpdateItem;
pub use plugin_skill::InstalledPlugin;
pub use plugin_skill::PluginOperationResult;
pub use plugin_skill::CommunitySkillResult;
pub use plugin_skill::CommunitySkillDetail;
pub use plugin_skill::ProviderHealth;
pub use plugin_skill::McpRegistrySearchResult;
pub use plugin_skill::McpRegistryServer;
pub use plugin_skill::McpRegistryPackage;
pub use plugin_skill::McpRegistryRemote;
pub use plugin_skill::McpRegistryEnvVar;
pub use plugin_skill::McpRegistryHeader;
pub use plugin_skill::McpRegistryRepository;
pub use plugin_skill::ConfiguredMcpServer;
pub use misc::LocalProxyStatus;
pub use misc::ApiTestResult;
pub use misc::MemoryFileCandidate;
pub use misc::DirEntry;
pub use misc::DirListing;
pub use misc::ChatDelta;
pub use misc::ChatDone;
pub use misc::Attachment;
pub use misc::PromptSearchResult;
pub use misc::PromptFavorite;
pub use misc::RunSearchFilters;
pub use misc::RunSearchResult;
pub use misc::FacetCount;
pub use misc::RunSearchFacets;
pub use misc::RunSearchResponse;

// Protocol state types (moved from agent::claude_protocol for dependency-direction compliance)
pub use protocol_state::ParserStats;
pub use protocol_state::ValidationWarn;
pub use protocol_state::validate_bus_event;
pub use protocol_state::ProtocolState;

// Utility functions
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn now_epoch_ms() -> u64 {
    chrono::Utc::now().timestamp_millis() as u64
}

// ── Attachment limits ──
// Images: no app-side limit — CLI compresses via sharp (→ ≤3.75MB + ≤2000px).
pub const MAX_TEXT_SIZE: u64 = 10 * 1024 * 1024; // 10MB — text files
pub const MAX_PDF_BINARY_SIZE: u64 = 20 * 1024 * 1024; // 20MB — PDF binary inline (CLI dj6)
pub const ALLOWED_IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];
pub const ALLOWED_DOC_TYPES: &[&str] = &["application/pdf"];

/// Max size for attachment by MIME type. Images: no limit, PDF: 20MB, text: 10MB.
pub fn max_attachment_size(mime: &str) -> u64 {
    if ALLOWED_IMAGE_TYPES.iter().any(|t| mime.starts_with(t)) {
        u64::MAX // CLI handles compression
    } else if ALLOWED_DOC_TYPES.contains(&mime) {
        MAX_PDF_BINARY_SIZE // 20MB for PDF (CLI dj6)
    } else {
        MAX_TEXT_SIZE // 10MB for text
    }
}
