import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusEvent } from "$lib/types";
import type { Transport } from "$lib/transport";
import { SessionRunConnection } from "./session-run-connection";

vi.mock("$lib/utils/debug", () => ({ dbg: vi.fn(), dbgWarn: vi.fn() }));

function createTransport(): Transport & {
  subscribeRun: ReturnType<typeof vi.fn>;
  unsubscribeRun: ReturnType<typeof vi.fn>;
} {
  return {
    invoke: vi.fn(),
    listen: vi.fn(),
    isDesktop: () => false,
    subscribeRun: vi.fn(),
    unsubscribeRun: vi.fn(),
    getConnectionState: vi.fn(() => "open"),
    onConnectionStateChange: vi.fn(() => () => {}),
    dispose: vi.fn(),
  } as unknown as Transport & {
    subscribeRun: ReturnType<typeof vi.fn>;
    unsubscribeRun: ReturnType<typeof vi.fn>;
  };
}

function events(...seqs: number[]): BusEvent[] {
  return seqs.map((seq) => ({
    type: "message_delta",
    run_id: "run-1",
    text: String(seq),
    _seq: seq,
  })) as BusEvent[];
}

describe("SessionRunConnection", () => {
  let transport: ReturnType<typeof createTransport>;
  let connection: SessionRunConnection;

  beforeEach(() => {
    transport = createTransport();
    connection = new SessionRunConnection({ ownerId: "store-a", transport });
  });

  it("starts inactive with a stable explicit owner", () => {
    expect(connection.state).toBe("inactive");
    expect(connection.runId).toBeNull();
    expect(connection.checkpoint).toBe(0);
    expect(connection.ownerId).toBe("store-a");
  });

  it("generates a unique owner per instance", () => {
    const first = new SessionRunConnection({ transport });
    const second = new SessionRunConnection({ transport });
    expect(first.ownerId).not.toBe(second.ownerId);
  });

  it("beginReplay selects a run without creating a physical subscription", () => {
    connection.beginReplay("run-1");
    expect(connection.state).toBe("replaying");
    expect(connection.runId).toBe("run-1");
    expect(transport.subscribeRun).not.toHaveBeenCalled();
  });

  it("subscribeFromReplay establishes the owner at the highest replay checkpoint", () => {
    connection.beginReplay("run-1");
    connection.subscribeFromReplay("run-1", events(4, 7, 6));

    expect(connection.state).toBe("live");
    expect(connection.checkpoint).toBe(7);
    expect(transport.subscribeRun).toHaveBeenCalledWith("run-1", 7, "store-a");
  });

  it("subscribeFresh establishes a live subscription from zero", () => {
    connection.subscribeFresh("run-1");
    expect(connection.state).toBe("live");
    expect(connection.checkpoint).toBe(0);
    expect(transport.subscribeRun).toHaveBeenCalledWith("run-1", 0, "store-a");
  });

  it("repeated live subscription at the same checkpoint is idempotent", () => {
    connection.subscribeFromSeq("run-1", 10);
    connection.subscribeFromSeq("run-1", 10);
    connection.subscribeFromSeq("run-1", 5);
    expect(transport.subscribeRun).toHaveBeenCalledTimes(1);
    expect(connection.checkpoint).toBe(10);
  });

  it("a higher checkpoint refreshes the existing owner", () => {
    connection.subscribeFromSeq("run-1", 10);
    connection.subscribeFromSeq("run-1", 20);
    expect(transport.subscribeRun).toHaveBeenNthCalledWith(2, "run-1", 20, "store-a");
    expect(connection.checkpoint).toBe(20);
  });

  it("switching runs releases the old physical owner before subscribing the new run", () => {
    connection.subscribeFresh("run-1");
    connection.subscribeFresh("run-2");

    expect(transport.unsubscribeRun).toHaveBeenCalledWith("run-1", "store-a");
    expect(transport.subscribeRun).toHaveBeenLastCalledWith("run-2", 0, "store-a");
    expect(connection.runId).toBe("run-2");
  });

  it("beginReplay on a new run releases the old owner immediately", () => {
    connection.subscribeFresh("run-1");
    connection.beginReplay("run-2");

    expect(transport.unsubscribeRun).toHaveBeenCalledWith("run-1", "store-a");
    expect(connection.state).toBe("replaying");
    expect(connection.runId).toBe("run-2");
    expect(transport.subscribeRun).toHaveBeenCalledTimes(1);
  });

  it("markReloading preserves ownership but resets the logical checkpoint", () => {
    connection.subscribeFromSeq("run-1", 42);
    transport.unsubscribeRun.mockClear();

    connection.markReloading("run-1");

    expect(connection.state).toBe("reloading");
    expect(connection.checkpoint).toBe(0);
    expect(transport.unsubscribeRun).not.toHaveBeenCalled();
  });

  it("replay after full reload re-asserts the same owner and returns live", () => {
    connection.subscribeFromSeq("run-1", 42);
    connection.markReloading("run-1");
    connection.beginReplay("run-1");
    connection.subscribeFromReplay("run-1", events(1, 2, 3));

    expect(transport.subscribeRun).toHaveBeenLastCalledWith("run-1", 3, "store-a");
    expect(connection.state).toBe("live");
    expect(connection.checkpoint).toBe(3);
  });

  it("release unsubscribes once and is idempotent", () => {
    connection.subscribeFresh("run-1");
    connection.release();
    connection.release();

    expect(transport.unsubscribeRun).toHaveBeenCalledTimes(1);
    expect(connection.state).toBe("inactive");
    expect(connection.runId).toBeNull();
  });

  it("release after selection but before physical subscription does not unsubscribe", () => {
    connection.beginReplay("run-1");
    connection.release();
    expect(transport.unsubscribeRun).not.toHaveBeenCalled();
    expect(connection.state).toBe("inactive");
  });

  it("dispose releases the owner and permanently rejects further transitions", () => {
    connection.subscribeFresh("run-1");
    connection.dispose();
    connection.subscribeFresh("run-2");

    expect(transport.unsubscribeRun).toHaveBeenCalledWith("run-1", "store-a");
    expect(transport.subscribeRun).toHaveBeenCalledTimes(1);
    expect(connection.state).toBe("disposed");
    expect(connection.runId).toBeNull();
  });

  it("keeps logical state correct when the injected desktop transport is a no-op", () => {
    const desktop = createTransport();
    desktop.isDesktop = () => true;
    const desktopConnection = new SessionRunConnection({ ownerId: "desktop", transport: desktop });

    desktopConnection.beginReplay("run-1");
    desktopConnection.subscribeFromReplay("run-1", []);
    expect(desktopConnection.state).toBe("live");
    desktopConnection.release();
    expect(desktopConnection.state).toBe("inactive");
  });
});
