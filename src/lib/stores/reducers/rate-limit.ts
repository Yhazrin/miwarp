/**
 * rate_limit_event reducer.
 *
 * Updates store-only rate-limit telemetry. No ctx involvement because
 * rateLimitStatus/Type/Utilization/ResetsAt are not in ReduceCtx — they
 * are display fields with no replay semantics (live event only).
 */
import type { BusEvent } from "$lib/types";
import { dbg } from "$lib/utils/debug";
import type { Reducer } from "./types";

export const reduceRateLimit: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "rate_limit_event" }>;
  store.rateLimitStatus = e.status;
  store.rateLimitType = e.rate_limit_type ?? "";
  store.rateLimitUtilization = e.utilization ?? null;
  store.rateLimitResetsAt = e.resets_at ?? null;
  dbg("store", "rate_limit_event", {
    status: e.status,
    type: e.rate_limit_type,
    utilization: e.utilization,
  });
};
