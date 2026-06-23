import { describe, expect, it } from "vitest";
import { VISUAL_LIMITS } from "./limits";
import {
  computeVisualBlockSignature,
  extractCompletedVisualFences,
  isEligibleStreamingVisualBlock,
} from "./extract-completed-visual-fences";

const VALID_KPI = JSON.stringify({
  items: [{ label: "Users", value: "42" }],
});

const VALID_MERMAID = `flowchart TD
  A[Start] --> B[End]`;

describe("extractCompletedVisualFences", () => {
  it("returns empty array for empty input", () => {
    expect(extractCompletedVisualFences("")).toEqual([]);
  });

  it("treats plain text without fences as a single text segment", () => {
    const segments = extractCompletedVisualFences("Hello world\nsecond line");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "text", text: "Hello world\nsecond line" });
  });

  it("extracts a single completed visual fence", () => {
    const raw = `Intro text\n\`\`\`miwarp-kpi\n${VALID_KPI}\n\`\`\``;
    const segments = extractCompletedVisualFences(raw);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ type: "text", text: "Intro text\n" });
    expect(segments[1]).toMatchObject({
      type: "visual",
      kind: "miwarp-kpi",
      source: VALID_KPI,
    });
  });

  it("extracts multiple completed visual fences in order", () => {
    const raw = [
      "Before",
      "```mermaid",
      VALID_MERMAID,
      "```",
      "Between",
      "```kpi",
      VALID_KPI,
      "```",
      "After",
    ].join("\n");
    const segments = extractCompletedVisualFences(raw);
    const visuals = segments.filter((s) => s.type === "visual");
    expect(visuals).toHaveLength(2);
    expect(visuals[0]).toMatchObject({ kind: "mermaid" });
    expect(visuals[1]).toMatchObject({ kind: "miwarp-kpi" });
    expect(segments.at(-1)).toMatchObject({ type: "text", text: "After" });
  });

  it("keeps an unclosed fence as trailing plain text", () => {
    const raw = "prefix\n```mermaid\nflowchart TD\n  A --> B";
    const segments = extractCompletedVisualFences(raw);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ type: "text", text: "prefix\n" });
    expect(segments[1]).toMatchObject({
      type: "text",
      text: "```mermaid\nflowchart TD\n  A --> B",
    });
  });

  it("keeps unsupported fenced languages as plain text", () => {
    const raw = "```typescript\nconst x = 1;\nconsole.log(x);\n```";
    const segments = extractCompletedVisualFences(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "text" });
    expect(segments[0].type === "text" && segments[0].text).toContain("const x = 1");
  });

  it("resolves language aliases case-insensitively", () => {
    const raw = `\`\`\`MERMAID\n${VALID_MERMAID}\n\`\`\``;
    const segments = extractCompletedVisualFences(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "visual", kind: "mermaid" });
  });

  it("accepts vega alias as vega-lite", () => {
    const spec = JSON.stringify({
      data: { values: [{ a: 1, b: 2 }] },
      mark: "bar",
      encoding: {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" },
      },
    });
    const raw = `\`\`\`vega\n${spec}\n\`\`\``;
    const segments = extractCompletedVisualFences(raw);
    expect(segments[0]).toMatchObject({ type: "visual", kind: "vega-lite" });
  });

  it("handles CRLF line endings", () => {
    const raw = `Intro\r\n\`\`\`miwarp-kpi\r\n${VALID_KPI}\r\n\`\`\`\r\nTail`;
    const segments = extractCompletedVisualFences(raw);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: "text", text: "Intro\r\n" });
    expect(segments[1]).toMatchObject({ type: "visual", kind: "miwarp-kpi" });
    expect(segments[2]).toMatchObject({ type: "text", text: "Tail" });
  });

  it("falls back to plain text when visual source exceeds limits", () => {
    const oversized = "x".repeat(VISUAL_LIMITS.MAX_SOURCE_CHARS + 1);
    const raw = `\`\`\`miwarp-kpi\n${oversized}\n\`\`\``;
    const segments = extractCompletedVisualFences(raw);
    expect(segments.every((s) => s.type === "text")).toBe(true);
  });

  it("falls back to plain text for invalid visual JSON", () => {
    const raw = "```miwarp-kpi\n{not json}\n```";
    const segments = extractCompletedVisualFences(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("text");
  });

  it("does not treat HTML-like content in text segments as markup", () => {
    const raw = '<script>alert("xss")</script>\n\nNormal text';
    const segments = extractCompletedVisualFences(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("text");
    if (segments[0].type === "text") {
      expect(segments[0].text).toContain("<script>");
    }
  });

  it("rejects mermaid with click directives as plain text fence", () => {
    const raw = "```mermaid\nflowchart TD\n  A --> B\nclick A call foo()\n```";
    const segments = extractCompletedVisualFences(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("text");
  });

  it("continues streaming text after a completed visual block", () => {
    const part1 = `\`\`\`miwarp-kpi\n${VALID_KPI}\n\`\`\`\nDone.`;
    const part2 = `${part1}\nMore streaming text.`;
    const first = extractCompletedVisualFences(part1);
    const second = extractCompletedVisualFences(part2);

    const firstVisual = first.find((s) => s.type === "visual");
    const secondVisual = second.find((s) => s.type === "visual");
    expect(firstVisual?.type).toBe("visual");
    expect(secondVisual?.type).toBe("visual");
    if (firstVisual?.type === "visual" && secondVisual?.type === "visual") {
      expect(secondVisual.key).toBe(firstVisual.key);
      expect(secondVisual.signature).toBe(firstVisual.signature);
    }

    const trailing = second.at(-1);
    expect(trailing).toMatchObject({ type: "text", text: "Done.\nMore streaming text." });
  });

  it("uses stable visual keys derived from content signature", () => {
    const raw = `\`\`\`miwarp-kpi\n${VALID_KPI}\n\`\`\``;
    const [block] = extractCompletedVisualFences(raw);
    expect(block?.type).toBe("visual");
    if (block?.type !== "visual") return;
    const expectedSig = computeVisualBlockSignature("miwarp-kpi", VALID_KPI);
    expect(block.signature).toBe(expectedSig);
    expect(block.key).toContain(expectedSig);
  });
});

describe("isEligibleStreamingVisualBlock", () => {
  it("accepts valid KPI blocks", () => {
    expect(isEligibleStreamingVisualBlock("miwarp-kpi", VALID_KPI)).toBe(true);
  });

  it("rejects oversize sources", () => {
    expect(
      isEligibleStreamingVisualBlock("mermaid", "a".repeat(VISUAL_LIMITS.MAX_SOURCE_CHARS + 1)),
    ).toBe(false);
  });
});

describe("computeVisualBlockSignature", () => {
  it("is stable for identical content", () => {
    const a = computeVisualBlockSignature("mermaid", VALID_MERMAID);
    const b = computeVisualBlockSignature("mermaid", VALID_MERMAID);
    expect(a).toBe(b);
  });

  it("differs when content changes", () => {
    const a = computeVisualBlockSignature("mermaid", VALID_MERMAID);
    const b = computeVisualBlockSignature("mermaid", `${VALID_MERMAID}\n  C[New]`);
    expect(a).not.toBe(b);
  });
});
