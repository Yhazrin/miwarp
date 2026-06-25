import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionQueueStore } from "./attention-queue-store.svelte";

vi.mock("$lib/api", () => ({
  getAttentionQueue: vi.fn(),
  listAttentionQueueEvents: vi.fn(),
  acknowledgeAttentionItem: vi.fn(),
  resolveAttentionItem: vi.fn(),
  reconcileAttentionQueue: vi.fn(),
}));

import * as api from "$lib/api";
import type {
  AttentionQueueSnapshot,
  AttentionEvent,
  AttentionReconcileReport,
} from "$lib/types/attention-queue";

const baseSnapshot = (): AttentionQueueSnapshot => ({
  schema_version: 1,
  items: [
    {
      id: "item-1",
      stable_key: "task_attention:task:task-1",
      kind: "task_attention",
      severity: "warning",
      status: "open",
      title: "Task needs attention",
      summary: "Restart required",
      task_id: "task-1",
      run_id: "run-1",
      source_revision: 1,
      allowed_actions: ["acknowledge", "retry_task", "mark_task_failed"],
      generation: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "item-2",
      stable_key: "pending_approval:run:run-1:request:req-1",
      kind: "pending_approval",
      severity: "blocking",
      status: "open",
      title: "Approval required",
      summary: "Tool waiting",
      run_id: "run-1",
      request_id: "req-1",
      source_revision: 2,
      allowed_actions: ["acknowledge"],
      generation: 1,
      created_at: "2026-01-01T00:00:01.000Z",
      updated_at: "2026-01-01T00:00:01.000Z",
      last_seen_at: "2026-01-01T00:00:01.000Z",
    },
  ],
  revision: 1,
  last_event_seq: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:01.000Z",
});

describe("AttentionQueueStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedupes incremental events by seq", async () => {
    const store = new AttentionQueueStore();
    const event: AttentionEvent = {
      id: "evt-1",
      seq: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      event: { type: "raised", item: baseSnapshot().items[0] },
    };
    store.events = [event];
    vi.mocked(api.listAttentionQueueEvents).mockResolvedValue([event, { ...event, id: "evt-1b" }]);

    const loaded = await store.loadEvents();
    expect(loaded).toHaveLength(1);
    expect(api.listAttentionQueueEvents).toHaveBeenCalledWith(1);
  });

  it("uses single-flight for snapshot loads", async () => {
    const store = new AttentionQueueStore();
    vi.mocked(api.getAttentionQueue).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(baseSnapshot()), 10);
        }),
    );

    const [first, second] = await Promise.all([store.loadSnapshot(), store.loadSnapshot()]);
    expect(first).toEqual(second);
    expect(api.getAttentionQueue).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache after reconcile changes", async () => {
    const store = new AttentionQueueStore();
    store.snapshot = baseSnapshot();
    store.events = [
      {
        id: "evt-1",
        seq: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
        event: { type: "raised", item: baseSnapshot().items[0] },
      },
    ];

    const report: AttentionReconcileReport = {
      scanned_tasks: 1,
      scanned_runs: 1,
      raised: 1,
      refreshed: 0,
      reopened: 0,
      auto_resolved: 0,
      recovered_pending_mutations: 0,
      failures: [],
    };
    vi.mocked(api.reconcileAttentionQueue).mockResolvedValue(report);
    vi.mocked(api.getAttentionQueue).mockResolvedValue(baseSnapshot());
    vi.mocked(api.listAttentionQueueEvents).mockResolvedValue([]);

    await store.reconcile();
    expect(api.getAttentionQueue).toHaveBeenCalled();
    expect(api.listAttentionQueueEvents).toHaveBeenCalled();
    expect(store.lastReconcileReport).toEqual(report);
  });

  it("derives blocked and task/run queries", async () => {
    const store = new AttentionQueueStore();
    store.snapshot = baseSnapshot();
    expect(store.blockedItems).toHaveLength(1);
    expect(store.itemsForTask("task-1")).toHaveLength(1);
    expect(store.itemsForRun("run-1")).toHaveLength(2);
  });
});
