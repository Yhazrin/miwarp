import { beforeEach, describe, expect, it } from "vitest";
import { DiagnosticsStore } from "./diagnostics-store.svelte";

describe("DiagnosticsStore", () => {
  let store: DiagnosticsStore;

  beforeEach(() => {
    store = new DiagnosticsStore();
  });

  it("seeds events and snapshot on refresh", async () => {
    await store.refresh();
    expect(store.events.length).toBeGreaterThan(0);
    expect(store.snapshot).not.toBeNull();
  });

  it("selects events by id", async () => {
    await store.refresh();
    const target = store.events[0];
    store.selectEvent(target.id);
    expect(store.selectedEvent?.id).toBe(target.id);
    store.selectEvent(null);
    expect(store.selectedEvent).toBeNull();
  });

  it("filters events by category and severity", async () => {
    await store.refresh();
    const trace = store.applyFilter({ category: "trace" });
    expect(trace.every((event) => event.category === "trace")).toBe(true);
    const errors = store.applyFilter({ severity: "error" });
    expect(errors.every((event) => event.severity === "error")).toBe(true);
  });

  it("filters by search text", async () => {
    await store.refresh();
    const matched = store.applyFilter({ search: "claude" });
    expect(
      matched.every((event) =>
        /claude/i.test(`${event.title} ${event.detail ?? ""} ${event.source ?? ""}`),
      ),
    ).toBe(true);
  });

  it("counts events by severity", async () => {
    await store.refresh();
    const counts = store.countBySeverity();
    const sum = counts.info + counts.warning + counts.error + counts.critical;
    expect(sum).toBe(store.events.length);
  });

  it("exports a redacted bundle and tracks last path", async () => {
    await store.refresh();
    const before = store.bundles.length;
    const bundle = await store.exportRedactedBundle();
    expect(bundle).not.toBeNull();
    expect(store.bundles.length).toBe(before + 1);
    expect(store.lastExportPath).toBe(bundle?.destination);
    expect(bundle?.redacted_fields.length).toBeGreaterThan(0);
  });
});
