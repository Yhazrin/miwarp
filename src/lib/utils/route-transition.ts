/** Suppress layout/shell CSS transitions during route changes (avoids jank). */
const SKIP_CLASS = "miwarp-skip-route-motion";

/**
 * Watchdog: if a paired `endRouteTransition()` is ever skipped (component
 * unmounts mid-navigation, IPC throws, etc.) the skip class would stay on
 * `<html>` forever — every subsequent animation on the shell would die.
 * Cap the suppression at this duration; `endRouteTransition` still removes
 * the class early via rAF, so the watchdog only kicks in on the failure path.
 */
const SKIP_TIMEOUT_MS = 1200;

let watchdogId: ReturnType<typeof setTimeout> | null = null;

export function beginRouteTransition(): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (html.classList.contains(SKIP_CLASS)) return;
  html.classList.add(SKIP_CLASS);
  if (watchdogId !== null) clearTimeout(watchdogId);
  watchdogId = setTimeout(() => {
    watchdogId = null;
    endRouteTransition();
  }, SKIP_TIMEOUT_MS);
}

export function endRouteTransition(): void {
  if (typeof document === "undefined") return;
  if (watchdogId !== null) {
    clearTimeout(watchdogId);
    watchdogId = null;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove(SKIP_CLASS);
    });
  });
}
