/**
 * Skill types - enhanced with version management and dependency support.
 * Based on Claude Code/Cowork design patterns.
 */
import type { LucideIconName } from "$lib/lucide-icon";

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string; // Full SKILL.md content
  category: SkillCategory;
  source: SkillSource;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
  author?: string;
  tags?: string[];
  icon?: string;

  // Enhanced fields from Claude Code design
  version?: string; // Semantic version (e.g., "1.2.0")
  minAppVersion?: string; // Minimum required app version
  changelog?: string; // Version changelog
  dependencies?: SkillDependency[]; // Skill dependencies
  downloadCount?: number; // Marketplace download count
  rating?: number; // Marketplace rating (0-5)
  publishedAt?: string; // When published to marketplace
  remoteRef?: SkillRemoteRef;
  metadata?: Record<string, unknown>;
}

interface SkillDependency {
  skillId: string;
  version?: string; // Semver constraint (e.g., ">=1.0.0")
}

/**
 * Skill version info for update checking.
 */
interface _SkillVersion {
  version: string;
  minAppVersion: string;
  changelog?: string;
  publishedAt: string;
}

export type SkillCategory =
  | "productivity"
  | "development"
  | "automation"
  | "memory"
  | "organization"
  | "integrations"
  | "custom";

export type SkillSource =
  | "local" // User's custom skills
  | "marketplace" // Downloaded from marketplace
  | "builtin" // Built-in skills
  | "feishu"
  | "github"
  | "folder";

type SkillRemoteSourceKind = "feishu" | "github" | "folder" | "marketplace";

export interface SkillRemoteRef {
  sourceId: string;
  sourceType: SkillRemoteSourceKind;
  remoteId: string;
  remoteUrl?: string;
  etag?: string;
  contentHash: string;
  lastSyncedAt: string;
}

interface SkillSourceConfigFeishu {
  authProfile?: string;
  wikiUrl?: string;
  wikiToken?: string;
  folderToken?: string;
  docTokens?: string[];
  /** Single-document URLs / wiki links for MVP sync */
  docUrls?: string[];
  includeChildren?: boolean;
  parserMode?: "strict" | "loose";
}

interface SkillSourceConfigSync {
  mode: "manual" | "startup" | "interval";
  intervalMinutes?: number;
  lastSyncedAt?: string;
  lastStatus?: "success" | "failed" | "partial";
  lastError?: string;
}

type SkillSourceProviderType = SkillRemoteSourceKind;

export interface SkillSourceConfig {
  id: string;
  name: string;
  type: SkillSourceProviderType;
  enabled: boolean;
  feishu?: Partial<SkillSourceConfigFeishu>;
  sync: SkillSourceConfigSync;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteSkillCandidate {
  id: string;
  sourceId: string;
  remoteId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  contentHash: string;
  remoteUrl?: string;
  status: RemoteSkillInstallStatus | string;
  skipped: boolean;
  skipReason?: string;
}

type RemoteSkillInstallStatus =
  | "not_installed"
  | "installed"
  | "update_available"
  | "conflict";

export interface SkillSourceSyncResult {
  sourceId: string;
  fetched: number;
  skipped: number;
  errors: string[];
  candidates: RemoteSkillCandidate[];
}

export interface SkillSourceHealth {
  ok: boolean;
  message?: string;
}

export interface InstallRemoteSkillResult {
  success: boolean;
  message: string;
  skillPath?: string;
  conflictName?: string;
}

interface RemoteSkillUpdateItem {
  skillPath: string;
  skillName: string;
  remoteId: string;
  localHash: string;
  remoteHash: string;
}

export interface SkillSourceUpdateCheck {
  sourceId: string;
  updates: RemoteSkillUpdateItem[];
}

export interface SkillExecution {
  id: string;
  skillId: string;
  skillName: string;
  args: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  sessionId?: string;
}

export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface SkillMetadata {
  name: string;
  description: string;
  category?: SkillCategory;
  trigger?: string[]; // Alternative trigger words
  icon?: string;
  author?: string;
}

interface _SkillManifest {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  isBuiltIn: boolean;
  author?: string;
  tags?: string[];
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

export const SKILL_CATEGORIES: { value: SkillCategory; label: string; icon: LucideIconName }[] = [
  { value: "productivity", label: "skillCat_productivity", icon: "zap" },
  { value: "development", label: "skillCat_development", icon: "wrench" },
  { value: "automation", label: "skillCat_automation", icon: "bot" },
  { value: "memory", label: "skillCat_memory", icon: "brain" },
  { value: "organization", label: "skillCat_organization", icon: "folder" },
  { value: "integrations", label: "skillCat_integrations", icon: "link" },
  { value: "custom", label: "skillCat_custom", icon: "sparkles" },
];

export const DEFAULT_SKILL_ICON: LucideIconName = "sparkles";

/**
 * Check if a skill version satisfies a constraint.
 * Supports semver-like matching.
 */
function _satisfiesVersion(installedVersion: string, constraint: string): boolean {
  if (!constraint) return true;

  // Simple version comparison (major.minor.patch)
  const parse = (v: string) => v.split(".").map(Number);
  const [a, b, c] = parse(installedVersion);
  const [ca, cb, cc] = parse(constraint.replace(/[^0-9.]/g, ""));

  if (constraint.startsWith(">=")) {
    return a > ca || (a === ca && (b > cb || (b === cb && c >= cc)));
  }
  if (constraint.startsWith(">")) {
    return a > ca || (a === ca && (b > cb || (b === cb && c > cc)));
  }
  if (constraint.startsWith("<=")) {
    return a < ca || (a === ca && (b < cb || (b === cb && c <= cc)));
  }
  if (constraint.startsWith("<")) {
    return a < ca || (a === ca && (b < cb || (b === cb && c < cc)));
  }
  if (constraint.startsWith("=")) {
    return installedVersion === constraint.slice(1).trim();
  }

  // Default: exact match
  return installedVersion === constraint;
}
