import { describe, it, expect, vi } from "vitest";
import { reduceTaskNotification } from "../task-notification";

vi.mock("$lib/utils/debug", () => ({ dbg: vi.fn() }));

describe("reduceTaskNotification", () => {
  const makeStore = () => ({ taskNotifications: new Map() });

  it("inserts a new task with fallback message", () => {
    const store = makeStore();
    reduceTaskNotification(
      {
        type: "task_notification",
        run_id: "r",
        _seq: 1,
        task_id: "t1",
        status: "in_progress",
      } as never,
      null,
      store as never,
      false,
    );
    const e = store.taskNotifications.get("t1") as { message: string; status: string };
    expect(e.message).toBe("t1"); // falls back to task_id
    expect(e.status).toBe("in_progress");
  });

  it("prefers data.summary over task_id for message", () => {
    const store = makeStore();
    reduceTaskNotification(
      {
        type: "task_notification",
        run_id: "r",
        _seq: 1,
        task_id: "t1",
        status: "completed",
        data: { summary: "Run build" },
      } as never,
      null,
      store as never,
      false,
    );
    const e = store.taskNotifications.get("t1") as { message: string };
    expect(e.message).toBe("Run build");
  });

  it("preserves prior startedAt when updating existing task", () => {
    const store = makeStore();
    store.taskNotifications.set("t1", { startedAt: 12345, status: "x" });
    reduceTaskNotification(
      { type: "task_notification", run_id: "r", _seq: 1, task_id: "t1", status: "y" } as never,
      null,
      store as never,
      false,
    );
    const e = store.taskNotifications.get("t1") as { startedAt: number; status: string };
    expect(e.startedAt).toBe(12345); // preserved
    expect(e.status).toBe("y"); // updated
  });
});
