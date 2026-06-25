import type {
  SpecFilter,
  SpecGate,
  SpecLinkedTask,
  SpecPlanStep,
  SpecRecord,
  SpecStatus,
} from "$lib/types/spec";

function isoDaysAgo(days: number, hours = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString();
}

function seedSpecs(): SpecRecord[] {
  return [
    {
      id: "spec-attention-realtime",
      title: "Attention Queue real-time push",
      summary:
        "Live incremental event delivery for the durable attention queue so the workspace reflects new items without manual refresh.",
      status: "implementing",
      priority: "high",
      owner: "frontend-worker",
      tags: ["attention", "workspace", "realtime"],
      acceptance_criteria: [
        {
          id: "ac-1",
          description: "New attention events render in the queue within 2s without reload.",
          status: "pass",
          linked_gate: "gate-smoke",
        },
        {
          id: "ac-2",
          description: "Acknowledging an item drops it from the open list immediately.",
          status: "in_progress",
        },
      ],
      plan_steps: [
        { id: "ps-1", description: "Wire event bus to AttentionQueueStore", status: "done" },
        {
          id: "ps-2",
          description: "Update panel reactivity on incremental events",
          status: "in_progress",
        },
        { id: "ps-3", description: "Document Wave 2 audit", status: "pending" },
      ],
      clarifications: [
        {
          id: "q-1",
          question: "Should ack emit an event back to the queue?",
          answer: "Yes, treat ack as a domain event so other workspaces stay in sync.",
          answered_at: isoDaysAgo(1),
          answered_by: "owner",
        },
      ],
      linked_tasks: [
        { task_id: "task-110-A17", role: "primary", status: "in_progress" },
        { task_id: "task-110-A8", role: "followup", status: "in_progress" },
      ],
      gates: [
        {
          id: "gate-smoke",
          name: "Smoke: live events",
          verdict: "pass",
          criteria_ids: ["ac-1"],
          last_run_at: isoDaysAgo(0, 2),
        },
      ],
      created_at: isoDaysAgo(7),
      updated_at: isoDaysAgo(0, 2),
    },
    {
      id: "spec-task-lab",
      title: "Worktree Task Lab acceptance",
      summary:
        "Worktree-scoped engineering tasks with verification gate, review decision and merge/keep/discard disposition.",
      status: "verifying",
      priority: "high",
      owner: "frontend-worker",
      tags: ["task", "worktree", "review"],
      acceptance_criteria: [
        {
          id: "ac-1",
          description: "Two tasks can run in parallel worktrees without cross-write.",
          status: "pass",
          linked_gate: "gate-parallel",
        },
        {
          id: "ac-2",
          description: "Quality gate verdict surfaces in the task detail panel.",
          status: "pass",
          linked_gate: "gate-quality",
        },
        {
          id: "ac-3",
          description: "Reviewer can apply approve / changes / reject decisions.",
          status: "in_progress",
        },
      ],
      plan_steps: [
        { id: "ps-1", description: "Store + UI integration", status: "done" },
        { id: "ps-2", description: "Add keyboard nav and a11y", status: "done" },
        { id: "ps-3", description: "Hook up merge/keep/discard buttons", status: "done" },
      ],
      clarifications: [],
      linked_tasks: [{ task_id: "task-110-A8", role: "primary", status: "in_progress" }],
      gates: [
        {
          id: "gate-parallel",
          name: "Parallel worktree smoke",
          verdict: "pass",
          criteria_ids: ["ac-1"],
          last_run_at: isoDaysAgo(2),
        },
        {
          id: "gate-quality",
          name: "Quality gate verdicts visible",
          verdict: "pass",
          criteria_ids: ["ac-2"],
          last_run_at: isoDaysAgo(0, 4),
        },
      ],
      created_at: isoDaysAgo(14),
      updated_at: isoDaysAgo(0, 4),
    },
    {
      id: "spec-resource-governor",
      title: "Resource & Cost Governor (frontend surface)",
      summary:
        "Status-bar surface for concurrent runs and budget occupancy. Spec stage: planning acceptance criteria.",
      status: "planned",
      priority: "medium",
      owner: "frontend-worker",
      tags: ["governor", "budget", "concurrency"],
      acceptance_criteria: [
        {
          id: "ac-1",
          description: "Status bar shows concurrent running count and budget occupancy.",
          status: "pending",
        },
        {
          id: "ac-2",
          description: "Crossing soft cap surfaces a non-blocking warning.",
          status: "pending",
        },
      ],
      plan_steps: [
        { id: "ps-1", description: "Define store shape and seed data", status: "in_progress" },
        { id: "ps-2", description: "Wire status bar component", status: "pending" },
      ],
      clarifications: [
        {
          id: "q-1",
          question: "Soft cap vs hard cap UX?",
          answer: null,
        },
      ],
      linked_tasks: [],
      gates: [],
      created_at: isoDaysAgo(3),
      updated_at: isoDaysAgo(1),
    },
  ];
}

export class SpecStore {
  specs = $state<SpecRecord[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  selectedSpecId = $state<string | null>(null);
  filter = $state<SpecFilter>({ status: "all", priority: "all", search: "" });

  get selected(): SpecRecord | null {
    if (!this.selectedSpecId) return null;
    return this.specs.find((spec) => spec.id === this.selectedSpecId) ?? null;
  }

  get active(): SpecRecord[] {
    return this.specs.filter((spec) =>
      ["clarifying", "planned", "implementing", "verifying"].includes(spec.status),
    );
  }

  get accepted(): SpecRecord[] {
    return this.specs.filter((spec) => spec.status === "accepted");
  }

  get rejected(): SpecRecord[] {
    return this.specs.filter((spec) => spec.status === "rejected");
  }

  countByStatus(): Record<SpecStatus, number> {
    const counts: Record<SpecStatus, number> = {
      draft: 0,
      clarifying: 0,
      planned: 0,
      implementing: 0,
      verifying: 0,
      accepted: 0,
      rejected: 0,
    };
    for (const spec of this.specs) counts[spec.status] += 1;
    return counts;
  }

  applyFilter(specs: SpecRecord[], filter: SpecFilter = this.filter): SpecRecord[] {
    const search = filter.search?.trim().toLowerCase() ?? "";
    return specs.filter((spec) => {
      if (filter.status && filter.status !== "all" && spec.status !== filter.status) return false;
      if (filter.priority && filter.priority !== "all" && spec.priority !== filter.priority)
        return false;
      if (search) {
        const haystack = `${spec.title} ${spec.summary} ${spec.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  filtered(): SpecRecord[] {
    return this.applyFilter(this.specs);
  }

  upsert(spec: SpecRecord): void {
    const index = this.specs.findIndex((existing) => existing.id === spec.id);
    if (index >= 0) {
      this.specs[index] = spec;
    } else {
      this.specs = [spec, ...this.specs];
    }
    this.sort();
  }

  select(id: string | null): void {
    this.selectedSpecId = id;
  }

  setFilter(next: Partial<SpecFilter>): void {
    this.filter = { ...this.filter, ...next };
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      // Mock data until Tauri command lands; downstream command will replace this.
      const seeded = seedSpecs();
      this.specs = seeded;
      this.sort();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  // Stub actions — concrete mutations are reserved for the Tauri command integration.
  advanceStatus(id: string, next: SpecStatus): SpecRecord | null {
    const spec = this.specs.find((existing) => existing.id === id);
    if (!spec) return null;
    const updated: SpecRecord = { ...spec, status: next, updated_at: new Date().toISOString() };
    this.upsert(updated);
    return updated;
  }

  resolvePlanStep(id: string, stepId: string, status: SpecPlanStep["status"]): SpecRecord | null {
    const spec = this.specs.find((existing) => existing.id === id);
    if (!spec) return null;
    const updated: SpecRecord = {
      ...spec,
      plan_steps: spec.plan_steps.map((step) => (step.id === stepId ? { ...step, status } : step)),
      updated_at: new Date().toISOString(),
    };
    this.upsert(updated);
    return updated;
  }

  linkTask(id: string, link: SpecLinkedTask): SpecRecord | null {
    const spec = this.specs.find((existing) => existing.id === id);
    if (!spec) return null;
    const next = spec.linked_tasks.filter((task) => task.task_id !== link.task_id);
    next.push(link);
    const updated: SpecRecord = {
      ...spec,
      linked_tasks: next,
      updated_at: new Date().toISOString(),
    };
    this.upsert(updated);
    return updated;
  }

  recordGateResult(id: string, gateId: string, verdict: SpecGate["verdict"]): SpecRecord | null {
    const spec = this.specs.find((existing) => existing.id === id);
    if (!spec) return null;
    const updated: SpecRecord = {
      ...spec,
      gates: spec.gates.map((gate) =>
        gate.id === gateId ? { ...gate, verdict, last_run_at: new Date().toISOString() } : gate,
      ),
      updated_at: new Date().toISOString(),
    };
    this.upsert(updated);
    return updated;
  }

  private sort(): void {
    this.specs = [...this.specs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
}

export const specStore = new SpecStore();
