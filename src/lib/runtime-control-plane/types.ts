import type { CliCommand, McpServerInfo } from "$lib/types";

export type AuthState = "unknown" | "authenticated" | "missing" | "expired";
export type ModelSource = "config" | "env" | "provider_default" | "session_override" | "unknown";

export type CapabilityField<T> =
  | { kind: "supported"; value: T }
  | { kind: "unsupported"; capability: string };

export interface RuntimeSkillInfo {
  name: string;
  description?: string | null;
}

export interface RuntimeHealth {
  runtimeId: string;
  state: string;
  consecutiveFailures: number;
  connectionGeneration: number;
}

export interface RuntimeDiagnosis {
  category: string;
  severity: string;
  titleKey: string;
  bodyKey: string;
  retryable: boolean;
}

export interface RuntimeSnapshot {
  runtimeId: string;
  displayName: string;
  installed: boolean;
  version?: string | null;
  auth: AuthState;
  configPath?: string | null;
  provider?: string | null;
  currentModel?: string | null;
  defaultModel?: string | null;
  modelSource: ModelSource;
  fetchedAtMs: number;
  stale: boolean;
  commands: CapabilityField<CliCommand[]>;
  mcp: CapabilityField<McpServerInfo[]>;
  skills: CapabilityField<RuntimeSkillInfo[]>;
  health: RuntimeHealth;
  diagnosis?: RuntimeDiagnosis | null;
  binaryPath?: string | null;
}

export interface RuntimeControlPlaneList {
  runtimes: RuntimeSnapshot[];
  defaultRuntimeId: string;
  fetchedAtMs: number;
}

export interface ConfigFieldDiff {
  key: string;
  before: unknown;
  after: unknown;
}

export interface ConfigTransactionPreview {
  runtimeId: string;
  configPath: string;
  diffs: ConfigFieldDiff[];
  redacted: boolean;
}

export interface ConfigTransactionResult {
  success: boolean;
  runtimeId: string;
  configPath: string;
  diffs: ConfigFieldDiff[];
  rolledBack: boolean;
  probeOk: boolean;
  error?: string | null;
}

export interface RuntimeHubHealthResponse {
  runtimeId: string;
  health: RuntimeHealth;
  snapshot: RuntimeSnapshot;
}

export interface RuntimeConfigWatchEvent {
  runtimeId: string;
  configPath: string;
  generation: number;
  reason: string;
}

export interface SessionRuntimeOverride {
  runtimeId?: string;
  provider?: string;
  model?: string;
}
