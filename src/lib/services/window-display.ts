/**
 * Window display service — owns platform detection, performance-mode class
 * application, and the desktop-only WebView zoom bridge.
 *
 * Layout components used to inline this logic. Centralizing it keeps the
 * layout focused on navigation and lets the heuristics evolve independently.
 */
import { applyUiZoomCssVar, clampUiZoom } from "$lib/utils/ui-zoom";
import { IS_MAC, IS_WINDOWS, IS_LINUX } from "$lib/utils/platform";

type Platform = "platform-windows" | "platform-macos" | "platform-linux";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "platform-linux";
  if (IS_WINDOWS || navigator.userAgent.includes("Windows")) return "platform-windows";
  if (IS_MAC) return "platform-macos";
  return "platform-linux";
}

type PerfMode = "quality" | "balanced" | "performance";

function resolvePerfMode(mode: string | undefined, platform: Platform): PerfMode {
  if (mode && mode !== "auto") return mode as PerfMode;
  if (platform === "platform-windows") return "performance";
  if (platform === "platform-linux") return "balanced";
  return "quality";
}

export function applyVisualPerformance(mode?: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  const platform = detectPlatform();
  for (const cls of ["platform-windows", "platform-macos", "platform-linux"]) {
    root.classList.toggle(cls, cls === platform);
  }

  const resolved = resolvePerfMode(mode, platform);
  for (const cls of ["perf-quality", "perf-balanced", "perf-performance"]) {
    root.classList.toggle(cls, cls === `perf-${resolved}`);
  }
}

export async function applyZoom(zoom?: number): Promise<void> {
  const factor = clampUiZoom(zoom);
  applyUiZoomCssVar(factor);
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().setZoom(factor);
  } catch {
    // Browser transport or webview API unavailable — CSS variable still applied.
  }
}
