/**
 * PermissionProjection — cached single-walk scan of timeline for permission
 * prompts (item #1 Permission Timeline Scan).
 *
 * Extracted from session-store (Worker-4 P0/P1/P2 refactor). The projection
 * is invalidated whenever the timeline reference changes; the cache is held
 * on the SessionStore as `_permScan`. Getter access goes through
 * `getPermissionScan()` which short-circuits when the cached `timelineRef`
 * matches.
 *
 * Walk rules:
 *  - Top-level tool entries with `status === "permission_prompt"` count.
 *  - Recurse into `subTimeline` (sub-agents inherit pending permissions).
 *  - `AskUserQuestion` / `ExitPlanMode` are tracked separately as "inline"
 *    (resolved by the chat UI directly, not the permission coordinator).
 *  - Last-write-wins by `permission_request_id` so a stale prompt cannot
 *    shadow the current one in `pendingTools`.
 */

import type { TimelineEntry, BusToolItem } from "$lib/types";

export interface PermissionScan {
  timelineRef: TimelineEntry[];
  hasPending: boolean;
  hasInline: boolean;
  pendingTools: Array<{ tool: BusToolItem; requestId: string }>;
}

const INLINE_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

export function scanPermissionState(timeline: TimelineEntry[]): PermissionScan {
  let hasPending = false;
  let hasInline = false;
  const toolMap = new Map<string, BusToolItem>();

  const walk = (entries: TimelineEntry[]) => {
    for (const entry of entries) {
      if (entry.kind !== "tool") continue;
      if (entry.tool.status === "permission_prompt" && entry.tool.permission_request_id) {
        hasPending = true;
        const name = entry.tool.tool_name;
        if (name === "AskUserQuestion" || name === "ExitPlanMode") {
          hasInline = true;
        } else {
          const rid = entry.tool.permission_request_id;
          toolMap.delete(rid);
          toolMap.set(rid, entry.tool);
        }
      }
      if (entry.subTimeline) walk(entry.subTimeline);
    }
  };
  walk(timeline);

  return {
    timelineRef: timeline,
    hasPending,
    hasInline,
    pendingTools: Array.from(toolMap, ([requestId, tool]) => ({ tool, requestId })),
  };
}

/**
 * Cache-aware accessor: returns the same `PermissionScan` object for a
 * given timeline reference. The store calls this from its getters.
 */
export class PermissionProjectionCache {
  private cached: PermissionScan | null = null;

  get(timeline: TimelineEntry[]): PermissionScan {
    if (this.cached && this.cached.timelineRef === timeline) {
      return this.cached;
    }
    this.cached = scanPermissionState(timeline);
    return this.cached;
  }

  invalidate(): void {
    this.cached = null;
  }
}

export { INLINE_TOOLS };
