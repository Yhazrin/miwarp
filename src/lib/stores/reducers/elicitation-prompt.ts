/**
 * elicitation_prompt reducer.
 *
 * Stores an MCP elicitation request in the store's `pendingElicitations` map,
 * keyed by request_id. The reducer is idempotent — re-sending the same
 * request_id overwrites the prior entry.
 */
import type { BusEvent } from "$lib/types";
import { dbg } from "$lib/utils/debug";
import type { Reducer } from "./types";

export const reduceElicitationPrompt: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "elicitation_prompt" }>;
  dbg("store", "elicitation_prompt received", {
    request_id: e.request_id,
    server: e.mcp_server_name,
    mode: e.mode,
  });
  const updated = new Map(store.pendingElicitations);
  updated.set(e.request_id, {
    requestId: e.request_id,
    mcpServerName: e.mcp_server_name,
    message: e.message,
    elicitationId: e.elicitation_id ?? "",
    mode: e.mode,
    url: e.url,
    requestedSchema: e.requested_schema,
  });
  store.pendingElicitations = updated;
};
