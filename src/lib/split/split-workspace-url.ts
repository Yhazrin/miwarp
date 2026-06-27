/**
 * Split workspace URL protocol (v1.0.9 P2-1).
 *
 * Schema:
 *   ?split=1                — split mode flag
 *   &run=<activeRunId>      — active run id (for chat-page loadRun on first paint)
 *   &panes=<base64-json>    — full pane set (id + runId per pane), base64 of JSON
 *   &layout=<layoutMode>    — layout mode (single | dual | triple | quad)
 *
 * Back-compat: a URL with `?split=1&run=X` (no `panes` or `layout`) is treated
 * as a single-pane workspace with the active run = X. Old URLs keep working.
 *
 * The `panes` payload is base64-encoded to keep the URL short and to avoid
 * escaping headaches with JSON in query strings. JSON keeps the schema
 * versioned (`v: 1`) so future additions can be back-compat without
 * breaking unreadable payloads.
 */

export const SPLIT_QUERY_PARAM = "split";
export const RUN_QUERY_PARAM = "run";
export const PANES_QUERY_PARAM = "panes";
export const LAYOUT_QUERY_PARAM = "layout";

export function isSplitModeUrl(params: URLSearchParams): boolean {
  return params.get(SPLIT_QUERY_PARAM) === "1";
}

export interface PaneRef {
  /** Stable id (matches PaneState.paneId at the time of URL write). */
  id: string;
  /** Run id this pane shows. */
  r: string;
}

export interface PaneSetPayload {
  /** Schema version. */
  v: 1;
  /** All panes, in display order. */
  items: PaneRef[];
  /** Active pane id. May be `null` if the URL was generated for an empty workspace. */
  active: string | null;
}

export interface BuildChatUrlOptions {
  runId?: string | null;
  split?: boolean;
  panes?: PaneRef[];
  activePaneId?: string | null;
  layout?: "single" | "dual" | "triple" | "quad" | null;
}

/** Build/derive the chat URL with optional split metadata. */
export function buildChatUrl(base: URL, opts: BuildChatUrlOptions): URL {
  const url = new URL(base.href);
  if (opts.split) {
    url.searchParams.set(SPLIT_QUERY_PARAM, "1");
  } else {
    url.searchParams.delete(SPLIT_QUERY_PARAM);
  }
  if (opts.runId) {
    url.searchParams.set(RUN_QUERY_PARAM, opts.runId);
  }
  if (opts.split && opts.panes && opts.panes.length > 0) {
    url.searchParams.set(PANES_QUERY_PARAM, buildSplitPanes(opts.panes, opts.activePaneId ?? null));
    if (opts.layout) url.searchParams.set(LAYOUT_QUERY_PARAM, opts.layout);
  } else {
    url.searchParams.delete(PANES_QUERY_PARAM);
    url.searchParams.delete(LAYOUT_QUERY_PARAM);
  }
  return url;
}

/** Encode a pane set as a base64-encoded JSON string. */
export function buildSplitPanes(panes: PaneRef[], active: string | null): string {
  const payload: PaneSetPayload = { v: 1, items: panes, active };
  const json = JSON.stringify(payload);
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(json)));
  }
  // Node fallback (vitest). Buffer is available in vitest's node env.
  const B = (
    globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }
  ).Buffer;
  return B!.from(json, "utf-8").toString("base64");
}

/**
 * Decode a base64-encoded panes payload. Returns `null` for malformed input
 * (treated by callers as "URL has no pane metadata → fall back to single
 * pane from `?run=`").
 */
export function parseSplitPanes(encoded: string | null): PaneSetPayload | null {
  if (!encoded) return null;
  try {
    const json =
      typeof atob === "function"
        ? decodeURIComponent(escape(atob(encoded)))
        : (
            globalThis as {
              Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
            }
          )
            .Buffer!.from(encoded, "base64")
            .toString("utf-8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<PaneSetPayload>;
    if (candidate.v !== 1) return null;
    if (!Array.isArray(candidate.items)) return null;
    const items: PaneRef[] = [];
    for (const raw of candidate.items) {
      if (
        raw &&
        typeof raw === "object" &&
        typeof (raw as PaneRef).id === "string" &&
        typeof (raw as PaneRef).r === "string"
      ) {
        items.push({ id: (raw as PaneRef).id, r: (raw as PaneRef).r });
      }
    }
    return {
      v: 1,
      items,
      active:
        typeof candidate.active === "string" || candidate.active === null
          ? (candidate.active as string | null)
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Read the panes set from URL params with back-compat:
 *   - If `?panes=` exists and parses, return the parsed payload.
 *   - Else if `?run=` exists, return a single-pane payload with that runId.
 *   - Else return null (caller should treat as "no split metadata").
 */
export function readPaneSetFromUrl(params: URLSearchParams): PaneSetPayload | null {
  const encoded = params.get(PANES_QUERY_PARAM);
  const parsed = parseSplitPanes(encoded);
  if (parsed) return parsed;
  const run = params.get(RUN_QUERY_PARAM);
  if (run) {
    return { v: 1, items: [{ id: "legacy", r: run }], active: "legacy" };
  }
  return null;
}

/** Read layout from URL. Defaults to `single` if missing or invalid. */
export function readLayoutFromUrl(params: URLSearchParams): "single" | "dual" | "triple" | "quad" {
  const raw = params.get(LAYOUT_QUERY_PARAM);
  if (raw === "dual" || raw === "triple" || raw === "quad") return raw;
  return "single";
}
