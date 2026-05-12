/**
 * MiWarp Background Store
 *
 * Manages terminal/chat area background images with full customization.
 * Supports global defaults and per-session overrides.
 */

import {
  DEFAULT_BACKGROUND,
  DEFAULT_BACKGROUND_SETTINGS,
  type BackgroundConfig,
  type BackgroundSettings,
} from '../types/background';

class BackgroundStore {
  /** Global background configuration */
  global = $state<BackgroundConfig>({ ...DEFAULT_BACKGROUND });

  /** Per-session background overrides */
  perSession = $state<Record<string, BackgroundConfig>>({});

  /** Current active session ID (set by the app) */
  activeSessionId = $state<string>('');

  /** Get the effective background for the current session */
  get current(): BackgroundConfig {
    if (this.activeSessionId && this.perSession[this.activeSessionId]) {
      return this.perSession[this.activeSessionId];
    }
    return this.global;
  }

  /** Get background for a specific session */
  getForSession(sessionId: string): BackgroundConfig {
    return this.perSession[sessionId] ?? this.global;
  }

  /** Update global background */
  setGlobal(config: Partial<BackgroundConfig>) {
    this.global = { ...this.global, ...config, scope: 'global' };
    this._persist();
  }

  /** Update session-specific background */
  setSession(sessionId: string, config: Partial<BackgroundConfig>) {
    this.perSession = {
      ...this.perSession,
      [sessionId]: { ...this.global, ...config, scope: 'session' },
    };
    this._persist();
  }

  /** Remove session override (falls back to global) */
  clearSession(sessionId: string) {
    const next = { ...this.perSession };
    delete next[sessionId];
    this.perSession = next;
    this._persist();
  }

  /** Reset global to defaults */
  resetGlobal() {
    this.global = { ...DEFAULT_BACKGROUND };
    this._persist();
  }

  /** Export settings as JSON string */
  exportSettings(): string {
    return JSON.stringify(
      {
        global: this.global,
        perSession: this.perSession,
      } as BackgroundSettings,
      null,
      2
    );
  }

  /** Import settings from JSON string */
  importSettings(json: string) {
    try {
      const settings: BackgroundSettings = JSON.parse(json);
      if (settings.global) this.global = settings.global;
      if (settings.perSession) this.perSession = settings.perSession;
      this._persist();
    } catch {
      console.warn('Failed to import background settings');
    }
  }

  /** Generate CSS style string for the current background */
  getStyle(sessionId?: string): string {
    const bg = sessionId ? this.getForSession(sessionId) : this.current;
    if (!bg.imageUrl) return '';

    const parts: string[] = [];

    // Background image layer
    parts.push(`background-image: url('${bg.imageUrl}')`);

    // Sizing mode mapping
    const sizeMap: Record<string, string> = {
      stretch: '100% 100%',
      fill: 'cover',
      fit: 'contain',
      tile: 'auto',
      cover: 'cover',
    };
    parts.push(`background-size: ${sizeMap[bg.sizingMode] || 'cover'}`);

    // Position
    parts.push(`background-position: ${bg.positionX}% ${bg.positionY}%`);

    // Repeat for tile mode
    if (bg.sizingMode === 'tile') {
      parts.push('background-repeat: repeat');
    } else {
      parts.push('background-repeat: no-repeat');
    }

    // Opacity and blur via filter
    const filters: string[] = [];
    if (bg.blur > 0) filters.push(`blur(${bg.blur}px)`);
    if (filters.length) parts.push(`filter: ${filters.join(' ')}`);

    parts.push(`opacity: ${bg.opacity / 100}`);

    return parts.join('; ');
  }

  /** Get color overlay style */
  getOverlayStyle(sessionId?: string): string {
    const bg = sessionId ? this.getForSession(sessionId) : this.current;
    if (!bg.colorOverlay) return '';
    return `background: ${bg.colorOverlay}; opacity: 0.3;`;
  }

  /** Check if a session has a custom background */
  hasSessionOverride(sessionId: string): boolean {
    return sessionId in this.perSession;
  }

  /** Initialize from localStorage */
  async init() {
    try {
      const stored = localStorage.getItem('miwarp-background');
      if (stored) {
        const settings: BackgroundSettings = JSON.parse(stored);
        if (settings.global) this.global = settings.global;
        if (settings.perSession) this.perSession = settings.perSession;
      }
    } catch {
      // Use defaults
    }
  }

  private _persist() {
    try {
      localStorage.setItem(
        'miwarp-background',
        JSON.stringify({
          global: this.global,
          perSession: this.perSession,
        } as BackgroundSettings)
      );
    } catch {
      // localStorage may be unavailable
    }
  }
}

export const backgroundStore = new BackgroundStore();
