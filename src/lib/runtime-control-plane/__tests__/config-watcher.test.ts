import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RuntimeConfigWatcher } from "../config-watcher";

const invoke = vi.fn();
const listen = vi.fn(async (_event: string, _handler: (payload: unknown) => void) => () => {});

vi.mock("$lib/transport", () => ({
  getTransport: () => ({ invoke, listen }),
}));

describe("RuntimeConfigWatcher", () => {
  let capturedHandler:
    | ((payload: {
        event: { runtimeId: string; generation: number; configPath: string; reason: string };
      }) => void)
    | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    listen.mockReset();
    capturedHandler = null;
    invoke.mockResolvedValue(1);
    listen.mockImplementation(async (_event: string, handler: (payload: unknown) => void) => {
      capturedHandler = handler as typeof capturedHandler;
      return () => {};
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces config events and ignores stale generations", async () => {
    const watcher = new RuntimeConfigWatcher();
    const events: string[] = [];
    await watcher.start("claude-code", (e) => events.push(e.reason));

    const handler = capturedHandler;
    expect(handler).toBeTruthy();
    handler!({
      event: {
        runtimeId: "claude-code",
        generation: 0,
        configPath: "/tmp/settings.json",
        reason: "config_changed",
      },
    });
    handler!({
      event: {
        runtimeId: "claude-code",
        generation: 1,
        configPath: "/tmp/settings.json",
        reason: "config_changed",
      },
    });

    vi.advanceTimersByTime(400);
    expect(events).toEqual(["debounced_config_changed"]);
  });
});
