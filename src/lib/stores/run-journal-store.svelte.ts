import * as api from "$lib/api";
import type {
  RunCheckpoint,
  RunJournalEvent,
  RunJournalReconcileReport,
  RunJournalSnapshot,
} from "$lib/types/run-journal";

export class RunJournalStore {
  snapshotsByRunId = $state<Record<string, RunJournalSnapshot>>({});
  eventsByRunId = $state<Record<string, RunJournalEvent[]>>({});
  lastReconcileReport = $state<RunJournalReconcileReport | null>(null);
  private snapshotFlights = new Map<string, Promise<RunJournalSnapshot>>();
  private eventFlights = new Map<string, Promise<RunJournalEvent[]>>();

  snapshotFor(runId: string): RunJournalSnapshot | null {
    return this.snapshotsByRunId[runId] ?? null;
  }

  eventsFor(runId: string): RunJournalEvent[] {
    return this.eventsByRunId[runId] ?? [];
  }

  loadSnapshot(runId: string): Promise<RunJournalSnapshot> {
    const existing = this.snapshotFlights.get(runId);
    if (existing) return existing;

    const flight = api
      .getRunJournal(runId)
      .then((snapshot) => {
        this.snapshotsByRunId = { ...this.snapshotsByRunId, [runId]: snapshot };
        return snapshot;
      })
      .finally(() => {
        this.snapshotFlights.delete(runId);
      });
    this.snapshotFlights.set(runId, flight);
    return flight;
  }

  loadEvents(runId: string): Promise<RunJournalEvent[]> {
    const existing = this.eventFlights.get(runId);
    if (existing) return existing;

    const current = this.eventsFor(runId);
    const sinceSeq = current.at(-1)?.seq ?? 0;
    const flight = api
      .listRunJournalEvents(runId, sinceSeq)
      .then((events) => {
        const merged = new Map<number, RunJournalEvent>();
        for (const event of [...current, ...events]) merged.set(event.seq, event);
        const ordered = [...merged.values()].sort((a, b) => a.seq - b.seq);
        this.eventsByRunId = { ...this.eventsByRunId, [runId]: ordered };
        return ordered;
      })
      .finally(() => {
        this.eventFlights.delete(runId);
      });
    this.eventFlights.set(runId, flight);
    return flight;
  }

  async createCheckpoint(runId: string, label?: string): Promise<RunCheckpoint> {
    const checkpoint = await api.createRunCheckpoint(runId, label);
    await this.loadSnapshot(runId);
    await this.loadEvents(runId);
    return checkpoint;
  }

  async reconcileAfterRestart(): Promise<RunJournalReconcileReport> {
    const report = await api.reconcileRunJournalAfterRestart();
    this.lastReconcileReport = report;
    if (
      report.recovered_pending_mutations > 0 ||
      report.restart_reconciled > 0 ||
      report.marked_uncertain > 0 ||
      report.impossible_resume > 0 ||
      report.failures.length > 0
    ) {
      // Reconciliation can rewrite snapshots and append events for multiple
      // runs. Invalidate both caches rather than presenting stale recovery data.
      this.snapshotsByRunId = {};
      this.eventsByRunId = {};
    }
    return report;
  }
}

export const runJournalStore = new RunJournalStore();
