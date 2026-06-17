/**
 * hook-events reducer — handles hook_started / hook_progress / hook_response / hook_callback.
 *
 * All four events append to the store's `hookEvents` list via _appendCapped
 * (which caps the list to prevent unbounded growth). Each event has a
 * slightly different shape — the reducer variants preserve the field set
 * that each event type carries.
 */
import type { BusEvent, HookEvent } from "$lib/types";
import type { Reducer } from "./types";

type AppendCapable = (arr: HookEvent[], item: HookEvent) => HookEvent[];

// Module-level helper used by all 4 reducers. Kept here (not on store)
// because it's only used by these reducers and stays a pure function.
const _appendCapped: AppendCapable = (() => {
  const MAX = 500;
  return (arr, item) => {
    const next = [...arr, item];
    return next.length > MAX ? next.slice(-MAX) : next;
  };
})();

export const reduceHookStarted: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "hook_started" }>;
  store.hookEvents = _appendCapped(store.hookEvents, {
    type: e.type,
    hook_id: e.hook_id,
    data: e as unknown,
    hook_name: e.hook_name,
  } as unknown as HookEvent);
};

export const reduceHookProgress: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "hook_progress" }>;
  store.hookEvents = _appendCapped(store.hookEvents, {
    type: e.type,
    hook_id: e.hook_id,
    data: e as unknown,
  } as unknown as HookEvent);
};

export const reduceHookResponse: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "hook_response" }>;
  store.hookEvents = _appendCapped(store.hookEvents, {
    type: e.type,
    hook_id: e.hook_id,
    data: e as unknown,
    hook_name: e.hook_name,
    stdout: e.stdout,
    stderr: e.stderr,
    exit_code: e.exit_code,
  } as unknown as HookEvent);
};

export const reduceHookCallback: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "hook_callback" }>;
  store.hookEvents = _appendCapped(store.hookEvents, {
    type: e.type,
    hook_id: e.hook_id,
    data: e as unknown,
    request_id: e.request_id,
    status: e.hook_event === "PreToolUse" ? "hook_pending" : "allowed",
  } as unknown as HookEvent);
};
