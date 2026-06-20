/**
 * user_message reducer.
 *
 * Handles user messages coming from the CLI. Two paths:
 *
 * 1. **Idempotency merge** (live mode only): if there's already a matching
 *    optimistic user entry (same content, no cliUuid), backfill the cliUuid.
 *    This collapses the optimistic-UI message and the CLI-confirmed message
 *    into a single timeline entry.
 *
 * 2. **New entry** (replay or no match): push a fresh user timeline entry.
 *    If there's a pending AskUserQuestion tool (`status: "ask_pending"`),
 *    resolve it to success with the message as the answer. In non-stream
 *    mode, also resolve the corresponding hook event to "done".
 */
import type { BusEvent, HookEvent, TimelineEntry } from "$lib/types";
import { eventTs } from "$lib/utils/event-ts";
import { uuid } from "$lib/utils/uuid";
import type { Reducer } from "./types";

export const reduceUserMessage: Reducer = (ev, ctx, store, replayOnly) => {
  const e = ev as Extract<BusEvent, { type: "user_message" }>;
  const tl = ctx ? ctx.tl : store.timeline;

  if (!replayOnly) {
    // Idempotency: find existing optimistic user entry with matching content
    // and backfill its cliUuid from the CLI's authoritative event.
    const match = tl.findLast(
      (entry) => entry.kind === "user" && entry.content === e.text && !entry.cliUuid,
    );
    if (match && match.kind === "user") {
      if (e.uuid) {
        const idx = tl.indexOf(match);
        const updated = { ...match, cliUuid: e.uuid, anchorId: e.uuid };
        if (ctx) ctx.tl[idx] = updated;
        else {
          const u = [...store.timeline];
          u[idx] = updated;
          store.timeline = u;
        }
      }
      return;
    }
  }

  // New entry path
  const newId = uuid();
  const entry: TimelineEntry = {
    kind: "user",
    id: newId,
    anchorId: e.uuid || newId,
    content: e.text,
    ts: eventTs(e),
    ...(e.uuid ? { cliUuid: e.uuid } : {}),
  };
  store._pushTimeline(ctx, entry);

  // Resolve any pending AskUserQuestion tool
  const pendingIdx = tl.findIndex(
    (entry) => entry.kind === "tool" && entry.tool.status === "ask_pending",
  );
  if (pendingIdx >= 0) {
    const old = tl[pendingIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const resolved: TimelineEntry = {
      ...old,
      tool: { ...old.tool, status: "success", output: { answer: e.text } },
    };
    if (ctx) ctx.tl[pendingIdx] = resolved;
    else {
      const u = [...store.timeline];
      u[pendingIdx] = resolved;
      store.timeline = u;
      // After store reassignment, `tl` is stale — re-fetch for the hook check below
    }
    if (!store._isStreamMode(ctx)) {
      const he = ctx ? ctx.he : store.tools;
      const hIdx = store._findHeIdxByStatus(ctx, old.id, "running");
      if (hIdx >= 0) {
        const updatedHe: HookEvent = {
          ...he[hIdx],
          status: "done",
          hook_type: "PostToolUse",
        };
        if (ctx) ctx.he[hIdx] = updatedHe;
        else {
          const u = [...store.tools];
          u[hIdx] = updatedHe;
          store.tools = u;
        }
      }
    }
  }
};
