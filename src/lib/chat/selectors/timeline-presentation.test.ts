import { describe, it, expect } from "vitest";
import {
  computeTimelinePresentation,
  computeTimelineMetadata,
  getInitialRenderLimit,
  INITIAL_RENDER_LIMIT_BY_MODE,
  sliceVisibleTimeline,
} from "./timeline-presentation";
import type { TimelineEntry, BusToolItem } from "$lib/types";
import { CONTEXT_CLEARED_MARKER } from "$lib/utils/slash-commands";

// ── Helpers ──

function userEntry(id: string, content = "hello"): TimelineEntry {
  return { kind: "user", id, anchorId: `a-${id}`, content, ts: "2025-01-01T00:00:00Z" };
}

function assistantEntry(id: string, content = "response"): TimelineEntry {
  return { kind: "assistant", id, anchorId: `a-${id}`, content, ts: "2025-01-01T00:00:01Z" };
}

function toolEntry(
  id: string,
  toolName: string,
  overrides: Partial<BusToolItem> = {},
): TimelineEntry {
  return {
    kind: "tool",
    id,
    anchorId: `a-${id}`,
    ts: "2025-01-01T00:00:02Z",
    tool: {
      tool_use_id: `tu-${id}`,
      tool_name: toolName,
      input: {},
      status: "success",
      ...overrides,
    },
  };
}

function separatorEntry(id: string, content: string): TimelineEntry {
  return { kind: "separator", id, anchorId: `a-${id}`, content, ts: "2025-01-01T00:00:03Z" };
}

// ── Tests ──

describe("getInitialRenderLimit", () => {
  it("returns mode-specific cap for output mode", () => {
    expect(getInitialRenderLimit("output", [])).toBe(INITIAL_RENDER_LIMIT_BY_MODE.output);
    expect(getInitialRenderLimit("output", [userEntry("1")])).toBe(1);
  });

  it("caps initial mount for guided/developer even when timeline is long", () => {
    const tl = Array.from({ length: 1200 }, (_, i) => userEntry(`u${i}`));
    expect(getInitialRenderLimit("guided", tl)).toBe(INITIAL_RENDER_LIMIT_BY_MODE.guided);
    expect(getInitialRenderLimit("developer", tl)).toBe(INITIAL_RENDER_LIMIT_BY_MODE.developer);
  });

  it("returns timeline length when shorter than the mode cap", () => {
    const tl = [userEntry("1"), assistantEntry("2")];
    expect(getInitialRenderLimit("guided", tl)).toBe(2);
  });

  it("returns guided cap for non-output mode when timeline is empty", () => {
    expect(getInitialRenderLimit("guided", [])).toBe(INITIAL_RENDER_LIMIT_BY_MODE.guided);
  });
});

describe("computeTimelineMetadata", () => {
  it("records scan units equal to timeline length", () => {
    const timeline = Array.from({ length: 50 }, (_, i) => userEntry(`u${i}`));
    const meta = computeTimelineMetadata(timeline);
    expect(meta.scanUnits).toBe(50);
  });
});

describe("sliceVisibleTimeline", () => {
  it("returns tail slice when renderLimit is smaller", () => {
    const timeline = Array.from({ length: 10 }, (_, i) => userEntry(`u${i}`));
    const visible = sliceVisibleTimeline(timeline, 3);
    expect(visible).toHaveLength(3);
    expect(visible[0].id).toBe("u7");
    expect(visible[2].id).toBe("u9");
  });
});

describe("computeTimelinePresentation", () => {
  const timeline: TimelineEntry[] = [
    userEntry("u1", "first"),
    toolEntry("t1", "Read", { input: { file_path: "/a.ts" } }),
    assistantEntry("a1", "ok"),
    userEntry("u2", "second"),
    toolEntry("t2", "Write", { input: { file_path: "/b.ts" }, output: { path: "/b.ts" } }),
    toolEntry("t3", "Bash", { input: { command: "ls" } }),
    assistantEntry("a2", "done"),
  ];

  it("returns full timeline when no filter and renderLimit >= length", () => {
    const result = computeTimelinePresentation(timeline, null, 999);
    expect(result.filteredTimeline).toHaveLength(7);
    expect(result.visibleTimeline).toHaveLength(7);
  });

  it("slices visibleTimeline when renderLimit < length", () => {
    const result = computeTimelinePresentation(timeline, null, 3);
    expect(result.filteredTimeline).toHaveLength(7);
    expect(result.visibleTimeline).toHaveLength(3);
    // Last 3 entries: t2 (Write), t3 (Bash), a2 (assistant)
    expect(result.visibleTimeline[0].id).toBe("t2");
    expect(result.visibleTimeline[1].id).toBe("t3");
    expect(result.visibleTimeline[2].id).toBe("a2");
  });

  it("filters by tool name", () => {
    const result = computeTimelinePresentation(timeline, "Read", 999);
    // user + assistant entries are kept; only tool entries are filtered by name
    const toolEntries = result.filteredTimeline.filter((e) => e.kind === "tool");
    expect(toolEntries).toHaveLength(1);
    expect(toolEntries[0].id).toBe("t1");
  });

  it("returns correct toolNames sorted", () => {
    const result = computeTimelinePresentation(timeline, null, 999);
    expect(result.toolNames).toEqual(["Bash", "Read", "Write"]);
  });

  it("builds timelineIdIndex correctly", () => {
    const result = computeTimelinePresentation(timeline, null, 999);
    expect(result.timelineIdIndex.get("u1")).toBe(0);
    expect(result.timelineIdIndex.get("t1")).toBe(1);
    expect(result.timelineIdIndex.get("a2")).toBe(6);
    expect(result.timelineIdIndex.size).toBe(7);
  });

  it("computes userCountPrefix correctly", () => {
    const result = computeTimelinePresentation(timeline, null, 999);
    // [0, 1, 1, 1, 2, 2, 2, 2] — prefix sum of user entries
    expect(result.userCountPrefix[0]).toBe(0);
    expect(result.userCountPrefix[1]).toBe(1); // after u1
    expect(result.userCountPrefix[2]).toBe(1); // after t1
    expect(result.userCountPrefix[4]).toBe(2); // after u2
    expect(result.userCountPrefix[7]).toBe(2); // end
  });

  it("finds lastClearSepId", () => {
    const withSep: TimelineEntry[] = [
      userEntry("u1"),
      separatorEntry("s1", CONTEXT_CLEARED_MARKER),
      assistantEntry("a1"),
      separatorEntry("s2", CONTEXT_CLEARED_MARKER),
      userEntry("u2"),
    ];
    const result = computeTimelinePresentation(withSep, null, 999);
    expect(result.lastClearSepId).toBe("s2");
  });

  it("returns null lastClearSepId when no context-cleared separator", () => {
    const result = computeTimelinePresentation(timeline, null, 999);
    expect(result.lastClearSepId).toBeNull();
  });

  it("finds latestPlanToolId for Write to plan file", () => {
    const withPlan: TimelineEntry[] = [
      userEntry("u1"),
      toolEntry("t1", "Write", {
        input: { file_path: "/project/.claude/plans/my-plan.md" },
        tool_use_id: "tu-plan",
      }),
      assistantEntry("a1"),
    ];
    const result = computeTimelinePresentation(withPlan, null, 999);
    expect(result.latestPlanToolId).toBe("tu-plan");
  });

  it("returns null latestPlanToolId when no plan file tool", () => {
    const result = computeTimelinePresentation(timeline, null, 999);
    expect(result.latestPlanToolId).toBeNull();
  });

  it("deduplicates createdFiles by path", () => {
    const withDupes: TimelineEntry[] = [
      toolEntry("t1", "Write", {
        input: { file_path: "/b.ts" },
        output: { path: "/b.ts" },
      }),
      toolEntry("t2", "Write", {
        input: { file_path: "/b.ts" },
        output: { path: "/b.ts" },
      }),
      toolEntry("t3", "Write", {
        input: { file_path: "/c.ts" },
        output: { path: "/c.ts" },
      }),
    ];
    const result = computeTimelinePresentation(withDupes, null, 999);
    expect(result.createdFiles).toHaveLength(2);
    expect(result.createdFiles.map((f) => f.path)).toEqual(["/b.ts", "/c.ts"]);
  });

  it("returns empty batchGroups and toolBursts when toolFilter is active", () => {
    const result = computeTimelinePresentation(timeline, "Read", 999);
    expect(result.batchGroups.size).toBe(0);
    expect(result.toolBursts.size).toBe(0);
  });

  it("handles empty timeline", () => {
    const result = computeTimelinePresentation([], null, 100);
    expect(result.filteredTimeline).toHaveLength(0);
    expect(result.visibleTimeline).toHaveLength(0);
    expect(result.toolNames).toHaveLength(0);
    expect(result.timelineIdIndex.size).toBe(0);
    expect(result.lastClearSepId).toBeNull();
    expect(result.latestPlanToolId).toBeNull();
    expect(result.createdFiles).toHaveLength(0);
    expect(result.userCountPrefix).toHaveLength(1); // just the [0] element
    expect(result.userCountPrefix[0]).toBe(0);
  });
});
