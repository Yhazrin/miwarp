import { describe, expect, it, vi } from "vitest";
import { reduceSessionLifecycle } from "$lib/stores/reducers/session-lifecycle";
import type { SessionStoreReducers } from "$lib/stores/reducers/types";

vi.mock("$lib/i18n/index.svelte", () => ({
  t: (key: string) => key,
}));

function mockStore(overrides: Partial<SessionStoreReducers> = {}): SessionStoreReducers {
  return {
    recoveryConnectionGeneration: 0,
    recoveryPhase: "",
    recoveryState: "healthy",
    recoveryCrashReason: null,
    recoveryUnrecoverable: false,
    recoveryNotice: null,
    recoveryLifecycleListener: null,
    ...overrides,
  } as SessionStoreReducers;
}

describe("reduceSessionLifecycle", () => {
  it("drops stale generation events", () => {
    const store = mockStore({ recoveryConnectionGeneration: 5 });
    reduceSessionLifecycle(
      {
        type: "session_lifecycle",
        run_id: "run-1",
        phase: "ready",
        recovery_state: "healthy",
        connection_generation: 3,
        timestamp_ms: 1,
      },
      null,
      store,
      false,
    );
    expect(store.recoveryConnectionGeneration).toBe(5);
  });

  it("projects recovering notice without prompt text", () => {
    const store = mockStore();
    reduceSessionLifecycle(
      {
        type: "session_lifecycle",
        run_id: "run-1",
        phase: "respawning",
        recovery_state: "recovering",
        crash_reason: "stdin_write_failed",
        connection_generation: 2,
        timestamp_ms: 1,
      },
      null,
      store,
      false,
    );
    expect(store.recoveryConnectionGeneration).toBe(2);
    expect(store.recoveryNotice).toBe("recovery_stdin_broken");
    expect(store.recoveryUnrecoverable).toBe(false);
  });

  it("notifies lifecycle listener for SendCoordinator sync", () => {
    const listener = vi.fn();
    const store = mockStore({ recoveryLifecycleListener: listener });
    reduceSessionLifecycle(
      {
        type: "session_lifecycle",
        run_id: "run-1",
        phase: "ready",
        recovery_state: "recovered",
        connection_generation: 4,
        timestamp_ms: 1,
      },
      null,
      store,
      false,
    );
    expect(listener).toHaveBeenCalledWith("recovered", 4);
  });
});
