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

    // Clear inline color token vars to avoid them overriding the new theme
    for (const v of TOKEN_VARS) {
      root.style.removeProperty(v);
    }

    root.setAttribute("data-theme", resolvedId);
    root.classList.remove("dark", "light");
    root.classList.add(isDark ? "dark" : "light");
    root.style.colorScheme = isDark ? "dark" : "light";
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
        }),
      );
    } catch {
      // localStorage may be unavailable
    }
  }
}

export const themeStore = new ThemeStore();
