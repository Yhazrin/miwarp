/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { hslTripleToHex, renderMermaidSvg, resetMermaidLoaderForTests } from "./mermaid-loader";

beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 120, height: 40 }),
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: () => 80,
  });
});

afterEach(() => {
  resetMermaidLoaderForTests();
  document.body.replaceChildren();
  // Strip any inline style we may have set on <html> during a test.
  document.documentElement.removeAttribute("style");
});

describe("hslTripleToHex", () => {
  it("converts the canonical 'h s% l%' form to hex", () => {
    expect(hslTripleToHex("0 0% 0%")).toBe("#000000");
    expect(hslTripleToHex("0 0% 100%")).toBe("#ffffff");
    expect(hslTripleToHex("220 18% 6%")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("handles negative hue and out-of-range values via wrap/clamp", () => {
    // -120 → 240 (blue-purple); the result must still be a valid 6-char hex.
    expect(hslTripleToHex("-120 50% 50%")).toMatch(/^#[0-9a-f]{6}$/);
    // S/L above 1.0 clamp to 1.0 — still a valid hex.
    expect(hslTripleToHex("180 200% 200%")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("passes through non-HSL strings unchanged", () => {
    expect(hslTripleToHex("#abcdef")).toBe("#abcdef");
    expect(hslTripleToHex("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(hslTripleToHex("")).toBe("");
  });
});

describe("renderMermaidSvg", () => {
  it("emits a <style> block with node fill colors (not a black fallback)", async () => {
    const svg = await renderMermaidSvg(
      "flowchart TD\n  A[Start] --> B[End]",
      "mermaid-test",
      false,
    );

    expect(svg).toContain("<style");
    expect(svg).toMatch(/\.node[^}]*\{[^}]*fill\s*:/s);
    expect(svg).toContain("Start");
    expect(svg).toContain("End");
  });

  it("inherits the chat font on the rendered SVG so it matches surrounding prose", async () => {
    const svg = await renderMermaidSvg("flowchart LR\n  X --> Y", "mermaid-font-test", false);

    // Mermaid 11 emits font-family in the inlined <style>; we set it to
    // "inherit" so the diagram picks up the chat's font stack.
    expect(svg).toMatch(/font-family\s*:\s*inherit/i);
  });
});
