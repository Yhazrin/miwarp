/**
 * Task Prompt Template Engine
 *
 * Generates self-contained prompts for scheduled tasks.
 * Injects project context, user preferences, and tool availability
 * so tasks can execute autonomously without conversation context.
 */
import { dbg } from "$lib/utils/debug";

// ── Types ──

export interface PromptContext {
  cwd?: string;
  projectName?: string;
  projectPath?: string;
  userPreferences?: UserPreferences;
  connectedTools?: string[];
  memoryFiles?: Record<string, string>;
  skills?: string[];
}

export interface UserPreferences {
  language?: string;
  timezone?: string;
  theme?: string;
  editor?: string;
  [key: string]: string | undefined;
}

export interface TemplateVariable {
  name: string;
  description: string;
  required: boolean;
  default?: string;
  source: "context" | "memory" | "env" | "static";
}

export interface TaskPromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  variables: TemplateVariable[];
  examples?: string[];
}

// ── Predefined Templates ──

export const TASK_TEMPLATES: TaskPromptTemplate[] = [
  {
    id: "daily-review",
    name: "Daily Code Review",
    description: "Review code changes from the past day",
    template: `# Daily Code Review

## Context
- Project: {{projectName}}
- Working Directory: {{cwd}}
- User: {{userName}}
- Date: {{date}}
- Language: {{language}}

## Task
Review all code changes in the working directory since yesterday. Focus on:
1. Security vulnerabilities
2. Performance issues
3. Code style violations
4. Missing tests

## Output
Generate a summary report with:
- Number of files changed
- Critical issues (if any)
- Suggestions for improvement

## Tools Available
{{availableTools}}

## Memory Context
{{memoryContext}}
`,
    variables: [
      { name: "projectName", description: "Project name", required: true, source: "context" },
      { name: "cwd", description: "Working directory path", required: true, source: "context" },
      { name: "userName", description: "User's name", required: false, source: "memory" },
      { name: "date", description: "Current date", required: false, source: "static" },
      { name: "language", description: "Preferred language", required: false, source: "memory" },
      {
        name: "availableTools",
        description: "List of available tools",
        required: false,
        source: "context",
      },
      {
        name: "memoryContext",
        description: "Relevant memory entries",
        required: false,
        source: "memory",
      },
    ],
    examples: [
      "Run at 9am every weekday to review overnight changes",
      "Run every Monday morning for weekly summary",
    ],
  },
  {
    id: "weekly-report",
    name: "Weekly Progress Report",
    description: "Generate a summary of the week's work",
    template: `# Weekly Progress Report

## Context
- Project: {{projectName}}
- Working Directory: {{cwd}}
- User: {{userName}}
- Week: {{week}}
- Year: {{year}}

## Task
Generate a summary of the past week's work including:
1. Completed tasks
2. In-progress items
3. Upcoming priorities
4. Blockers or concerns

## Output
Format as a markdown report suitable for team sharing.

## Preferences
- Timezone: {{timezone}}
- Theme: {{theme}}

## Memory Context
{{memoryContext}}
`,
    variables: [
      { name: "projectName", description: "Project name", required: true, source: "context" },
      { name: "cwd", description: "Working directory", required: true, source: "context" },
      { name: "userName", description: "User's name", required: false, source: "memory" },
      { name: "week", description: "ISO week number", required: false, source: "static" },
      { name: "year", description: "Year", required: false, source: "static" },
      { name: "timezone", description: "User's timezone", required: false, source: "memory" },
      { name: "theme", description: "UI theme preference", required: false, source: "memory" },
      {
        name: "memoryContext",
        description: "Memory entries about current projects",
        required: false,
        source: "memory",
      },
    ],
  },
  {
    id: "dep-audit",
    name: "Dependency Audit",
    description: "Check for outdated dependencies and security issues",
    template: `# Dependency Audit

## Context
- Project: {{projectName}}
- Working Directory: {{cwd}}
- Package Manager: {{packageManager}}
- Date: {{date}}

## Task
Run a comprehensive dependency audit:
1. Check for outdated packages
2. Identify security vulnerabilities
3. Suggest updates
4. Generate migration notes

## Commands to Run
{{#if packageManager === "npm"}}
- npm outdated
- npm audit
- npm update --dry-run
{{else if packageManager === "yarn"}}
- yarn outdated
- yarn audit
- yarn upgrade --dry-run
{{else if packageManager === "pnpm"}}
- pnpm outdated
- pnpm audit
- pnpm update --dry-run
{{/if}}

## Output
Generate a report with:
- List of outdated packages (current vs latest)
- Security issues with severity levels
- Recommended actions

## Tools Available
- npm/yarn/pnpm CLI
- Git for changelog analysis
`,
    variables: [
      { name: "projectName", description: "Project name", required: true, source: "context" },
      { name: "cwd", description: "Working directory", required: true, source: "context" },
      {
        name: "packageManager",
        description: "Package manager (npm/yarn/pnpm)",
        required: false,
        source: "context",
      },
      { name: "date", description: "Current date", required: false, source: "static" },
    ],
  },
  {
    id: "memory-consolidation",
    name: "Memory Consolidation",
    description: "Organize and merge memory files",
    template: `# Memory Consolidation

## Context
- User: {{userName}}
- Date: {{date}}
- Memory Path: {{memoryPath}}
- Language: {{language}}

## Task
Perform a reflective pass over your memory files:

### Phase 1 — Take stock
- List the memory directory
- Read MEMORY.md index
- Identify duplicate entries
- Note stale content

### Phase 2 — Consolidate
- Separate durable (preferences, style, relationships) from dated (completed projects, old tasks)
- Merge overlapping entries
- Fix time references (convert "next week" to absolute dates)
- Remove easily re-derivable content

### Phase 3 — Tidy the index
- Update MEMORY.md to under 200 lines
- One line per entry, under ~150 chars
- Remove pointers to retired memories
- Add newly important items

## Output
Generate a summary of:
- Files processed
- Duplicates merged
- Entries updated
- Stale content removed

## Backup
Before making changes, create a backup of the memory directory.

## Memory Files Available
{{memoryFilesList}}
`,
    variables: [
      { name: "userName", description: "User's name", required: false, source: "memory" },
      { name: "date", description: "Current date", required: false, source: "static" },
      {
        name: "memoryPath",
        description: "Path to memory directory",
        required: true,
        source: "static",
        default: "~/.miwarp/memory",
      },
      { name: "language", description: "User's language", required: false, source: "memory" },
      {
        name: "memoryFilesList",
        description: "List of memory files",
        required: false,
        source: "context",
      },
    ],
  },
  {
    id: "project-init",
    name: "Project Initialization",
    description: "Initialize a new project with best practices",
    template: `# Project Initialization

## Context
- Project Name: {{projectName}}
- Project Path: {{projectPath}}
- Template: {{template}}
- User: {{userName}}
- Date: {{date}}

## Task
Initialize a new project following best practices:

### 1. Structure Setup
- Create standard directory structure
- Initialize package.json with metadata
- Set up TypeScript configuration
- Configure ESLint and Prettier

### 2. Documentation
- Create CLAUDE.md with project overview
- Create README.md with setup instructions
- Create .gitignore
- Set up CHANGELOG.md

### 3. Version Control
- Initialize git repository
- Create initial commit
- Set up branch protection (if remote exists)

### 4. CI/CD (if applicable)
- Add GitHub Actions workflow
- Configure testing on push
- Set up automatic formatting

## Output
- List of files created
- Commands to run next
- Configuration summary

## User Preferences
- Editor: {{editor}}
- Preferred code style: {{codeStyle}}
`,
    variables: [
      { name: "projectName", description: "Project name", required: true, source: "context" },
      { name: "projectPath", description: "Project root path", required: true, source: "context" },
      {
        name: "template",
        description: "Project template",
        required: false,
        source: "context",
        default: "default",
      },
      { name: "userName", description: "User's name", required: false, source: "memory" },
      { name: "date", description: "Current date", required: false, source: "static" },
      { name: "editor", description: "Preferred editor", required: false, source: "memory" },
      { name: "codeStyle", description: "Preferred code style", required: false, source: "memory" },
    ],
  },
];

// ── Template Engine ──

export class TaskPromptTemplateEngine {
  private templates: Map<string, TaskPromptTemplate> = new Map();

  constructor() {
    // Register predefined templates
    for (const template of TASK_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Register a custom template
   */
  registerTemplate(template: TaskPromptTemplate): void {
    this.templates.set(template.id, template);
    dbg("prompt-template", "registerTemplate", { id: template.id });
  }

  /**
   * Get all templates
   */
  getTemplates(): TaskPromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): TaskPromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Generate a prompt from a template
   */
  generate(templateId: string, context: PromptContext): string | null {
    const template = this.templates.get(templateId);
    if (!template) {
      dbg("prompt-template", "generate failed - template not found", { templateId });
      return null;
    }

    // Validate required variables
    for (const variable of template.variables) {
      if (variable.required && !this.resolveVariable(variable, context)) {
        dbg("prompt-template", "missing required variable", { name: variable.name });
        // Use default if available
        if (!variable.default) {
          return null;
        }
      }
    }

    // Replace template variables
    let result = template.template;
    for (const variable of template.variables) {
      const value = this.resolveVariable(variable, context) || variable.default || "";
      const regex = new RegExp(`\\{\\{${variable.name}\\}\\}`, "g");
      result = result.replace(regex, value);
    }

    // Clean up unused template blocks (e.g., {{#if}}...{{/if}})
    result = this.removeUnusedConditionals(result, context);

    // Remove any remaining unreplaced variables
    result = result.replace(/\{\{[^}]+\}\}/g, "");

    dbg("prompt-template", "generate", { templateId, length: result.length });
    return result.trim();
  }

  /**
   * Resolve a variable from context
   */
  private resolveVariable(variable: TemplateVariable, context: PromptContext): string {
    switch (variable.source) {
      case "context":
        return this.getContextValue(variable.name, context);
      case "memory":
        return this.getMemoryValue(variable.name, context);
      case "env":
        return process.env[variable.name] || "";
      case "static":
        return this.getStaticValues()[variable.name] || "";
      default:
        return "";
    }
  }

  /**
   * Get value from context
   */
  private getContextValue(name: string, context: PromptContext): string {
    const mapping: Record<string, keyof PromptContext> = {
      projectName: "projectName",
      cwd: "cwd",
      projectPath: "projectPath",
      connectedTools: "connectedTools",
    };

    const key = mapping[name];
    if (key && context[key]) {
      if (Array.isArray(context[key])) {
        return (context[key] as string[]).join(", ");
      }
      return String(context[key]);
    }

    return "";
  }

  /**
   * Get value from user preferences
   */
  private getMemoryValue(name: string, context: PromptContext): string {
    if (!context.userPreferences) return "";

    const mapping: Record<string, string> = {
      userName: "name",
      language: "language",
      timezone: "timezone",
      theme: "theme",
      editor: "editor",
      codeStyle: "codeStyle",
    };

    const key = mapping[name];
    if (key && context.userPreferences[key]) {
      return String(context.userPreferences[key]);
    }

    // Also check directly
    if (context.userPreferences[name]) {
      return String(context.userPreferences[name]);
    }

    return "";
  }

  /**
   * Get static values (date, time, etc.)
   */
  private getStaticValues(): Record<string, string> {
    const now = new Date();
    return {
      date: now.toISOString().split("T")[0],
      time: now.toTimeString().split(" ")[0],
      datetime: now.toISOString(),
      week: this.getISOWeek(now).toString(),
      year: now.getFullYear().toString(),
      month: (now.getMonth() + 1).toString().padStart(2, "0"),
      day: now.getDate().toString().padStart(2, "0"),
    };
  }

  /**
   * Get ISO week number
   */
  private getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  /**
   * Remove unused conditional blocks
   */
  private removeUnusedConditionals(template: string, context: PromptContext): string {
    // Handle {{#if}}...{{/if}} blocks
    const ifRegex = /\{\{#if\s+(\w+)\s*==\s*"([^"]+)"\}\}([\s\S]*?)\{\{\/if\}\}/g;

    return template.replace(ifRegex, (match, varName, expectedValue, content) => {
      const actualValue = this.resolveVariable(
        { name: varName, description: "", required: true, source: "context" },
        context,
      );
      return actualValue === expectedValue ? content : "";
    });
  }

  /**
   * Validate a template
   */
  validateTemplate(templateId: string): { valid: boolean; errors: string[] } {
    const template = this.templates.get(templateId);
    if (!template) {
      return { valid: false, errors: ["Template not found"] };
    }

    const errors: string[] = [];

    // Check template has content
    if (!template.template.trim()) {
      errors.push("Template content is empty");
    }

    // Check variables are defined
    if (!template.variables || template.variables.length === 0) {
      errors.push("No variables defined");
    }

    // Check all variables in template have definitions
    const varNames = template.variables.map((v) => v.name);
    const templateVars = template.template.match(/\{\{(\w+)\}\}/g) || [];
    for (const match of templateVars) {
      const name = match.replace(/\{\{|\}\}/g, "");
      if (!varNames.includes(name) && !["if", "else", "/if", "#if", "/#if"].includes(name)) {
        errors.push(`Undefined variable: ${name}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Preview a template with sample context
   */
  preview(templateId: string): string | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    // Create sample context
    const sampleContext: PromptContext = {
      projectName: "sample-project",
      cwd: "/path/to/project",
      userPreferences: {
        name: "Sample User",
        language: "en",
        timezone: "UTC",
        theme: "dark",
      },
      connectedTools: ["github", "slack"],
      memoryFiles: {
        "projects.md": "# Projects\n- Sample Project",
      },
    };

    return this.generate(templateId, sampleContext);
  }
}

// Create singleton instance
export const taskPromptEngine = new TaskPromptTemplateEngine();
