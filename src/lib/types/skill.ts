/**
 * Skill types
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
  { value: "productivity", label: "Productivity", icon: "⚡" },
  { value: "development", label: "Development", icon: "🔧" },
  { value: "automation", label: "Automation", icon: "🤖" },
  { value: "memory", label: "Memory", icon: "🧠" },
  { value: "organization", label: "Organization", icon: "📁" },
  { value: "integrations", label: "Integrations", icon: "🔗" },
  { value: "custom", label: "Custom", icon: "✨" },
];

export const DEFAULT_SKILL_ICON = "✨";
