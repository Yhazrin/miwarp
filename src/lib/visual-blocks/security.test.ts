/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  containsExternalMarkdownImage,
  sanitizeMermaidForRender,
  sanitizeMermaidSvg,
  validateJsonValue,
  validateMermaidSource,
  validateSourceText,
} from "./security";
import { VISUAL_LIMITS } from "./limits";

describe("validateSourceText", () => {
  it("rejects script tags", () => {
    expect(validateSourceText("<script>alert(1)</script>")).toEqual({
      ok: false,
      reason: "script_tag",
    });
  });

  it("rejects javascript: URLs", () => {
    expect(validateSourceText("javascript:alert(1)")).toEqual({
      ok: false,
      reason: "javascript_url",
    });
  });

  it("rejects oversized source", () => {
    const huge = "x".repeat(VISUAL_LIMITS.MAX_SOURCE_CHARS + 1);
    expect(validateSourceText(huge)).toEqual({ ok: false, reason: "source_too_large" });
  });
});

describe("validateMermaidSource", () => {
  it("rejects click directives", () => {
    expect(validateMermaidSource("flowchart LR\nclick A href")).toEqual({
      ok: false,
      reason: "mermaid_click",
    });
  });

  it("rejects external URLs", () => {
    expect(validateMermaidSource("flowchart LR\nA[https://evil.com]")).toEqual({
      ok: false,
      reason: "external_url",
    });
  });

  it("rejects unsafe securityLevel init", () => {
    expect(validateMermaidSource("%%{init: {securityLevel: 'loose'}}%%\nflowchart LR")).toEqual({
      ok: false,
      reason: "mermaid_unsafe_init",
    });
  });

  it("accepts safe diagram", () => {
    expect(validateMermaidSource("flowchart TD\n  Start --> End")).toEqual({ ok: true });
  });
});

describe("sanitizeMermaidForRender", () => {
  it("strips click lines", () => {
    const input = "flowchart LR\n  A --> B\nclick A callback\n  B --> C";
    expect(sanitizeMermaidForRender(input)).not.toMatch(/click/i);
    expect(sanitizeMermaidForRender(input)).toContain("A --> B");
  });
});

describe("sanitizeMermaidSvg", () => {
  it("removes script tags from SVG", () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
    const clean = sanitizeMermaidSvg(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).toContain("<rect");
  });

  it("removes onclick handlers", () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" width="10" height="10"/></svg>';
    const clean = sanitizeMermaidSvg(dirty);
    expect(clean).not.toContain("onclick");
  });

  it("removes external href links", () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.com"><text>link</text></a></svg>';
    const clean = sanitizeMermaidSvg(dirty);
    expect(clean).not.toContain("https://evil.com");
  });
});

describe("validateJsonValue", () => {
  it("rejects excessive nesting depth", () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i <= VISUAL_LIMITS.MAX_JSON_DEPTH; i++) {
      nested = { child: nested };
    }
    expect(validateJsonValue(nested).ok).toBe(false);
  });

  it("rejects external URL strings", () => {
    expect(validateJsonValue("https://example.com/image.png")).toEqual({
      ok: false,
      reason: "external_url",
    });
  });

  it("rejects data.url in vega specs", () => {
    expect(
      validateJsonValue({
        data: { url: "https://example.com/data.json" },
      }),
    ).toEqual({ ok: false, reason: "vega_data_url" });
  });

  it("rejects forbidden vega keys", () => {
    expect(validateJsonValue({ usermeta: { embedOptions: {} } })).toEqual({
      ok: false,
      reason: "vega_forbidden_key",
    });
    expect(validateJsonValue({ signals: [{ name: "x", value: 1 }] })).toEqual({
      ok: false,
      reason: "vega_forbidden_key",
    });
  });

  it("rejects named external datasets", () => {
    expect(validateJsonValue({ data: { name: "table" } })).toEqual({
      ok: false,
      reason: "vega_external_data",
    });
  });

  it("rejects transform expressions", () => {
    expect(
      validateJsonValue({
        transform: [{ calculate: "datum.a * 2", expr: "datum.a * 2" }],
      }),
    ).toEqual({ ok: false, reason: "vega_expression" });
  });

  it("accepts inline values", () => {
    expect(
      validateJsonValue({
        mark: "point",
        data: { values: [{ x: 1, y: 2 }] },
      }),
    ).toEqual({ ok: true });
  });
});

describe("containsExternalMarkdownImage", () => {
  it("detects external markdown images", () => {
    expect(containsExternalMarkdownImage("![alt](https://cdn.example.com/x.png)")).toBe(true);
  });

  it("allows relative paths", () => {
    expect(containsExternalMarkdownImage("![alt](./local.png)")).toBe(false);
  });
});
