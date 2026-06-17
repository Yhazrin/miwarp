/**
 * raw reducer.
 *
 * Handles CLI raw-output events (text piped directly from claude_stdout_text
 * or claude_stderr). If source matches, pushes a synthetic `assistant`
 * timeline entry wrapping the raw text. Otherwise increments
 * `rawFallbackCount` and warns (used as a signal that the protocol didn't
 * catch a stream line).
 */
import type { BusEvent, TimelineEntry } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { uuid } from "$lib/utils/uuid";
import type { Reducer } from "./types";

const RAW_PIPE_SOURCES = new Set(["claude_stdout_text", "claude_stderr"]);

export const reduceRaw: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "raw" }>;
  const rawText = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  if (rawText && RAW_PIPE_SOURCES.has(e.source)) {
    const rawId = uuid();
    const entry: TimelineEntry = {
      kind: "assistant",
      id: rawId,
      anchorId: rawId,
      content: `\`[${e.source}]\` ${rawText}`,
      ts: new Date().toISOString(),
    };
    store._pushTimeline(ctx, entry);
  } else {
    store.rawFallbackCount++;
    dbgWarn("store", "raw fallback event:", e.source, rawText?.slice(0, 100));
    if (store.strictMode) {
      throw new Error(`[STRICT] raw fallback event: source=${e.source}`);
    }
  }
  // Reference the dbg symbol to keep the import meaningful in production
  // builds (dbgWarn is used above; dbg is reserved for future raw debug).
  void dbg;
};
