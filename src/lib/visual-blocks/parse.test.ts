import { describe, expect, it } from "vitest";
import { parseVisualBlock } from "./parse";

describe("parseVisualBlock — miwarp-progress", () => {
  it("accepts canonical contract shape", () => {
    const result = parseVisualBlock(
      "miwarp-progress",
      JSON.stringify({
        title: "Deploy",
        summary: "Rolling out v2",
        items: [
          { label: "Build", status: "done", progress: 100, detail: "OK" },
          { label: "Deploy", status: "active", progress: 42 },
          { label: "Verify", status: "pending" },
          { label: "Rollback", status: "failed", detail: "timeout" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block.kind).toBe("miwarp-progress");
    if (result.block.kind !== "miwarp-progress") return;
    expect(result.block.spec.title).toBe("Deploy");
    expect(result.block.spec.summary).toBe("Rolling out v2");
    expect(result.block.spec.items).toHaveLength(4);
    expect(result.block.spec.items[0]).toEqual({
      label: "Build",
      status: "done",
      progress: 100,
      detail: "OK",
    });
    expect(result.block.spec.items[1].status).toBe("active");
    expect(result.block.spec.items[1].progress).toBe(42);
  });

  it("preserves status aliases", () => {
    const result = parseVisualBlock(
      "miwarp-progress",
      JSON.stringify({
        items: [
          { label: "A", status: "in_progress" },
          { label: "B", status: "completed" },
          { label: "C", status: "running" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.block.kind !== "miwarp-progress") return;
    expect(result.block.spec.items.map((i) => i.status)).toEqual(["active", "done", "active"]);
  });

  it("preserves items alias keys", () => {
    const result = parseVisualBlock(
      "miwarp-progress",
      JSON.stringify({
        steps: [{ label: "Step 1", status: "done" }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("clamps progress to 0–100", () => {
    const result = parseVisualBlock(
      "miwarp-progress",
      JSON.stringify({
        items: [{ label: "X", status: "active", progress: 150 }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.block.kind !== "miwarp-progress") return;
    expect(result.block.spec.items[0].progress).toBe(100);
  });

  it("rejects missing items", () => {
    const result = parseVisualBlock("miwarp-progress", JSON.stringify({ title: "Empty" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("progress_missing_items");
  });
});

describe("parseVisualBlock — miwarp-kpi", () => {
  it("accepts canonical contract shape", () => {
    const result = parseVisualBlock(
      "miwarp-kpi",
      JSON.stringify({
        title: "Metrics",
        items: [
          {
            label: "Latency",
            value: "42ms",
            trend: "down",
            detail: "-5ms",
            status: "success",
          },
          { label: "Errors", value: "0.1%", trend: "flat", status: "neutral" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.block.kind !== "miwarp-kpi") return;
    expect(result.block.spec.title).toBe("Metrics");
    expect(result.block.spec.items[0]).toEqual({
      label: "Latency",
      value: "42ms",
      trend: "down",
      detail: "-5ms",
      status: "success",
    });
  });

  it("coerces numeric values to strings", () => {
    const result = parseVisualBlock(
      "miwarp-kpi",
      JSON.stringify({ items: [{ label: "Count", value: 42 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.block.kind !== "miwarp-kpi") return;
    expect(result.block.spec.items[0].value).toBe("42");
  });

  it("preserves metrics alias", () => {
    const result = parseVisualBlock(
      "miwarp-kpi",
      JSON.stringify({ metrics: [{ label: "RPS", value: "1.2k" }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects invalid trend", () => {
    const result = parseVisualBlock(
      "miwarp-kpi",
      JSON.stringify({ items: [{ label: "X", value: "1", trend: "sideways" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.block.kind !== "miwarp-kpi") return;
    expect(result.block.spec.items[0].trend).toBeUndefined();
  });
});

describe("parseVisualBlock — miwarp-timeline", () => {
  it("accepts canonical contract shape", () => {
    const result = parseVisualBlock(
      "miwarp-timeline",
      JSON.stringify({
        title: "Release",
        items: [
          { title: "Alpha", date: "2026-01-01", state: "done", detail: "Shipped" },
          { title: "Beta", date: "2026-03-01", state: "active" },
          { title: "GA", state: "pending" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.block.kind !== "miwarp-timeline") return;
    expect(result.block.spec.items[0]).toEqual({
      title: "Alpha",
      date: "2026-01-01",
      state: "done",
      detail: "Shipped",
    });
  });

  it("preserves state aliases", () => {
    const result = parseVisualBlock(
      "miwarp-timeline",
      JSON.stringify({
        events: [
          { title: "A", status: "in_progress" },
          { title: "B", status: "completed" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.block.kind !== "miwarp-timeline") return;
    expect(result.block.spec.items[0].state).toBe("active");
    expect(result.block.spec.items[1].state).toBe("done");
  });
});

describe("parseVisualBlock — mermaid", () => {
  it("accepts a simple flowchart", () => {
    const result = parseVisualBlock("mermaid", "flowchart LR\n  A --> B");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block.kind).toBe("mermaid");
  });

  it("rejects click directives", () => {
    const result = parseVisualBlock("mermaid", "flowchart LR\n  click A callback");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("mermaid_click");
  });
});

describe("parseVisualBlock — vega-lite", () => {
  it("accepts inline data spec", () => {
    const result = parseVisualBlock(
      "vega-lite",
      JSON.stringify({
        mark: "bar",
        data: { values: [{ a: "A", b: 28 }] },
        encoding: { x: { field: "a" }, y: { field: "b" } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block.kind).toBe("vega-lite");
  });

  it("rejects data.url", () => {
    const result = parseVisualBlock(
      "vega-lite",
      JSON.stringify({
        mark: "bar",
        data: { url: "https://example.com/data.json" },
        encoding: { x: { field: "a" }, y: { field: "b" } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("vega_data_url");
  });

  it("rejects transform expressions", () => {
    const result = parseVisualBlock(
      "vega-lite",
      JSON.stringify({
        mark: "bar",
        data: { values: [{ a: "A", b: 1 }] },
        transform: [{ calculate: "datum.a", expr: "datum.a" }],
        encoding: { x: { field: "a" }, y: { field: "b" } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("vega_expression");
  });
});
