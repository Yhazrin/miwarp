import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "$lib/types/task";

const apiMocks = vi.hoisted(() => ({
  listTaskEvents: vi.fn(),
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
