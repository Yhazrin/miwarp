import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RequestRegistry } from "./request-registry";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

describe("RequestRegistry", () => {
  let registry: RequestRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new RequestRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allocates unique ids", () => {
    const id1 = registry.allocateId();
    const id2 = registry.allocateId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^req_\d+$/);
  });

  it("register + resolve works", async () => {
    const { promise } = registry.register<string>("req_1", 1, 5000);
    registry.resolve("req_1", "hello");
    const result = await promise;
    expect(result).toBe("hello");
    expect(registry.size).toBe(0);
  });

  it("register + rejectWithError preserves structured error", async () => {
    const { promise } = registry.register<string>("req_1", 1, 5000);
    registry.rejectWithError("req_1", {
      message: "not found",
      code: -32601,
      data: { method: "foo" },
    });

    try {
      await promise;
      expect.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as Error & { code?: number; data?: unknown };
      expect(err.message).toBe("not found");
      expect(err.name).toBe("RpcError");
      expect(err.code).toBe(-32601);
      expect(err.data).toEqual({ method: "foo" });
    }
  });

  it("rejects on timeout", async () => {
    const { promise } = registry.register<string>("req_1", 1, 1000);

    vi.advanceTimersByTime(1001);

    try {
      await promise;
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect((e as Error).message).toContain("IPC_TIMEOUT");
      expect((e as Error).message).toContain("req_1");
    }
    expect(registry.size).toBe(0);
  });

  it("resolve clears timeout timer", async () => {
    const { promise } = registry.register<string>("req_1", 1, 5000);
    registry.resolve("req_1", "ok");
    await promise;
    // Advancing time should not cause any timeout rejection
    vi.advanceTimersByTime(10000);
    expect(registry.size).toBe(0);
  });

  it("rejectAll rejects all pending for given generation", async () => {
    const p1 = registry.register<string>("req_1", 1, 5000);
    const p2 = registry.register<string>("req_2", 1, 5000);
    const p3 = registry.register<string>("req_3", 2, 5000);

    registry.rejectAll("disconnected", 1);

    try {
      await p1.promise;
    } catch (e) {
      expect((e as Error).message).toBe("disconnected");
    }
    try {
      await p2.promise;
    } catch (e) {
      expect((e as Error).message).toBe("disconnected");
    }
    // p3 belongs to generation 2, should still be pending
    expect(registry.size).toBe(1);

    // Clean up
    registry.resolve("req_3", "ok");
    await p3.promise;
  });

  it("rejectAll without generation rejects all", async () => {
    const p1 = registry.register<string>("req_1", 1, 5000);
    const p2 = registry.register<string>("req_2", 2, 5000);

    registry.rejectAll("all gone");

    try {
      await p1.promise;
    } catch (e) {
      expect((e as Error).message).toBe("all gone");
    }
    try {
      await p2.promise;
    } catch (e) {
      expect((e as Error).message).toBe("all gone");
    }
    expect(registry.size).toBe(0);
  });

  it("rejectStale rejects only older generations", async () => {
    const p1 = registry.register<string>("req_1", 1, 5000);
    const p2 = registry.register<string>("req_2", 2, 5000);

    registry.rejectStale(2, "stale");

    try {
      await p1.promise;
    } catch (e) {
      expect((e as Error).message).toBe("stale");
    }
    // p2 is generation 2, not stale
    expect(registry.size).toBe(1);

    registry.resolve("req_2", "ok");
    await p2.promise;
  });

  it("dispose rejects all and clears", async () => {
    const p1 = registry.register<string>("req_1", 1, 5000);
    const p2 = registry.register<string>("req_2", 1, 5000);

    registry.dispose();

    try {
      await p1.promise;
    } catch (e) {
      expect((e as Error).message).toBe("Transport disposed");
    }
    try {
      await p2.promise;
    } catch (e) {
      expect((e as Error).message).toBe("Transport disposed");
    }
    expect(registry.size).toBe(0);
  });

  it("resolve returns false for unknown id", () => {
    expect(registry.resolve("nonexistent", "x")).toBe(false);
  });

  it("rejectWithError returns false for unknown id", () => {
    expect(registry.rejectWithError("nonexistent", { message: "x" })).toBe(false);
  });
});
