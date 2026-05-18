import { describe, it, expect } from "vitest";
import { selectSortedToolNames, filterTimelineByToolName } from "../tool-filter";
import { aggregateCumulativeTokens } from "../session-info";
import type { UsageState } from "$lib/stores/types";
import type { TimelineEntry } from "$lib/types";

describe("chat selectors", () => {
  it("selectSortedToolNames + filterTimelineByToolName", () => {
    const timeline: TimelineEntry[] = [
      { kind: "user", id: "u1", anchorId: "u1", content: "hi", ts: "1", cliUuid: "c1" },
      {
        kind: "tool",
        id: "t1",
        tool: {
          tool_use_id: "x",
          tool_name: "Bash",
          input: {},
          status: "success",
        },
      } as TimelineEntry,
    ];
    expect(selectSortedToolNames(timeline)).toEqual(["Bash"]);
    expect(filterTimelineByToolName(timeline, null).length).toBe(2);
    expect(filterTimelineByToolName(timeline, "Read").length).toBe(1);
  });

  it("aggregateCumulativeTokens falls back without modelUsage", () => {
    const u: UsageState = {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      cost: 0,
    };
    expect(aggregateCumulativeTokens(u)).toEqual({
      input: 10,
      output: 20,
      cacheRead: 1,
      cacheWrite: 2,
    });
  });
});
