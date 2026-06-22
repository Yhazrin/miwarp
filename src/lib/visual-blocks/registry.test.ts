import { describe, expect, it } from "vitest";
import { isVisualBlockLang, resolveVisualBlockLang, VISUAL_SUMMARY_I18N_KEYS } from "./registry";

describe("resolveVisualBlockLang", () => {
  it("maps canonical language tags", () => {
    expect(resolveVisualBlockLang("mermaid")).toBe("mermaid");
    expect(resolveVisualBlockLang("vega-lite")).toBe("vega-lite");
    expect(resolveVisualBlockLang("miwarp-progress")).toBe("miwarp-progress");
    expect(resolveVisualBlockLang("miwarp-kpi")).toBe("miwarp-kpi");
    expect(resolveVisualBlockLang("miwarp-timeline")).toBe("miwarp-timeline");
  });

  it("preserves aliases", () => {
    expect(resolveVisualBlockLang("vegalite")).toBe("vega-lite");
    expect(resolveVisualBlockLang("vega")).toBe("vega-lite");
    expect(resolveVisualBlockLang("progress")).toBe("miwarp-progress");
    expect(resolveVisualBlockLang("kpi")).toBe("miwarp-kpi");
    expect(resolveVisualBlockLang("timeline")).toBe("miwarp-timeline");
  });

  it("returns null for unknown languages", () => {
    expect(resolveVisualBlockLang("javascript")).toBeNull();
    expect(resolveVisualBlockLang("")).toBeNull();
    expect(resolveVisualBlockLang(undefined)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(resolveVisualBlockLang("MERMAID")).toBe("mermaid");
    expect(resolveVisualBlockLang(" KPI ")).toBe("miwarp-kpi");
  });
});

describe("isVisualBlockLang", () => {
  it("returns true for supported tags and aliases", () => {
    expect(isVisualBlockLang("mermaid")).toBe(true);
    expect(isVisualBlockLang("progress")).toBe(true);
  });

  it("returns false for unsupported tags", () => {
    expect(isVisualBlockLang("typescript")).toBe(false);
  });
});

describe("VISUAL_SUMMARY_I18N_KEYS", () => {
  it("maps every visual kind to an i18n key", () => {
    expect(VISUAL_SUMMARY_I18N_KEYS.mermaid).toBe("visual_block_mermaid_summary");
    expect(VISUAL_SUMMARY_I18N_KEYS["vega-lite"]).toBe("visual_block_vega_summary");
    expect(VISUAL_SUMMARY_I18N_KEYS["miwarp-progress"]).toBe("visual_block_progress_summary");
    expect(VISUAL_SUMMARY_I18N_KEYS["miwarp-kpi"]).toBe("visual_block_kpi_summary");
    expect(VISUAL_SUMMARY_I18N_KEYS["miwarp-timeline"]).toBe("visual_block_timeline_summary");
  });
});
