import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunSubscriptions } from "./run-subscriptions";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

describe("RunSubscriptions", () => {
  let subs: RunSubscriptions;

  beforeEach(() => {
    subs = new RunSubscriptions();
  });

  it("subscribes and releases the default owner", () => {
    const result = subs.subscribe("run-1", 10);
    expect(result).toMatchObject({
      lastSeq: 10,
      ownerAdded: true,
      checkpointAdvanced: true,
      shouldSendSubscribe: true,
    });
    expect(subs.unsubscribe("run-1")).toBe(true);
    expect(subs.has("run-1")).toBe(false);
  });

  it("repeated legacy subscribe is idempotent", () => {
    subs.subscribe("run-1", 10);
    const repeated = subs.subscribe("run-1", 10);

    expect(repeated.ownerAdded).toBe(false);
    expect(repeated.shouldSendSubscribe).toBe(false);
    expect(subs.getOwnerCount("run-1")).toBe(1);
    expect(subs.unsubscribe("run-1")).toBe(true);
  });

  it("distinct owners are reference counted", () => {
    subs.subscribe("run-1", 10, "timeline");
    subs.subscribe("run-1", 20, "notifications");

    expect(subs.getOwnerCount("run-1")).toBe(2);
    expect(subs.unsubscribe("run-1", "timeline")).toBe(false);
    expect(subs.has("run-1")).toBe(true);
    expect(subs.unsubscribe("run-1", "notifications")).toBe(true);
    expect(subs.has("run-1")).toBe(false);
  });

  it("unknown owner cannot release another owner", () => {
    subs.subscribe("run-1", 10, "timeline");
    expect(subs.unsubscribe("run-1", "other")).toBe(false);
    expect(subs.getOwnerCount("run-1")).toBe(1);
  });

  it("lastSeq is monotonic", () => {
    subs.subscribe("run-1", 100);
    const lower = subs.subscribe("run-1", 50);
    expect(lower.lastSeq).toBe(100);
    expect(lower.checkpointAdvanced).toBe(false);

    subs.updateSeq("run-1", 200);
    subs.updateSeq("run-1", 150);
    expect(subs.getLastSeq("run-1")).toBe(200);
  });

  it("checkpoint advance requests a server subscribe refresh", () => {
    subs.subscribe("run-1", 10);
    const result = subs.subscribe("run-1", 20);
    expect(result.ownerAdded).toBe(false);
    expect(result.checkpointAdvanced).toBe(true);
    expect(result.shouldSendSubscribe).toBe(true);
    expect(result.lastSeq).toBe(20);
  });

  it("resetSeq preserves owners while clearing the replay checkpoint", () => {
    subs.subscribe("run-1", 42, "timeline");
    subs.subscribe("run-1", 42, "notifications");

    subs.resetSeq("run-1");

    expect(subs.getLastSeq("run-1")).toBe(0);
    expect(subs.getOwnerCount("run-1")).toBe(2);
    expect(subs.has("run-1")).toBe(true);
  });

  it("getAll returns one entry per run", () => {
    subs.subscribe("run-1", 10, "a");
    subs.subscribe("run-2", 20, "b");
    subs.subscribe("run-1", 30, "c");

    expect(subs.getAll()).toEqual(
      expect.arrayContaining([
        { runId: "run-1", lastSeq: 30 },
        { runId: "run-2", lastSeq: 20 },
      ]),
    );
    expect(subs.getAll()).toHaveLength(2);
  });

  it("updateSeq on an unknown run is a no-op", () => {
    subs.updateSeq("missing", 99);
    expect(subs.has("missing")).toBe(false);
  });

  it("unknown run reports zero state", () => {
    expect(subs.getLastSeq("missing")).toBe(0);
    expect(subs.getOwnerCount("missing")).toBe(0);
    expect(subs.unsubscribe("missing")).toBe(false);
  });

  it("dispose clears all ownership", () => {
    subs.subscribe("run-1", 10, "a");
    subs.subscribe("run-2", 20, "b");
    subs.dispose();
    expect(subs.getAll()).toEqual([]);
    expect(subs.has("run-1")).toBe(false);
  });
});
