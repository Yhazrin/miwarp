import { describe, expect, it, vi } from "vitest";
import { ConnectionState } from "./connection-state";
import { TauriTransport } from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("$lib/utils/debug", () => ({ dbg: vi.fn(), dbgWarn: vi.fn() }));

describe("TauriTransport connection health", () => {
  it("reports an always-open local IPC channel", () => {
    const transport = new TauriTransport();
    expect(transport.getConnectionState()).toBe(ConnectionState.Open);
  });

  it("returns a no-op connection listener cleanup", () => {
    const transport = new TauriTransport();
    const listener = vi.fn();
    const unsubscribe = transport.onConnectionStateChange(listener);

    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});
