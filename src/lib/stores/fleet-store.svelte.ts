/**
 * FleetStore: reactive state for the Fleet View (v1.2.0).
 *
 * - `members` / `metrics` come from REST + tauri command (same backing impl).
 * - Live updates flow through `/api/fleet/ws` WS, which forwards B-class
 *   broadcaster events filtered to fleet-relevant ones.
 * - Filter state is local; the store re-derives `filteredMembers` on change.
 */
import * as api from "$lib/api";
import type { FleetMemberSummary, FleetMetrics, FleetStatus } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

export interface FleetFilters {
  status: FleetStatus | "all";
  agent: string | "all";
  search: string;
}

export class FleetStore {
  members = $state<FleetMemberSummary[]>([]);
  metrics = $state<FleetMetrics | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  filters = $state<FleetFilters>({
    status: "all",
    agent: "all",
    search: "",
  });

  /** WebSocket for live updates; null when not connected. */
  private ws: WebSocket | null = null;
  private wsRetryAttempt = 0;
  private static readonly _WS_RETRY_DELAYS_MS = [1000, 3000, 5000];

  /** Per-employee selected id (for the detail drawer). */
  selectedMemberId = $state<string | null>(null);

  filteredMembers = $derived.by(() => {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    return this.members.filter((m) => {
      if (f.status !== "all" && m.status !== f.status) return false;
      if (f.agent !== "all" && m.agent !== f.agent) return false;
      if (q) {
        const hay = `${m.id} ${m.cwd} ${m.currentTaskPreview ?? ""} ${m.model ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  /** Distinct agent values present in the current member set (for filter UI). */
  availableAgents = $derived.by(() => {
    const set = new Set<string>();
    for (const m of this.members) set.add(m.agent);
    return Array.from(set).sort();
  });

  /** Count by status for header chips. */
  statusCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const m of this.members) {
      counts[m.status] = (counts[m.status] ?? 0) + 1;
    }
    return counts;
  });

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [members, metrics] = await Promise.all([api.listFleet(), api.getFleetMetrics()]);
      this.members = members;
      this.metrics = metrics;
      dbg("fleet", `refreshed: ${members.length} members, ${metrics.total} total`);
    } catch (e) {
      this.error = String(e);
      dbgWarn("fleet", `refresh failed: ${e}`);
    } finally {
      this.loading = false;
    }
  }

  async stopMember(id: string): Promise<boolean> {
    try {
      const ok = await api.stopFleetMember(id);
      if (ok) {
        // Optimistic local update; the WS event will reconcile.
        this.members = this.members.map((m) =>
          m.id === id ? { ...m, status: "stopped" as FleetStatus } : m,
        );
      }
      return ok;
    } catch (e) {
      this.error = `stop failed: ${e}`;
      return false;
    }
  }

  async sendToMember(id: string, prompt: string): Promise<boolean> {
    try {
      const r = await api.sendToFleetMember(id, prompt);
      return r.accepted;
    } catch (e) {
      this.error = `send failed: ${e}`;
      return false;
    }
  }

  /**
   * Open the live-update WebSocket. Idempotent: calling twice is a no-op.
   * The WS endpoint is `ws(s)://<host>:<port>/api/fleet/ws?token=<token>`.
   */
  connectLiveUpdates(webServerToken: string, port: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.ws) this.ws.close();

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname || "127.0.0.1";
    const url = `${proto}//${host}:${port}/api/fleet/ws?token=${encodeURIComponent(webServerToken)}`;

    dbg("fleet", `connecting WS: ${url}`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.wsRetryAttempt = 0;
      dbg("fleet", "WS connected");
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        this.applyWsEvent(data);
      } catch (e) {
        dbgWarn("fleet", `WS message parse failed: ${e}`);
      }
    };
    ws.onerror = () => {
      dbgWarn("fleet", "WS error");
    };
    ws.onclose = () => {
      dbg("fleet", "WS closed");
      this.ws = null;
      this.scheduleWsReconnect(webServerToken, port);
    };
  }

  private scheduleWsReconnect(token: string, port: number) {
    const delay =
      FleetStore._WS_RETRY_DELAYS_MS[
        Math.min(this.wsRetryAttempt, FleetStore._WS_RETRY_DELAYS_MS.length - 1)
      ];
    this.wsRetryAttempt += 1;
    setTimeout(() => this.connectLiveUpdates(token, port), delay);
  }

  private applyWsEvent(data: { type?: string; run_id?: string; payload?: unknown }) {
    const runId = data.run_id;
    if (!runId) return;
    // On any fleet-relevant event, just refresh the affected member from REST.
    // v1.2.0 MVP: avoid complex incremental reconciliation; cheap refresh wins.
    const target = this.members.find((m) => m.id === runId);
    if (!target) return;
    api
      .getFleetMember(runId)
      .then((detail) => {
        this.members = this.members.map((m) => (m.id === runId ? detail : m));
      })
      .catch((e) => dbgWarn("fleet", `WS refresh for ${runId} failed: ${e}`));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  resetFilters(): void {
    this.filters = { status: "all", agent: "all", search: "" };
  }
}

// Singleton — only one fleet view at a time.
export const fleetStore = new FleetStore();
