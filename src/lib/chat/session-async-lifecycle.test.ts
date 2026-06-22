import { describe, expect, it } from "vitest";
import { SessionAsyncLifecycleCoordinator } from "./session-async-lifecycle";

describe("SessionAsyncLifecycleCoordinator", () => {
  it("beginLoad increments generation and invalidates prior capture", () => {
    const lc = new SessionAsyncLifecycleCoordinator();
    const g1 = lc.beginLoad();
    expect(g1).toBe(1);
    expect(lc.isStale(g1!)).toBe(false);

    const g2 = lc.beginLoad();
    expect(g2).toBe(2);
    expect(lc.isStale(g1!)).toBe(true);
    expect(lc.isStale(g2!)).toBe(false);
  });

  it("beginResume is single-flight and bumps generation", () => {
    const lc = new SessionAsyncLifecycleCoordinator();
    const g1 = lc.beginResume();
    expect(g1).toBe(1);
    expect(lc.resumeInFlight).toBe(true);
    expect(lc.beginResume()).toBeNull();

    lc.endResume();
    expect(lc.resumeInFlight).toBe(false);
    const g2 = lc.beginResume();
    expect(g2).toBe(2);
    expect(lc.isStale(g1!)).toBe(true);
    lc.endResume();
  });

  it("unmount marks stale and clears resume busy", () => {
    const lc = new SessionAsyncLifecycleCoordinator();
    const g = lc.beginResume();
    expect(g).not.toBeNull();
    lc.unmount();
    expect(lc.isMounted).toBe(false);
    expect(lc.resumeInFlight).toBe(false);
    expect(lc.isStale(g!)).toBe(true);
  });

  it("stalePredicate mirrors isStale", () => {
    const lc = new SessionAsyncLifecycleCoordinator();
    const g = lc.beginLoad();
    const pred = lc.stalePredicate(g!);
    expect(pred()).toBe(false);
    lc.beginLoad();
    expect(pred()).toBe(true);
  });

  it("invalidate without resume does not set resumeInFlight", () => {
    const lc = new SessionAsyncLifecycleCoordinator();
    const g1 = lc.beginLoad();
    lc.invalidate();
    expect(lc.resumeInFlight).toBe(false);
    expect(lc.isStale(g1!)).toBe(true);
  });

  it("rejects new load and resume operations after unmount", () => {
    const lc = new SessionAsyncLifecycleCoordinator();
    lc.unmount();

    expect(lc.beginLoad()).toBeNull();
    expect(lc.beginResume()).toBeNull();
    expect(lc.resumeInFlight).toBe(false);
  });
});
