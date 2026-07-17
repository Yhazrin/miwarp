export type GovernorStatus = "ok" | "warning" | "exceeded" | "unknown";

export interface GovernorBudget {
  kind: "concurrent_runs" | "memory_bytes" | "daily_cost";
  label: string;
  current: number;
  limit: number;
  unit: string;
}

export interface GovernorSnapshot {
  status: GovernorStatus;
  concurrent_runs: number;
  budgets: GovernorBudget[];
  updated_at: string;
}

interface GovernorSeedOptions {
  concurrent_runs: number;
  concurrent_limit: number;
  memory_bytes: number;
  memory_limit: number;
  daily_cost: number;
  daily_cost_limit: number;
}

const DEFAULT_SEED: GovernorSeedOptions = {
  concurrent_runs: 2,
  concurrent_limit: 5,
  memory_bytes: 2_300_000_000,
  memory_limit: 4_000_000_000,
  daily_cost: 1.42,
  daily_cost_limit: 8.0,
};

function isoSecondsAgo(seconds: number): string {
  const date = new Date();
  date.setUTCSeconds(date.getUTCSeconds() - seconds);
  return date.toISOString();
}

function deriveStatus(snap: GovernorSeedOptions): GovernorStatus {
  const ratios = [
    snap.concurrent_runs / snap.concurrent_limit,
    snap.memory_bytes / snap.memory_limit,
    snap.daily_cost / snap.daily_cost_limit,
  ];
  const max = Math.max(...ratios);
  if (max >= 1) return "exceeded";
  if (max >= 0.8) return "warning";
  return "ok";
}

function buildSnapshot(options: GovernorSeedOptions = DEFAULT_SEED): GovernorSnapshot {
  return {
    status: deriveStatus(options),
    concurrent_runs: options.concurrent_runs,
    budgets: [
      {
        kind: "concurrent_runs",
        label: "Concurrent runs",
        current: options.concurrent_runs,
        limit: options.concurrent_limit,
        unit: "runs",
      },
      {
        kind: "memory_bytes",
        label: "Memory",
        current: options.memory_bytes,
        limit: options.memory_limit,
        unit: "bytes",
      },
      {
        kind: "daily_cost",
        label: "Daily cost",
        current: options.daily_cost,
        limit: options.daily_cost_limit,
        unit: "USD",
      },
    ],
    updated_at: new Date().toISOString(),
  };
}

export class ResourceGovernorStore {
  snapshot = $state<GovernorSnapshot | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  private inFlight: Promise<void> | null = null;

  get concurrentRuns(): number {
    return this.snapshot?.concurrent_runs ?? 0;
  }

  get status(): GovernorStatus {
    return this.snapshot?.status ?? "unknown";
  }

  occupancy(budgetKind: GovernorBudget["kind"]): number {
    if (!this.snapshot) return 0;
    const budget = this.snapshot.budgets.find((entry) => entry.kind === budgetKind);
    if (!budget || budget.limit === 0) return 0;
    return Math.min(1, budget.current / budget.limit);
  }

  async refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performRefresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      // Frontend stub. The Tauri `governor_snapshot` command will replace this.
      this.snapshot = buildSnapshot();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  /** Test hook for asserting status derivation logic. */
  static deriveFrom(options: GovernorSeedOptions): GovernorSnapshot {
    return buildSnapshot(options);
  }
}

const resourceGovernorStore = new ResourceGovernorStore();
;
