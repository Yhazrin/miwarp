import { describe, it, expect } from "vitest";
import { reduceSystemStatus } from "../system-status";

describe("reduceSystemStatus", () => {
  it("writes status to store.systemStatus", () => {
    const store: { systemStatus: { status: string } | null } = { systemStatus: null };
    reduceSystemStatus(
      { type: "system_status", run_id: "r", _seq: 1, status: "degraded" } as never,
      null,
      store as never,
      false,
    );
    expect(store.systemStatus).toEqual({ status: "degraded" });
  });

  it("defaults status to empty string when missing", () => {
    const store: { systemStatus: { status: string } | null } = { systemStatus: null };
    reduceSystemStatus(
      { type: "system_status", run_id: "r", _seq: 1 } as never,
      null,
      store as never,
      false,
    );
    expect(store.systemStatus).toEqual({ status: "" });
  });
});
