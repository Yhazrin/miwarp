/**
 * Skills API endpoint
 *
 * Handles CRUD operations for skills via REST API.
 */
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { Skill } from "$lib/types/skill";

// In-memory skill storage (would be persisted in production)
const skills: Skill[] = [
  {
    id: "builtin-schedule",
    name: "schedule",
    description: "Create a scheduled task that runs on a recurring schedule or at a specific time",
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

// GET /api/skills - List all skills
export const GET: RequestHandler = async () => {
  dbg("api-skills", "GET list");
  return json({ skills, count: skills.length });
};

// POST /api/skills - Create a new skill
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.description || !body.content) {
      return json(
        { error: "Missing required fields: name, description, content" },
        { status: 400 },
      );
    }

    // Check for duplicate names
    if (skills.some((s) => s.name === body.name)) {
      return json({ error: "A skill with this name already exists" }, { status: 409 });
    }

    const newSkill: Skill = {
      id: body.id || `skill-${Date.now()}`,
      name: body.name,
      description: body.description,
      content: body.content,
      category: body.category || "custom",
      source: body.source || "local",
      isBuiltIn: false,
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: body.updatedAt || new Date().toISOString(),
      author: body.author,
      tags: body.tags,
      icon: body.icon || "✨",
    };

    skills.push(newSkill);
    dbg("api-skills", "POST created", { id: newSkill.id, name: newSkill.name });

    return json({ skill: newSkill }, { status: 201 });
  } catch (e) {
    dbgWarn("api-skills", "POST error", e);
    return json({ error: "Invalid request body" }, { status: 400 });
  }
};

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

\`/schedule <task-id> [cron-expression|<ISO-timestamp>]\`

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

\`/consolidate-memory [options]\`

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

\`/setup-cowork\`

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
