import { describe, expect, it } from "vitest";
import {
  BUILTIN_THEME_IDS,
  migrateThemeIdSuffix,
  resolveAppliedDataTheme,
  resolveCssThemeBase,
  resolveDataThemeValue,
  resolveThemeEntry,
} from "../resolve-theme";

const BUILTIN_ENTRIES = BUILTIN_THEME_IDS.map((id) => ({ id, variants: "both" as const }));

describe("resolveThemeEntry", () => {
  it("falls back to codex for unknown ids", () => {
    expect(resolveThemeEntry("morandi-old", BUILTIN_ENTRIES).id).toBe("codex");
  });

  it("strips legacy -light suffix before lookup", () => {
    expect(resolveThemeEntry("ocean-light", BUILTIN_ENTRIES).id).toBe("ocean");
  });

  it("keeps custom themes that exist in the theme list", () => {
    const themes = [...BUILTIN_ENTRIES, { id: "custom-codex-1", variants: "both" as const }];
    expect(resolveThemeEntry("custom-codex-1", themes).id).toBe("custom-codex-1");
  });
});

describe("resolveCssThemeBase", () => {
  it("maps custom themes to their source built-in palette", () => {
    expect(resolveCssThemeBase("custom-codex")).toBe("codex");
    expect(resolveCssThemeBase("custom-codex-1")).toBe("codex");
    expect(resolveCssThemeBase("custom-dev-preview-2")).toBe("dev-preview");
  });

  it("passes through built-in ids", () => {
    expect(resolveCssThemeBase("auroraLime")).toBe("auroraLime");
  });
});

describe("resolveDataThemeValue", () => {
  it("appends -light for dual-variant themes in light mode", () => {
    expect(resolveDataThemeValue("morandi", "light", "both")).toBe("morandi-light");
    expect(resolveDataThemeValue("morandi", "dark", "both")).toBe("morandi");
  });
});

describe("resolveAppliedDataTheme", () => {
  it("uses built-in css for every built-in theme in both modes", () => {
    for (const id of BUILTIN_THEME_IDS) {
      expect(resolveAppliedDataTheme(id, BUILTIN_ENTRIES, "dark")).toBe(id);
      expect(resolveAppliedDataTheme(id, BUILTIN_ENTRIES, "light")).toBe(`${id}-light`);
    }
  });

  it("uses source css for custom themes", () => {
    const themes = [...BUILTIN_ENTRIES, { id: "custom-morandi-1", variants: "both" as const }];
    expect(resolveAppliedDataTheme("custom-morandi-1", themes, "dark")).toBe("morandi");
    expect(resolveAppliedDataTheme("custom-morandi-1", themes, "light")).toBe("morandi-light");
  });
});

describe("migrateThemeIdSuffix", () => {
  it("extracts implied light mode from legacy ids", () => {
    expect(migrateThemeIdSuffix("codex-light")).toEqual({ base: "codex", impliedMode: "light" });
  });
});
