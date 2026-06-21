/**
 * Public types for {@link PermissionCoordinator}.
 *
 * A permission request has the identity tuple
 * `(runId, requestId, toolName)` plus a captured decision. The
 * coordinator owns the lifecycle from `register` through one terminal
 * transition (`allowed | denied | failed | stale | cancelled`).
 *
 * Decisions capture the user's choice:
 *   - `allow-once`           → run the tool this invocation only
 *   - `allow-with-rules`     → run the tool and remember rules for
 *                              this session (suggestion payload)
 *   - `allow-set-mode`       → run the tool and switch permission mode
 *                              (suggestion payload includes setMode)
 *   - `deny`                 → refuse, continue
 *   - `deny-stop`            → refuse and interrupt the run
 *
 * Permanent allow via `updatedPermissions` is intentionally NOT modeled
 * here. The CLI accepts rules-suggestion in `updatedPermissions` and
 * treats them as session-scoped; backend NEVER_ALLOW_TOOLS forbids
 * permanent allow for plan-mode tools.
 */
import type { PermissionSuggestion } from "$lib/types";

export type PermissionRequestState =
  | "pending"
  | "submitting"
  | "allowed"
  | "denied"
  | "failed"
  | "stale"
  | "cancelled"
  | "expired";

export type PermissionDecisionKind =
  | "allow-once"
  | "allow-with-rules"
  | "allow-set-mode"
  | "deny"
  | "deny-stop";

export interface AllowOnceDecision {
  kind: "allow-once";
  toolInput?: Record<string, unknown>;
}

export interface AllowWithRulesDecision {
  kind: "allow-with-rules";
  rules: PermissionSuggestion[];
  toolInput?: Record<string, unknown>;
}

export interface AllowSetModeDecision {
  kind: "allow-set-mode";
  rules: PermissionSuggestion[];
  toolInput?: Record<string, unknown>;
}

export interface DenyDecision {
  kind: "deny";
  message?: string;
}

export interface DenyStopDecision {
  kind: "deny-stop";
  message?: string;
}

export type PermissionDecision =
  | AllowOnceDecision
  | AllowWithRulesDecision
  | AllowSetModeDecision
  | DenyDecision
  | DenyStopDecision;

export type PermissionBehavior = "allow" | "deny";

/**
 * Typed error codes that both frontend and backend agree on. The wire
 * format on IPC is a string tag plus a human-readable message; the
 * `code` is the contract.
 */
export type PermissionErrorCode =
  | "unknown_request"
  | "already_cancelled"
  | "run_mismatch"
  | "duplicate"
  | "danger_tool_blocked"
  | "transport"
  | "timeout"
  | "unknown";

export interface PermissionFailure {
  code: PermissionErrorCode;
  message: string;
  retryable: boolean;
}

export interface PermissionRequest {
  runId: string;
  requestId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestions?: PermissionSuggestion[];
  receivedAt: number;
}

export interface PermissionEvent {
  state: PermissionRequestState;
  runId: string;
  requestId: string;
  toolName: string;
  decision?: PermissionDecision;
  failure?: PermissionFailure;
  latencyMs?: number;
  /** Generated internally — never trust caller-supplied timestamps. */
  at: number;
}

export type PermissionListener = (event: PermissionEvent) => void;

export interface PermissionRespondOptions {
  /** Identity captured at click time. Required for run-safety. */
  runId: string;
  requestId: string;
  toolName: string;
  /** The decision payload. */
  decision: PermissionDecision;
  /**
   * The transport function. Must resolve on backend ack and reject on
   * transport failure. Captured so a reconcile pass can re-dispatch.
   */
  transport: () => Promise<void>;
  /**
   * Generation captured at click time. Stale responses are dropped
   * without contacting the backend.
   */
  generation?: number;
}

export interface PermissionCoordinatorOptions {
  /**
   * How long an in-flight submit may sit before being abandoned as a
   * transport timeout (ms). Default 10 000.
   */
  submitTimeoutMs?: number;
  /**
   * Bounded retry ledger. Default 16. Used for Retry CTA after a
   * transport failure. Permanent allow is forbidden by backend policy.
   */
  maxRetryable?: number;
  /**
   * Per-call generation override; if absent the coordinator maintains
   * its own counter, bumped by `bumpGeneration()`.
   */
  initialGeneration?: number;
  /** Test seam — inject a timer API. */
  timers?: {
    setTimeout: (handler: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
  };
  /**
   * Listener that fires on the first failed transition. Lets the UI
   * surface a Retry CTA without coupling the coordinator to the toast
   * layer.
   */
  onFailure?: (event: PermissionEvent) => void;
  /**
   * Listener that fires on the first terminal "allowed" or "denied"
   * transition. Lets the caller clear attention flags.
   */
  onResolved?: (event: PermissionEvent) => void;
}

export interface RetryablePermissionRecord {
  runId: string;
  requestId: string;
  toolName: string;
  decision: PermissionDecision;
  failure: PermissionFailure;
  transport: () => Promise<void>;
  generation: number;
}

export interface PermissionSnapshot {
  runId: string;
  requestId: string;
  toolName: string;
  state: PermissionRequestState;
  failure?: PermissionFailure;
  decidedAt?: number;
}
