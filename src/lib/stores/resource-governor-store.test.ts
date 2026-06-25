import { beforeEach, describe, expect, it } from "vitest";
import { ResourceGovernorStore } from "./resource-governor-store.svelte";

describe("ResourceGovernorStore", () => {
  let store: ResourceGovernorStore;

  beforeEach(() => {
    store = new ResourceGovernorStore();
  });

  it("seeds a snapshot on refresh", async () => {
    await store.refresh();
    expect(store.snapshot).not.toBeNull();
    expect(store.snapshot?.budgets.length).toBe(3);
  });

  it("reports concurrent runs and status", async () => {
    await store.refresh();
    expect(store.concurrentRuns).toBeGreaterThan(0);
    expect(["ok", "warning", "exceeded"]).toContain(store.status);
  });

  it("computes occupancy per budget kind", async () => {
    await store.refresh();
    const concurrent = store.occupancy("concurrent_runs");
    const memory = store.occupancy("memory_bytes");
    const cost = store.occupancy("daily_cost");
    expect(concurrent).toBeGreaterThan(0);
    expect(concurrent).toBeLessThanOrEqual(1);
    expect(memory).toBeGreaterThan(0);
    expect(cost).toBeGreaterThan(0);
  });

  it("derives exceeded status when a budget overflows", () => {
    const snap = ResourceGovernorStore.deriveFrom({
      concurrent_runs: 1,
      concurrent_limit: 5,
      memory_bytes: 5_000_000_000,
      memory_limit: 4_000_000_000,
      daily_cost: 1,
      daily_cost_limit: 8,
    });
    expect(snap.status).toBe("exceeded");
  });

  it("derives warning status when ratio crosses 0.8", () => {
    const snap = ResourceGovernorStore.deriveFrom({
      concurrent_runs: 4,
      concurrent_limit: 5,
      memory_bytes: 1_000_000_000,
      memory_limit: 4_000_000_000,
      daily_cost: 1,
      daily_cost_limit: 8,
    });
    expect(snap.status).toBe("warning");
  });

  it("derives ok status when all ratios are healthy", () => {
    const snap = ResourceGovernorStore.deriveFrom({
      concurrent_runs: 1,
      concurrent_limit: 5,
      memory_bytes: 1_000_000_000,
      memory_limit: 4_000_000_000,
      daily_cost: 1,
      daily_cost_limit: 8,
    });
    expect(snap.status).toBe("ok");
  });
});
