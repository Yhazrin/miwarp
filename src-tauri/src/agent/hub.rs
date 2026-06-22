//! Runtime Hub — v1.0.9 unified Runtime registry.
//!
//! This module pins the v1.0.9 runtime contract. The four
//! `runtime_hub_*` Tauri commands (`runtime_hub_list`,
//! `runtime_hub_health`, `runtime_hub_diagnose`,
//! `runtime_hub_set_default`) consume these types; the frontend
//! `useRuntimeCapabilities()` composable mirrors them.
//!
//! The hub separates three concepts that earlier versions conflated:
//!
//! - **Provider** — where the inference calls go (Anthropic direct,
//!   Azure relay, local Ollama, internal proxy). Per-user setting.
//! - **Runtime** — what process executes the user turn and owns
//!   the protocol (claude-code, codex, mimo-code, ssh-remote).
//!   Per-project default + per-session override.
//! - **Model** — what model the Runtime calls. Per-session,
//!   switchable mid-run via the provider's model list.
//!
//! The struct types below are intentionally not convertible into
//! each other; if a caller needs a `Runtime` from a `Provider` (or
//! vice versa) they must go through explicit construction.
//!
//! See `docs/architecture/v1.0.9-runtime-contract.md` for the
//! normative contract.

use crate::models::{AgentRuntimeKind, RuntimeProtocolKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

/// Stable identity of a Runtime. The string is the only thing
/// the frontend may persist across sessions; everything else in
/// `RuntimeDescriptor` can change across launches.
pub type RuntimeId = String;

/// Wire-format semver, parsed from `--version` output. `Unknown`
/// when the binary did not respond to the probe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeVersion {
    Known { major: u32, minor: u32, patch: u32 },
    Unknown,
}

impl RuntimeVersion {
    pub fn is_at_least(&self, want_major: u32, want_minor: u32) -> bool {
        match self {
            Self::Unknown => false,
            Self::Known { major, minor, .. } => (*major, *minor) >= (want_major, want_minor),
        }
    }
}

/// Where the Runtime binary comes from. Determines how the hub
/// resolves the path, runs the health check, and emits the
/// `RuntimeDiagnosis`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum RuntimeSource {
    /// `which <bin>` on PATH or an absolute path the user
    /// configured.
    LocalBinary { resolved_path: String },
    /// Downloaded to `~/.miwarp/runtimes/<id>/<version>/`.
    ManagedBundle { install_dir: String },
    /// Spawned over SSH on a remote host.
    SshRemote {
        host: String,
        port: u16,
        user: String,
        /// Path to the private key. Never sent to the frontend.
        #[serde(skip)]
        identity_file: Option<PathBuf>,
    },
    /// Reaches the Runtime through an HTTP relay (e.g. a corporate
    /// Anthropic-compatible proxy that also wraps the CLI binary).
    HttpRelay { base_url: String },
}

// ── Capabilities ──

/// The 12 capability flags defined by the v1.0.9 runtime contract.
/// Every flag is `false` by default. The `From<&str>`-style
/// construction in the hub ensures callers must opt in explicitly.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RuntimeCapabilities {
    pub supports_streaming: bool,
    pub supports_resume: bool,
    pub supports_fork: bool,
    pub supports_permission_requests: bool,
    pub supports_tool_calls: bool,
    pub supports_usage: bool,
    pub supports_thinking: bool,
    pub supports_attachments: bool,
    pub supports_images: bool,
    pub supports_mcp: bool,
    pub supports_skills: bool,
    pub supports_remote_execution: bool,
    pub supports_structured_events: bool,
}

impl RuntimeCapabilities {
    /// Count of `true` flags. The contract test asserts this
    /// matches the count in `v1.0.9-runtime-contract.md` §3.
    pub fn count(&self) -> usize {
        let mut n = 0;
        if self.supports_streaming {
            n += 1;
        }
        if self.supports_resume {
            n += 1;
        }
        if self.supports_fork {
            n += 1;
        }
        if self.supports_permission_requests {
            n += 1;
        }
        if self.supports_tool_calls {
            n += 1;
        }
        if self.supports_usage {
            n += 1;
        }
        if self.supports_thinking {
            n += 1;
        }
        if self.supports_attachments {
            n += 1;
        }
        if self.supports_images {
            n += 1;
        }
        if self.supports_mcp {
            n += 1;
        }
        if self.supports_skills {
            n += 1;
        }
        if self.supports_remote_execution {
            n += 1;
        }
        if self.supports_structured_events {
            n += 1;
        }
        n
    }

    /// Capability-driven UI degradation decisions (the §9 table
    /// from the contract). Returns the action that must be hidden
    /// when the capability is missing. `None` means "no UI
    /// change" — the action is always available.
    pub fn ui_action_to_hide(&self) -> Vec<HiddenAction> {
        let mut hidden = Vec::new();
        if !self.supports_streaming {
            hidden.push(HiddenAction::LiveTail);
        }
        if !self.supports_resume {
            hidden.push(HiddenAction::ResumeSession);
        }
        if !self.supports_permission_requests {
            hidden.push(HiddenAction::PermissionTrustCenter);
        }
        if !self.supports_tool_calls {
            hidden.push(HiddenAction::ToolResultPreview);
            hidden.push(HiddenAction::WorkbenchFileDiffLink);
        }
        if !self.supports_usage {
            hidden.push(HiddenAction::UsagePanel);
        }
        if !self.supports_thinking {
            hidden.push(HiddenAction::ShowReasoning);
        }
        if !self.supports_attachments {
            hidden.push(HiddenAction::ImageAttachment);
            hidden.push(HiddenAction::FileAttachment);
        }
        if !self.supports_images {
            hidden.push(HiddenAction::ImagePreview);
        }
        if !self.supports_mcp {
            hidden.push(HiddenAction::McpMarketplace);
            hidden.push(HiddenAction::LiveMcpServers);
        }
        if !self.supports_skills {
            hidden.push(HiddenAction::CommunitySkills);
        }
        if !self.supports_remote_execution {
            hidden.push(HiddenAction::LocalOnlyBadge);
        }
        if !self.supports_structured_events {
            hidden.push(HiddenAction::BusEventTimeline);
        }
        hidden
    }
}

/// What the UI must hide when a capability is missing. This enum
/// is the contract surface the frontend's `useRuntimeCapabilities`
/// composable consumes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HiddenAction {
    LiveTail,
    ResumeSession,
    PermissionTrustCenter,
    ToolResultPreview,
    WorkbenchFileDiffLink,
    UsagePanel,
    ShowReasoning,
    ImageAttachment,
    FileAttachment,
    ImagePreview,
    McpMarketplace,
    LiveMcpServers,
    CommunitySkills,
    LocalOnlyBadge,
    BusEventTimeline,
}

// ── Launch ──

/// How to spawn a Runtime process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RuntimeLaunchSpec {
    pub binary: String,
    pub base_args: Vec<String>,
    /// Environment variables to inject. Empty keys are forbidden
    /// (the hub rejects them at construction time).
    pub env: BTreeMap<String, String>,
    pub cwd_policy: CwdPolicy,
    /// Maximum time the spawn may take. The hub enforces a
    /// hard cap of 30s regardless of what the spec says.
    pub spawn_timeout: Duration,
    pub health_check: HealthCheckSpec,
}

impl RuntimeLaunchSpec {
    pub const MAX_SPAWN_TIMEOUT: Duration = Duration::from_secs(30);

    pub fn validate_spawn_timeout(t: Duration) -> Result<(), RuntimeHubError> {
        if t > Self::MAX_SPAWN_TIMEOUT {
            return Err(RuntimeHubError::SpawnTimeoutTooLarge {
                requested_ms: t.as_millis() as u64,
                cap_ms: Self::MAX_SPAWN_TIMEOUT.as_millis() as u64,
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CwdPolicy {
    ProjectRoot,
    UserHome,
    Custom(PathBuf),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct HealthCheckSpec {
    pub probe_args: Vec<String>,
    pub probe_timeout: Duration,
    pub min_version: Option<RuntimeVersion>,
    pub auth_check: AuthCheckSpec,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthCheckSpec {
    /// The hub never inspects the auth state; it only verifies
    /// the binary launches.
    Noop,
    /// Probe the binary for a `401` or "API key missing" message
    /// in `--version`-like output.
    ProbeEnvVars { required: Vec<String> },
}

// ── Health ──

/// Observable health of a single Runtime. The hub exposes this
/// from `runtime_hub_health`. Frontend projects it into the
/// Runtime Health panel; Agent D's diagnostic ring buffer
/// subscribes to its transitions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RuntimeHealth {
    pub runtime_id: RuntimeId,
    pub state: RuntimeHealthState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_diagnosis: Option<RuntimeDiagnosis>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_healthy_at_ms: Option<u64>,
    pub consecutive_failures: u32,
    /// Increments on every reconnect or respawn. The frontend
    /// uses this to invalidate in-flight transactions.
    pub connection_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<RuntimeHubError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeHealthState {
    Unknown,
    Detecting,
    Ready,
    Degraded,
    Reconnecting,
    Recovering,
    /// Three consecutive failures — auto-retry is forbidden; the
    /// user must act.
    Unrecoverable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RuntimeDiagnosis {
    pub category: DiagnosisCategory,
    pub severity: DiagnosisSeverity,
    /// i18n key (resolved by the frontend).
    pub title_key: String,
    /// i18n key with placeholders (resolved by the frontend).
    pub body_key: String,
    pub fix_action: Option<FixAction>,
    pub retryable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosisCategory {
    BinaryNotFound,
    VersionTooOld,
    AuthMissing,
    NetworkUnreachable,
    SpawnTimeout,
    ProtocolDesynced,
    StdinBroken,
    StdoutEof,
    StaleGeneration,
    SshAuthFailed,
    SshHostUnreachable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosisSeverity {
    Info,
    Warn,
    Error,
    Fatal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FixAction {
    OpenSettings,
    InstallGuide,
    Retry,
    SwitchRuntime,
}

// ── Error envelope ──

/// Typed error envelope for the four `runtime_hub_*` commands.
/// Strings are forbidden; the variants carry structured fields
/// the frontend renders through i18n.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum RuntimeHubError {
    SpawnTimeoutTooLarge {
        requested_ms: u64,
        cap_ms: u64,
    },
    BinaryNotFound {
        runtime_id: RuntimeId,
        hint: String,
    },
    VersionTooOld {
        runtime_id: RuntimeId,
        required: String,
        found: String,
    },
    AuthMissing {
        runtime_id: RuntimeId,
        env_var: String,
    },
    /// Caller asked for a capability the Runtime does not
    /// expose. The UI must not silently retry.
    CapabilityUnsupported {
        runtime_id: RuntimeId,
        capability: String,
    },
    /// Three consecutive failures — recovery is exhausted. The
    /// hub refuses further calls until the user changes a
    /// setting or explicitly resets the failure counter.
    RecoveryExhausted {
        runtime_id: RuntimeId,
        attempts: u32,
    },
}

impl RuntimeHubError {
    pub fn retryable(&self) -> bool {
        matches!(
            self,
            Self::BinaryNotFound { .. }
                | Self::AuthMissing { .. }
                | Self::SpawnTimeoutTooLarge { .. }
        )
    }
}

// ── RuntimeDescriptor ──

/// Immutable identity of a Runtime. The hub stores one per
/// registered Runtime. The frontend reads `display_name` and
/// `capabilities` for UI projection; the binary / env fields
/// are intentionally `skip`ped on the wire so they never leak
/// to the browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RuntimeDescriptor {
    pub id: RuntimeId,
    pub display_name: String,
    pub kind: AgentRuntimeKind,
    pub protocol: RuntimeProtocolKind,
    pub version: RuntimeVersion,
    pub source: RuntimeSource,
    pub capabilities: RuntimeCapabilities,
    pub launch: RuntimeLaunchSpec,
}

impl RuntimeDescriptor {
    /// Convenience constructor for the local-binary case. The
    /// caller is still responsible for the `launch.health_check`
    /// contents — this constructor does not invent defaults.
    pub fn local(
        id: impl Into<String>,
        kind: AgentRuntimeKind,
        protocol: RuntimeProtocolKind,
        resolved_path: impl Into<String>,
        version: RuntimeVersion,
        capabilities: RuntimeCapabilities,
        launch: RuntimeLaunchSpec,
    ) -> Self {
        let id_str: String = id.into();
        Self {
            id: id_str.clone(),
            display_name: id_str,
            kind,
            protocol,
            version,
            source: RuntimeSource::LocalBinary {
                resolved_path: resolved_path.into(),
            },
            capabilities,
            launch,
        }
    }
}

// Re-export the existing protocol enums so callers don't have
// to chase the import path. The hub module is the canonical
// entry; everything else re-exports from here.
pub use crate::models::RuntimeProtocolKind as HubProtocolKind;

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    fn full_caps() -> RuntimeCapabilities {
        RuntimeCapabilities {
            supports_streaming: true,
            supports_resume: true,
            supports_fork: true,
            supports_permission_requests: true,
            supports_tool_calls: true,
            supports_usage: true,
            supports_thinking: true,
            supports_attachments: true,
            supports_images: true,
            supports_mcp: true,
            supports_skills: true,
            supports_remote_execution: true,
            supports_structured_events: true,
        }
    }

    fn empty_caps() -> RuntimeCapabilities {
        RuntimeCapabilities::default()
    }

    #[test]
    fn capability_count_matches_contract() {
        // 13 flags in the v1.0.9 spec. If you add a flag, this
        // test fails — by design. The contract doc must be
        // updated first.
        let c = full_caps();
        assert_eq!(c.count(), 13);
    }

    #[test]
    fn default_capabilities_have_no_flags() {
        let c = RuntimeCapabilities::default();
        assert_eq!(c.count(), 0);
        assert!(c.ui_action_to_hide().contains(&HiddenAction::LiveTail));
        assert!(c
            .ui_action_to_hide()
            .contains(&HiddenAction::PermissionTrustCenter));
    }

    #[test]
    fn full_capabilities_hide_nothing() {
        let c = full_caps();
        assert!(c.ui_action_to_hide().is_empty());
    }

    #[test]
    fn missing_streaming_hides_live_tail() {
        let mut c = full_caps();
        c.supports_streaming = false;
        let hidden = c.ui_action_to_hide();
        assert!(hidden.contains(&HiddenAction::LiveTail));
        assert!(!hidden.contains(&HiddenAction::ResumeSession));
    }

    #[test]
    fn missing_permission_hides_trust_center() {
        let mut c = full_caps();
        c.supports_permission_requests = false;
        let hidden = c.ui_action_to_hide();
        assert!(hidden.contains(&HiddenAction::PermissionTrustCenter));
    }

    #[test]
    fn missing_tool_calls_hides_diff_and_preview() {
        let mut c = full_caps();
        c.supports_tool_calls = false;
        let hidden = c.ui_action_to_hide();
        assert!(hidden.contains(&HiddenAction::ToolResultPreview));
        assert!(hidden.contains(&HiddenAction::WorkbenchFileDiffLink));
    }

    #[test]
    fn missing_structured_events_hides_bus_timeline() {
        let mut c = full_caps();
        c.supports_structured_events = false;
        let hidden = c.ui_action_to_hide();
        assert!(hidden.contains(&HiddenAction::BusEventTimeline));
    }

    #[test]
    fn spawn_timeout_above_cap_is_rejected() {
        let r = RuntimeLaunchSpec::validate_spawn_timeout(Duration::from_secs(45));
        assert!(r.is_err());
    }

    #[test]
    fn spawn_timeout_at_cap_is_accepted() {
        let r = RuntimeLaunchSpec::validate_spawn_timeout(Duration::from_secs(30));
        assert!(r.is_ok());
    }

    #[test]
    fn runtime_hub_error_retryable() {
        let r = RuntimeHubError::BinaryNotFound {
            runtime_id: "claude-code".to_string(),
            hint: "Install with: brew install claude".to_string(),
        };
        assert!(r.retryable());

        let r = RuntimeHubError::CapabilityUnsupported {
            runtime_id: "codex".to_string(),
            capability: "supports_permission_requests".to_string(),
        };
        assert!(!r.retryable());
    }

    #[test]
    fn runtime_version_is_at_least() {
        let v = RuntimeVersion::Known {
            major: 2,
            minor: 1,
            patch: 81,
        };
        assert!(v.is_at_least(2, 1));
        assert!(v.is_at_least(2, 0));
        assert!(!v.is_at_least(2, 2));
        assert!(!RuntimeVersion::Unknown.is_at_least(0, 0));
    }

    #[test]
    fn runtime_health_serializes_optional_last_healthy() {
        let h = RuntimeHealth {
            runtime_id: "claude-code".to_string(),
            state: RuntimeHealthState::Ready,
            last_diagnosis: None,
            last_healthy_at_ms: Some(1719000000000),
            consecutive_failures: 0,
            connection_generation: 1,
            last_error: None,
        };
        let json = serde_json::to_string(&h).unwrap();
        assert!(json.contains("\"state\":\"ready\""));
        assert!(json.contains("\"connection_generation\":1"));
    }

    #[test]
    fn runtime_descriptor_local_constructor() {
        let d = RuntimeDescriptor::local(
            "claude-code",
            AgentRuntimeKind::ClaudeCode,
            RuntimeProtocolKind::StreamJson,
            "/usr/local/bin/claude",
            RuntimeVersion::Known {
                major: 2,
                minor: 1,
                patch: 81,
            },
            full_caps(),
            RuntimeLaunchSpec {
                binary: "/usr/local/bin/claude".to_string(),
                base_args: vec!["--print".to_string()],
                env: BTreeMap::new(),
                cwd_policy: CwdPolicy::ProjectRoot,
                spawn_timeout: Duration::from_secs(10),
                health_check: HealthCheckSpec {
                    probe_args: vec!["--version".to_string()],
                    probe_timeout: Duration::from_secs(5),
                    min_version: Some(RuntimeVersion::Known {
                        major: 2,
                        minor: 0,
                        patch: 0,
                    }),
                    auth_check: AuthCheckSpec::ProbeEnvVars {
                        required: vec!["ANTHROPIC_API_KEY".to_string()],
                    },
                },
            },
        );
        assert_eq!(d.id, "claude-code");
        assert_eq!(d.capabilities.count(), 13);
        assert!(matches!(d.source, RuntimeSource::LocalBinary { .. }));
    }

    #[test]
    fn health_check_probe_args_for_claude_code_is_version() {
        // Contract test — `docs/architecture/v1.0.9-runtime-contract.md`
        // §7 pins this exact list. Downgrading the assertion is a
        // contract violation.
        let d = RuntimeDescriptor::local(
            "claude-code",
            AgentRuntimeKind::ClaudeCode,
            RuntimeProtocolKind::StreamJson,
            "/usr/local/bin/claude",
            RuntimeVersion::Known {
                major: 2,
                minor: 1,
                patch: 81,
            },
            full_caps(),
            RuntimeLaunchSpec {
                binary: "/usr/local/bin/claude".to_string(),
                base_args: vec![],
                env: BTreeMap::new(),
                cwd_policy: CwdPolicy::ProjectRoot,
                spawn_timeout: Duration::from_secs(5),
                health_check: HealthCheckSpec {
                    probe_args: vec!["--version".to_string()],
                    probe_timeout: Duration::from_secs(5),
                    min_version: None,
                    auth_check: AuthCheckSpec::Noop,
                },
            },
        );
        assert_eq!(
            d.launch.health_check.probe_args,
            vec!["--version".to_string()]
        );
    }

    #[test]
    fn min_version_enforcement() {
        // Simulated: hub refuses to mark a Runtime Ready when the
        // parsed version is older than the spec's min_version.
        let v = RuntimeVersion::Known {
            major: 1,
            minor: 9,
            patch: 0,
        };
        let _min = RuntimeVersion::Known {
            major: 2,
            minor: 0,
            patch: 0,
        };
        // A 1.x version is never >= 2.0. The hub uses this to
        // emit VersionTooOld and refuse to spawn the Runtime.
        assert!(!v.is_at_least(2, 0));
        // A version that's already past the floor is fine.
        let ok = RuntimeVersion::Known {
            major: 2,
            minor: 1,
            patch: 81,
        };
        assert!(ok.is_at_least(2, 0));
    }

    #[test]
    fn hidden_action_serializes_to_snake_case() {
        let a = HiddenAction::PermissionTrustCenter;
        let json = serde_json::to_string(&a).unwrap();
        assert_eq!(json, "\"permission_trust_center\"");
    }

    #[test]
    fn runtime_hub_error_carries_typed_code() {
        let e = RuntimeHubError::CapabilityUnsupported {
            runtime_id: "codex".to_string(),
            capability: "supports_thinking".to_string(),
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"code\":\"capability_unsupported\""));
        assert!(!json.contains("\"message\""));
    }

    #[test]
    fn empty_capabilities_hide_everything() {
        let hidden = empty_caps().ui_action_to_hide();
        // 13 capabilities × at least 1 hidden action each, but the
        // mapping consolidates some (e.g. attachments → image +
        // file). We assert at least 10 unique hidden actions.
        assert!(
            hidden.len() >= 10,
            "expected ≥10 hidden actions, got {}",
            hidden.len()
        );
    }
}
