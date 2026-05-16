/**
 * Skill types - enhanced with version management and dependency support.
 * Based on Claude Code/Cowork design patterns.
 */
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
}

export interface SkillDependency {
  skillId: string;
  version?: string; // Semver constraint (e.g., ">=1.0.0")
}

/**
 * Skill version info for update checking.
 */
export interface SkillVersion {
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
  | "builtin"; // Built-in skills

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

export interface SkillManifest {
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

export const SKILL_CATEGORIES: { value: SkillCategory; label: string; icon: string }[] = [
  { value: "productivity", label: "skillCat_productivity", icon: "⚡" },
  { value: "development", label: "skillCat_development", icon: "🔧" },
  { value: "automation", label: "skillCat_automation", icon: "🤖" },
  { value: "memory", label: "skillCat_memory", icon: "🧠" },
  { value: "organization", label: "skillCat_organization", icon: "📁" },
  { value: "integrations", label: "skillCat_integrations", icon: "🔗" },
  { value: "custom", label: "skillCat_custom", icon: "✨" },
];

export const DEFAULT_SKILL_ICON = "✨";

/**
 * Check if a skill version satisfies a constraint.
 * Supports semver-like matching.
 */
export function satisfiesVersion(installedVersion: string, constraint: string): boolean {
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
