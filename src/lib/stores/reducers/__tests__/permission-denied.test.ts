import { describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "$lib/types";
import { reducePermissionDenied } from "../permission-denied";

function makeToolEntry(
  toolUseId: string,
  status: Extract<TimelineEntry, { kind: "tool" }>["tool"]["status"] = "running",
): TimelineEntry {
  return {
    kind: "tool",
    id: toolUseId,
    anchorId: toolUseId,
    ts: "2026-06-21T00:00:00.000Z",
    tool: {
      tool_use_id: toolUseId,
      tool_name: "Bash",
      input: {},
      status,
    },
  };
}

function makeStore(opts: { timeline?: TimelineEntry[] } = {}) {
  return {
    timeline: opts.timeline ?? ([] as TimelineEntry[]),
    _findToolIdx(ctx: { tl: TimelineEntry[] } | null, toolUseId: string): number {
      const tl = ctx ? ctx.tl : this.timeline;
      return tl.findIndex((e) => e.kind === "tool" && e.id === toolUseId);
    },
    _updateToolInAnySubTimeline: vi.fn(() => false),
  };
}

function deniedEvent(toolUseId: string) {
  return {
    type: "permission_denied",
    run_id: "run-1",
    _seq: 30,
    tool_use_id: toolUseId,
  } as never;
}

describe("reducePermissionDenied", () => {
  it("marks a matching tool entry as permission_denied", () => {
    const store = makeStore({ timeline: [makeToolEntry("tool-1")] });

    reducePermissionDenied(deniedEvent("tool-1"), null, store as never, false);

    expect(store.timeline[0]).toMatchObject({
      kind: "tool",
      tool: { status: "permission_denied", tool_use_id: "tool-1" },
    });
  });

  it("falls back to subTimeline search when tool is not in main timeline", () => {
    const store = makeStore();

    reducePermissionDenied(deniedEvent("missing-tool"), null, store as never, false);

    expect(store._updateToolInAnySubTimeline).toHaveBeenCalledWith(
      "missing-tool",
      expect.any(Function),
      null,
    );
  });

  it("writes to ctx when batch context is provided", () => {
    const store = makeStore({ timeline: [makeToolEntry("tool-2", "permission_prompt")] });
    const ctx = {
      tl: [...store.timeline] as TimelineEntry[],
    };

    reducePermissionDenied(deniedEvent("tool-2"), ctx as never, store as never, true);

    expect(ctx.tl[0]).toMatchObject({
      tool: { status: "permission_denied" },
    });
    // Original store timeline should be untouched in batch mode
    expect(store.timeline[0]).toMatchObject({
      tool: { status: "permission_prompt" },
    });
  });

  it("falls back to subTimeline search with ctx when tool is not in main timeline", () => {
    const store = makeStore();
    const ctx = { tl: [] as TimelineEntry[] };

    reducePermissionDenied(deniedEvent("sub-tool"), ctx as never, store as never, true);

    expect(store._updateToolInAnySubTimeline).toHaveBeenCalledWith(
      "sub-tool",
      expect.any(Function),
      ctx,
    );
  });
});
