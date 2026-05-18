/**
 * MiWarp Theme Store
 *
 * Manages theme switching, custom themes, and per-session theme overrides.
 * Uses CSS custom property swapping via data-theme attribute on <html>.
 *
 * Single source of truth: all theme state lives here.
 */
import { t } from "$lib/i18n/index.svelte";

export interface ThemeDefinition {
  id: string;
  name: string;
  type: "dark" | "light";
  accent: string; // primary accent color for preview swatches
}

const BUILTIN_THEMES: ThemeDefinition[] = [
  { id: "codex", name: t("theme_codexDark"), type: "dark", accent: "#33A6FF" },
  { id: "codex-light", name: t("theme_codexLight"), type: "light", accent: "#33A6FF" },
  { id: "midnight", name: t("theme_midnight"), type: "dark", accent: "#3B82F6" },
  { id: "ocean", name: t("theme_ocean"), type: "dark", accent: "#0EA5E9" },
  { id: "dracula", name: t("theme_dracula"), type: "dark", accent: "#BD93F9" },
  { id: "nord", name: t("theme_nord"), type: "dark", accent: "#5E81AC" },
  { id: "morandi", name: t("theme_morandi"), type: "dark", accent: "#A67FA3" },
  { id: "morandi-light", name: t("theme_morandiLight"), type: "light", accent: "#A67FA3" },
  { id: "dev-preview", name: t("theme_devPreview"), type: "dark", accent: "#26C2A3" },
  { id: "dev-preview-light", name: t("theme_devPreviewLight"), type: "light", accent: "#26C2A3" },
];

export type ThemeId = string;
export type ColorScheme = "warm" | "neutral";

const TOKEN_VARS = [
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
  /** Currently active global theme ID */
  currentTheme = $state<ThemeId>("codex-light");

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

  /** Light or dark mode derived from current theme */
  get isDark(): boolean {
    const theme = this.themes.find((t) => t.id === this.currentTheme);
    return theme?.type === "dark";
  }

  /** Get the effective theme for a given session */
  getThemeForSession(sessionId: string): ThemeId {
    return this.sessionThemes.get(sessionId) ?? this.currentTheme;
  }

  /** Set the global theme */
  setTheme(themeId: ThemeId) {
    const theme = this.themes.find((t) => t.id === themeId);
    if (!theme) {
      // Fallback to codex-light if theme doesn't exist
      this.currentTheme = "codex-light";
      this._applyTheme("codex-light");
    } else {
      this.currentTheme = themeId;
      this._applyTheme(themeId);
    }
    this._persistSettings();
  }

  /** Set color scheme (warm/neutral) */
  setColorScheme(scheme: ColorScheme) {
    this.colorScheme = scheme;
    this._applyColorScheme(scheme);
    this._persistSettings();
  }

  /** Cycle through themes (dark → light → dark...) */
  cycleTheme() {
    const darkThemes = this.themes.filter((t) => t.type === "dark").map((t) => t.id);
    const lightThemes = this.themes.filter((t) => t.type === "light").map((t) => t.id);

    if (darkThemes.includes(this.currentTheme)) {
      // Switch to a light theme, preferring codex-light
      const next = lightThemes.includes("codex-light") ? "codex-light" : lightThemes[0];
      if (next) this.setTheme(next);
    } else {
      // Switch to a dark theme, preferring codex
      const next = darkThemes.includes("codex") ? "codex" : darkThemes[0];
      if (next) this.setTheme(next);
    }
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
    this._applyTheme(themeId);
    this._persistSettings();
  }

  /** Clear all overrides for a specific theme (reset to built-in defaults). */
  resetThemeOverrides(themeId: ThemeId) {
    this.themeOverrides[themeId] = null;
    this.themeOverrides = { ...this.themeOverrides };
    this._persistSettings();
    if (this.currentTheme === themeId) {
      this._applyTheme(themeId);
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
      type: sourceTheme.type,
      accent:
        this.themeOverrides[sourceThemeId]?.["--miwarp-accent-primary"] ?? sourceTheme.accent,
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
      this.setTheme("codex-light");
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

  /** Import theme config from JSON */
  importConfig(json: string) {
    try {
      const config = JSON.parse(json);
      if (config.currentTheme) {
        this.currentTheme = config.currentTheme;
      }
      if (config.colorScheme) {
        this.colorScheme = config.colorScheme;
      }
      if (config.sessionThemes) {
        this.sessionThemes = new Map(Object.entries(config.sessionThemes));
      }
      if (config.customThemes) {
        const builtins = [...BUILTIN_THEMES];
        this.themes = [...builtins, ...config.customThemes];
      }
      if (config.themeOverrides) {
        this.themeOverrides = config.themeOverrides;
      }
      this._applyTheme(this.currentTheme);
      this._applyColorScheme(this.colorScheme);
      // Persist after import so settings aren't lost on refresh
      this._persistSettings();
    } catch {
      console.warn("Failed to import theme config");
    }
  }

  /** Initialize: load persisted settings, migrate old keys, and apply theme */
  async init() {
    // Try new miwarp-theme key first
    try {
      const stored = localStorage.getItem("miwarp-theme");
      if (stored) {
        const config = JSON.parse(stored);
        if (config.currentTheme) this.currentTheme = config.currentTheme;
        if (config.colorScheme) this.colorScheme = config.colorScheme;
        if (config.sessionThemes) {
          this.sessionThemes = new Map(Object.entries(config.sessionThemes));
        }
        if (config.customThemes) {
          this.themes = [...BUILTIN_THEMES, ...config.customThemes];
        }
        if (config.themeOverrides) {
          this.themeOverrides = config.themeOverrides;
        }
        this._applyTheme(this.currentTheme);
        this._applyColorScheme(this.colorScheme);
        this.initialized = true;
        return;
      }
    } catch {
      // Use defaults
    }

    // Fallback: migrate from old ocv:theme / ocv:colorScheme
    try {
      const oldTheme = localStorage.getItem("ocv:theme");
      const oldScheme = localStorage.getItem("ocv:colorScheme");

      if (oldTheme === "light") {
        this.currentTheme = "codex-light";
      } else if (oldTheme === "dark") {
        this.currentTheme = "codex";
      } else if (oldTheme === "system") {
        // Map system to codex (dark) since that's what was likely shown
        // Could map to codex-light for light preference, but codex is the safe default
        if (
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
        ) {
          this.currentTheme = "codex";
        } else {
          this.currentTheme = "codex-light";
        }
      }
      // If no oldTheme or unrecognized value, keep default "codex-light"

      if (oldScheme === "neutral") {
        this.colorScheme = "neutral";
      } else {
        this.colorScheme = "warm";
      }

      // Migrate: write to new key so we don't migrate again
      this._persistSettings();
    } catch {
      // Use defaults
    }

    this._applyTheme(this.currentTheme);
    this._applyColorScheme(this.colorScheme);
    this.initialized = true;
  }

  private _applyColorScheme(scheme: ColorScheme) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("scheme-neutral", scheme === "neutral");
    root.classList.toggle("scheme-warm", scheme === "warm");
  }

  private _applyTheme(themeId: ThemeId) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const theme = this.themes.find((t) => t.id === themeId);

    const resolvedId = theme?.id ?? "codex-light";
    const isDark = theme?.type === "dark";

    // Step 1: Set data-theme attribute — CSS applies built-in theme variables
    root.setAttribute("data-theme", resolvedId);

    // Step 2: Apply class and colorScheme
    root.classList.remove("dark", "light");
    root.classList.add(isDark ? "dark" : "light");
    root.style.colorScheme = isDark ? "dark" : "light";

    // Step 3: Apply user overrides on top of the new theme's CSS vars
    const overrides = this.themeOverrides[themeId];
    if (overrides) {
      for (const [varName, hslValue] of Object.entries(overrides)) {
        root.style.setProperty(varName, hslValue);
      }
    }
  }

  private _persistSettings() {
    try {
      localStorage.setItem(
        "miwarp-theme",
        JSON.stringify({
          currentTheme: this.currentTheme,
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
}

export const themeStore = new ThemeStore();
