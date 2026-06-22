/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
});

import { buildVisualBlockPlaceholder } from "./render-placeholder";
import { renderMarkdown } from "$lib/utils/markdown";

describe("buildVisualBlockPlaceholder", () => {
  it("emits visual host for valid miwarp-progress", () => {
    const html = buildVisualBlockPlaceholder({
      kind: "miwarp-progress",
      lang: "miwarp-progress",
      source: JSON.stringify({ items: [{ label: "Step", status: "done" }] }),
    });
    expect(html).toContain("data-visual-block");
    expect(html).toContain('data-visual-kind="miwarp-progress"');
    expect(html).toContain("visual-block-fallback");
  });

  it("falls back to raw code block for invalid specs", () => {
    const html = buildVisualBlockPlaceholder({
      kind: "miwarp-kpi",
      lang: "miwarp-kpi",
      source: JSON.stringify({ title: "No items" }),
    });
    expect(html).not.toContain("data-visual-block");
    expect(html).toContain("code-block");
    expect(html).toContain("miwarp-kpi");
  });

  it("falls back to raw code block for unsafe mermaid", () => {
    const html = buildVisualBlockPlaceholder({
      kind: "mermaid",
      lang: "mermaid",
      source: "flowchart LR\nclick A callback",
    });
    expect(html).not.toContain("data-visual-block");
    expect(html).toContain("code-block");
  });
});

describe("renderMarkdown visual integration", () => {
  it("renders valid visual fence as host placeholder", () => {
    const md = '```miwarp-kpi\n{"items":[{"label":"Users","value":"1.2k"}]}\n```';
    const html = renderMarkdown(md);
    expect(html).toContain("data-visual-block");
    expect(html).toContain("data-visual-kind");
  });

  it("renders invalid visual fence as plain code block", () => {
    const md = "```miwarp-progress\nnot json\n```";
    const html = renderMarkdown(md);
    expect(html).not.toContain("data-visual-block");
    expect(html).toContain("code-block");
  });

  it("resolves language aliases in fences", () => {
    const md = '```progress\n{"items":[{"label":"A","status":"done"}]}\n```';
    const html = renderMarkdown(md);
    expect(html).toContain('data-visual-kind="miwarp-progress"');
  });
});
