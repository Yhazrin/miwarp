/**
 * system_status reducer.
 *
 * One-line store write. No ctx involvement — systemStatus is display-only.
 */
import type { BusEvent } from "$lib/types";
import type { Reducer } from "./types";

export const reduceSystemStatus: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "system_status" }>;
  store.systemStatus = { status: e.status ?? "" };
};
