/**
 * MiWarp Theme Store
 *
 * Manages theme switching, custom themes, and per-session theme overrides.
 * Uses CSS custom property swapping via data-theme attribute on <html>.
 *
 * Single source of truth: all theme state lives here.
 */
import { t } from "$lib/i18n/index.svelte";
import {
  DEFAULT_THEME_ID,
  migrateThemeIdSuffix,
  resolveAppliedDataTheme,
  resolveThemeEntry,
} from "$lib/theme/resolve-theme";
import { LS_LEGACY_THEME, LS_LEGACY_COLOR_SCHEME } from "$lib/utils/storage-keys";
import { dbgWarn } from "$lib/utils/debug";

export interface ThemeDefinition {
  /** Base theme id without any -light/-dark suffix (e.g. "morandi", "codex"). */
  id: string;
  /** Display name in the picker (e.g. "Morandi", "Codex Dark"). */
  name: string;
  /** Brand accent color, used for the picker swatch. */
  accent: string;
  /**
   * Which CSS data-theme blocks exist for this theme:
   *   - "both"   → `[data-theme="X"]` (dark) + `[data-theme="X-light"]` (light) — picker shows ONE entry, mode picks variant
   *   - "light"  → only `[data-theme="X"]` (with light palette baked in)
   *   - "dark"   → only `[data-theme="X"]` (with dark palette baked in)
   * Most themes should be "both" — the same brand reads cleanly in both modes.
   */
  variants: "both" | "light" | "dark";
}

/** Old single-variant type. Kept as a type alias for legacy call sites. */
export type ThemeVariant = "light" | "dark";

const BUILTIN_THEMES: ThemeDefinition[] = [
  // ── Each theme = one design. The same brand reads cleanly in both light and
  //    dark mode. CSS has matching `[data-theme="X"]` (dark) and
  //    `[data-theme="X-light"]` (light) blocks. The picker shows ONE entry
  //    per theme; the mode picker decides which variant is applied.
  { id: "codex", name: t("theme_codex"), accent: "#33A6FF", variants: "both" },
  { id: "midnight", name: t("theme_midnight"), accent: "#3B82F6", variants: "both" },
  { id: "ocean", name: t("theme_ocean"), accent: "#0EA5E9", variants: "both" },
  { id: "dracula", name: t("theme_dracula"), accent: "#BD93F9", variants: "both" },
  { id: "nord", name: t("theme_nord"), accent: "#5E81AC", variants: "both" },
  { id: "morandi", name: t("theme_morandi"), accent: "#A67FA3", variants: "both" },
  { id: "dev-preview", name: t("theme_devPreview"), accent: "#26C2A3", variants: "both" },
  { id: "carbonPink", name: t("theme_carbonPink"), accent: "#F43F8A", variants: "both" },
  { id: "deepSeaMilk", name: t("theme_deepSeaMilk"), accent: "#7DD3FC", variants: "both" },
  { id: "auroraPomelo", name: t("theme_auroraPomelo"), accent: "#F97316", variants: "both" },
  { id: "pomegranateMist", name: t("theme_pomegranateMist"), accent: "#E11D48", variants: "both" },
  { id: "auroraLime", name: t("theme_auroraLime"), accent: "#A3E635", variants: "both" },
];

export type ThemeId = string;
export type ColorScheme = "warm" | "neutral";

const _TOKEN_VARS = [
  "--miwarp-bg-deepest",
  "--miwarp-bg-deep",
  "--miwarp-bg-base",
  "--miwarp-bg-elevated",
  "--miwarp-bg-surface",
  "--miwarp-bg-hover",
  "--miwarp-accent-primary",
  "--miwarp-accent-violet",
  "--miwarp-accent-blue",
  "--miwarp-text-primary",
  "--miwarp-text-secondary",
  "--miwarp-text-tertiary",
  "--miwarp-status-running",
  "--miwarp-status-done",
  "--miwarp-status-failed",
  "--miwarp-status-pending",
  "--miwarp-status-paused",
  "--miwarp-status-blocked",
  "--miwarp-status-idle",
];

class ThemeStore {
  /** Currently active global theme ID (base id, no -light suffix). */
  currentTheme = $state<ThemeId>("codex");

  /** Light / dark / follow-system. Drives which `[data-theme]` variant is applied. */
  mode = $state<"light" | "dark" | "system">("light");

  /** Color scheme variant (warm/neutral) */
  colorScheme = $state<ColorScheme>("warm");

  /** All available themes (built-in + custom) */
  themes = $state<ThemeDefinition[]>([...BUILTIN_THEMES]);

  /** Per-session theme overrides: sessionId → themeId */
  sessionThemes = $state<Map<ThemeId, ThemeId>>(new Map());

  /**
   * Per-theme color overrides: themeId → variable name → HSL value string.
   * null means "reset to defaults" for that theme.
   */
  themeOverrides = $state<Record<ThemeId, Record<string, string> | null>>({});

  /** Whether init() has been called */
  initialized = false;

  /**
   * System-mode OS listener (imperative, no `$effect.root`).
   *
   * Earlier used `$effect.root` + a nested `$effect` that read `this.mode`
   * to gate an mql subscription, but that setup runs at module-load time
   * (class constructor) when the Svelte runtime isn't fully primed yet.
   * `init()` would later flip `this.mode = "system"` from localStorage, but
   * the effect re-run was unreliable and the mql listener was never
   * registered — so the app theme froze on whatever was last applied while
   * Tauri/window-vibrancy (which has its own OS listener) kept updating the
   * native glass sidebar. Replacing with imperative `addEventListener` in
   * `setMode` makes the subscription happen exactly when the user picks
   * system mode, with no dependency on effect timing.
   */
  private _systemMql: MediaQueryList | null = null;
  private _systemListener: ((e: MediaQueryListEvent) => void) | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    // Cache the mql reference + listener at construction. They're reused
    // every time the user toggles in/out of system mode, so we never
    // attach more than one listener even if setMode is called many times.
    this._systemMql = window.matchMedia("(prefers-color-scheme: dark)");
    this._systemListener = () => this._applyTheme();
  }

  /** Resolve the effective light/dark mode:
   *   - "system" → query prefers-color-scheme
   *   - explicit → return as-is
   */
  get effectiveMode(): "light" | "dark" {
    if (this.mode === "system") {
      if (typeof window === "undefined") return "light";
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return this.mode;
  }

  /** Whether the current effective rendering is dark. */
  get isDark(): boolean {
    return this.effectiveMode === "dark";
  }

  /** Get the effective theme for a given session */
  getThemeForSession(sessionId: string): ThemeId {
    return this.sessionThemes.get(sessionId) ?? this.currentTheme;
  }

  /** Compute the actual `data-theme` value to apply (combines base id + mode). */
  get resolvedDataTheme(): string {
    return resolveAppliedDataTheme(this.currentTheme, this.themes, this.effectiveMode);
  }

  /** Set the global theme (base id, no -light suffix). */
  setTheme(themeId: ThemeId) {
    const theme = this.themes.find((t) => t.id === themeId);
    if (!theme) {
      // Fallback to codex if theme doesn't exist
      this.currentTheme = "codex";
      this._applyTheme();
    } else {
      this.currentTheme = themeId;
      this._applyTheme();
    }
    this._persistSettings();
  }

  /** Set color scheme (warm/neutral) */
  setColorScheme(scheme: ColorScheme) {
    this.colorScheme = scheme;
    this._applyColorScheme(scheme);
    this._persistSettings();
  }

  /** Set light/dark/system mode. Re-applies the current theme with the new variant. */
  setMode(next: "light" | "dark" | "system") {
    this.mode = next;
    this._syncSystemListener();
    this._applyTheme();
    this._persistSettings();
  }

  /**
   * Sidebar quick-toggle: cycle appearance mode light → dark → system.
   * Same theme, different mode.
   */
  cycleTheme() {
    const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
    const idx = order.indexOf(this.mode);
    const next = order[(idx + 1) % order.length] ?? "light";
    this.setMode(next);
  }

  /** Override theme for a specific session */
  setSessionTheme(sessionId: string, themeId: ThemeId) {
    const next = new Map(this.sessionThemes);
    next.set(sessionId, themeId);
    this.sessionThemes = next;
    this._persistSettings();
  }

  /** Remove session theme override (falls back to global) */
  clearSessionTheme(sessionId: string) {
    const next = new Map(this.sessionThemes);
    next.delete(sessionId);
    this.sessionThemes = next;
    this._persistSettings();
  }

  /** Get all overrides for a specific theme (returns empty object if none). */
  getThemeOverrides(themeId: ThemeId): Record<string, string> {
    return this.themeOverrides[themeId] ?? {};
  }

  /** Check if a specific theme has any overrides. */
  hasThemeOverrides(themeId: ThemeId): boolean {
    const overrides = this.themeOverrides[themeId];
    return overrides !== null && overrides !== undefined && Object.keys(overrides).length > 0;
  }

  /** Set a single variable override for a theme. */
  setThemeOverride(themeId: ThemeId, varName: string, hslValue: string) {
    if (!this.themeOverrides[themeId]) {
      this.themeOverrides[themeId] = {};
    }
    this.themeOverrides[themeId]![varName] = hslValue;
    // Trigger reactivity
    this.themeOverrides = { ...this.themeOverrides };
    this._applyTheme();
    this._persistSettings();
  }

  /** Clear all overrides for a specific theme (reset to built-in defaults). */
  resetThemeOverrides(themeId: ThemeId) {
    this.themeOverrides[themeId] = null;
    this.themeOverrides = { ...this.themeOverrides };
    this._persistSettings();
    if (this.currentTheme === themeId) {
      this._applyTheme();
    }
  }

  /**
   * Create a new custom theme from the current overrides of an existing theme.
   * Copies the source theme's overrides to the new theme.
   */
  createCustomThemeFromOverrides(sourceThemeId: ThemeId, newThemeName: string): ThemeDefinition {
    const sourceTheme = this.themes.find((t) => t.id === sourceThemeId);
    if (!sourceTheme) throw new Error(`Source theme ${sourceThemeId} not found`);

    // Generate unique ID
    const baseId = `custom-${sourceThemeId}`;
    let newId = baseId;
    let counter = 1;
    while (this.themes.some((t) => t.id === newId)) {
      newId = `${baseId}-${counter}`;
      counter++;
    }

    const newTheme: ThemeDefinition = {
      id: newId,
      name: newThemeName,
      accent: this.themeOverrides[sourceThemeId]?.["--miwarp-accent-primary"] ?? sourceTheme.accent,
      variants: sourceTheme.variants,
    };

    this.themes = [...this.themes, newTheme];
    // Copy overrides to new theme
    if (this.themeOverrides[sourceThemeId]) {
      this.themeOverrides[newId] = { ...this.themeOverrides[sourceThemeId]! };
    }
    this.themeOverrides = { ...this.themeOverrides };
    this._persistSettings();

    return newTheme;
  }

  /** Register a custom theme */
  addCustomTheme(theme: ThemeDefinition) {
    this.themes = [...this.themes, theme];
    this._persistSettings();
  }

  /** Remove a custom theme (cannot remove built-in) */
  removeCustomTheme(themeId: ThemeId) {
    if (BUILTIN_THEMES.some((t) => t.id === themeId)) return;
    this.themes = this.themes.filter((t) => t.id !== themeId);
    if (this.currentTheme === themeId) {
      this.setTheme("codex");
    }
    this._persistSettings();
  }

  /** Export current theme config as JSON */
  exportConfig(): string {
    return JSON.stringify(
      {
        currentTheme: this.currentTheme,
        colorScheme: this.colorScheme,
        sessionThemes: Object.fromEntries(this.sessionThemes),
        customThemes: this.themes.filter((t) => !BUILTIN_THEMES.some((b) => b.id === t.id)),
        themeOverrides: this.themeOverrides,
      },
      null,
      2,
    );
  }

  /**
   * Push the current store state onto `<html>` (data-theme, light/dark class,
   * color scheme). Idempotent — safe to call after init, on mount, or from
   * a layout $effect whenever reactive theme state changes.
   */
  applyToDom() {
    if (typeof document === "undefined") return;
    this._syncSystemListener();
    this._applyTheme();
    this._applyColorScheme(this.colorScheme);
  }

  /** Import theme config from JSON */
  importConfig(json: string) {
    try {
      const config = JSON.parse(json);
      if (config.currentTheme) {
        const migrated = this._migrateThemeId(config.currentTheme);
        if (config.customThemes) {
          const builtins = [...BUILTIN_THEMES];
          this.themes = [...builtins, ...config.customThemes];
        }
        this.currentTheme = this._normalizeThemeId(migrated.base);
        // Only override mode if not explicitly set in the imported config.
        if (!config.mode) {
          this.mode = migrated.mode;
        }
      }
      if (config.mode) {
        this.mode = config.mode;
      }
      if (config.colorScheme) {
        this.colorScheme = config.colorScheme;
      }
      if (config.sessionThemes) {
        this.sessionThemes = new Map(Object.entries(config.sessionThemes));
      }
      if (config.customThemes && !config.currentTheme) {
        const builtins = [...BUILTIN_THEMES];
        this.themes = [...builtins, ...config.customThemes];
      }
      if (config.themeOverrides) {
        this.themeOverrides = config.themeOverrides;
      }
      this._syncSystemListener();
      this._applyTheme();
      this._applyColorScheme(this.colorScheme);
      // Persist after import so settings aren't lost on refresh
      this._persistSettings();
    } catch (e) {
      dbgWarn("theme", "import failed", e);
    }
  }

  /** Initialize: load persisted settings, migrate old keys, and apply theme */
  async init() {
    if (!this.initialized) {
      let shouldPersist = false;
      let loaded = false;

      // Try new miwarp-theme key first
      try {
        const stored = localStorage.getItem("miwarp-theme");
        if (stored) {
          const config = JSON.parse(stored);
          if (config.customThemes) {
            this.themes = [...BUILTIN_THEMES, ...config.customThemes];
          }
          // Migrate: old theme ids had a "-light" suffix; strip it and store
          // the variant intent in `mode` instead.
          if (config.currentTheme) {
            const migrated = this._migrateThemeId(config.currentTheme);
            const normalized = this._normalizeThemeId(migrated.base);
            if (normalized !== migrated.base) {
              shouldPersist = true;
            }
            this.currentTheme = normalized;
            if (!config.mode) {
              this.mode = migrated.mode;
            }
          }
          if (config.mode) this.mode = config.mode;
          if (config.colorScheme) this.colorScheme = config.colorScheme;
          if (config.sessionThemes) {
            this.sessionThemes = new Map(Object.entries(config.sessionThemes));
          }
          if (config.themeOverrides) {
            this.themeOverrides = config.themeOverrides;
          }
          if (shouldPersist) {
            this._persistSettings();
          }
          loaded = true;
        }
      } catch (e) {
        dbgWarn("theme", "init failed, using defaults", e);
      }

      // Fallback: migrate from old ocv:theme / ocv:colorScheme
      if (!loaded) {
        try {
          const oldTheme = localStorage.getItem(LS_LEGACY_THEME);
          const oldScheme = localStorage.getItem(LS_LEGACY_COLOR_SCHEME);

          // Map the old "light"/"dark"/"system" string directly to mode
          if (oldTheme === "light" || oldTheme === "dark" || oldTheme === "system") {
            this.mode = oldTheme;
          }
          // Keep currentTheme at default "codex"

          if (oldScheme === "neutral") {
            this.colorScheme = "neutral";
          } else {
            this.colorScheme = "warm";
          }

          // Migrate: write to new key so we don't migrate again
          this._persistSettings();
        } catch (e) {
          dbgWarn("theme", "migration failed, using defaults", e);
        }
      }

      this.initialized = true;
    }

    // Always mirror store → DOM. Earlier `if (initialized) return` skipped this
    // on the second init() call (layout module + app-window-controller), so a
    // late caller could leave bubbles/fonts on codex defaults after AppShell
    // split even though localStorage had the saved theme.
    this.applyToDom();
  }

  private _normalizeThemeId(themeId: ThemeId): ThemeId {
    return resolveThemeEntry(themeId, this.themes).id;
  }

  private _syncSystemListener() {
    if (!this._systemMql || !this._systemListener) return;

    this._systemMql.removeEventListener("change", this._systemListener);
    if (this.mode === "system") {
      this._systemMql.addEventListener("change", this._systemListener);
    }
  }

  private _clearThemeInlineVars(root: HTMLElement) {
    for (const varName of _TOKEN_VARS) {
      root.style.removeProperty(varName);
    }
  }

  private _applyColorScheme(scheme: ColorScheme) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("scheme-neutral", scheme === "neutral");
    root.classList.toggle("scheme-warm", scheme === "warm");
  }

  private _applyTheme() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const themeEntry = resolveThemeEntry(this.currentTheme, this.themes);
    const effective = this.effectiveMode;
    const dataThemeValue = resolveAppliedDataTheme(themeEntry.id, this.themes, effective);

    // Enable smooth transition during theme switch
    root.classList.add("theme-transitioning");

    // Clear stale inline overrides before swapping CSS blocks.
    this._clearThemeInlineVars(root);

    // Step 1: Set data-theme attribute — CSS applies built-in theme variables
    root.setAttribute("data-theme", dataThemeValue);

    // Step 2: Apply class and colorScheme
    root.classList.remove("dark", "light");
    root.classList.add(effective === "dark" ? "dark" : "light");
    root.style.colorScheme = effective === "dark" ? "dark" : "light";

    // Step 2b: Mirror color scheme into a dedicated attribute so CSS
    // selectors that need to branch on light/dark (e.g. native window
    // glass sidebar wash) have a single, authoritative signal that
    // doesn't depend on the legacy `.dark`/`.light` class.
    root.setAttribute("data-color-scheme", effective);

    // Step 3: Apply user overrides on top of the new theme's CSS vars
    const overrides = this.themeOverrides[themeEntry.id];
    if (overrides) {
      for (const [varName, hslValue] of Object.entries(overrides)) {
        root.style.setProperty(varName, hslValue);
      }
    }

    // Remove transition class after animation completes
    setTimeout(() => root.classList.remove("theme-transitioning"), 350);
  }

  private _persistSettings() {
    try {
      localStorage.setItem(
        "miwarp-theme",
        JSON.stringify({
          currentTheme: this.currentTheme,
          mode: this.mode,
          colorScheme: this.colorScheme,
          sessionThemes: Object.fromEntries(this.sessionThemes),
          customThemes: this.themes.filter((t) => !BUILTIN_THEMES.some((b) => b.id === t.id)),
          themeOverrides: this.themeOverrides,
        }),
      );
    } catch {
      // localStorage may be unavailable
    }
  }

  /**
   * Translate a legacy theme id (which carried a `-light` suffix to mean light
   * variant) into the new (base id, mode) pair. Unknown ids pass through as
   * dark + base id.
   */
  private _migrateThemeId(id: string): { base: ThemeId; mode: "light" | "dark" | "system" } {
    const { base, impliedMode } = migrateThemeIdSuffix(id);
    return { base, mode: impliedMode ?? "dark" };
  }
}

export { DEFAULT_THEME_ID };

export const themeStore = new ThemeStore();
