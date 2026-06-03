/** Suppress layout/shell CSS transitions during route changes (avoids jank). */
const SKIP_CLASS = "miwarp-skip-route-motion";

export function beginRouteTransition(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add(SKIP_CLASS);
}

export function endRouteTransition(): void {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove(SKIP_CLASS);
    });
  });
}
