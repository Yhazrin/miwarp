import * as api from "$lib/api";
import type {
  AttentionAction,
  AttentionEvent,
  AttentionItem,
  AttentionQueueSnapshot,
  AttentionReconcileReport,
  AttentionStatus,
} from "$lib/types/attention-queue";

export class AttentionQueueStore {
  snapshot = $state<AttentionQueueSnapshot | null>(null);
  events = $state<AttentionEvent[]>([]);
  lastReconcileReport = $state<AttentionReconcileReport | null>(null);

  private snapshotFlight: Promise<AttentionQueueSnapshot> | null = null;
  private eventsFlight: Promise<AttentionEvent[]> | null = null;

  openItems = $derived.by(() => this.itemsWithStatus("open"));
  acknowledgedItems = $derived.by(() => this.itemsWithStatus("acknowledged"));
  blockedItems = $derived.by(() =>
    (this.snapshot?.items ?? []).filter(
      (item) =>
        item.severity === "blocking" && (item.status === "open" || item.status === "acknowledged"),
    ),
  );

  itemsForTask(taskId: string): AttentionItem[] {
    return (this.snapshot?.items ?? []).filter((item) => item.task_id === taskId);
  }

  itemsForRun(runId: string): AttentionItem[] {
    return (this.snapshot?.items ?? []).filter((item) => item.run_id === runId);
  }

  loadSnapshot(): Promise<AttentionQueueSnapshot> {
    if (this.snapshotFlight) return this.snapshotFlight;

    this.snapshotFlight = api
      .getAttentionQueue()
      .then((snapshot) => {
        this.snapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.snapshotFlight = null;
      });
    return this.snapshotFlight;
  }

  loadEvents(): Promise<AttentionEvent[]> {
    if (this.eventsFlight) return this.eventsFlight;

    const sinceSeq = this.events.at(-1)?.seq ?? 0;
    this.eventsFlight = api
      .listAttentionQueueEvents(sinceSeq)
      .then((incoming) => {
        const merged = new Map<number, AttentionEvent>();
        for (const event of [...this.events, ...incoming]) {
          merged.set(event.seq, event);
        }
        const ordered = [...merged.values()].sort((a, b) => a.seq - b.seq);
        this.events = ordered;
        return ordered;
      })
      .finally(() => {
        this.eventsFlight = null;
      });
    return this.eventsFlight;
  }

  async acknowledge(id: string, actor?: string): Promise<AttentionQueueSnapshot> {
    const snapshot = await api.acknowledgeAttentionItem(id, actor);
    this.snapshot = snapshot;
    await this.loadEvents();
    return snapshot;
  }

  async resolve(
    id: string,
    action: AttentionAction,
    actor?: string,
    note?: string,
  ): Promise<AttentionQueueSnapshot> {
    const snapshot = await api.resolveAttentionItem(id, action, actor, note);
    this.snapshot = snapshot;
    await this.loadEvents();
    return snapshot;
  }

  async reconcile(): Promise<AttentionReconcileReport> {
    const report = await api.reconcileAttentionQueue();
    this.lastReconcileReport = report;
    if (
      report.raised > 0 ||
      report.refreshed > 0 ||
      report.reopened > 0 ||
      report.auto_resolved > 0 ||
      report.recovered_pending_mutations > 0 ||
      report.failures.length > 0
    ) {
      this.invalidateCache();
      await this.loadSnapshot();
      await this.loadEvents();
    }
    return report;
  }

  invalidateCache(): void {
    this.snapshot = null;
    this.events = [];
  }

  private itemsWithStatus(status: AttentionStatus): AttentionItem[] {
    return (this.snapshot?.items ?? []).filter((item) => item.status === status);
  }
}

export const attentionQueueStore = new AttentionQueueStore();
