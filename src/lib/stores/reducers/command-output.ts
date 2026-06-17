/**
 * command_output reducer.
 *
 * Pushes a single `command_output` timeline entry. No ctx involvement —
 * this is a one-shot display entry that never participates in batch replay
 * semantics (a replayed command output doesn't make sense in a re-rendered
 * session view).
 */
import type { BusEvent, TimelineEntry } from "$lib/types";
import { dbg } from "$lib/utils/debug";
import { eventTs } from "$lib/utils/event-ts";
import { uuid } from "$lib/utils/uuid";
import type { Reducer } from "./types";

export const reduceCommandOutput: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "command_output" }>;
  dbg("store", "command_output received", {
    contentLen: e.content.length,
    hasBatchCtx: !!ctx,
  });
  const cmdId = uuid();
  const cmdEntry: TimelineEntry = {
    kind: "command_output",
    id: cmdId,
    anchorId: cmdId,
    content: e.content,
    ts: eventTs(e),
  };
  store._pushTimeline(ctx, cmdEntry);
};
