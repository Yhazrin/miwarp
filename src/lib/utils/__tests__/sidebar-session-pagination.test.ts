import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_PAGE_SIZE,
  SESSION_PAGE_INCREMENT,
  getSessionVisibleCount,
  hasMoreSessions,
  hiddenSessionCount,
  nextVisibleSessionCount,
  showMoreSessionIncrement,
  sliceVisibleSessions,
  visibleCountForSelectedIndex,
} from "../sidebar-session-pagination";

describe("sidebar-session-pagination", () => {
  it("defaults visible count per key to DEFAULT_SESSION_PAGE_SIZE", () => {
    expect(getSessionVisibleCount({}, "alpha")).toBe(DEFAULT_SESSION_PAGE_SIZE);
    expect(getSessionVisibleCount({ alpha: 10 }, "alpha")).toBe(10);
  });

  it("slices sessions and computes hidden counts", () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    expect(sliceVisibleSessions(items, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(hiddenSessionCount(items.length, 5)).toBe(2);
    expect(hasMoreSessions(items.length, 5)).toBe(true);
    expect(hasMoreSessions(items.length, items.length)).toBe(false);
  });

  it("advances visible count by SESSION_PAGE_INCREMENT capped at total", () => {
    expect(nextVisibleSessionCount(5, 20)).toBe(10);
    expect(nextVisibleSessionCount(18, 20)).toBe(20);
    expect(showMoreSessionIncrement(3)).toBe(3);
    expect(showMoreSessionIncrement(8)).toBe(SESSION_PAGE_INCREMENT);
  });

  it("expands visible count when selected index is beyond current page", () => {
    expect(visibleCountForSelectedIndex(-1, 5)).toBe(5);
    expect(visibleCountForSelectedIndex(3, 5)).toBe(5);
    expect(visibleCountForSelectedIndex(7, 5)).toBe(8);
  });
});
