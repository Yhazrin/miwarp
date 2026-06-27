/** Built-in theme ids — keep in sync with BUILTIN_THEMES in theme-store. */
export const BUILTIN_THEME_IDS = [
  "codex",
  "midnight",
  "ocean",
  "dracula",
  "nord",
  "morandi",
  "dev-preview",
  "carbonPink",
  "deepSeaMilk",
  "auroraPomelo",
  "pomegranateMist",
  "auroraLime",
] as const;

export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number];

export const DEFAULT_THEME_ID: BuiltinThemeId = "codex";

export type ThemeVariants = "both" | "light" | "dark";

export interface ThemeEntryLike {
  id: string;
  variants?: ThemeVariants;
}

/** Strip legacy `-light` suffix from stored theme ids. */
export function migrateThemeIdSuffix(themeId: string): {
  base: string;
  impliedMode: "light" | null;
} {
  if (themeId.endsWith("-light")) {
    return { base: themeId.slice(0, -"-light".length), impliedMode: "light" };
  }
  return { base: themeId, impliedMode: null };
}

/** Resolve a stored theme id to a known theme entry, or fall back to codex. */
export function resolveThemeEntry(
  themeId: string | undefined | null,
  themes: readonly ThemeEntryLike[],
): ThemeEntryLike {
  if (!themeId) {
    return { id: DEFAULT_THEME_ID, variants: "both" };
  }

  const { base } = migrateThemeIdSuffix(themeId);
  const found = themes.find((theme) => theme.id === base);
  if (found) return found;

  return { id: DEFAULT_THEME_ID, variants: "both" };
}

/**
 * Map the active theme id to the CSS `data-theme` base block.
 * Custom themes inherit palette tokens from their source built-in theme.
 */
export function resolveCssThemeBase(themeId: string): BuiltinThemeId {
  if ((BUILTIN_THEME_IDS as readonly string[]).includes(themeId)) {
    return themeId as BuiltinThemeId;
  }

  if (themeId.startsWith("custom-")) {
    const rest = themeId.slice("custom-".length);
    const sorted = [...BUILTIN_THEME_IDS].sort((a, b) => b.length - a.length);
    for (const builtinId of sorted) {
      if (rest === builtinId || rest.startsWith(`${builtinId}-`)) {
        return builtinId;
      }
    }
  }

  return DEFAULT_THEME_ID;
}

/** Compute the `data-theme` attribute value from css base + effective mode. */
export function resolveDataThemeValue(
  cssBase: string,
  effectiveMode: "light" | "dark",
  variants: ThemeVariants = "both",
): string {
  if (variants === "light" || variants === "dark") {
    return cssBase;
  }
  return effectiveMode === "light" ? `${cssBase}-light` : cssBase;
}

/** Full splash/store pipeline: theme id + mode → data-theme attribute. */
export function resolveAppliedDataTheme(
  themeId: string | undefined | null,
  themes: readonly ThemeEntryLike[],
  effectiveMode: "light" | "dark",
): string {
  const entry = resolveThemeEntry(themeId, themes);
  const cssBase = resolveCssThemeBase(entry.id);
  return resolveDataThemeValue(cssBase, effectiveMode, entry.variants ?? "both");
}
