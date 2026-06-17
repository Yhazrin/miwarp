/**
 * compact_boundary reducer.
 *
 * Handles context-window compaction events. Two flavors:
 * - Micro-compaction (`trigger` starts with "micro"): just increment counter.
 * - Full compaction: increment counter, push a "Context compacted" timeline
 *   separator, and reset per-turn usage fields so the progress bar reflects
 *   the post-compact state.
 *
 * `lastCompactedAt` is set only in live mode — during replay the timestamp
 * would be meaningless (Date.now() ≠ original event time).
 */
import type { BusEvent, TimelineEntry } from "$lib/types";
import { dbg } from "$lib/utils/debug";
import { eventTs } from "$lib/utils/event-ts";
import { uuid } from "$lib/utils/uuid";
import type { Reducer } from "./types";

export const reduceCompactBoundary: Reducer = (ev, ctx, store, replayOnly) => {
  const e = ev as Extract<BusEvent, { type: "compact_boundary" }>;
  const isMicro = (e.trigger ?? "").startsWith("micro");

  if (isMicro) {
    store.microcompactCount++;
  } else {
    store.compactCount++;
    // Full compaction: insert timeline separator
    const tokensInfo = e.pre_tokens ? ` (${Math.round(e.pre_tokens / 1000)}k tokens)` : "";
    const sepId = uuid();
    const entry: TimelineEntry = {
      kind: "separator",
      id: sepId,
      anchorId: sepId,
      content: `Context compacted${tokensInfo}`,
      ts: eventTs(e),
    };
    store._pushTimeline(ctx, entry);
    // Reset per-turn token counts so contextUtilization reflects the
    // compacted state instead of showing stale pre-compact values.
    // The next usage_update event will supply accurate post-compact numbers.
    // Only reset on full compaction — micro-compaction keeps the existing
    // usage so the progress bar does not flash 90%→0%→85%.
    dbg("store", "compact: reset context usage", { preTokens: e.pre_tokens });
    const prev = ctx ? ctx.usage : store.usage;
    const reset = {
      ...prev,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindowUsedPercentage: undefined,
      contextWindowRemainingPercentage: undefined,
    };
    if (ctx) ctx.usage = reset;
    else store.usage = reset;
  }
  // Only set lastCompactedAt during live mode — during replay
  // the timestamp would be meaningless (Date.now() ≠ original event time).
  if (!replayOnly) {
    store.lastCompactedAt = Date.now();
  }
};
