import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRecoveryController } from "./session-recovery-controller";

function createTimers() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    timers: {
      setTimeout(callback: () => void): ReturnType<typeof setTimeout> {
        const id = nextId++;
        callbacks.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout(handle: ReturnType<typeof setTimeout>): void {
        callbacks.delete(handle as unknown as number);
      },
    },
    runAll(): void {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    get size(): number {
      return callbacks.size;
    },
  };
}

describe("SessionRecoveryController", () => {
  let notices: Array<string | null>;
  let fake: ReturnType<typeof createTimers>;
  let controller: SessionRecoveryController;

  beforeEach(() => {
    notices = [];
    fake = createTimers();
    controller = new SessionRecoveryController({
      setNotice: (notice) => notices.push(notice),
      timers: fake.timers,
      noticeDurationMs: 5000,
    });
  });

  it("coalesces concurrent recovery requests for the same run", async () => {
    let resolveRecovery!: () => void;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecovery = resolve;
        }),
    );

    const first = controller.request("run-1", "recovering", execute);
    const second = controller.request("run-1", "ignored", execute);
    await Promise.resolve();

    expect(second).toBe(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(controller.isRecovering("run-1")).toBe(true);

    resolveRecovery();
    await first;
    expect(controller.isRecovering("run-1")).toBe(false);
  });

  it("allows a new recovery after the previous request completed", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    await controller.request("run-1", "first", execute);
    await controller.request("run-1", "second", execute);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce independent runs", async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      controller.request("run-1", "one", first),
      controller.request("run-2", "two", second),
    ]);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("clears a completed recovery notice after the configured duration", async () => {
    await controller.request("run-1", "recovered", async () => {});
    expect(notices).toEqual(["recovered"]);
    expect(fake.size).toBe(1);

    fake.runAll();
    expect(notices).toEqual(["recovered", null]);
  });

  it("an older recovery cannot clear the notice of a newer run", async () => {
    let resolveFirst!: () => void;
    const first = controller.request(
      "run-1",
      "first",
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await controller.request("run-2", "second", async () => {});
    resolveFirst();
    await first;

    fake.runAll();
    expect(notices).toEqual(["first", "second", null]);
  });

  it("resetNotice clears timers and invalidates pending notice cleanup", async () => {
    await controller.request("run-1", "recovering", async () => {});
    controller.resetNotice();
    expect(fake.size).toBe(0);
    expect(notices.at(-1)).toBeNull();
  });

  it("dispose clears notice and ignores future requests", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    controller.dispose();
    await controller.request("run-1", "ignored", execute);
    expect(execute).not.toHaveBeenCalled();
    expect(notices.at(-1)).toBeNull();
  });
});
