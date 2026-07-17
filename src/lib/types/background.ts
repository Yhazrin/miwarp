/**
 * Background customization types for MiWarp terminal/chat area.
 */

export type SizingMode = "stretch" | "fill" | "fit" | "tile" | "cover";

export type BackgroundScope = "global" | "session";

export interface BackgroundConfig {
  /** Image URL or local file path */
  imageUrl: string;
  /** Opacity 0-100 */
  opacity: number;
  /** Blur amount in pixels (0-50) */
  blur: number;
  /** Horizontal position offset (percentage, 0-100) */
  positionX: number;
  /** Vertical position offset (percentage, 0-100) */
  positionY: number;
  /** How the background image is sized */
  sizingMode: SizingMode;
  /** Hex color overlay applied on top of the image */
  colorOverlay: string;
  /** Whether this is a global or per-session config */
  scope: BackgroundScope;
}

export interface BackgroundSettings {
  /** Global default background */
  global: BackgroundConfig;
  /** Per-session overrides, keyed by session ID */
  perSession: Record<string, BackgroundConfig>;
}

export const DEFAULT_BACKGROUND: BackgroundConfig = {
  imageUrl: "",
  opacity: 30,
  blur: 0,
  positionX: 50,
  positionY: 50,
  sizingMode: "cover",
  colorOverlay: "",
  scope: "global",
};

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  global: { ...DEFAULT_BACKGROUND },
  perSession: {},
};
