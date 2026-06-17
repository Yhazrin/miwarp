/**
 * auth_status reducer.
 *
 * One-line store write. No ctx involvement.
 */
import type { BusEvent } from "$lib/types";
import type { Reducer } from "./types";

export const reduceAuthStatus: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "auth_status" }>;
  store.authStatus = { is_authenticating: e.is_authenticating, output: e.output ?? [] };
};
