/**
 * CLI version-based capability detection.
 *
 * Maps `session_init.claude_code_version` to feature flags so the UI can
 * gracefully degrade when connected to an older CLI.  Version thresholds
 * are documented inline; update them when a feature ships in a new CLI
 * release.
 */

// ── Version parsing ──

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Parse "MAJOR.MINOR.PATCH" → SemVer. Returns null on malformed input. */
export function parseSemVer(raw: string): SemVer | null {
  if (!raw) return null;
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

/** Compare two SemVers: negative if a < b, 0 if equal, positive if a > b. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** Returns true when `version >= threshold`. */
export function versionAtLeast(version: SemVer, threshold: SemVer): boolean {
  return compareSemVer(version, threshold) >= 0;
}

// ── Capability flags ──

export interface CliCapabilities {
  /** Agent tool with isolation/permission/background params. */
  supports_agent_tool: boolean;
  /** Workflow tool for multi-phase orchestration. */
  supports_workflow: boolean;
  /** ScheduleWakeup tool for timed loops. */
  supports_schedule_wakeup: boolean;
  /** ReportFindings tool for structured review output. */
  supports_report_findings: boolean;
  /** Ultracode high-compute mode. */
  supports_ultracode: boolean;
  /** Background agent execution (run_in_background). */
  supports_background_agents: boolean;
  /** Tool use summary events (tool_use_summary). */
  supports_tool_use_summary: boolean;
  /** Attention queue events. */
  supports_attention_queue: boolean;
  /** Runtime health probe events. */
  supports_runtime_health: boolean;
}

// Version thresholds — each maps to a minimum CLI version.
// Update these when a feature is confirmed shipped in a specific release.
const V2_0_0: SemVer = { major: 2, minor: 0, patch: 0 };
const V1_1_0: SemVer = { major: 1, minor: 1, patch: 0 };

const CAPABILITY_THRESHOLDS: Array<[keyof CliCapabilities, SemVer]> = [
  ["supports_agent_tool", V2_0_0],
  ["supports_workflow", V2_0_0],
  ["supports_schedule_wakeup", V2_0_0],
  ["supports_report_findings", V2_0_0],
  ["supports_ultracode", V2_0_0],
  ["supports_background_agents", V2_0_0],
  ["supports_tool_use_summary", V1_1_0],
  ["supports_attention_queue", V1_1_0],
  ["supports_runtime_health", V1_1_0],
];

/** Default: all false — used when version is unknown. */
const ALL_FALSE: CliCapabilities = {
  supports_agent_tool: false,
  supports_workflow: false,
  supports_schedule_wakeup: false,
  supports_report_findings: false,
  supports_ultracode: false,
  supports_background_agents: false,
  supports_tool_use_summary: false,
  supports_attention_queue: false,
  supports_runtime_health: false,
};

/**
 * Derive capabilities from a CLI version string.
 * Returns ALL_FALSE for unparseable versions (safe degradation).
 */
export function getCliCapabilities(version: string): CliCapabilities {
  const parsed = parseSemVer(version);
  if (!parsed) return ALL_FALSE;

  const result = { ...ALL_FALSE };
  for (const [flag, threshold] of CAPABILITY_THRESHOLDS) {
    if (versionAtLeast(parsed, threshold)) {
      result[flag] = true;
    }
  }
  return result;
}

/**
 * Quick check: does this CLI version support a specific capability?
 * Convenience wrapper around getCliCapabilities for one-off checks.
 */
export function cliSupports(version: string, flag: keyof CliCapabilities): boolean {
  return getCliCapabilities(version)[flag];
}

// ── Derived display helpers ──

/** Human-readable capability summary for settings/debug. */
export function describeCapabilities(caps: CliCapabilities): string[] {
  const enabled: string[] = [];
  for (const [key, val] of Object.entries(caps)) {
    if (val) enabled.push(key.replace("supports_", ""));
  }
  return enabled;
}
