/**
 * Tests for the HTML session report generator.
 */
import { describe, expect, it } from "vitest";
import { renderInsightReport } from "./html-export";
import type { TaskRun, TimelineEntry } from "$lib/types";
import type { TurnUsage, UsageState } from "$lib/stores/types";

const run = {
  id: "r1",
  name: "demo run",
  prompt: "do something",
  agent: "claude",
  status: "completed",
  started_at: "2026-01-01T00:00:00Z",
  cwd: "/tmp",
  auth_mode: "api_key",
} as unknown as TaskRun;

const usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 1.23,
} as UsageState;

describe("html-export", () => {
  it("renders a self-contained HTML doc", () => {
    const out = renderInsightReport({ run, timeline: [], usage, turnUsages: [] });
    expect(out).toContain("<!DOCTYPE html>");
    expect(out).toContain("demo run");
    expect(out).toContain("$1.2300");
  });

  it("escapes user-supplied strings", () => {
    const bad = { ...run, name: "<script>alert(1)</script>" } as TaskRun;
    const out = renderInsightReport({ run: bad, timeline: [], usage, turnUsages: [] });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders timeline entries by kind", () => {
    const tl: TimelineEntry[] = [
      { kind: "user", id: "u1", anchorId: "u1", content: "hi", ts: "" } as TimelineEntry,
      { kind: "assistant", id: "a1", anchorId: "a1", content: "hello", ts: "" } as TimelineEntry,
    ];
    const turns: TurnUsage[] = [
      {
        turnIndex: 0,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.001,
      },
    ];
    const out = renderInsightReport({ run, timeline: tl, usage, turnUsages: turns });
    expect(out).toContain("&gt; hi");
    expect(out).toContain("hello");
    expect(out).toContain("Turn 1");
  });

  it("supports dark theme", () => {
    const out = renderInsightReport({ run, timeline: [], usage, turnUsages: [], theme: "dark" });
    expect(out).toContain("#0f172a");
  });
});
