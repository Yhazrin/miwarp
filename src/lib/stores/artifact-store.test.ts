import { beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "./artifact-store.svelte";

describe("ArtifactStore", () => {
  let store: ArtifactStore;

  beforeEach(() => {
    store = new ArtifactStore();
  });

  it("seeds the artifact list on refresh", async () => {
    await store.refresh();
    expect(store.artifacts.length).toBeGreaterThan(0);
    expect(store.loading).toBe(false);
  });

  it("exposes pinned subset", async () => {
    await store.refresh();
    expect(store.pinned.length).toBeGreaterThan(0);
    expect(store.pinned.every((artifact) => artifact.pinned)).toBe(true);
  });

  it("filters by kind and search", async () => {
    await store.refresh();
    const diffs = store.applyFilter({ kind: "diff" });
    expect(diffs.every((artifact) => artifact.kind === "diff")).toBe(true);
    const matched = store.applyFilter({ search: "mermaid" });
    expect(
      matched.every((artifact) =>
        /mermaid/i.test(`${artifact.title} ${artifact.description ?? ""}`),
      ),
    ).toBe(true);
  });

  it("filters by pinned only", async () => {
    await store.refresh();
    const pinned = store.applyFilter({ pinnedOnly: true });
    expect(pinned.every((artifact) => artifact.pinned)).toBe(true);
  });

  it("toggles pin state and refreshes updated_at", async () => {
    await store.refresh();
    const target = store.artifacts[0];
    const before = target.pinned;
    const beforeTs = target.updated_at;
    const updated = store.togglePin(target.id);
    expect(updated?.pinned).toBe(!before);
    expect(updated?.updated_at).not.toBe(beforeTs);
  });

  it("removes artifacts and clears selection when needed", async () => {
    await store.refresh();
    const target = store.artifacts[0];
    store.select(target.id);
    expect(store.selected?.id).toBe(target.id);
    const removed = store.remove(target.id);
    expect(removed).toBe(true);
    expect(store.artifacts.find((artifact) => artifact.id === target.id)).toBeUndefined();
    expect(store.selected).toBeNull();
  });

  it("groups by run / kind / task", async () => {
    await store.refresh();
    const byRun = store.groupByRun();
    const byKind = store.groupByKind();
    const byTask = store.groupByTask();
    expect(byRun.length).toBeGreaterThan(0);
    expect(byKind.length).toBeGreaterThan(0);
    expect(byTask.length).toBeGreaterThan(0);
    const sumByRun = byRun.reduce((acc, group) => acc + group.artifacts.length, 0);
    expect(sumByRun).toBe(store.artifacts.length);
  });

  it("counts artifacts by kind", async () => {
    await store.refresh();
    const counts = store.countByKind();
    const sum = Object.values(counts).reduce((acc, n) => acc + n, 0);
    expect(sum).toBe(store.artifacts.length);
  });
});
