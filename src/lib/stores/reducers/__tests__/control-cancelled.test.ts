import { describe, it, expect, vi } from "vitest";
import { reduceControlCancelled } from "../control-cancelled";

describe("reduceControlCancelled", () => {
  it("delegates to _resolveStaleTools with the predicate", () => {
    const store = {
      hookEvents: [] as unknown[],
      pendingElicitations: new Map() as Map<string, unknown>,
      _resolveStaleTools: vi.fn(),
    };
    reduceControlCancelled(
      { type: "control_cancelled", run_id: "r", _seq: 1, request_id: "req1" } as never,
      null,
      store as never,
      false,
    );
    expect(store._resolveStaleTools).toHaveBeenCalledWith(expect.any(Function), null);
    const predicate = (store._resolveStaleTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(predicate({ status: "permission_prompt", permission_request_id: "req1" })).toBe(true);
    expect(predicate({ status: "running", permission_request_id: "req1" })).toBe(true);
    expect(predicate({ status: "completed", permission_request_id: "req1" })).toBe(false);
    expect(predicate({ status: "permission_prompt", permission_request_id: "other" })).toBe(false);
  });

  it("marks matching hook_pending hook events as cancelled", () => {
    const store = {
      hookEvents: [
        { request_id: "req1", status: "hook_pending" },
        { request_id: "req1", status: "allowed" },
        { request_id: "other", status: "hook_pending" },
      ] as unknown[],
      pendingElicitations: new Map() as Map<string, unknown>,
      _resolveStaleTools: vi.fn(),
    };
    reduceControlCancelled(
      { type: "control_cancelled", run_id: "r", _seq: 1, request_id: "req1" } as never,
      null,
      store as never,
      false,
    );
    expect((store.hookEvents[0] as { status: string }).status).toBe("cancelled");
    expect((store.hookEvents[1] as { status: string }).status).toBe("allowed"); // unchanged
    expect((store.hookEvents[2] as { status: string }).status).toBe("hook_pending"); // different req_id
  });

  it("removes matching elicitation entry", () => {
    const elic = new Map<string, unknown>([["req1", { x: 1 }]]);
    const store = {
      hookEvents: [] as unknown[],
      pendingElicitations: elic,
      _resolveStaleTools: vi.fn(),
    };
    reduceControlCancelled(
      { type: "control_cancelled", run_id: "r", _seq: 1, request_id: "req1" } as never,
      null,
      store as never,
      false,
    );
    expect(store.pendingElicitations.has("req1")).toBe(false);
  });
});
