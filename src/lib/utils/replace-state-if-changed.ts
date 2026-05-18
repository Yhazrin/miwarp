import { replaceState } from "$app/navigation";
import { dbg } from "$lib/utils/debug";

/**
 * SvelteKit replaceState delegates to window.history.replaceState().
 * Calling it repeatedly with an already-canonical URL still counts toward
 * the browser limit (~100 / 10s) and triggers SecurityError loops with
 * reactive routing.
 */
export function replaceStateIfHrefChanged(next: URL, source: string): boolean {
  if (typeof window === "undefined") {
    replaceState(next, {});
    return true;
  }
  const cur = new URL(window.location.href);
  const dst = `${next.pathname}${next.search}${next.hash}`;
  const src = `${cur.pathname}${cur.search}${cur.hash}`;
  if (dst === src) {
    dbg("chat-route", "replaceState skipped (href unchanged)", { source, href: dst });
    return false;
  }
  dbg("chat-route", "replaceState", { source, from: src, to: dst });
  replaceState(next, {});
  return true;
}
