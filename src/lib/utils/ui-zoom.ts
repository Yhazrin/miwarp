/** Clamp UI zoom to the same range as settings (0.75–1.5). */
export function clampUiZoom(raw?: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(1.5, Math.max(0.75, raw as number));
}

/** Keep CSS layout px aligned with native title-bar chrome when webview zoom ≠ 1. */
export function applyUiZoomCssVar(zoom?: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--miwarp-ui-zoom", String(clampUiZoom(zoom)));
}

/** Divide layout px so visual size stays stable under Tauri webview zoom. */
export function layoutPx(value: number, zoom?: number): number {
  return value / clampUiZoom(zoom);
}
