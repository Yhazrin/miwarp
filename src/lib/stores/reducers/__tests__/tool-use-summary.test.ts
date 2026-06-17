import { describe, it, expect, vi } from "vitest";
import { reduceToolUseSummary } from "../tool-use-summary";

describe("reduceToolUseSummary", () => {
  it("patches summary on existing main-timeline tool", () => {
    const tl: unknown[] = [{ kind: "tool", id: "tool-1", tool: {} }];
    const store = {
      timeline: tl,
      _findToolIdx: (_ctx: unknown, id: string) =>
        tl.findIndex((e) => (e as { id: string }).id === id),
      _updateSubTimelineTool: vi.fn(),
    };
    reduceToolUseSummary(
      {
        type: "tool_use_summary",
        run_id: "r",
        _seq: 1,
        tool_use_id: "tool-1",
        summary: "Read 5 files",
      } as never,
      null,
      store as never,
      false,
    );
    const patched = store.timeline[0] as { tool: { summary: string } };
    expect(patched.tool.summary).toBe("Read 5 files");
  });

  it("delegates to _updateSubTimelineTool when parent_tool_use_id is set", () => {
    const store = {
      timeline: [],
      _findToolIdx: vi.fn(),
      _updateSubTimelineTool: vi.fn(),
    };
    reduceToolUseSummary(
      {
        type: "tool_use_summary",
        run_id: "r",
        _seq: 1,
        tool_use_id: "child",
        parent_tool_use_id: "parent",
        summary: "x",
      } as never,
      null,
      store as never,
      false,
    );
    expect(store._updateSubTimelineTool).toHaveBeenCalledWith(
      "parent",
      "child",
      expect.any(Function),
      null,
    );
  });
});
