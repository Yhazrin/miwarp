import manifest from "./builtin/manifest.json";
import schedule from "./builtin/schedule.md?raw";
import consolidateMemory from "./builtin/consolidate-memory.md?raw";
import setupCowork from "./builtin/setup-cowork.md?raw";
import visualizeData from "./builtin/visualize-data.md?raw";
import mindMap from "./builtin/mind-map.md?raw";
import architectureDiagram from "./builtin/architecture-diagram.md?raw";
import projectStatusDashboard from "./builtin/project-status-dashboard.md?raw";
import decisionMap from "./builtin/decision-map.md?raw";
import type { Skill, SkillCategory } from "$lib/types/skill";

const BUILT_IN_TIMESTAMP = "2026-06-22T00:00:00Z";

interface BuiltInManifestEntry {
  name: string;
  description: string;
  category: SkillCategory;
  icon: string;
  tags: string[];
}

const CONTENT_BY_NAME: Record<string, string> = {
  schedule,
  "consolidate-memory": consolidateMemory,
  "setup-cowork": setupCowork,
  "visualize-data": visualizeData,
  "mind-map": mindMap,
  "architecture-diagram": architectureDiagram,
  "project-status-dashboard": projectStatusDashboard,
  "decision-map": decisionMap,
};

const DEFINITIONS = (manifest.skills as BuiltInManifestEntry[]).map((entry) => ({
  ...entry,
  content: CONTENT_BY_NAME[entry.name] ?? "",
}));

const BUILTIN_SKILLS_MANIFEST_VERSION = manifest.version;

export function createBuiltInSkills(): Skill[] {
  return DEFINITIONS.map((definition) => ({
    id: `builtin-${definition.name}`,
    name: definition.name,
    description: definition.description,
    content: definition.content,
    category: definition.category,
    source: "builtin",
    isBuiltIn: true,
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP,
    author: "MiWarp",
    tags: [...definition.tags],
    icon: definition.icon,
    version: "1.0.0",
  }));
}

export function builtInSkillNames(): string[] {
  return DEFINITIONS.map((definition) => definition.name);
}
