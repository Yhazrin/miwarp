/**
 * Skill Store
 *
 * Reactive state management for Skills.
 * Handles skill registry, execution state, and CRUD operations.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { Skill, SkillExecution, SkillCategory, SkillMetadata } from "$lib/types/skill";

export class SkillStore {
  // Skill registry
  skills = $state<Skill[]>([]);

  // Execution state
  executions = $state<SkillExecution[]>([]);
  currentExecution = $state<SkillExecution | null>(null);

  // UI state
  loading = $state(false);
  error = $state<string | null>(null);
  showEditor = $state(false);
  editingSkill = $state<Skill | null>(null);
  searchQuery = $state("");
  selectedCategory = $state<SkillCategory | null>(null);

  // Computed properties
  filteredSkills = $derived.by(() => {
    let result = this.skills;

    if (this.selectedCategory) {
      result = result.filter((s) => s.category === this.selectedCategory);
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return result;
  });

  builtInSkills = $derived.by(() => this.skills.filter((s) => s.isBuiltIn));

  customSkills = $derived.by(() => this.skills.filter((s) => !s.isBuiltIn));

  recentExecutions = $derived.by(() =>
    [...this.executions]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 10),
  );

  /**
   * Load all skills from storage
   */
  async loadSkills(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      const response = await fetch("/api/skills", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.skills = data.skills || [];

      dbg("skill-store", "loadSkills", { count: this.skills.length });
    } catch (e) {
      dbgWarn("skill-store", "loadSkills error", e);
      this.error = e instanceof Error ? e.message : "Failed to load skills";
      // Load built-in skills as fallback
      this.loadBuiltInSkills();
    } finally {
      this.loading = false;
    }
  }

  /**
   * Load built-in skills
   */
  loadBuiltInSkills(): void {
    this.skills = [
      {
        id: "builtin-schedule",
        name: "schedule",
        description:
          "Create a scheduled task that runs on a recurring schedule or at a specific time",
        content: getScheduleSkillContent(),
        category: "automation",
        source: "builtin",
        isBuiltIn: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        author: "MiWarp",
        tags: ["task", "schedule", "automation"],
        icon: "⏰",
      },
      {
        id: "builtin-consolidate-memory",
        name: "consolidate-memory",
        description:
          "Reflective pass over your memory files — merge duplicates, fix stale facts, prune the index",
        content: getConsolidateMemorySkillContent(),
        category: "memory",
        source: "builtin",
        isBuiltIn: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        author: "MiWarp",
        tags: ["memory", "organization", "cleanup"],
        icon: "🧠",
      },
      {
        id: "builtin-setup-cowork",
        name: "setup-cowork",
        description: "Guided Cowork setup — install a matching plugin, try a skill, connect tools",
        content: getSetupCoworkSkillContent(),
        category: "integrations",
        source: "builtin",
        isBuiltIn: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        author: "MiWarp",
        tags: ["setup", "cowork", "integration"],
        icon: "🚀",
      },
    ];
  }

  /**
   * Get a skill by name
   */
  getSkillByName(name: string): Skill | undefined {
    return this.skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * Create a new skill
   */
  async createSkill(metadata: SkillMetadata, content: string): Promise<boolean> {
    this.error = null;

    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `skill-${Date.now()}`,
          name: metadata.name,
          description: metadata.description,
          content,
          category: metadata.category || "custom",
          source: "local",
          isBuiltIn: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          author: metadata.author,
          tags: metadata.trigger || [],
          icon: metadata.icon || "✨",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.skill) {
        this.skills = [...this.skills, data.skill];
        this.showEditor = false;
        this.editingSkill = null;
        dbg("skill-store", "createSkill", { name: metadata.name });
        return true;
      }
      return false;
    } catch (e) {
      dbgWarn("skill-store", "createSkill error", e);
      this.error = e instanceof Error ? e.message : "Failed to create skill";
      return false;
    }
  }

  /**
   * Update an existing skill
   */
  async updateSkill(
    skillId: string,
    metadata: Partial<SkillMetadata>,
    content?: string,
  ): Promise<boolean> {
    this.error = null;

    try {
      const response = await fetch(`/api/skills/${skillId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...metadata,
          ...(content !== undefined && { content }),
          updatedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Refresh the skills list
      await this.loadSkills();
      this.showEditor = false;
      this.editingSkill = null;
      dbg("skill-store", "updateSkill", { skillId });
      return true;
    } catch (e) {
      dbgWarn("skill-store", "updateSkill error", e);
      this.error = e instanceof Error ? e.message : "Failed to update skill";
      return false;
    }
  }

  /**
   * Delete a skill
   */
  async deleteSkill(skillId: string): Promise<boolean> {
    this.error = null;

    try {
      const skill = this.skills.find((s) => s.id === skillId);
      if (skill?.isBuiltIn) {
        this.error = "Cannot delete built-in skills";
        return false;
      }

      const response = await fetch(`/api/skills/${skillId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.skills = this.skills.filter((s) => s.id !== skillId);
      dbg("skill-store", "deleteSkill", { skillId });
      return true;
    } catch (e) {
      dbgWarn("skill-store", "deleteSkill error", e);
      this.error = e instanceof Error ? e.message : "Failed to delete skill";
      return false;
    }
  }

  /**
   * Execute a skill
   */
  async executeSkill(skillName: string, args: string = ""): Promise<boolean> {
    const skill = this.getSkillByName(skillName);
    if (!skill) {
      this.error = `Skill not found: ${skillName}`;
      return false;
    }

    const execution: SkillExecution = {
      id: `exec-${Date.now()}`,
      skillId: skill.id,
      skillName: skill.name,
      args,
      status: "running",
      startedAt: new Date().toISOString(),
    };

    this.currentExecution = execution;
    this.executions = [...this.executions, execution];

    try {
      const response = await fetch("/api/skills/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: skill.id,
          skillName: skill.name,
          args,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Update execution with result
      this.updateExecution(execution.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        result: data.result,
      });

      dbg("skill-store", "executeSkill", { skillName, args });
      this.currentExecution = null;
      return true;
    } catch (e) {
      dbgWarn("skill-store", "executeSkill error", e);
      this.updateExecution(execution.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "Execution failed",
      });
      this.currentExecution = null;
      return false;
    }
  }

  /**
   * Update execution status
   */
  private updateExecution(execId: string, updates: Partial<SkillExecution>): void {
    const index = this.executions.findIndex((e) => e.id === execId);
    if (index >= 0) {
      this.executions[index] = { ...this.executions[index], ...updates };
      this.executions = [...this.executions];
    }
  }

  /**
   * Cancel a running execution
   */
  cancelExecution(execId: string): void {
    this.updateExecution(execId, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
    });
    if (this.currentExecution?.id === execId) {
      this.currentExecution = null;
    }
  }

  /**
   * Open editor for creating a new skill
   */
  openCreateEditor(): void {
    this.editingSkill = null;
    this.showEditor = true;
  }

  /**
   * Open editor for editing an existing skill
   */
  openEditEditor(skill: Skill): void {
    this.editingSkill = skill;
    this.showEditor = true;
  }

  /**
   * Close the editor
   */
  closeEditor(): void {
    this.showEditor = false;
    this.editingSkill = null;
  }

  /**
   * Set search query
   */
  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  /**
   * Set category filter
   */
  setSelectedCategory(category: SkillCategory | null): void {
    this.selectedCategory = category;
  }

  /**
   * Clear error state
   */
  clearError(): void {
    this.error = null;
  }

  /**
   * Execute a skill with enhanced progress tracking
   */
  async executeSkillEnhanced(
    skillName: string,
    args: string = "",
    onProgress?: (progress: number, currentStep: string) => void,
  ): Promise<boolean> {
    const skill = this.getSkillByName(skillName);
    if (!skill) {
      this.error = `Skill not found: ${skillName}`;
      return false;
    }

    const execution: SkillExecution = {
      id: `exec-${Date.now()}`,
      skillId: skill.id,
      skillName: skill.name,
      args,
      status: "running",
      startedAt: new Date().toISOString(),
    };

    this.currentExecution = execution;
    this.executions = [...this.executions, execution];

    try {
      // Simulate progress for now - in real implementation, this would come from SSE or websocket
      const progressTimers: ReturnType<typeof setTimeout>[] = [];
      if (onProgress) {
        onProgress(10, "Initializing skill...");
        progressTimers.push(setTimeout(() => onProgress(30, "Loading dependencies..."), 500));
        progressTimers.push(setTimeout(() => onProgress(60, "Executing main logic..."), 1000));
        progressTimers.push(setTimeout(() => onProgress(90, "Finalizing..."), 1500));
      }

      const response = await fetch("/api/skills/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: skill.id,
          skillName: skill.name,
          args,
        }),
      });

      for (const t of progressTimers) clearTimeout(t);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Update execution with result
      this.updateExecution(execution.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        result: data.result,
      });

      if (onProgress) {
        onProgress(100, "Completed");
      }

      dbg("skill-store", "executeSkillEnhanced", { skillName, args });
      this.currentExecution = null;
      return true;
    } catch (e) {
      dbgWarn("skill-store", "executeSkillEnhanced error", e);
      this.updateExecution(execution.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "Execution failed",
      });
      this.currentExecution = null;
      return false;
    }
  }

  /**
   * Clear execution history
   */
  clearExecutionHistory(): void {
    this.executions = [];
  }
}

// ── Built-in Skill Content ──

function getScheduleSkillContent(): string {
  return `---
name: schedule
description: Create a scheduled task
category: automation
icon: ⏰
---

# Schedule Skill

Creates a scheduled task that runs automatically on a recurring schedule or at a specific time.

## Usage

/schedule <task-id> [cron-expression|<ISO-timestamp>]

## Examples

\`\`\`
/schedule daily-backup "0 2 * * *"
/schedule weekly-report "0 9 * * 1"
/schedule reminder "2024-12-25T10:00:00-08:00"
\`\`\`

## Cron Expression Format

\`\`\`
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sun-Sat)
│ │ │ │ │
* * * * *
\`\`\`

## Presets

- Every minute: \`* * * * *\`
- Every 5 minutes: \`*/5 * * * *\`
- Every hour: \`0 * * * *\`
- Every day at 9am: \`0 9 * * *\`
- Weekdays at 9am: \`0 9 * * 1-5\`
- Every Monday at 8:30am: \`30 8 * * 1\`
- First of month at midnight: \`0 0 1 * *\`

## Tips

- Use descriptive task IDs (e.g., \`daily-backup\`, \`weekly-report\`)
- Check /tasks to see scheduled task status
- Use /cancel-scheduled-task to stop a task
`;
}

function getConsolidateMemorySkillContent(): string {
  return `---
name: consolidate-memory
description: Consolidate and organize memory files
category: memory
icon: 🧠
---

# Consolidate Memory Skill

Performs a reflective pass over your memory files to:
- Merge duplicate entries
- Fix stale facts
- Prune outdated information
- Update the memory index

## Usage

/consolidate-memory [options]

## Options

- \`--dry-run\`: Show what would be changed without making changes
- \`--verbose\`: Show detailed output
- \`--target <path>\`: Specify a specific memory file to consolidate

## Process

1. Scan all memory files in \`~/.claude/memory/\`
2. Identify duplicate entries by content similarity
3. Merge duplicates, keeping the most recent version
4. Update timestamps and references
5. Generate a consolidation report

## Example Output

\`\`\`
Consolidating memory files...
Found 3 duplicate entries
Merged entries:
  - memory/projects.md (2 -> 1)
  - memory/contacts.md (3 -> 1)
Updated 15 references
Pruned 5 stale entries
Consolidation complete!
\`\`\`

## Notes

- Always creates a backup before making changes
- Can be scheduled to run automatically
- Best run when not actively working on tasks
`;
}

function getSetupCoworkSkillContent(): string {
  return `---
name: setup-cowork
description: Guided Cowork setup and initialization
category: integrations
icon: 🚀
---

# Setup Cowork Skill

Guides you through setting up Claude Cowork with a step-by-step workflow.

## Usage

/setup-cowork

## Steps

### 1. Install Plugin

The Cowork plugin provides:
- File system access for your projects
- Browser automation tools
- Scheduled task management
- Skill execution engine

### 2. Connect Your First Project

\`\`\`
/add-dir ~/your-project-path
\`\`\`

### 3. Try a Built-in Skill

Start with one of these:
- \`/schedule\` - Create your first scheduled task
- \`/consolidate-memory\` - Organize your memory
- \`/init\` - Initialize a new CLAUDE.md file

### 4. Explore the Marketplace

Visit the Skill Marketplace to discover:
- Development tools
- Productivity boosters
- Custom integrations

## What's Next?

- Configure your preferences with \`/config\`
- Set up your keybindings with \`/keybindings\`
- Invite team members with \`/team\`

## Resources

- Documentation: /docs
- GitHub: https://github.com/your-org/miwarp
- Support: /feedback
`;
}

// Create singleton instance
export const skillStore = new SkillStore();
