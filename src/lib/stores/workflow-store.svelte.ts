/**
 * Workflow Templates - Claude Code inspired pre-built workflows
 *
 * Provides reusable workflow templates that users can execute with context.
 * Inspired by Claude Code's workflow patterns for common development tasks.
 */

import { dbg, dbgWarn } from "$lib/utils/debug";

// ── Workflow Template Types ──

export type WorkflowStepType = "slash_command" | "prompt" | "custom";

export interface WorkflowStep {
  type: WorkflowStepType;
  /** The command or prompt text */
  value: string;
  /** Optional description for display */
  description?: string;
  /** Delay in ms before executing (for better UX) */
  delay?: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "development" | "review" | "automation" | "collaboration";
  steps: WorkflowStep[];
  /** Required context to execute this workflow */
  requiredContext?: ("cwd" | "git" | "session")[];
  /** Tags for search/filtering */
  tags: string[];
  /** Whether this workflow is built-in or user-created */
  source: "builtin" | "custom";
  /** Last used timestamp */
  lastUsedAt?: string;
  /** Usage count for ranking */
  usageCount?: number;
}

// ── Built-in Workflow Templates ──

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // Development workflows
  {
    id: "code-review",
    name: "Code Review",
    description: "Review recent code changes with AI feedback",
    icon: "🔍",
    category: "review",
    tags: ["review", "pr", "git", "feedback"],
    source: "builtin",
    steps: [
      {
        type: "slash_command",
        value: "/review",
        description: "Review code changes",
        delay: 500,
      },
      {
        type: "custom",
        value:
          "Provide a comprehensive code review including: 1) Code quality and style 2) Potential bugs or security issues 3) Performance concerns 4) Suggestions for improvement",
        description: "Generate detailed review report",
      },
    ],
    requiredContext: ["cwd", "git"],
  },
  {
    id: "security-review",
    name: "Security Review",
    description: "Deep security analysis of code changes",
    icon: "🛡️",
    category: "review",
    tags: ["security", "vulnerability", "audit", "review"],
    source: "builtin",
    steps: [
      {
        type: "slash_command",
        value: "/security-review",
        description: "Run security review",
        delay: 500,
      },
    ],
    requiredContext: ["cwd", "git"],
  },
  {
    id: "implement-feature",
    name: "Implement Feature",
    description: "Plan and implement a new feature with testing",
    icon: "✨",
    category: "development",
    tags: ["feature", "implement", "coding", "development"],
    source: "builtin",
    steps: [
      {
        type: "prompt",
        value:
          "Let's implement a new feature. First, create a detailed specification document covering: 1) Feature description and goals 2) API design 3) Data models 4) Acceptance criteria 5) Edge cases to handle",
        description: "Create feature specification",
        delay: 500,
      },
      {
        type: "prompt",
        value:
          "Now implement the feature according to the specification. Write clean, well-documented code with proper error handling.",
        description: "Implement feature code",
      },
      {
        type: "prompt",
        value:
          "Write comprehensive unit tests for the new feature. Include edge cases and error scenarios.",
        description: "Write unit tests",
      },
    ],
    requiredContext: ["cwd", "session"],
  },
  {
    id: "bug-fix",
    name: "Bug Fix",
    description: "Systematically investigate and fix a bug",
    icon: "🐛",
    category: "development",
    tags: ["bug", "fix", "debug", "investigate"],
    source: "builtin",
    steps: [
      {
        type: "prompt",
        value:
          "I'm investigating a bug. Help me: 1) Identify potential root causes 2) Suggest investigation steps 3) Look for similar issues in the codebase 4) Propose a fix with tests",
        description: "Analyze and diagnose bug",
        delay: 500,
      },
      {
        type: "prompt",
        value: "Now implement the fix and write a test to prevent regression.",
        description: "Implement fix with test",
      },
    ],
    requiredContext: ["cwd", "session"],
  },
  {
    id: "refactor-code",
    name: "Refactor Code",
    description: "Improve existing code structure and quality",
    icon: "🔄",
    category: "development",
    tags: ["refactor", "improve", "cleanup", "restructure"],
    source: "builtin",
    steps: [
      {
        type: "prompt",
        value:
          "I want to refactor some code for better maintainability. Review the code and suggest: 1) Structural improvements 2) Code duplication removal 3) Naming improvements 4) Error handling patterns",
        description: "Analyze code for refactoring opportunities",
        delay: 500,
      },
      {
        type: "prompt",
        value: "Apply the suggested refactoring improvements, ensuring tests still pass.",
        description: "Apply refactoring",
      },
    ],
    requiredContext: ["cwd"],
  },

  // Review workflows
  {
    id: "pr-review",
    name: "Pull Request Review",
    description: "Complete PR review with checks",
    icon: "📋",
    category: "review",
    tags: ["pr", "pull request", "review", "merge"],
    source: "builtin",
    steps: [
      {
        type: "prompt",
        value:
          "Review the current pull request. Check: 1) Code quality 2) Test coverage 3) Documentation 4) Security concerns 5) Performance implications 6) Alignment with project standards",
        description: "Comprehensive PR review",
        delay: 500,
      },
      {
        type: "prompt",
        value: "Summarize the findings with actionable suggestions.",
        description: "Summarize review",
      },
    ],
    requiredContext: ["cwd", "git"],
  },

  // Automation workflows
  {
    id: "create-tests",
    name: "Create Tests",
    description: "Generate comprehensive test suite",
    icon: "🧪",
    category: "automation",
    tags: ["test", "testing", "coverage", "unit"],
    source: "builtin",
    steps: [
      {
        type: "prompt",
        value:
          "Create comprehensive test files for the codebase. Focus on: 1) Unit tests for core functions 2) Integration tests for key flows 3) Edge case coverage 4) Mock strategies 5) Test fixtures",
        description: "Analyze and create tests",
        delay: 500,
      },
      {
        type: "prompt",
        value: "Run the tests to verify they pass and provide coverage report.",
        description: "Run tests and verify",
      },
    ],
    requiredContext: ["cwd", "session"],
  },
  {
    id: "update-dependencies",
    name: "Update Dependencies",
    description: "Safely update project dependencies",
    icon: "📦",
    category: "automation",
    tags: ["update", "dependencies", "npm", "package"],
    source: "builtin",
    steps: [
      {
        type: "prompt",
        value:
          "Check for outdated dependencies in this project. List all packages with available updates and their potential breaking changes.",
        description: "Check dependency updates",
        delay: 500,
      },
      {
        type: "prompt",
        value: "Update the dependencies safely, testing after each major update.",
        description: "Update dependencies",
      },
    ],
    requiredContext: ["cwd"],
  },

  // Collaboration workflows
  {
    id: "team-code-review",
    name: "Team Code Review",
    description: "Multi-agent code review with team members",
    icon: "👥",
    category: "collaboration",
    tags: ["team", "review", "collaborate", "multi"],
    source: "builtin",
    steps: [
      {
        type: "prompt",
        value:
          "I'm starting a team code review. First, analyze the current changes and identify key areas to focus on.",
        description: "Initialize review",
        delay: 500,
      },
      {
        type: "prompt",
        value:
          "Assign specific aspects: 1) Code quality 2) Security 3) Performance 4) Documentation. Review each thoroughly.",
        description: "Comprehensive team review",
      },
    ],
    requiredContext: ["cwd", "git", "session"],
  },
  {
    id: "pair-programming",
    name: "Pair Programming",
    description: "Collaborative coding session",
    icon: "🤝",
    category: "collaboration",
    tags: ["pair", "collaborate", "code", "together"],
    source: "builtin",
    steps: [
      {
        type: "prompt",
        value:
          "Let's do pair programming on this task. I'll drive, you navigate. First, understand the current codebase and the task at hand.",
        description: "Start pair session",
        delay: 500,
      },
      {
        type: "prompt",
        value:
          "Continue pair programming. Provide real-time feedback on code style, potential issues, and improvements.",
        description: "Pair program",
      },
    ],
    requiredContext: ["cwd", "session"],
  },
];

// ── Workflow Store ──

class WorkflowStore {
  templates = $state<WorkflowTemplate[]>([...WORKFLOW_TEMPLATES]);
  recentTemplates = $state<string[]>([]);
  searchQuery = $state("");
  selectedCategory = $state<WorkflowTemplate["category"] | null>(null);
  isExecuting = $state(false);
  currentTemplateId = $state<string | null>(null);
  currentStepIndex = $state(0);

  get filteredTemplates(): WorkflowTemplate[] {
    let result = this.templates;

    if (this.selectedCategory) {
      result = result.filter((t) => t.category === this.selectedCategory);
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    return result;
  }

  get builtinTemplates(): WorkflowTemplate[] {
    return this.templates.filter((t) => t.source === "builtin");
  }

  get customTemplates(): WorkflowTemplate[] {
    return this.templates.filter((t) => t.source === "custom");
  }

  get recentTemplatesList(): WorkflowTemplate[] {
    return this.recentTemplates
      .map((id) => this.templates.find((t) => t.id === id))
      .filter((t): t is WorkflowTemplate => !!t);
  }

  getCategories(): WorkflowTemplate["category"][] {
    return ["development", "review", "automation", "collaboration"];
  }

  getCategoryLabel(category: WorkflowTemplate["category"]): string {
    const labels: Record<WorkflowTemplate["category"], string> = {
      development: "Development",
      review: "Review",
      automation: "Automation",
      collaboration: "Collaboration",
    };
    return labels[category] || category;
  }

  getCategoryIcon(category: WorkflowTemplate["category"]): string {
    const icons: Record<WorkflowTemplate["category"], string> = {
      development: "💻",
      review: "🔍",
      automation: "⚡",
      collaboration: "👥",
    };
    return icons[category] || "📋";
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  setCategory(category: WorkflowTemplate["category"] | null): void {
    this.selectedCategory = category;
  }

  /**
   * Record template usage for sorting
   */
  recordUsage(templateId: string): void {
    // Update in-memory state
    const template = this.templates.find((t) => t.id === templateId);
    if (template) {
      template.usageCount = (template.usageCount || 0) + 1;
      template.lastUsedAt = new Date().toISOString();
    }

    // Update recent list
    this.recentTemplates = this.recentTemplates.filter((id) => id !== templateId);
    this.recentTemplates.unshift(templateId);
    this.recentTemplates = this.recentTemplates.slice(0, 10);

    // Persist
    try {
      localStorage.setItem("miwarp:recent-workflows", JSON.stringify(this.recentTemplates));
    } catch (e) {
      dbgWarn("workflow", "persist recent templates failed", e);
    }
  }

  /**
   * Load recent templates from storage
   */
  loadRecentTemplates(): void {
    try {
      const raw = localStorage.getItem("miwarp:recent-workflows");
      if (raw) {
        this.recentTemplates = JSON.parse(raw);
      }
    } catch (e) {
      dbgWarn("workflow", "load recent templates failed", e);
      this.recentTemplates = [];
    }
  }

  /**
   * Get workflow by ID
   */
  getTemplate(id: string): WorkflowTemplate | undefined {
    return this.templates.find((t) => t.id === id);
  }

  /**
   * Add custom workflow template
   */
  addCustomTemplate(
    template: Omit<WorkflowTemplate, "source" | "usageCount" | "lastUsedAt">,
  ): void {
    const newTemplate: WorkflowTemplate = {
      ...template,
      source: "custom",
      usageCount: 0,
    };
    this.templates = [...this.templates, newTemplate];
    dbg("workflow-store", "added custom template", template.id);
  }

  /**
   * Update custom workflow template
   */
  updateCustomTemplate(id: string, updates: Partial<Omit<WorkflowTemplate, "source">>): boolean {
    const index = this.templates.findIndex((t) => t.id === id && t.source === "custom");
    if (index === -1) return false;

    this.templates = this.templates.map((t, i) => (i === index ? { ...t, ...updates } : t));
    return true;
  }

  /**
   * Delete custom workflow template
   */
  deleteCustomTemplate(id: string): boolean {
    const template = this.templates.find((t) => t.id === id);
    if (!template || template.source !== "custom") return false;

    this.templates = this.templates.filter((t) => t.id !== id);
    this.recentTemplates = this.recentTemplates.filter((rid) => rid !== id);
    return true;
  }

  /**
   * Execute a workflow step by step
   * Returns a generator that yields each step to allow for async execution
   */
  *executeWorkflow(templateId: string): Generator<WorkflowStep, void, unknown> {
    const template = this.getTemplate(templateId);
    if (!template) {
      dbgWarn("workflow-store", "template not found", templateId);
      return;
    }

    this.currentTemplateId = templateId;
    this.currentStepIndex = 0;
    this.isExecuting = true;
    this.recordUsage(templateId);

    try {
      for (let i = 0; i < template.steps.length; i++) {
        this.currentStepIndex = i;
        yield template.steps[i];

        // Apply delay if specified (handled by caller)
        if (template.steps[i].delay) {
          // Caller will wait before calling next()
        }
      }
    } finally {
      this.isExecuting = false;
      this.currentTemplateId = null;
      this.currentStepIndex = 0;
    }
  }

  /**
   * Check if workflow can be executed given context
   */
  canExecute(
    templateId: string,
    context: Record<string, boolean>,
  ): {
    canExecute: boolean;
    missingContext: string[];
  } {
    const template = this.getTemplate(templateId);
    if (!template) return { canExecute: false, missingContext: [] };

    const missing: string[] = [];
    for (const req of template.requiredContext || []) {
      if (!context[req]) {
        missing.push(req);
      }
    }

    return {
      canExecute: missing.length === 0,
      missingContext: missing,
    };
  }
}

// Export singleton instance
export const workflowStore = new WorkflowStore();

// ── Workflow Execution Helper ──

export interface WorkflowExecutorOptions {
  onStep: (step: WorkflowStep, index: number) => void | Promise<void>;
  onComplete: () => void;
  onError: (error: Error) => void;
}

/**
 * Execute a workflow with proper step handling
 */
export async function executeWorkflow(
  templateId: string,
  options: WorkflowExecutorOptions,
): Promise<void> {
  const template = workflowStore.getTemplate(templateId);
  if (!template) {
    options.onError(new Error(`Template not found: ${templateId}`));
    return;
  }

  try {
    for (let i = 0; i < template.steps.length; i++) {
      const step = template.steps[i];
      await options.onStep(step, i);

      if (step.delay) {
        await new Promise((resolve) => setTimeout(resolve, step.delay));
      }
    }
    options.onComplete();
  } catch (error) {
    options.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

// ── Quick Actions ──

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  /** Contexts where this action is available */
  contexts: ("chat" | "prompt" | "terminal" | "global")[];
  /** Keyboard shortcut */
  shortcut?: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "qa-stop",
    label: "Stop",
    icon: "⏹",
    action: () => {
      window.dispatchEvent(new CustomEvent("miwarp:stop-run"));
    },
    contexts: ["chat"],
    shortcut: "Escape",
  },
  {
    id: "qa-copy",
    label: "Copy Code",
    icon: "📋",
    action: () => {
      window.dispatchEvent(new CustomEvent("miwarp:copy-code"));
    },
    contexts: ["chat"],
  },
  {
    id: "qa-insert",
    label: "Insert at Cursor",
    icon: "✏️",
    action: () => {
      window.dispatchEvent(new CustomEvent("miwarp:insert-at-cursor"));
    },
    contexts: ["prompt"],
  },
  {
    id: "qa-expand",
    label: "Expand Output",
    icon: "⬆️",
    action: () => {
      window.dispatchEvent(new CustomEvent("miwarp:expand-output"));
    },
    contexts: ["chat"],
  },
];

export function getQuickActionsForContext(context: QuickAction["contexts"][number]): QuickAction[] {
  return QUICK_ACTIONS.filter(
    (qa) => qa.contexts.includes(context) || qa.contexts.includes("global"),
  );
}
