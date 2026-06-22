/**
 * Canonical set of BusEvent `type` literals from the frontend/Rust contract.
 * Used by protocol quarantine to distinguish ignorable unknowns from invariant errors.
 *
 * Keep in sync with `src/lib/types.ts` and `src/lib/bus/__tests__/bus-contract.test.ts`.
 */
export const KNOWN_BUS_EVENT_TYPES = new Set<string>([
  "auth_status",
  "command_output",
  "compact_boundary",
  "control_cancelled",
  "elicitation_prompt",
  "files_persisted",
  "hook_callback",
  "hook_progress",
  "hook_response",
  "hook_started",
  "message_complete",
  "message_delta",
  "permission_denied",
  "permission_prompt",
  "protocol_desync",
  "ralph_complete",
  "ralph_iteration",
  "ralph_started",
  "rate_limit_event",
  "raw",
  "run_state",
  "session_init",
  "session_recovered",
  "session_recovering",
  "system_status",
  "task_notification",
  "thinking_delta",
  "tool_end",
  "tool_input_delta",
  "tool_progress",
  "tool_start",
  "tool_use_summary",
  "usage_update",
  "user_message",
]);

export function isKnownBusEventType(type: string): boolean {
  return KNOWN_BUS_EVENT_TYPES.has(type);
}
