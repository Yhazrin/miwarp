import { describe, it, expect } from "vitest";
import {
  buildSyntheticTimeline,
  compareOpenBudgets,
  estimateRenderWork,
  simulateLoadMoreEarlier,
  RENDER_GROWTH_STEP,
  TAIL_LIVE_ENTRIES,
} from "../render-work-budget";
import {
  computeTimelineMetadata,
  computeTimelinePresentation,
  getInitialRenderLimit,
  sliceVisibleTimeline,
} from "../selectors/timeline-presentation";
import { detectToolBursts } from "$lib/utils/tool-rendering";
import type { TimelineEntry } from "$lib/types";

const LONG_SESSION_SIZE = 1200;

describe("timeline render-work budget", () => {
  it("reduces mounted entries by ≥70% on 1200-item developer session open", () => {
    const timeline = buildSyntheticTimeline(LONG_SESSION_SIZE);
    const { legacy, optimized, mountReductionPct } = compareOpenBudgets(timeline, "developer");

    expect(legacy.mountedEntries).toBe(LONG_SESSION_SIZE);
    expect(optimized.mountedEntries).toBe(getInitialRenderLimit("developer", timeline));
    expect(mountReductionPct).toBeGreaterThanOrEqual(70);
  });

  it("reduces mounted entries by ≥70% on 1200-item guided session open", () => {
    const timeline = buildSyntheticTimeline(LONG_SESSION_SIZE);
    const { mountReductionPct, optimized } = compareOpenBudgets(timeline, "guided");
    expect(mountReductionPct).toBeGreaterThanOrEqual(70);
    expect(optimized.mountedEntries).toBe(150);
  });

  it("keeps metadata scan independent of renderLimit changes", () => {
    const timeline = buildSyntheticTimeline(500);
    const metadata = computeTimelineMetadata(timeline);

    const at100 = computeTimelinePresentation(timeline, null, 100, metadata);
    const at300 = computeTimelinePresentation(timeline, null, 300, metadata);

    expect(at100.metadata).toBe(metadata);
    expect(at300.metadata).toBe(metadata);
    expect(at100.visibleTimeline).toHaveLength(100);
    expect(at300.visibleTimeline).toHaveLength(300);
    expect(at100.metadata.scanUnits).toBe(500);
  });

  it("incremental append keeps new tail rows inside the visible window", () => {
    const base = buildSyntheticTimeline(1000);
    const renderLimit = getInitialRenderLimit("developer", base);
    const beforeVisible = sliceVisibleTimeline(base, renderLimit);
    const lastBefore = beforeVisible[beforeVisible.length - 1]?.id;

    const appended: TimelineEntry[] = [
      ...base,
      {
        kind: "assistant",
        id: "e-new",
        anchorId: "a-e-new",
        content: "New incremental reply",
        ts: "2025-06-22T00:00:00Z",
      },
    ];
    const afterVisible = sliceVisibleTimeline(appended, renderLimit);

    expect(afterVisible[afterVisible.length - 1].id).toBe("e-new");
    expect(afterVisible.some((e) => e.id === lastBefore)).toBe(true);
    expect(afterVisible).toHaveLength(renderLimit);
  });

  it("simulateLoadMoreEarlier grows window without overshooting timeline length", () => {
    const timelineLen = 1000;
    let limit = getInitialRenderLimit("developer", buildSyntheticTimeline(timelineLen));
    const steps: number[] = [];

    while (limit < timelineLen) {
      const step = simulateLoadMoreEarlier(timelineLen, limit, RENDER_GROWTH_STEP);
      expect(step.newlyMounted).toBe(RENDER_GROWTH_STEP);
      expect(step.hiddenRemaining).toBe(timelineLen - step.nextLimit);
      limit = step.nextLimit;
      steps.push(step.newlyMounted);
    }

    expect(limit).toBe(timelineLen);
    expect(steps.length).toBeGreaterThan(0);
  });

  it("frozen tail budget only eagerly parses the last live entries", () => {
    const timeline = buildSyntheticTimeline(200);
    const metadata = computeTimelineMetadata(timeline);
    const visible = sliceVisibleTimeline(timeline, 200);
    const budget = estimateRenderWork(visible, metadata);

    let expectedEager = 0;
    const cutoff = visible.length - TAIL_LIVE_ENTRIES;
    for (let i = cutoff; i < visible.length; i++) {
      const e = visible[i];
      if (e.kind === "user" || e.kind === "assistant") expectedEager += e.content.length;
    }
    expect(budget.eagerMarkdownChars).toBe(expectedEager);
  });

  it("burst collapse keys stay stable across load-more (content-based, not index)", () => {
    const timeline = buildSyntheticTimeline(400);
    const windowA = sliceVisibleTimeline(timeline, 150);
    const windowB = sliceVisibleTimeline(timeline, 250);

    const burstsA = detectToolBursts(windowA);
    const burstsB = detectToolBursts(windowB);

    const keysA = [...burstsA.values()].map((b) => b.key);
    const keysB = [...burstsB.values()].map((b) => b.key);

    for (const key of keysA) {
      expect(keysB).toContain(key);
    }
  });
});
