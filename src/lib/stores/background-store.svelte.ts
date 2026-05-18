/**
 * MiWarp full-window wallpaper (global + per-session override).
 */

import {
  DEFAULT_BACKGROUND,
  migrateBackgroundConfig,
  type BackgroundConfig,
  type BackgroundSettings,
  type RootWallpaperDescriptor,
} from "../types/background";

class BackgroundStore {
  global = $state<BackgroundConfig>({ ...DEFAULT_BACKGROUND });

  perSession = $state<Record<string, BackgroundConfig>>({});

  activeSessionId = $state<string>("");

  get current(): BackgroundConfig {
    if (this.activeSessionId && this.perSession[this.activeSessionId]) {
      return this.perSession[this.activeSessionId];
    }
    return this.global;
  }

  getForSession(sessionId: string): BackgroundConfig {
    return this.perSession[sessionId] ?? this.global;
  }

  setGlobal(config: Partial<BackgroundConfig>) {
    this.global = migrateBackgroundConfig({ ...this.global, ...config, scope: "global" });
    this._persist();
  }

  setSession(sessionId: string, config: Partial<BackgroundConfig>) {
    const base = migrateBackgroundConfig({ ...this.global, ...this.perSession[sessionId] });
    this.perSession = {
      ...this.perSession,
      [sessionId]: migrateBackgroundConfig({ ...base, ...config, scope: "session" }),
    };
    this._persist();
  }

  clearSession(sessionId: string) {
    const next = { ...this.perSession };
    delete next[sessionId];
    this.perSession = next;
    this._persist();
  }

  resetGlobal() {
    this.global = { ...DEFAULT_BACKGROUND };
    this._persist();
  }

  exportSettings(): string {
    return JSON.stringify(
      {
        global: this.global,
        perSession: this.perSession,
      } as BackgroundSettings,
      null,
      2,
    );
  }

  importSettings(json: string) {
    try {
      const settings: BackgroundSettings = JSON.parse(json);
      if (settings.global) this.global = migrateBackgroundConfig(settings.global);
      if (settings.perSession) {
        const next: Record<string, BackgroundConfig> = {};
        for (const [k, v] of Object.entries(settings.perSession)) {
          next[k] = migrateBackgroundConfig(v);
        }
        this.perSession = next;
      }
      this._persist();
    } catch {
      console.warn("Failed to import background settings");
    }
  }

  /** CSS for BackgroundPicker image preview (inner div). */
  getImagePreviewInnerStyle(sessionId?: string): string {
    const bg = sessionId ? this.getForSession(sessionId) : this.current;
    if (bg.mode !== "image" || !bg.imageUrl) return "";

    const sizeMap: Record<string, string> = {
      stretch: "100% 100%",
      fill: "cover",
      fit: "contain",
      tile: "auto",
      cover: "cover",
    };
    const size = sizeMap[bg.sizingMode] || "cover";
    const pos = `${bg.positionX}% ${bg.positionY}%`;
    const repeat = bg.sizingMode === "tile" ? "repeat" : "no-repeat";

    const filters: string[] = [];
    if (bg.blur > 0) filters.push(`blur(${bg.blur}px)`);
    const filterCss = filters.length ? `filter: ${filters.join(" ")}` : "";

    const scale = bg.blur > 0 ? "transform: scale(1.08); transform-origin: center center;" : "";

    return [
      `background-image: url(${JSON.stringify(bg.imageUrl)})`,
      `background-size: ${size}`,
      `background-position: ${pos}`,
      `background-repeat: ${repeat}`,
      filterCss,
      scale,
      `opacity: ${bg.opacity / 100}`,
    ]
      .filter(Boolean)
      .join("; ");
  }

  getSolidPreviewStyle(sessionId?: string): string {
    const bg = sessionId ? this.getForSession(sessionId) : this.current;
    if (bg.mode !== "solid") return "";
    return `background-color: ${bg.solidColor}; opacity: ${bg.opacity / 100}`;
  }

  getOverlayStyle(sessionId?: string): string {
    const bg = sessionId ? this.getForSession(sessionId) : this.current;
    if (!bg.colorOverlay) return "";
    return `background: ${bg.colorOverlay}; opacity: ${bg.overlayOpacity / 100}`;
  }

  /** Full-window layers behind the UI (fixed inset-0). */
  getRootWallpaperDescriptor(): RootWallpaperDescriptor {
    const bg = this.current;

    if (bg.mode === "none") {
      return { show: false, solidStyle: "", imageInnerStyle: "", overlayStyle: "" };
    }

    if (bg.mode === "solid") {
      return {
        show: true,
        solidStyle: `background-color: ${bg.solidColor}; opacity: ${bg.opacity / 100}`,
        imageInnerStyle: "",
        overlayStyle: bg.colorOverlay
          ? `background: ${bg.colorOverlay}; opacity: ${bg.overlayOpacity / 100}`
          : "",
      };
    }

    if (!bg.imageUrl) {
      return { show: false, solidStyle: "", imageInnerStyle: "", overlayStyle: "" };
    }

    const sizeMap: Record<string, string> = {
      stretch: "100% 100%",
      fill: "cover",
      fit: "contain",
      tile: "auto",
      cover: "cover",
    };
    const size = sizeMap[bg.sizingMode] || "cover";
    const pos = `${bg.positionX}% ${bg.positionY}%`;
    const repeat = bg.sizingMode === "tile" ? "repeat" : "no-repeat";

    const filters: string[] = [];
    if (bg.blur > 0) filters.push(`blur(${bg.blur}px)`);
    const filterCss = filters.length ? `filter: ${filters.join(" ")}` : "";
    const scale = bg.blur > 0 ? "transform: scale(1.1); transform-origin: center center;" : "";

    const imageInnerStyle = [
      `background-image: url(${JSON.stringify(bg.imageUrl)})`,
      `background-size: ${size}`,
      `background-position: ${pos}`,
      `background-repeat: ${repeat}`,
      filterCss,
      scale,
      `opacity: ${bg.opacity / 100}`,
    ]
      .filter(Boolean)
      .join("; ");

    return {
      show: true,
      solidStyle: "",
      imageInnerStyle,
      overlayStyle: bg.colorOverlay
        ? `background: ${bg.colorOverlay}; opacity: ${bg.overlayOpacity / 100}`
        : "",
    };
  }

  hasSessionOverride(sessionId: string): boolean {
    return sessionId in this.perSession;
  }

  async init() {
    try {
      const stored = localStorage.getItem("miwarp-background");
      if (stored) {
        const settings: BackgroundSettings = JSON.parse(stored);
        if (settings.global) this.global = migrateBackgroundConfig(settings.global);
        if (settings.perSession) {
          const next: Record<string, BackgroundConfig> = {};
          for (const [k, v] of Object.entries(settings.perSession)) {
            next[k] = migrateBackgroundConfig(v);
          }
          this.perSession = next;
        }
      }
    } catch {
      // keep defaults
    }
  }

  private _persist() {
    try {
      localStorage.setItem(
        "miwarp-background",
        JSON.stringify({
          global: this.global,
          perSession: this.perSession,
        } as BackgroundSettings),
      );
    } catch {
      // quota / private mode
    }
  }
}

export const backgroundStore = new BackgroundStore();
