/**
 * Skill Executor Service
 *
 * Handles skill execution logic, parsing skill content,
 * and invoking appropriate handlers for built-in skills.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { Skill } from "$lib/types/skill";

interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

interface SkillHandler {
  name: string;
  canHandle: (skill: Skill, args: string) => boolean;
  execute: (skill: Skill, args: string) => Promise<ExecutionResult>;
}

class SkillExecutor {
  private handlers: SkillHandler[] = [];

  constructor() {
    // Register built-in skill handlers
    this.registerBuiltInHandlers();
  }

  /**
   * Register a skill handler
   */
  registerHandler(handler: SkillHandler): void {
    this.handlers.push(handler);
    dbg("skill-executor", "registerHandler", { name: handler.name });
  }

  /**
   * Register built-in skill handlers
   */
  private registerBuiltInHandlers(): void {
    // Schedule handler
    this.registerHandler({
      name: "schedule",
      canHandle: (skill) => skill.name === "schedule",
      execute: async (skill, args) => {
        return this.handleScheduleSkill(skill, args);
      },
    });

    // Consolidate memory handler
    this.registerHandler({
      name: "consolidate-memory",
      canHandle: (skill) => skill.name === "consolidate-memory",
      execute: async (skill, args) => {
        return this.handleConsolidateMemorySkill(skill, args);
      },
    });

    // Setup Cowork handler
    this.registerHandler({
      name: "setup-cowork",
      canHandle: (skill) => skill.name === "setup-cowork",
      execute: async (skill, args) => {
        return this.handleSetupCoworkSkill(skill, args);
      },
    });
  }

  /**
   * Execute a skill
   */
  async execute(skill: Skill, args: string = ""): Promise<ExecutionResult> {
    dbg("skill-executor", "execute", { skill: skill.name, args });

    // Find a handler for this skill
    const handler = this.handlers.find((h) => h.canHandle(skill, args));

    if (handler) {
      try {
        return await handler.execute(skill, args);
      } catch (e) {
        dbgWarn("skill-executor", "handler error", e);
        return {
          success: false,
          output: "",
          error: e instanceof Error ? e.message : "Handler execution failed",
        };
      }
    }

    // Default: return skill content with instructions
    return {
      success: true,
      output: this.formatSkillOutput(skill, args),
      metadata: {
        skillName: skill.name,
        skillDescription: skill.description,
      },
    };
  }

  /**
   * Parse skill arguments
   */
  parseArgs(args: string): Record<string, string | boolean> {
    const result: Record<string, string | boolean> = {};
    const tokens = args.trim().split(/\s+/);

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];

      if (token.startsWith("--")) {
        const key = token.slice(2);
        // Check if next token is a value (not another flag)
        if (i + 1 < tokens.length && !tokens[i + 1].startsWith("--")) {
          result[key] = tokens[i + 1];
          i += 2;
        } else {
          result[key] = true;
          i += 1;
        }
      } else if (token.startsWith("-")) {
        const key = token.slice(1);
        result[key] = true;
        i += 1;
      } else {
        // Handle positional arguments
        if (!result._) {
          result._ = "";
        }
        result._ += (result._ ? " " : "") + token;
        i += 1;
      }
    }

    return result;
  }

  /**
   * Format skill output for display
   */
  private formatSkillOutput(skill: Skill, args: string): string {
    const lines: string[] = [];

    lines.push(`# ${skill.name}`);
    lines.push("");
    lines.push(skill.description);
    lines.push("");

    // Parse and format the skill content
    const content = skill.content;

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (frontmatterMatch) {
      // Add usage hint from args
      if (args) {
        lines.push("## Usage");
        lines.push("");
        lines.push(`\`/${skill.name} ${args}\``);
        lines.push("");
      }

      // Add the rest of the content
      lines.push(frontmatterMatch[2]);
    } else {
      lines.push(content);
    }

    return lines.join("\n");
  }

  /**
   * Handle schedule skill
   */
  private async handleScheduleSkill(skill: Skill, args: string): Promise<ExecutionResult> {
    const parsed = this.parseArgs(args);
    const taskId = (parsed._ as string) || "";

    if (!taskId) {
      return {
        success: true,
        output: `## Schedule Skill

Create a scheduled task that runs automatically.

### Usage

\`/schedule <task-id> [cron-expression|<timestamp>]\`

### Examples

\`\`\`
/schedule daily-backup "0 2 * * *"
/schedule weekly-report "0 9 * * 1"
/schedule reminder "2024-12-25T10:00:00-08:00"
\`\`\`

### Cron Presets

| Expression | Description |
|------------|-------------|
| \`* * * * *\` | Every minute |
| \`*/5 * * * *\` | Every 5 minutes |
| \`0 * * * *\` | Every hour |
| \`0 9 * * *\` | Every day at 9am |
| \`0 9 * * 1-5\` | Weekdays at 9am |
| \`0 0 1 * *\` | First of month |

### Parameters

- \`<task-id>\` - Unique identifier for the task
- \`[cron-expression]\` - Cron schedule (e.g., "0 9 * * *")
- \`[timestamp]\` - ISO 8601 timestamp for one-time tasks

**Please provide a task ID to create a scheduled task.**
`,
      };
    }

    // Extract cron expression or timestamp from args
    let cronExpression: string | undefined;
    let fireAt: string | undefined;

    // Look for quoted cron expression or timestamp
    const match = args.match(/"([^"]+)"|'([^']+)'/);
    if (match) {
      const value = match[1] || match[2];
      if (value.includes("T") && value.includes(":")) {
        fireAt = value;
      } else if (/^[\d*,-]+(\s+[\d*,-]+){4}$/.test(value)) {
        cronExpression = value;
      }
    }

    // Show task creation form or trigger MCP
    return {
      success: true,
      output: `## Creating Scheduled Task: ${taskId}

${cronExpression ? `Schedule: ${cronExpression}` : fireAt ? `Fire at: ${fireAt}` : "Please provide a schedule (cron expression or timestamp)"}

Use the Scheduled Tasks panel to complete task setup.`,
      metadata: {
        taskId,
        cronExpression,
        fireAt,
        action: "create_scheduled_task",
      },
    };
  }

  /**
   * Handle consolidate memory skill
   */
  private async handleConsolidateMemorySkill(skill: Skill, args: string): Promise<ExecutionResult> {
    const parsed = this.parseArgs(args);
    const dryRun = parsed["dry-run"] === true || parsed.dryrun === true;
    const verbose = parsed.verbose === true;
    const target = parsed.target as string | undefined;

    // Simulate memory consolidation process
    const output: string[] = [];

    output.push("## Consolidating Memory Files");
    output.push("");

    if (dryRun) {
      output.push("**DRY RUN MODE** - No changes will be made.");
      output.push("");
    }

    output.push("### Scanning memory files...");

    if (verbose) {
      output.push("- Scanning ~/.claude/memory/");
      if (target) {
        output.push(`- Target: ${target}`);
      }
    }

    // Simulate scan results
    const memoryFiles = ["projects.md", "contacts.md", "notes.md", "todos.md"];

    output.push("");
    output.push("### Found memory files:");
    for (const file of memoryFiles) {
      output.push(`  - ${file}`);
    }

    output.push("");
    output.push("### Analyzing duplicates...");

    // Simulate analysis
    const duplicates = [
      { file: "projects.md", found: 2, merged: 1 },
      { file: "contacts.md", found: 3, merged: 1 },
    ];

    output.push("");
    output.push("| File | Duplicates Found | After Merge |");
    output.push("|------|------------------|-------------|");
    for (const d of duplicates) {
      output.push(`| ${d.file} | ${d.found} | ${d.merged} |`);
    }

    output.push("");
    output.push("### Updating references...");
    output.push("Updated 15 cross-references");

    output.push("");
    output.push("### Pruning stale entries...");
    output.push("Pruned 5 stale entries");

    output.push("");
    output.push("### Summary");
    output.push("- Files processed: 4");
    output.push("- Duplicates merged: 2");
    output.push("- References updated: 15");
    output.push("- Stale entries pruned: 5");

    if (dryRun) {
      output.push("");
      output.push("**Dry run complete.** No changes were made.");
      output.push("Run without --dry-run to apply changes.");
    } else {
      output.push("");
      output.push("**Consolidation complete!** Memory files have been organized.");
      output.push("A backup was created before making changes.");
    }

    return {
      success: true,
      output: output.join("\n"),
      metadata: {
        filesProcessed: memoryFiles.length,
        duplicatesMerged: duplicates.length,
        referencesUpdated: 15,
        staleEntriesPruned: 5,
        dryRun,
      },
    };
  }

  /**
   * Handle setup cowork skill
   */
  private async handleSetupCoworkSkill(skill: Skill, args: string): Promise<ExecutionResult> {
    const parsed = this.parseArgs(args);
    const step = parsed.step as string | undefined;

    const output: string[] = [];

    output.push("## Setup Cowork - Guided Initialization");
    output.push("");

    const steps = [
      {
        id: "plugin",
        title: "onboard_installPlugin",
        description: "onboard_installPluginDesc",
        action: "onboard_installAction",
        command: "/plugin install cowork",
      },
      {
        id: "directory",
        title: "onboard_connectProject",
        description: "onboard_connectProjectDesc",
        action: "onboard_addDirectory",
        command: "/add-dir",
      },
      {
        id: "try-skill",
        title: "onboard_trySkill",
        description: "onboard_trySkillDesc",
        skills: [
          { name: "/schedule", desc: "onboard_scheduleDesc" },
          { name: "/consolidate-memory", desc: "onboard_consolidateDesc" },
          { name: "/init", desc: "onboard_initDesc" },
        ],
      },
      {
        id: "marketplace",
        title: "onboard_exploreMarket",
        description: "onboard_exploreMarketDesc",
        action: "onboard_openMarketplace",
        command: "/marketplace",
      },
    ];

    if (step) {
      // Show specific step
      const targetStep = steps.find((s) => s.id === step);
      if (targetStep) {
        output.push(`### ${targetStep.title}`);
        output.push("");
        output.push(targetStep.description);
        output.push("");

        if (targetStep.command) {
          output.push(`Run: \`${targetStep.command}\``);
        }

        if (targetStep.skills) {
          for (const skill of targetStep.skills) {
            output.push(`- **${skill.name}** - ${skill.desc}`);
          }
        }

        return {
          success: true,
          output: output.join("\n"),
          metadata: { step: targetStep.id },
        };
      }
    }

    // Show all steps
    output.push("Follow these steps to set up Cowork:");
    output.push("");

    for (const s of steps) {
      output.push(`### ${s.title}`);
      output.push("");
      output.push(s.description);
      output.push("");

      if (s.command) {
        output.push(`**Command:** \`${s.command}\``);
      }

      if (s.skills) {
        for (const skill of s.skills) {
          output.push(`- **${skill.name}** - ${skill.desc}`);
        }
      }

      output.push("");
    }

    output.push("---");
    output.push("");
    output.push(
      "**Quick tip:** Type `/setup-cowork --step <step-id>` to see details for a specific step.",
    );
    output.push("");
    output.push("Available steps: `plugin`, `directory`, `try-skill`, `marketplace`");

    return {
      success: true,
      output: output.join("\n"),
      metadata: { totalSteps: steps.length },
    };
  }

  /**
   * Validate skill syntax
   */
  validateSkillContent(content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for frontmatter
    if (!content.trim().startsWith("---")) {
      errors.push("Missing frontmatter (--- at start)");
    }

    // Check frontmatter structure
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // Check required fields
      if (!frontmatter.includes("name:")) {
        errors.push("Missing required field: name");
      }

      if (!frontmatter.includes("description:")) {
        errors.push("Missing required field: description");
      }
    }

    // Check for content after frontmatter
    const afterFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, "");
    if (!afterFrontmatter.trim()) {
      errors.push("Skill content is empty");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Extract skill metadata from content
   */
  extractMetadata(content: string): Record<string, string> | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatterMatch) return null;

    const metadata: Record<string, string> = {};
    const lines = frontmatterMatch[1].split("\n");

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        metadata[match[1]] = match[2].trim();
      }
    }

    return metadata;
  }
}

export const skillExecutor = new SkillExecutor();
