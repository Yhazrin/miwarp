import { beforeEach, describe, expect, it } from "vitest";
import { SpecStore } from "./spec-store.svelte";

describe("SpecStore lifecycle", () => {
  let store: SpecStore;

  beforeEach(() => {
    store = new SpecStore();
  });

  it("seeds the spec list on refresh", async () => {
    await store.refresh();
    expect(store.specs.length).toBeGreaterThan(0);
    expect(store.loading).toBe(false);
  });

  it("exposes a selected spec when selectedSpecId is set", async () => {
    await store.refresh();
    const target = store.specs[0];
    store.select(target.id);
    expect(store.selected?.id).toBe(target.id);
    store.select(null);
    expect(store.selected).toBeNull();
  });

  it("partitions specs by status buckets", async () => {
    await store.refresh();
    const counts = store.countByStatus();
    const sum = Object.values(counts).reduce((acc, n) => acc + n, 0);
    expect(sum).toBe(store.specs.length);
  });

  it("filters by status predicate", async () => {
    await store.refresh();
    const implementing = store.applyFilter(store.specs, { status: "implementing" });
    expect(implementing.every((spec) => spec.status === "implementing")).toBe(true);
  });

  it("filters by search text against title and summary", async () => {
    await store.refresh();
    const all = store.specs.length;
    const matches = store.applyFilter(store.specs, { search: "queue" });
    expect(matches.length).toBeLessThanOrEqual(all);
    expect(matches.every((spec) => /queue/i.test(`${spec.title} ${spec.summary}`))).toBe(true);
  });

  it("advances status and bumps updated_at", async () => {
    await store.refresh();
    const target = store.specs[0];
    const before = target.updated_at;
    const updated = store.advanceStatus(target.id, "accepted");
    expect(updated?.status).toBe("accepted");
    expect(store.selected).toBeNull();
    const persisted = store.specs.find((spec) => spec.id === target.id);
    expect(persisted?.status).toBe("accepted");
    expect(persisted?.updated_at).not.toBe(before);
  });

  it("resolves a plan step and keeps other steps intact", async () => {
    await store.refresh();
    const target = store.specs.find((spec) => spec.plan_steps.length > 1);
    expect(target).toBeDefined();
    if (!target) return;
    const stepId = target.plan_steps[0]!.id;
    const updated = store.resolvePlanStep(target.id, stepId, "done");
    const persisted = store.specs.find((spec) => spec.id === target.id);
    expect(persisted?.plan_steps.find((step) => step.id === stepId)?.status).toBe("done");
    expect(updated?.plan_steps.length).toBe(target.plan_steps.length);
  });

  it("records gate verdicts and updates last_run_at", async () => {
    await store.refresh();
    const target = store.specs.find((spec) => spec.gates.length > 0);
    expect(target).toBeDefined();
    if (!target) return;
    const gateId = target.gates[0]!.id;
    const previous = target.gates[0]!.last_run_at;
    const updated = store.recordGateResult(target.id, gateId, "pass");
    const persisted = store.specs.find((spec) => spec.id === target.id);
    const gate = persisted?.gates.find((entry) => entry.id === gateId);
    expect(gate?.verdict).toBe("pass");
    expect(gate?.last_run_at).not.toBe(previous);
    expect(updated?.gates.length).toBe(target.gates.length);
  });

  it("links tasks idempotently", async () => {
    await store.refresh();
    const target = store.specs[0];
    store.linkTask(target.id, { task_id: "task-x", role: "primary", status: "in_progress" });
    store.linkTask(target.id, { task_id: "task-x", role: "verification", status: "pending" });
    const persisted = store.specs.find((spec) => spec.id === target.id);
    const linked = persisted?.linked_tasks.filter((link) => link.task_id === "task-x") ?? [];
    expect(linked.length).toBe(1);
    expect(linked[0]?.role).toBe("verification");
  });
});
