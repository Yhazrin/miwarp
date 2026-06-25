import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskEvent, TaskRecord } from "$lib/types/task";

const apiMocks = vi.hoisted(() => ({
  listTaskEvents: vi.fn(),
  listTasks: vi.fn(),
}));

vi.mock("$lib/api", () => apiMocks);

import { TaskCoreStore } from "./task-core-store.svelte";

function event(seq: number): TaskEvent {
  return {
    id: `event-${seq}`,
    task_id: "task-1",
    seq,
    source: "system",
    event: { type: "created" },
    timestamp: `2026-06-23T00:00:0${seq}.000Z`,
  };
}

function task(
  id: string,
  status: TaskRecord["status"],
  updatedAt: string,
  overrides: Partial<TaskRecord> = {},
): TaskRecord {
  return {
    id,
    title: id,
    description: "",
    constraints: [],
    allowed_dirs: [],
    verification_commands: [],
    verification_results: [],
    changed_files: [],
    checkpoints: [],
    dev_servers: [],
    status,
    priority: "medium",
    tags: [],
    run_links: [],
    artifact_links: [],
    quality_gate: { verdict: "pending", checks: [] },
    review: { outcome: "pending" },
    merge_decision: { decision: "pending" },
    revision: 1,
    last_event_seq: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...overrides,
  };
}

describe("TaskCoreStore lifecycle events", () => {
  beforeEach(() => {
    apiMocks.listTaskEvents.mockReset();
  });

  it("sorts and deduplicates events by sequence", async () => {
    apiMocks.listTaskEvents.mockResolvedValueOnce([event(2), event(1), event(2)]);
    const store = new TaskCoreStore();

    const events = await store.loadEvents("task-1");

    expect(apiMocks.listTaskEvents).toHaveBeenCalledWith("task-1", 0);
    expect(events.map((item) => item.seq)).toEqual([1, 2]);
    expect(store.eventsFor("task-1").map((item) => item.seq)).toEqual([1, 2]);
  });

  it("loads incrementally from the latest cached sequence", async () => {
    apiMocks.listTaskEvents
      .mockResolvedValueOnce([event(1), event(2)])
      .mockResolvedValueOnce([event(3)]);
    const store = new TaskCoreStore();

    await store.loadEvents("task-1");
    const events = await store.loadEvents("task-1");

    expect(apiMocks.listTaskEvents).toHaveBeenNthCalledWith(2, "task-1", 2);
    expect(events.map((item) => item.seq)).toEqual([1, 2, 3]);
  });

  it("shares one in-flight request per task", async () => {
    let resolveRequest: ((events: TaskEvent[]) => void) | undefined;
    apiMocks.listTaskEvents.mockReturnValueOnce(
      new Promise<TaskEvent[]>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const store = new TaskCoreStore();

    const first = store.loadEvents("task-1");
    const second = store.loadEvents("task-1");

    expect(first).toBe(second);
    expect(apiMocks.listTaskEvents).toHaveBeenCalledTimes(1);
    resolveRequest?.([event(1)]);
    await expect(first).resolves.toEqual([event(1)]);
  });
});

describe("TaskCoreStore derivations", () => {
  beforeEach(() => {
    apiMocks.listTaskEvents.mockReset();
    apiMocks.listTasks.mockReset();
  });

  it("segments tasks by lifecycle bucket", () => {
    const store = new TaskCoreStore();
    store.tasks = [
      task("a", "running", "2026-06-23T01:00:00Z"),
      task("b", "needs_attention", "2026-06-23T02:00:00Z"),
      task("c", "review", "2026-06-23T03:00:00Z"),
      task("d", "done", "2026-06-23T04:00:00Z"),
      task("e", "failed", "2026-06-23T05:00:00Z"),
      task("f", "archived", "2026-06-23T06:00:00Z"),
    ];

    expect(store.active.map((item) => item.id).sort()).toEqual(["a", "b", "c"]);
    expect(store.needsAttention.map((item) => item.id)).toEqual(["b"]);
    expect(store.inReview.map((item) => item.id)).toEqual(["c"]);
    expect(store.completed.map((item) => item.id)).toEqual(["d"]);
    expect(store.failed.map((item) => item.id)).toEqual(["e"]);
    expect(store.archived.map((item) => item.id)).toEqual(["f"]);
  });

  it("counts tasks by status", () => {
    const store = new TaskCoreStore();
    store.tasks = [
      task("a", "running", "2026-06-23T01:00:00Z"),
      task("b", "running", "2026-06-23T02:00:00Z"),
      task("c", "done", "2026-06-23T03:00:00Z"),
    ];

    const counts = store.countByStatus();
    expect(counts.running).toBe(2);
    expect(counts.done).toBe(1);
    expect(counts.failed).toBe(0);
    expect(counts.draft).toBe(0);
  });

  it("filters by predicate bucket", () => {
    const store = new TaskCoreStore();
    store.tasks = [
      task("a", "running", "2026-06-23T01:00:00Z"),
      task("b", "needs_attention", "2026-06-23T02:00:00Z"),
      task("c", "review", "2026-06-23T03:00:00Z"),
      task("d", "done", "2026-06-23T04:00:00Z"),
      task("e", "failed", "2026-06-23T05:00:00Z"),
    ];

    expect(store.filterBy("all").length).toBe(5);
    expect(
      store
        .filterBy("active")
        .map((item) => item.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    expect(store.filterBy("attention").map((item) => item.id)).toEqual(["b"]);
    expect(store.filterBy("review").map((item) => item.id)).toEqual(["c"]);
    expect(store.filterBy("done").map((item) => item.id)).toEqual(["d"]);
    expect(store.filterBy("failed").map((item) => item.id)).toEqual(["e"]);
    expect(store.filterBy("archived")).toEqual([]);
  });
});
