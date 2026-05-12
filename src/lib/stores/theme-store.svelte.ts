/**
 * MiWarp Theme Store
 *
 * Manages theme switching, custom themes, and per-session theme overrides.
 * Uses CSS custom property swapping via data-theme attribute on <html>.
 */

export interface ThemeDefinition {
  id: string;
  name: string;
  type: 'dark' | 'light';
  accent: string; // primary accent color for preview swatches
}

const BUILTIN_THEMES: ThemeDefinition[] = [
  { id: 'warp-dark', name: 'Warp Dark', type: 'dark', accent: '#6366F1' },
  { id: 'warp-light', name: 'Warp Light', type: 'light', accent: '#6366F1' },
  { id: 'midnight', name: 'Midnight', type: 'dark', accent: '#3B82F6' },
  { id: 'ocean', name: 'Ocean', type: 'dark', accent: '#0EA5E9' },
  { id: 'dracula', name: 'Dracula', type: 'dark', accent: '#BD93F9' },
  { id: 'nord', name: 'Nord', type: 'dark', accent: '#5E81AC' },
];

export type ThemeId = string;

class ThemeStore {
  /** Currently active global theme ID */
  currentTheme = $state<ThemeId>('warp-dark');

  /** All available themes (built-in + custom) */
  themes = $state<ThemeDefinition[]>([...BUILTIN_THEMES]);

  /** Per-session theme overrides: sessionId → themeId */
  sessionThemes = $state<Map<ThemeId, ThemeId>>(new Map());

  /** Light or dark mode derived from current theme */
  get isDark(): boolean {
    const theme = this.themes.find(t => t.id === this.currentTheme);
    return theme?.type === 'dark';
  }

  /** Get the effective theme for a given session */
  getThemeForSession(sessionId: string): ThemeId {
    return this.sessionThemes.get(sessionId) ?? this.currentTheme;
  }

  /** Set the global theme */
  setTheme(themeId: ThemeId) {
    this.currentTheme = themeId;
    this._applyTheme(themeId);
    this._persistSettings();
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
    if (BUILTIN_THEMES.some(t => t.id === themeId)) return;
    this.themes = this.themes.filter(t => t.id !== themeId);
    if (this.currentTheme === themeId) {
      this.setTheme('warp-dark');
    }
    this._persistSettings();
  }

  /** Export current theme config as JSON */
  exportConfig(): string {
    return JSON.stringify(
      {
        currentTheme: this.currentTheme,
        sessionThemes: Object.fromEntries(this.sessionThemes),
        customThemes: this.themes.filter(
          t => !BUILTIN_THEMES.some(b => b.id === t.id)
        ),
      },
      null,
      2
    );
  }

  /** Import theme config from JSON */
  importConfig(json: string) {
    try {
      const config = JSON.parse(json);
      if (config.currentTheme) {
        this.currentTheme = config.currentTheme;
      }
      if (config.sessionThemes) {
        this.sessionThemes = new Map(Object.entries(config.sessionThemes));
      }
      if (config.customThemes) {
        const builtins = [...BUILTIN_THEMES];
        this.themes = [...builtins, ...config.customThemes];
      }
      this._applyTheme(this.currentTheme);
    } catch {
      console.warn('Failed to import theme config');
    }
  }

  /** Initialize: load persisted settings and apply theme */
  async init() {
    try {
      const stored = localStorage.getItem('miwarp-theme');
      if (stored) {
        const config = JSON.parse(stored);
        if (config.currentTheme) this.currentTheme = config.currentTheme;
        if (config.sessionThemes) {
          this.sessionThemes = new Map(Object.entries(config.sessionThemes));
        }
        if (config.customThemes) {
          this.themes = [...BUILTIN_THEMES, ...config.customThemes];
        }
      }
    } catch {
      // Use defaults
    }
    this._applyTheme(this.currentTheme);
  }

  private _applyTheme(themeId: ThemeId) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const theme = this.themes.find(t => t.id === themeId);

    root.setAttribute('data-theme', themeId);

    // Also toggle dark class for legacy compatibility
    if (theme?.type === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
  }

  private _persistSettings() {
    try {
      localStorage.setItem(
        'miwarp-theme',
        JSON.stringify({
          currentTheme: this.currentTheme,
          sessionThemes: Object.fromEntries(this.sessionThemes),
          customThemes: this.themes.filter(
            t => !BUILTIN_THEMES.some(b => b.id === t.id)
          ),
        })
      );
    } catch {
      // localStorage may be unavailable
    }
  }
}

export const themeStore = new ThemeStore();
