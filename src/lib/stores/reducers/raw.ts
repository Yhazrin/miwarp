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
import { dbgWarn } from "$lib/utils/debug";
import { uuid } from "$lib/utils/uuid";
import type { Reducer } from "./types";

const RAW_PIPE_SOURCES = new Set(["claude_stdout_text", "claude_stderr"]);

// These sources were persisted by older backends before the Claude stream
// protocol classified them. They are transport telemetry, not chat content.
// Consume them explicitly so replaying an old run does not produce thousands
// of warnings or reactive diagnostic writes.
const LEGACY_CLAUDE_TELEMETRY_SOURCES = new Set([
  "claude_system_thinking_tokens",
  "claude_message_delta",
]);

export const reduceRaw: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "raw" }>;
  const rawText = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  if (LEGACY_CLAUDE_TELEMETRY_SOURCES.has(e.source)) {
    return;
  }
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
};
