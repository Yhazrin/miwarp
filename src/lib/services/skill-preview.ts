/**
 * Skill Preview Service
 *
 * Generates execution previews for skills before they run.
 * Based on Claude Cowork design patterns - allows users to see
 * what a skill will do before executing it.
 */
import type { Skill } from "$lib/types/skill";
import { dbg } from "$lib/utils/debug";

interface PreviewStep {
  order: number;
  description: string;
  icon: string;
  toolCalls?: string[];
  estimatedDuration?: string;
  warnings?: string[];
}

export interface SkillPreview {
  skillId: string;
  skillName: string;
  description: string;
  steps: PreviewStep[];
  estimatedDuration: string;
  potentialSideEffects: string[];
  warnings: string[];
  prerequisites: string[];
}

interface ExecutionEstimate {
  duration: string;
  complexity: "simple" | "moderate" | "complex";
  tokensEstimate: string;
}

const STEP_ICONS = {
  default: "📋",
  read: "📖",
  write: "✏️",
  execute: "⚡",
  api: "🔌",
  file: "📁",
  network: "🌐",
  ui: "🖥️",
  timer: "⏰",
} as const;

/**
 * Generate a preview of skill execution
 */
export function generateSkillPreview(skill: Skill, args: string = ""): SkillPreview {
  dbg("skill-preview", "generating", { skill: skill.name, args });

  const steps: PreviewStep[] = [];
  const warnings: string[] = [];
  const prerequisites: string[] = [];
  const sideEffects: string[] = [];

  // Parse skill content to extract steps
  const content = skill.content;

  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const bodyContent = frontmatterMatch ? frontmatterMatch[2] : content;

  // Analyze the skill content for steps
  const parsedSteps = parseSkillContent(bodyContent, args);
  steps.push(...parsedSteps.steps);
  sideEffects.push(...parsedSteps.sideEffects);

  // Check for built-in skill types
  if (skill.name === "schedule") {
    steps.push(...getScheduleSkillSteps(args));
  } else if (skill.name === "consolidate-memory") {
    steps.push(...getConsolidateMemorySteps(args));
  } else if (skill.name === "setup-cowork") {
    steps.push(...getSetupCoworkSteps(args));
  } else if (skill.name === "review") {
    steps.push(...getReviewSkillSteps());
  } else if (skill.name === "init") {
    steps.push(...getInitSkillSteps());
  }

  // Check prerequisites
  if (skill.dependencies && skill.dependencies.length > 0) {
    for (const dep of skill.dependencies) {
      prerequisites.push(`Requires: ${dep.skillId}${dep.version ? ` (${dep.version})` : ""}`);
    }
  }

  // Add warnings based on skill type
  if (sideEffects.some((s) => s.includes("file") || s.includes("delete"))) {
    warnings.push("This skill may modify files");
  }
  if (sideEffects.some((s) => s.includes("API") || s.includes("network"))) {
    warnings.push("This skill makes network requests");
  }
  if (skill.name.includes("memory") || skill.name.includes("consolidate")) {
    warnings.push("This skill may delete or modify data");
  }

  return {
    skillId: skill.id,
    skillName: skill.name,
    description: skill.description,
    steps:
      steps.length > 0
        ? steps
        : [
            {
              order: 1,
              description: "Execute skill with provided arguments",
              icon: STEP_ICONS.default,
              estimatedDuration: "~1s",
            },
          ],
    estimatedDuration: estimateDuration(steps),
    potentialSideEffects: sideEffects,
    warnings,
    prerequisites,
  };
}

/**
 * Parse skill content and extract execution steps
 */
function parseSkillContent(
  content: string,
  _args: string,
): { steps: PreviewStep[]; sideEffects: string[] } {
  const steps: PreviewStep[] = [];
  const sideEffects: string[] = [];
  const lines = content.split("\n");

  let stepOrder = 1;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect file operations
    if (trimmed.includes("write") || trimmed.includes("create") || trimmed.includes("save")) {
      steps.push({
        order: stepOrder++,
        description: `Write/Create: ${extractTarget(trimmed)}`,
        icon: STEP_ICONS.write,
        toolCalls: ["Write", "Create", "Save"],
      });
      sideEffects.push("File modification");
    }

    // Detect read operations
    if (trimmed.includes("read") || trimmed.includes("scan") || trimmed.includes("search")) {
      steps.push({
        order: stepOrder++,
        description: `Read/Scan: ${extractTarget(trimmed)}`,
        icon: STEP_ICONS.read,
        toolCalls: ["Read", "Grep", "Glob"],
      });
    }

    // Detect API calls
    if (trimmed.includes("API") || trimmed.includes("fetch") || trimmed.includes("request")) {
      steps.push({
        order: stepOrder++,
        description: "Make API request",
        icon: STEP_ICONS.api,
        toolCalls: ["WebFetch", "WebSearch"],
      });
      sideEffects.push("Network activity");
    }

    // Detect execution
    if (trimmed.includes("execute") || trimmed.includes("run") || trimmed.includes("invoke")) {
      steps.push({
        order: stepOrder++,
        description: `Execute: ${extractTarget(trimmed)}`,
        icon: STEP_ICONS.execute,
        toolCalls: ["Bash", "Execute"],
      });
    }
  }

  return { steps, sideEffects };
}

/**
 * Extract target from a line
 */
function extractTarget(line: string): string {
  const match = line.match(/`(.*?)`/);
  return match ? match[1] : line.slice(0, 50);
}

/**
 * Get schedule skill specific steps
 */
function getScheduleSkillSteps(args: string): PreviewStep[] {
  const steps: PreviewStep[] = [
    {
      order: 1,
      description: "Parse task schedule parameters",
      icon: STEP_ICONS.read,
      toolCalls: ["Parse"],
    },
    {
      order: 2,
      description: "Validate schedule format (cron or timestamp)",
      icon: STEP_ICONS.timer,
      toolCalls: ["Validate"],
    },
  ];

  if (args.includes("cron") || args.match(/\d+\s+\d+/)) {
    steps.push({
      order: 3,
      description: "Configure recurring cron schedule",
      icon: STEP_ICONS.timer,
      estimatedDuration: "< 1s",
    });
  } else if (args.includes("T")) {
    steps.push({
      order: 3,
      description: "Set one-time scheduled trigger",
      icon: STEP_ICONS.timer,
      estimatedDuration: "< 1s",
    });
  }

  steps.push({
    order: 4,
    description: "Save scheduled task to storage",
    icon: STEP_ICONS.write,
    estimatedDuration: "~2s",
  });

  return steps;
}

/**
 * Get consolidate memory skill steps
 */
function getConsolidateMemorySteps(args: string): PreviewStep[] {
  const dryRun = args.includes("--dry-run") || args.includes("-n");

  const steps: PreviewStep[] = [
    {
      order: 1,
      description: "Scan memory files",
      icon: STEP_ICONS.read,
      toolCalls: ["Read", "Glob"],
    },
    {
      order: 2,
      description: "Analyze duplicates and stale entries",
      icon: STEP_ICONS.file,
      estimatedDuration: "~3s",
    },
  ];

  if (!dryRun) {
    steps.push(
      {
        order: 3,
        description: "Create backup of memory files",
        icon: STEP_ICONS.write,
        estimatedDuration: "~2s",
      },
      {
        order: 4,
        description: "Merge duplicate entries",
        icon: STEP_ICONS.write,
        estimatedDuration: "~5s",
      },
      {
        order: 5,
        description: "Prune stale entries",
        icon: STEP_ICONS.write,
        estimatedDuration: "~2s",
      },
      {
        order: 6,
        description: "Update cross-references",
        icon: STEP_ICONS.write,
        estimatedDuration: "~2s",
      },
    );
  } else {
    steps.push({
      order: 3,
      description: "Dry run - no changes will be made",
      icon: STEP_ICONS.default,
      warnings: ["Preview only - run without --dry-run to apply changes"],
    });
  }

  return steps;
}

/**
 * Get setup cowork skill steps
 */
function getSetupCoworkSteps(args: string): PreviewStep[] {
  const step = args.match(/--step\s+(\w+)/)?.[1];

  const steps: PreviewStep[] = [
    {
      order: 1,
      description: "Check current setup status",
      icon: STEP_ICONS.read,
      toolCalls: ["Read", "List"],
    },
  ];

  if (!step || step === "plugin") {
    steps.push({
      order: 2,
      description: "Install Cowork plugin",
      icon: STEP_ICONS.execute,
      toolCalls: ["PluginInstall"],
    });
  }

  if (!step || step === "directory") {
    steps.push({
      order: step ? 2 : 3,
      description: "Connect project directory",
      icon: STEP_ICONS.file,
      toolCalls: ["FolderPicker"],
    });
  }

  if (!step || step === "try-skill") {
    steps.push({
      order: step ? 2 : 4,
      description: "Test a skill (schedule, consolidate-memory, or init)",
      icon: STEP_ICONS.execute,
      toolCalls: ["SkillExecute"],
    });
  }

  if (!step || step === "marketplace") {
    steps.push({
      order: step ? 2 : 5,
      description: "Open skill marketplace",
      icon: STEP_ICONS.ui,
      toolCalls: ["Navigate"],
    });
  }

  return steps;
}

/**
 * Get review skill steps
 */
function getReviewSkillSteps(): PreviewStep[] {
  return [
    {
      order: 1,
      description: "Get git diff of recent changes",
      icon: STEP_ICONS.read,
      toolCalls: ["GitDiff"],
    },
    {
      order: 2,
      description: "Analyze code quality and patterns",
      icon: STEP_ICONS.default,
      estimatedDuration: "~10s",
    },
    {
      order: 3,
      description: "Check for potential bugs",
      icon: STEP_ICONS.execute,
      estimatedDuration: "~5s",
    },
    {
      order: 4,
      description: "Generate review feedback",
      icon: STEP_ICONS.write,
      toolCalls: ["Write"],
      estimatedDuration: "~3s",
    },
  ];
}

/**
 * Get init skill steps
 */
function getInitSkillSteps(): PreviewStep[] {
  return [
    {
      order: 1,
      description: "Scan project structure",
      icon: STEP_ICONS.read,
      toolCalls: ["Glob", "Read"],
    },
    {
      order: 2,
      description: "Detect project type and conventions",
      icon: STEP_ICONS.default,
      estimatedDuration: "~5s",
    },
    {
      order: 3,
      description: "Create CLAUDE.md documentation",
      icon: STEP_ICONS.write,
      toolCalls: ["Write"],
      estimatedDuration: "~3s",
    },
  ];
}

/**
 * Estimate total execution duration
 */
function estimateDuration(steps: PreviewStep[]): string {
  let totalSeconds = 0;

  for (const step of steps) {
    if (step.estimatedDuration) {
      const match = step.estimatedDuration.match(/~(\d+)s/);
      if (match) {
        totalSeconds += parseInt(match[1]);
      }
    } else {
      totalSeconds += 2; // Default ~2s per step
    }
  }

  if (totalSeconds < 5) return "< 5s";
  if (totalSeconds < 30) return `~${totalSeconds}s`;
  return `~${Math.round(totalSeconds / 60)}m`;
}

/**
 * Create a simple execution preview
 */
function createQuickPreview(skill: Skill): string {
  return `/${skill.name} - ${skill.description}`;
}

/**
 * Check if skill has prerequisites
 */
function checkPrerequisites(
  skill: Skill,
  installedSkills: Skill[],
): { satisfied: boolean; missing: string[] } {
  if (!skill.dependencies || skill.dependencies.length === 0) {
    return { satisfied: true, missing: [] };
  }

  const missing: string[] = [];

  for (const dep of skill.dependencies) {
    const found = installedSkills.find((s) => s.id === dep.skillId);
    if (!found) {
      missing.push(dep.skillId);
    }
  }

  return {
    satisfied: missing.length === 0,
    missing,
  };
}

const skillPreview = {
  generate: generateSkillPreview,
  quickPreview: createQuickPreview,
  checkPrerequisites,
  estimateDuration,
};
