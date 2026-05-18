/**
 * Full-window wallpaper (global default + optional per-session override).
 */

export type SizingMode = "stretch" | "fill" | "fit" | "tile" | "cover";

export type BackgroundScope = "global" | "session";

/** Wallpaper mode: off, image, or solid color. */
export type WallpaperMode = "none" | "image" | "solid";

export interface BackgroundConfig {
  mode: WallpaperMode;
  /** Image URL, path, or data URI (mode === "image") */
  imageUrl: string;
  /** Solid fill color (mode === "solid"), CSS color */
  solidColor: string;
  /** Wallpaper layer opacity 0–100 */
  opacity: number;
  /** Blur on image only (0–50 px) */
  blur: number;
  /**
   * Frosted UI chrome strength (0–100): scales sidebar / main shell opacity over the wallpaper.
   * Lower values let more of the wallpaper (or desktop, with a transparent window) show through.
   */
  chromeOpacity: number;
  /** Backdrop blur on window chrome (0–48 px), sidebar + main shell when wallpaper is on */
  chromeBlur: number;
  positionX: number;
  positionY: number;
  sizingMode: SizingMode;
  /** Optional tint on top of wallpaper */
  colorOverlay: string;
  /** Overlay strength 0–100 (when colorOverlay set) */
  overlayOpacity: number;
  scope: BackgroundScope;
}

export interface BackgroundSettings {
  global: BackgroundConfig;
  perSession: Record<string, BackgroundConfig>;
}

/** Layers applied to the root layout (fixed full-screen). */
export interface RootWallpaperDescriptor {
  show: boolean;
  solidStyle: string;
  imageInnerStyle: string;
  overlayStyle: string;
}

export const DEFAULT_BACKGROUND: BackgroundConfig = {
  mode: "none",
  imageUrl: "",
  solidColor: "#0f172a",
  opacity: 85,
  blur: 0,
  chromeOpacity: 100,
  chromeBlur: 28,
  positionX: 50,
  positionY: 50,
  sizingMode: "cover",
  colorOverlay: "",
  overlayOpacity: 0,
  scope: "global",
};

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  global: { ...DEFAULT_BACKGROUND },
  perSession: {},
};

function normalizeConfig(
  partial: Partial<BackgroundConfig> | undefined,
  fallback: BackgroundConfig,
): BackgroundConfig {
  const merged: BackgroundConfig = { ...fallback, ...partial };
  if (!partial?.mode) {
    merged.mode = partial?.imageUrl ? "image" : "none";
  }
  if (partial && partial.overlayOpacity === undefined) {
    merged.overlayOpacity = merged.colorOverlay ? 30 : 0;
  }
  merged.chromeOpacity = Math.max(
    0,
    Math.min(100, Number(merged.chromeOpacity ?? DEFAULT_BACKGROUND.chromeOpacity)),
  );
  merged.chromeBlur = Math.max(
    0,
    Math.min(48, Number(merged.chromeBlur ?? DEFAULT_BACKGROUND.chromeBlur)),
  );
  return merged;
}

export function migrateBackgroundConfig(partial?: Partial<BackgroundConfig>): BackgroundConfig {
  return normalizeConfig(partial, DEFAULT_BACKGROUND);
}
