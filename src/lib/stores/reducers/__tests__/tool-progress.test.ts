import { describe, it, expect, vi } from "vitest";
import { reduceToolProgress } from "../tool-progress";

describe("reduceToolProgress", () => {
  it("patches elapsed_time_seconds on existing main-timeline tool", () => {
    const tl: unknown[] = [
      { kind: "tool", id: "tool-1", tool: { elapsed_time_seconds: 1 } },
      { kind: "message", id: "msg-1" },
    ];
    const store = {
      timeline: tl,
      _findToolIdx: (_ctx: unknown, id: string) =>
        tl.findIndex((e) => (e as { id: string }).id === id),
      _updateSubTimelineTool: vi.fn(),
    };
    reduceToolProgress(
      {
        type: "tool_progress",
        run_id: "r",
        _seq: 1,
        tool_use_id: "tool-1",
        elapsed_time_seconds: 5,
      } as never,
      null,
      store as never,
      false,
    );
    const patched = store.timeline[0] as { tool: { elapsed_time_seconds: number } };
    expect(patched.tool.elapsed_time_seconds).toBe(5);
    expect(store._updateSubTimelineTool).not.toHaveBeenCalled();
  });

  it("delegates to _updateSubTimelineTool when parent_tool_use_id is set", () => {
    const store = {
      timeline: [],
      _findToolIdx: vi.fn(),
      _updateSubTimelineTool: vi.fn(),
    };
    reduceToolProgress(
      {
        type: "tool_progress",
        run_id: "r",
        _seq: 1,
        tool_use_id: "child-1",
        parent_tool_use_id: "parent-1",
        elapsed_time_seconds: 7,
      } as never,
      null,
      store as never,
      false,
    );
    expect(store._updateSubTimelineTool).toHaveBeenCalledWith(
      "parent-1",
      "child-1",
      expect.any(Function),
      null,
    );
    expect(store._findToolIdx).not.toHaveBeenCalled();
  });

  it("no-op when tool_use_id not found in main timeline", () => {
    const tl: unknown[] = [];
    const store = {
      timeline: tl,
      _findToolIdx: () => -1,
      _updateSubTimelineTool: vi.fn(),
    };
    reduceToolProgress(
      {
        type: "tool_progress",
        run_id: "r",
        _seq: 1,
        tool_use_id: "missing",
        elapsed_time_seconds: 1,
      } as never,
      null,
      store as never,
      false,
    );
    expect(tl.length).toBe(0); // no patch applied
  });
});
