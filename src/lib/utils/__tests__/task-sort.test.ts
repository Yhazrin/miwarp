import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isTaskActive, sortTasksByPriority, formatElapsed } from "../task-sort";

describe("isTaskActive", () => {
  it("returns true for running status", () => {
    expect(isTaskActive("running")).toBe(true);
  });

  it("returns true for pending status", () => {
    expect(isTaskActive("pending")).toBe(true);
  });

  it("returns true for unknown statuses", () => {
    expect(isTaskActive("something_new")).toBe(true);
  });

  it("returns false for completed", () => {
    expect(isTaskActive("completed")).toBe(false);
  });

  it("returns false for failed", () => {
    expect(isTaskActive("failed")).toBe(false);
  });

  it("returns false for error", () => {
    expect(isTaskActive("error")).toBe(false);
  });
});

describe("sortTasksByPriority", () => {
  it("sorts active tasks before completed ones", () => {
    const tasks = [
      { status: "completed", startedAt: 100 },
      { status: "running", startedAt: 200 },
      { status: "failed", startedAt: 300 },
    ];
    const sorted = sortTasksByPriority(tasks);
    expect(sorted[0].status).toBe("running");
    expect(sorted[1].status).toBe("failed");
    expect(sorted[2].status).toBe("completed");
  });

  it("sorts by most recent within same activity group", () => {
    const tasks = [
      { status: "running", startedAt: 100 },
      { status: "running", startedAt: 300 },
      { status: "running", startedAt: 200 },
    ];
    const sorted = sortTasksByPriority(tasks);
    expect(sorted[0].startedAt).toBe(300);
    expect(sorted[1].startedAt).toBe(200);
    expect(sorted[2].startedAt).toBe(100);
  });

  it("returns empty array unchanged", () => {
    expect(sortTasksByPriority([])).toEqual([]);
  });

  it("handles single item", () => {
    const tasks = [{ status: "running", startedAt: 100 }];
    expect(sortTasksByPriority(tasks)).toEqual(tasks);
  });

  it("sorts error status alongside completed (terminal)", () => {
    const tasks = [
      { status: "error", startedAt: 100 },
      { status: "pending", startedAt: 200 },
    ];
    const sorted = sortTasksByPriority(tasks);
    expect(sorted[0].status).toBe("pending");
    expect(sorted[1].status).toBe("error");
  });
});

describe("formatElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns <1s for sub-second durations", () => {
    vi.setSystemTime(1000);
    expect(formatElapsed(500)).toBe("<1s");
  });

  it("returns seconds for durations under a minute", () => {
    vi.setSystemTime(10000);
    expect(formatElapsed(7000)).toBe("3s");
  });

  it("handles zero elapsed time", () => {
    vi.setSystemTime(1000);
    expect(formatElapsed(1000)).toBe("<1s");
  });
});
