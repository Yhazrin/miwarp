import type { ArtifactFilter, ArtifactKind, ArtifactRecord } from "$lib/types/artifact";

function isoDaysAgo(days: number, hours = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString();
}

function seed(): ArtifactRecord[] {
  return [
    {
      id: "art-diff-110-A17-1",
      kind: "diff",
      title: "AttentionQueueStore incremental events",
      description: "Wave 2 attention store incremental patch.",
      run_id: "run-110-A17-1",
      task_id: "task-110-A17",
      workspace_cwd: "/Users/me/miwarp",
      content_hash: "sha256:9b1f0a",
      size_bytes: 12_840,
      mime_type: "text/x-diff",
      source_uri: "agent://runs/run-110-A17-1/diff",
      pinned: true,
      created_at: isoDaysAgo(0, 2),
      updated_at: isoDaysAgo(0, 2),
      tags: ["attention", "wave-2"],
    },
    {
      id: "art-mermaid-110-A8-1",
      kind: "mermaid",
      title: "Task lifecycle flow",
      description: "Mermaid diagram of the task state machine.",
      run_id: "run-110-A8-1",
      task_id: "task-110-A8",
      workspace_cwd: "/Users/me/miwarp",
      content_hash: "sha256:8a12cf",
      size_bytes: 2_104,
      mime_type: "text/vnd.mermaid",
      source_uri: "agent://runs/run-110-A8-1/mermaid/lifecycle",
      pinned: false,
      created_at: isoDaysAgo(1),
      updated_at: isoDaysAgo(1),
      tags: ["task", "diagram"],
    },
    {
      id: "art-test-110-A8-1",
      kind: "test_report",
      title: "vitest run for task-core-store",
      description: "6 tests passed (1 file).",
      run_id: "run-110-A8-1",
      task_id: "task-110-A8",
      workspace_cwd: "/Users/me/miwarp",
      content_hash: "sha256:f01ab2",
      size_bytes: 4_212,
      mime_type: "application/json",
      source_uri: "agent://runs/run-110-A8-1/test-report",
      pinned: false,
      created_at: isoDaysAgo(0, 6),
      updated_at: isoDaysAgo(0, 6),
      tags: ["test", "vitest"],
    },
    {
      id: "art-context-pack-110-A20-1",
      kind: "context_pack",
      title: "Spec & Acceptance context pack",
      description: "Context pack assembled for spec review.",
      run_id: "run-110-A20-1",
      task_id: "task-110-A20",
      workspace_cwd: "/Users/me/miwarp",
      content_hash: "sha256:2c9a44",
      size_bytes: 8_902,
      mime_type: "application/json",
      source_uri: "agent://runs/run-110-A20-1/context-pack",
      pinned: true,
      created_at: isoDaysAgo(2),
      updated_at: isoDaysAgo(2),
      tags: ["context", "spec"],
    },
    {
      id: "art-screenshot-110-S2-1",
      kind: "screenshot",
      title: "Doctor UI smoke screenshot",
      description: "macOS Doctor UI smoke capture.",
      run_id: "run-110-S2-1",
      task_id: null,
      workspace_cwd: "/Users/me/miwarp",
      content_hash: "sha256:7d5c11",
      size_bytes: 412_338,
      mime_type: "image/png",
      source_uri: "file:///.miwarp/diagnostics/smoke.png",
      pinned: false,
      created_at: isoDaysAgo(3),
      updated_at: isoDaysAgo(3),
      tags: ["diagnostics", "screenshot"],
    },
    {
      id: "art-diagnostic-bundle-110-S2-1",
      kind: "diagnostic_bundle",
      title: "Doctor trace bundle (redacted)",
      description: "Sanitized export of local agent trace.",
      run_id: "run-110-S2-1",
      task_id: null,
      workspace_cwd: "/Users/me/miwarp",
      content_hash: "sha256:1ee7ab",
      size_bytes: 1_204_882,
      mime_type: "application/zip",
      source_uri: "file:///.miwarp/diagnostics/bundle.zip",
      pinned: true,
      created_at: isoDaysAgo(3, 2),
      updated_at: isoDaysAgo(3, 2),
      tags: ["diagnostics", "trace"],
    },
  ];
}

export interface ArtifactGroup {
  id: string;
  label: string;
  artifacts: ArtifactRecord[];
}

export class ArtifactStore {
  artifacts = $state<ArtifactRecord[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  selectedArtifactId = $state<string | null>(null);
  filter = $state<ArtifactFilter>({ kind: "all", search: "", pinnedOnly: false });

  get selected(): ArtifactRecord | null {
    if (!this.selectedArtifactId) return null;
    return this.artifacts.find((artifact) => artifact.id === this.selectedArtifactId) ?? null;
  }

  get pinned(): ArtifactRecord[] {
    return this.artifacts.filter((artifact) => artifact.pinned);
  }

  countByKind(): Record<ArtifactKind, number> {
    const counts = {} as Record<ArtifactKind, number>;
    for (const artifact of this.artifacts) {
      counts[artifact.kind] = (counts[artifact.kind] ?? 0) + 1;
    }
    return counts;
  }

  applyFilter(filter: ArtifactFilter = this.filter): ArtifactRecord[] {
    const search = filter.search?.trim().toLowerCase() ?? "";
    return this.artifacts.filter((artifact) => {
      if (filter.runId && artifact.run_id !== filter.runId) return false;
      if (filter.taskId && artifact.task_id !== filter.taskId) return false;
      if (filter.kind && filter.kind !== "all" && artifact.kind !== filter.kind) return false;
      if (filter.pinnedOnly && !artifact.pinned) return false;
      if (search) {
        const haystack =
          `${artifact.title} ${artifact.description ?? ""} ${artifact.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  filtered(): ArtifactRecord[] {
    return this.applyFilter();
  }

  setFilter(next: Partial<ArtifactFilter>): void {
    this.filter = { ...this.filter, ...next };
  }

  select(id: string | null): void {
    this.selectedArtifactId = id;
  }

  togglePin(id: string): ArtifactRecord | null {
    const target = this.artifacts.find((artifact) => artifact.id === id);
    if (!target) return null;
    const updated: ArtifactRecord = {
      ...target,
      pinned: !target.pinned,
      updated_at: new Date().toISOString(),
    };
    this.upsert(updated);
    return updated;
  }

  remove(id: string): boolean {
    const target = this.artifacts.find((artifact) => artifact.id === id);
    if (!target) return false;
    this.artifacts = this.artifacts.filter((artifact) => artifact.id !== id);
    if (this.selectedArtifactId === id) this.selectedArtifactId = null;
    return true;
  }

  groupByRun(): ArtifactGroup[] {
    return this.groupBy((artifact) => artifact.run_id ?? "unassigned");
  }

  groupByKind(): ArtifactGroup[] {
    return this.groupBy((artifact) => artifact.kind);
  }

  groupByTask(): ArtifactGroup[] {
    return this.groupBy((artifact) => artifact.task_id ?? "unassigned");
  }

  upsert(artifact: ArtifactRecord): void {
    const index = this.artifacts.findIndex((existing) => existing.id === artifact.id);
    if (index >= 0) {
      this.artifacts[index] = artifact;
    } else {
      this.artifacts = [artifact, ...this.artifacts];
    }
    this.sort();
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      // Seeded mock data until the Tauri command lands.
      this.artifacts = seed();
      this.sort();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  private groupBy(key: (artifact: ArtifactRecord) => string): ArtifactGroup[] {
    const filtered = this.filtered();
    const groups = new Map<string, ArtifactRecord[]>();
    for (const artifact of filtered) {
      const id = key(artifact);
      const bucket = groups.get(id);
      if (bucket) bucket.push(artifact);
      else groups.set(id, [artifact]);
    }
    return [...groups.entries()].map(([id, items]) => ({
      id,
      label: id,
      artifacts: items.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }));
  }

  private sort(): void {
    this.artifacts = [...this.artifacts].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
}

export const artifactStore = new ArtifactStore();
