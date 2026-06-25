import type {
  DiagnosticsBundle,
  DiagnosticsEvent,
  DiagnosticsFilter,
  DiagnosticsSnapshot,
} from "$lib/types/diagnostics";

function isoHoursAgo(hours: number): string {
  const date = new Date();
  date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString();
}

function seedEvents(): DiagnosticsEvent[] {
  return [
    {
      id: "diag-1",
      timestamp: isoHoursAgo(48),
      category: "runtime_health",
      severity: "info",
      title: "Claude runtime healthy",
      detail: "Binary resolved at /usr/local/bin/claude, version 1.0.9",
      source: "runtime-probe",
    },
    {
      id: "diag-2",
      timestamp: isoHoursAgo(20),
      category: "session_health",
      severity: "warning",
      title: "Session reconnect",
      detail: "Forced reconnect after 60s of silence",
      source: "session-actor",
      run_id: "run-110-A17-1",
    },
    {
      id: "diag-3",
      timestamp: isoHoursAgo(6),
      category: "trace",
      severity: "info",
      title: "Tool start: bash",
      detail: "cargo test --workspace --quiet",
      source: "session-actor",
      span_id: "span-1",
      trace_id: "trace-1",
      run_id: "run-110-A17-1",
    },
    {
      id: "diag-4",
      timestamp: isoHoursAgo(5),
      category: "trace",
      severity: "info",
      title: "Tool end: bash",
      detail: "duration 5.2s, exit 0",
      source: "session-actor",
      span_id: "span-1",
      trace_id: "trace-1",
      run_id: "run-110-A17-1",
    },
    {
      id: "diag-5",
      timestamp: isoHoursAgo(4),
      category: "performance",
      severity: "warning",
      title: "p95 latency 1.4s",
      detail: "Above soft cap of 1.0s for chat first-token",
      source: "perf-sampler",
    },
    {
      id: "diag-6",
      timestamp: isoHoursAgo(3),
      category: "session_health",
      severity: "error",
      title: "Permission wait timeout",
      detail: "User did not respond within 5m for a write outside the worktree",
      source: "session-actor",
      run_id: "run-110-A8-1",
      task_id: "task-110-A8",
    },
    {
      id: "diag-7",
      timestamp: isoHoursAgo(1),
      category: "runtime_health",
      severity: "info",
      title: "Codex runtime ready",
      detail: "Logged in, MCP servers reachable",
      source: "runtime-probe",
    },
  ];
}

function seedSnapshot(): DiagnosticsSnapshot {
  return {
    generated_at: new Date().toISOString(),
    runtime_health: "healthy",
    session_health: "degraded",
    last_diagnostic_at: isoHoursAgo(1),
    performance_p50_ms: 280,
    performance_p95_ms: 1400,
    performance_p99_ms: 2100,
  };
}

export class DiagnosticsStore {
  events = $state<DiagnosticsEvent[]>([]);
  snapshot = $state<DiagnosticsSnapshot | null>(null);
  bundles = $state<DiagnosticsBundle[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  exporting = $state(false);
  lastExportPath = $state<string | null>(null);
  selectedEventId = $state<string | null>(null);
  filter = $state<DiagnosticsFilter>({ category: "all", severity: "all", search: "" });

  get selectedEvent(): DiagnosticsEvent | null {
    if (!this.selectedEventId) return null;
    return this.events.find((event) => event.id === this.selectedEventId) ?? null;
  }

  selectEvent(id: string | null): void {
    this.selectedEventId = id;
  }

  applyFilter(filter: DiagnosticsFilter = this.filter): DiagnosticsEvent[] {
    const search = filter.search?.trim().toLowerCase() ?? "";
    return this.events.filter((event) => {
      if (filter.category && filter.category !== "all" && event.category !== filter.category)
        return false;
      if (filter.severity && filter.severity !== "all" && event.severity !== filter.severity)
        return false;
      if (search) {
        const haystack = `${event.title} ${event.detail ?? ""} ${event.source ?? ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  filtered(): DiagnosticsEvent[] {
    return this.applyFilter();
  }

  setFilter(next: Partial<DiagnosticsFilter>): void {
    this.filter = { ...this.filter, ...next };
  }

  countBySeverity(): Record<"info" | "warning" | "error" | "critical", number> {
    const counts = { info: 0, warning: 0, error: 0, critical: 0 };
    for (const event of this.events) counts[event.severity] += 1;
    return counts;
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.events = seedEvents();
      this.snapshot = seedSnapshot();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  async exportRedactedBundle(): Promise<DiagnosticsBundle | null> {
    this.exporting = true;
    try {
      // Stub: real implementation will call the `export_diagnostics` Tauri
      // command when the backend lands. The store surfaces a fake path so
      // the UI flow can be exercised end-to-end.
      const fakePath = `~/.miwarp/diagnostics/bundle-${Date.now()}.zip`;
      const bundle: DiagnosticsBundle = {
        id: `bundle-${Date.now()}`,
        created_at: new Date().toISOString(),
        size_bytes: 1_204_882,
        redacted_fields: ["env.API_KEY", "user.prompt_body"],
        destination: fakePath,
      };
      this.bundles = [bundle, ...this.bundles];
      this.lastExportPath = fakePath;
      return bundle;
    } finally {
      this.exporting = false;
    }
  }
}

export const diagnosticsStore = new DiagnosticsStore();
