import type { Skill, SkillCategory } from "$lib/types/skill";

const BUILT_IN_TIMESTAMP = "2026-06-22T00:00:00Z";

interface BuiltInSkillDefinition {
  name: string;
  description: string;
  category: SkillCategory;
  icon: string;
  tags: string[];
  content: string;
}

const DEFINITIONS: readonly BuiltInSkillDefinition[] = [
  {
    name: "schedule",
    description: "Create a scheduled task that runs on a recurring schedule or at a specific time",
    category: "automation",
    icon: "clock",
    tags: ["task", "schedule", "automation"],
    content: `---
name: schedule
description: Create a scheduled task
category: automation
icon: ⏰
---

# Schedule Skill

Create a recurring or one-time task. Confirm the requested cadence, timezone, workspace, and task prompt before creating it.

## Usage

\`/schedule <task-id> [cron-expression|<ISO-timestamp>]\`

## Examples

- \`/schedule daily-backup "0 2 * * *"\`
- \`/schedule weekly-report "0 9 * * 1"\`
- \`/schedule reminder "2026-12-25T10:00:00+08:00"\`

Prefer a clear task name, preserve the user's timezone, and state whether the schedule is exact or flexible.
`,
  },
  {
    name: "consolidate-memory",
    description: "Review memory files, merge duplicates, flag stale facts, and preserve provenance",
    category: "memory",
    icon: "brain",
    tags: ["memory", "organization", "cleanup"],
    content: `---
name: consolidate-memory
description: Consolidate and organize memory files
category: memory
icon: 🧠
---

# Consolidate Memory Skill

Review memory entries without silently rewriting uncertain facts.

## Workflow

1. Inventory relevant memory sources.
2. Group exact duplicates and near-duplicates separately.
3. Keep the newest well-supported fact and preserve provenance.
4. Flag contradictions for review instead of guessing.
5. Produce a concise change report.

Use a dry-run first when deletion or broad rewriting is involved.
`,
  },
  {
    name: "setup-cowork",
    description: "Guide the user through workspace, runtime, skill, and integration setup",
    category: "integrations",
    icon: "rocket",
    tags: ["setup", "runtime", "integration"],
    content: `---
name: setup-cowork
description: Guided MiWarp workspace setup
category: integrations
icon: 🚀
---

# Setup MiWarp Workbench

Guide the user through a small verified setup loop:

1. Select or add a workspace.
2. Detect an installed runtime such as Claude Code, Codex, or MiMo.
3. Verify authentication and runtime health.
4. Run a read-only first task.
5. Add only the skills and integrations needed for the user's workflow.

Never claim a runtime or integration is ready until its health check succeeds.
`,
  },
  {
    name: "visualize-data",
    description:
      "Turn structured data into a bounded KPI view, chart specification, and written conclusion",
    category: "development",
    icon: "bar-chart-2",
    tags: ["visualization", "data", "chart", "kpi", "vega-lite"],
    content: `---
name: visualize-data
description: Create safe, bounded data visualizations for MiWarp chat
category: development
icon: 📊
---

# Visualize Data

Choose the smallest visual that answers the question. Write a short conclusion before the chart and an accessible text summary after it.

## Chart selection

| Question type | Preferred mark | Avoid |
|---------------|----------------|-------|
| Trend over time (dates, releases, latency) | \`line\` | Pie, 3D, dual y-axes |
| Compare categories or groups | \`bar\` | Pie with many slices |
| Part-of-whole when few segments sum to a meaningful total | \`arc\` (pie) | Pie for unrelated counts, 3D |

Default to \`bar\` or \`line\`. Use \`arc\` only when there are at most ~6 segments and the values represent shares of one whole.

## Output contracts

**KPI headline** — use \`miwarp-kpi\` for a few headline values:

\`\`\`miwarp-kpi
{"title":"Release health","items":[{"label":"Tests","value":"1,666","trend":"up","detail":"All passing"},{"label":"Build","value":"Pass","status":"success"}]}
\`\`\`

**Line (time trend)** — ordinal/time on x, quantitative on y; inline \`data.values\`, explicit \`title\` and axis labels:

\`\`\`vega-lite
{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","title":"Latency trend","data":{"values":[{"day":"Mon","ms":120},{"day":"Tue","ms":95}]},"mark":{"type":"line","point":true},"encoding":{"x":{"field":"day","type":"ordinal","title":"Day"},"y":{"field":"ms","type":"quantitative","title":"p95 latency (ms)"}}}
\`\`\`

**Bar (category comparison)** — nominal x, quantitative y:

\`\`\`vega-lite
{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","title":"Errors by service","data":{"values":[{"service":"api","count":3},{"service":"worker","count":12}]},"mark":"bar","encoding":{"x":{"field":"service","type":"nominal","title":"Service"},"y":{"field":"count","type":"quantitative","title":"Errors"}}}
\`\`\`

**Arc / pie (shares)** — only when slices are few and sum to a meaningful whole; prefer \`theta\` + \`color\`:

\`\`\`vega-lite
{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","title":"Traffic share","data":{"values":[{"source":"organic","pct":62},{"source":"paid","pct":38}]},"mark":{"type":"arc","innerRadius":40},"encoding":{"theta":{"field":"pct","type":"quantitative"},"color":{"field":"source","type":"nominal","title":"Source"}}}
\`\`\`

All Vega-Lite specs must use inline \`data\` (no remote URLs), include \`title\`, axis/legend labels, and a written conclusion. Do not invent missing values — state assumptions and gaps in prose.
`,
  },
  {
    name: "mind-map",
    description:
      "Produce hierarchical mind maps with Mermaid mindmap syntax and a plain-text outline",
    category: "productivity",
    icon: "network",
    tags: ["mindmap", "brainstorm", "hierarchy", "mermaid", "outline"],
    content: `---
name: mind-map
description: Hierarchical mind maps for MiWarp chat
category: productivity
icon: 🗺️
---

# Mind Map

Use when the user needs a brainstorm, topic tree, or concept hierarchy — not a sequence or deployment diagram.

## Rules

- One central root theme; keep each node label short (a few words).
- Prefer 2–4 levels; split very wide branches into a second diagram if needed.
- Use Mermaid \`mindmap\` only — no \`click\`, HTML, scripts, or remote images.
- After the diagram, add a plain-text bullet outline so the structure is readable without the graphic.

## Example

\`\`\`mermaid
mindmap
  root((Product launch))
    Research
      User interviews
      Competitor scan
    Build
      MVP scope
      QA checklist
    Launch
      Beta cohort
      Announcement
\`\`\`

**Outline**

- Product launch
  - Research → user interviews, competitor scan
  - Build → MVP scope, QA checklist
  - Launch → beta cohort, announcement
`,
  },
  {
    name: "architecture-diagram",
    description:
      "Explain system structure and runtime behavior with safe Mermaid diagrams and supporting prose",
    category: "development",
    icon: "workflow",
    tags: ["architecture", "diagram", "mermaid", "sequence", "flowchart"],
    content: `---
name: architecture-diagram
description: Produce architecture and runtime diagrams for MiWarp chat
category: development
icon: 🧭
---

# Architecture Diagram

Start with the architectural decision or behavior the diagram must explain. Name component ownership and connectors in prose, then emit one focused Mermaid diagram.

Suitable diagrams:

- \`flowchart\` for components and dependency direction.
- \`sequenceDiagram\` for request, event, retry, and recovery behavior.
- \`stateDiagram-v2\` for lifecycle state machines.
- \`gitGraph\` only for simple branch explanations.

\`\`\`mermaid
sequenceDiagram
  participant UI
  participant Coordinator
  participant Runtime
  UI->>Coordinator: submit(transaction)
  Coordinator->>Runtime: dispatch(idempotencyKey)
  Runtime-->>Coordinator: accepted
  Coordinator-->>UI: clear owned draft
\`\`\`

Keep node labels concise. Do not add click callbacks, HTML scripts, remote images, or untrusted links. Follow the diagram with a plain-text reading order and key tradeoffs.
`,
  },
  {
    name: "project-status-dashboard",
    description:
      "Summarize delivery health with milestones, progress, risks, and measurable evidence",
    category: "productivity",
    icon: "gauge",
    tags: ["project", "status", "dashboard", "progress", "milestone"],
    content: `---
name: project-status-dashboard
description: Build a concise project status dashboard
category: productivity
icon: 🎯
---

# Project Status Dashboard

Report the decision-relevant facts first: overall status, completed outcomes, current blockers, next milestone, and evidence.

Use \`miwarp-progress\` for bounded phases:

\`\`\`miwarp-progress
{"title":"v1.0.9 delivery","summary":"Core reliability is complete; experience work is active.","items":[{"label":"Send transactions","status":"done","progress":100},{"label":"Runtime Hub","status":"active","progress":55},{"label":"Release validation","status":"pending","progress":10}]}
\`\`\`

Use \`miwarp-timeline\` for dated events or ordered handoffs:

\`\`\`miwarp-timeline
{"title":"Next handoffs","items":[{"title":"Freeze contracts","state":"done"},{"title":"Integrate feature branches","state":"active"},{"title":"Run release gates","state":"pending"}]}
\`\`\`

Use at most twelve progress items. Distinguish measured completion from estimates and list unresolved risks in text.
`,
  },
  {
    name: "decision-map",
    description: "Compare options, constraints, consequences, and a recommended decision visually",
    category: "productivity",
    icon: "git-branch",
    tags: ["decision", "tradeoff", "options", "mermaid", "adr"],
    content: `---
name: decision-map
description: Map a decision and its tradeoffs
category: productivity
icon: 🧩
---

# Decision Map

Define the decision, hard constraints, evaluation criteria, and rejected alternatives. Recommend one option only after showing the tradeoffs.

For branching logic, use a compact Mermaid flowchart:

\`\`\`mermaid
flowchart TD
  A[Need independent deployment?] -->|No| B[Modular monolith]
  A -->|Yes| C[Need independent scaling?]
  C -->|No| D[Isolated worker/process]
  C -->|Yes| E[Service boundary]
\`\`\`

For scored evidence, use \`vega-lite\` with a small inline dataset. State that scores are judgments unless they come from measured data. End with consequences, rollback conditions, and the next verification step.
`,
  },
];

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
