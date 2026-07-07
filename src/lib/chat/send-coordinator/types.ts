/**
 * Public types and internal record shapes for {@link SendCoordinator}.
 *
 * The coordinator exposes five submit lifecycle states and four transport
 * phase states. Record types are intentionally not exported through the
 * main `send-coordinator` barrel; only the orchestration surface and the
 * status event payloads are part of the public API.
 */
import type { TimeoutApi } from "$lib/transport";

export type SendState =
  | "submitting"
  | "queued"
  | "recovering"
  | "accepted"
  | "failed"
  | "cancelled";

export type TransportPhase = "connected" | "reconnecting" | "recovering" | "disposed";

export interface SendDraft {
  text: string;
  attachments: unknown[];
}

export interface SendSubmitOptions {
  /** The runId the user intended this submit for, captured at click time. */
  runId: string;
  /** Optional session id (for stream sessions). */
  sessionId?: string | null;
  /** Draft snapshot for retry / draft restoration. */
  draft: SendDraft;
  /**
   * The transport-acceptance function. It must resolve on successful
   * delivery to the backend and reject with an Error on transport-level
   * failure (timeout, disconnected, rejection, etc.). It is captured by
   * closure so a queued drain can re-dispatch without the caller
   * re-submitting.
   */
  transport: (clientMessageId: string) => Promise<void>;
  /**
   * Optional override of the client message id. Tests use this to assert
   * idempotency. In production the coordinator generates a UUIDv4.
   */
  clientMessageId?: string;
  /**
   * Optional cause label for the breadcrumb log; helps distinguish start
   * sends from continuation sends without leaking content.
   */
  cause?: "start" | "continue" | "resume" | "retry";
  /**
   * Optional generation captured at click time. The caller may pass the
   * live connection generation when wiring the coordinator against a
   * transport state machine; if omitted, the coordinator uses its own
   * tracked generation (the conservative choice).
   */
  generation?: number;
}

export interface SendStatusEvent {
  state: SendState;
  runId: string;
  clientMessageId: string;
  cause: SendSubmitOptions["cause"];
  generation: number;
  /** Set on the `failed` transition. */
  error?: SendFailure;
  /** Set on the `queued` transition when the queue held the submit. */
  queueDepth?: number;
}

export type SendListener = (event: SendStatusEvent) => void;

export interface TransportPhaseEvent {
  phase: TransportPhase;
  generation: number;
  previousPhase: TransportPhase;
  previousGeneration: number;
  cancelled: number;
}

export type TransportPhaseListener = (event: TransportPhaseEvent) => void;

export interface SendFailure {
  code:
    | "transport_unavailable"
    | "stale_identity"
    | "stale_generation"
    | "rejected"
    | "timeout"
    | "duplicate"
    | "queue_full"
    | "queue_expired"
    | "unknown";
  message: string;
  /** Whether the caller may safely retry without dedupe concerns. */
  retryable: boolean;
  /** Original cause for logging (never the user content). */
  cause?: string;
}

export interface SendCoordinatorOptions {
  /** How long before an in-flight submit is considered stale (ms). */
  submitTimeoutMs?: number;
  /** Maximum queued entries held while transport is unhealthy. */
  maxQueued?: number;
  /** Maximum retryable records retained for `retry()`. */
  maxRetryable?: number;
  /** Maximum acknowledged ids retained for idempotency checks. */
  maxAcknowledged?: number;
  /** Per-queue-entry TTL in ms. Default 30 000. */
  queueTtlMs?: number;
  /** Initial connection generation. Defaults to 0. */
  initialGeneration?: number;
  /** Initial transport phase. Defaults to `connected`. */
  initialPhase?: TransportPhase;
  /** Injectable timer API for tests. Defaults to `systemTimers`. */
  timers?: TimeoutApi;
  /** Optional UUID factory (overridable for tests). */
  uuid?: () => string;
  /**
   * Hook invoked on the first failed transition of a submit. Allows the
   * UI to surface a retry CTA without coupling the coordinator to the
   * toast layer.
   */
  onFailure?: (event: SendStatusEvent) => void;
  /**
   * Hook invoked on the first accepted transition of a submit. The
   * caller can use this to clear the draft.
   */
  onAccepted?: (event: SendStatusEvent) => void;
  /**
   * Hook invoked whenever the transport phase changes (including on
   * generation bumps). Lets the UI surface "reconnecting…" notices.
   */
  onTransportPhase?: (event: TransportPhaseEvent) => void;
}

export interface InFlightRecord {
  runId: string;
  sessionId: string | null;
  clientMessageId: string;
  draft: SendDraft;
  cause: SendSubmitOptions["cause"];
  state: SendState;
  generation: number;
  /** Has this submit already emitted a terminal transition? */
  settled: boolean;
  /** Captured failure when a cancellation/abort fired before transport resolved. */
  failure?: SendFailure;
  /** Single promise handed back to every duplicate `submit()` caller. */
  promise: Promise<{ clientMessageId: string }>;
  /** Resolver handed to the transport promise so a queued drain can complete it. */
  resolve: (value: { clientMessageId: string }) => void;
  /** Rejector handed to the transport promise so cancellation can surface a real error. */
  reject: (err: Error) => void;
  /** Transport closure; preserved so `reconcile` can re-dispatch without a new submit. */
  transport: (clientMessageId: string) => Promise<void>;
  /** Timer handle for the queue TTL — cleared on dispose or drain. */
  ttlTimer?: ReturnType<typeof setTimeout>;
  /** Timer handle for the submit timeout — cleared on settle. */
  submitTimeoutTimer?: ReturnType<typeof setTimeout>;
}

export interface RetryableRecord {
  clientMessageId: string;
  runId: string;
  sessionId: string | null;
  draft: SendDraft;
  cause: SendSubmitOptions["cause"];
  generation: number;
  failure: SendFailure;
  transport: (clientMessageId: string) => Promise<void>;
}
