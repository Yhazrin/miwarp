/**
 * SendCoordinator: explicit state machine for "user pressed Send → agent
 * acknowledges receipt". Solves the v1.0.9 P1 defect "send appears to do
 * nothing until refresh" by:
 *
 *   1. Holding a single-flight in-flight slot per `clientMessageId`. The
 *      caller is allowed concurrent submits for the same `runId` — the
 *      coordinator tracks each independently — but the slot key is the
 *      client message id, not the run, so two simultaneous sends never
 *      overwrite one another and a retry does not collide with the
 *      original.
 *   2. Capturing run identity at submit time so a session switch during
 *      the IPC round-trip cannot cross-route the optimistic timeline
 *      entry or the eventual retry. When a newer submit for the same
 *      `runId` appears mid-flight, the older submit is marked stale.
 *   3. Distinguishing submit-accepted (transport promise resolved) from
 *      transport-available (connection up). The user-visible "draft" is
 *      cleared only after the backend confirms receipt.
 *   4. Surfacing a typed failure with retry capability instead of letting
 *      the draft silently disappear. Cancellation reasons are preserved
 *      so the UI can show the right Retry vs. switch-session message.
 *   5. Emitting a single-shot completion event (one terminal transition
 *      per submit) so retry handlers and draft-restoration logic don't
 *      double-fire.
 *
 * The coordinator does NOT know about the prompt input store directly.
 * The caller retains ownership of the draft and decides when to clear
 * it, using `subscribe()` to learn when a submit has been accepted vs.
 * failed.
 */
import { uuid } from "$lib/utils/uuid";
import { dbg, dbgWarn } from "$lib/utils/debug";

export type SendState = "idle" | "submitting" | "accepted" | "queued" | "failed";

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
   * failure (timeout, disconnected, rejection, etc.).
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
}

export interface SendStatusEvent {
  state: SendState;
  runId: string;
  clientMessageId: string;
  cause: SendSubmitOptions["cause"];
  /** Set on the `failed` transition. */
  error?: SendFailure;
}

export type SendListener = (event: SendStatusEvent) => void;

export interface SendFailure {
  code:
    | "transport_unavailable"
    | "stale_identity"
    | "rejected"
    | "timeout"
    | "duplicate"
    | "unknown";
  message: string;
  /** Whether the caller may safely retry without dedupe concerns. */
  retryable: boolean;
  /** Original cause for logging (never the user content). */
  cause?: string;
}

/**
 * Per-coordinator internal record of a single submit.
 */
interface InFlightRecord {
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
}

export interface SendCoordinatorOptions {
  /** How long before an in-flight submit is considered stale (ms). */
  submitTimeoutMs?: number;
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
}

const DEFAULT_SUBMIT_TIMEOUT_MS = 60_000;

export class SendCoordinator {
  /** Keyed by clientMessageId so concurrent submits do not overwrite each other. */
  private readonly inFlight = new Map<string, InFlightRecord>();
  /** Set of clientMessageIds that have been explicitly acknowledged. */
  private readonly acknowledged = new Set<string>();
  private listeners = new Set<SendListener>();
  private generation = 0;
  private readonly submitTimeoutMs: number;
  private readonly onFailure?: SendCoordinatorOptions["onFailure"];
  private readonly onAccepted?: SendCoordinatorOptions["onAccepted"];

  constructor(options: SendCoordinatorOptions = {}) {
    this.submitTimeoutMs = options.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    this.onFailure = options.onFailure;
    this.onAccepted = options.onAccepted;
  }

  /**
   * Whether any submit is currently in flight. Used by the UI to gate
   * the send button without coupling it to a specific record.
   */
  get busy(): boolean {
    return this.inFlight.size > 0;
  }

  /**
   * Whether the coordinator is currently submitting for the given runId.
   */
  isSubmitting(runId?: string): boolean {
    if (!runId) return this.busy;
    for (const record of this.inFlight.values()) {
      if (record.runId === runId && record.state === "submitting") return true;
    }
    return false;
  }

  /**
   * Whether any submit for the given runId is still in flight (submitting
   * or queued). Once a submit is accepted/failed, it leaves the in-flight
   * set, so this returns false.
   */
  hasInFlight(runId?: string): boolean {
    if (!runId) return this.busy;
    for (const record of this.inFlight.values()) {
      if (record.runId === runId) return true;
    }
    return false;
  }

  /**
   * Subscribe to state transitions. Returns an unsubscribe function.
   * The listener fires once per transition; the caller may receive
   * multiple events for a single submit (e.g. submitting → accepted).
   */
  subscribe(listener: SendListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Submit a user message. Resolves with the client message id on
   * submit-accepted (transport promise resolved). Rejects with a
   * `SendCoordinatorError` on any terminal failure (transport rejection,
   * stale identity, cancellation, abort). The caller should NOT clear
   * the draft on rejection.
   */
  async submit(options: SendSubmitOptions): Promise<{ clientMessageId: string }> {
    const clientMessageId = options.clientMessageId ?? uuid();
    const record: InFlightRecord = {
      runId: options.runId,
      sessionId: options.sessionId ?? null,
      clientMessageId,
      draft: options.draft,
      cause: options.cause ?? "continue",
      state: "submitting",
      generation: ++this.generation,
      settled: false,
    };
    this.inFlight.set(clientMessageId, record);

    this.emit({
      state: "submitting",
      runId: record.runId,
      clientMessageId,
      cause: record.cause,
    });

    dbg("send", "submit.start", {
      runId: record.runId,
      clientMessageId,
      cause: record.cause,
      generation: record.generation,
    });

    try {
      await options.transport(clientMessageId);
    } catch (rawError) {
      if (record.settled) {
        // We were cancelled or aborted while the transport was awaiting.
        // Re-throw the captured failure so the rejection shape stays
        // consistent and the original reason is preserved.
        throw new SendCoordinatorError(
          record.failure ?? {
            code: "stale_identity",
            message: "Submit was cancelled",
            retryable: false,
          },
        );
      }
      const failure = toSendFailure(rawError);
      this.transitionToFailed(record, failure, "transport rejected");
      throw new SendCoordinatorError(failure);
    }

    // If the submit was cancelled/aborted while the transport promise was
    // pending, surface the captured failure rather than the generic
    // stale_identity below. Cancellation reasons (e.g. "user switched
    // session") must reach the caller verbatim. The caller signals a
    // session switch via `cancelForRun(runId)`; if they forgot, the
    // submit accepts on the run that was active at click time.
    if (record.settled) {
      throw new SendCoordinatorError(
        record.failure ?? {
          code: "stale_identity",
          message: "Submit was cancelled",
          retryable: false,
        },
      );
    }

    this.transitionToAccepted(record);
    dbg("send", "submit.accepted", {
      runId: record.runId,
      clientMessageId,
      cause: record.cause,
    });
    return { clientMessageId };
  }

  /**
   * Mark the submit as queued. The caller (e.g. browser transport) may
   * use this to indicate the message is held in the transport buffer
   * waiting for the connection to come back. We intentionally do NOT
   * promise resolution: a queued submit that is never delivered stays
   * in-flight until the user retries or the run is abandoned.
   */
  markQueued(runId: string, clientMessageId?: string): boolean {
    const record = this.findRecord(runId, clientMessageId);
    if (!record || record.state !== "submitting" || record.settled) return false;
    record.state = "queued";
    this.emit({
      state: "queued",
      runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
    });
    return true;
  }

  /**
   * Acknowledge the submit as fully accepted by the backend (agent will
   * receive it). Idempotent: subsequent calls with the same
   * `clientMessageId` return true. With no `clientMessageId` the first
   * matching record is acknowledged.
   */
  acknowledge(runId: string, clientMessageId?: string): boolean {
    const record = this.findRecord(runId, clientMessageId);
    if (record) {
      if (clientMessageId && record.clientMessageId !== clientMessageId) return false;
      if (record.settled) {
        // already settled — still ack idempotent
        this.acknowledged.add(record.clientMessageId);
        return true;
      }
      record.settled = true;
      record.state = "accepted";
      this.inFlight.delete(record.clientMessageId);
      this.acknowledged.add(record.clientMessageId);
      return true;
    }
    // Already settled and removed — was it us?
    if (clientMessageId && this.acknowledged.has(clientMessageId)) return true;
    return false;
  }

  /**
   * Abort a submit (e.g. session was killed). Surfaces a failed
   * transition so the UI can restore the draft.
   */
  abort(runId: string, reason: string, clientMessageId?: string): void {
    const record = this.findRecord(runId, clientMessageId);
    if (!record || record.settled) return;
    this.transitionToFailed(
      record,
      {
        code: "unknown",
        message: reason,
        retryable: false,
        cause: "aborted",
      },
      "aborted",
    );
  }

  /**
   * Cancel any in-flight submits for a run. Used when the run is
   * disposed (closed, replaced by another run, etc.).
   */
  cancelForRun(runId: string, reason = "Run disposed", clientMessageId?: string): void {
    const record = this.findRecord(runId, clientMessageId);
    if (!record || record.settled) return;
    this.transitionToFailed(
      record,
      {
        code: "stale_identity",
        message: reason,
        retryable: false,
      },
      "cancelled",
    );
  }

  /**
   * Drop any in-flight submit whose runId no longer matches the active
   * run. Returns the number of records dropped.
   */
  reconcileActiveRun(activeRunId: string | null | undefined): number {
    if (!activeRunId) {
      const count = this.inFlight.size;
      for (const record of this.inFlight.values()) {
        this.transitionToFailed(
          record,
          {
            code: "stale_identity",
            message: "Active run lost",
            retryable: false,
          },
          "reconcile",
        );
      }
      return count;
    }
    let dropped = 0;
    for (const [clientId, record] of this.inFlight) {
      if (record.runId !== activeRunId) {
        this.transitionToFailed(
          record,
          {
            code: "stale_identity",
            message: "Active run switched",
            retryable: false,
          },
          "reconcile",
        );
        dropped++;
        // Defensive: iteration over a mutating map; safe because we are
        // deleting the current entry, but skip the deleted one.
        this.inFlight.delete(clientId);
      }
    }
    return dropped;
  }

  /**
   * Dispose the coordinator. Drops all listeners. In-flight records
   * are not transitioned (caller is expected to dispose the store
   * synchronously).
   */
  dispose(): void {
    this.listeners.clear();
    this.inFlight.clear();
    this.acknowledged.clear();
  }

  /**
   * Test helper: snapshot current in-flight state. Not exported on
   * the public API surface; used by `send-coordinator.test.ts`.
   */
  _debugSnapshot(): { runId: string; state: SendState; clientMessageId: string }[] {
    return Array.from(this.inFlight.values()).map((r) => ({
      runId: r.runId,
      state: r.state,
      clientMessageId: r.clientMessageId,
    }));
  }

  private findRecord(runId: string, clientMessageId?: string): InFlightRecord | undefined {
    if (clientMessageId) {
      const record = this.inFlight.get(clientMessageId);
      if (record && record.runId === runId) return record;
      return undefined;
    }
    for (const record of this.inFlight.values()) {
      if (record.runId === runId) return record;
    }
    return undefined;
  }

  private transitionToAccepted(record: InFlightRecord): void {
    if (record.settled) return;
    record.settled = true;
    record.state = "accepted";
    this.inFlight.delete(record.clientMessageId);
    this.acknowledged.add(record.clientMessageId);
    const event: SendStatusEvent = {
      state: "accepted",
      runId: record.runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
    };
    this.onAccepted?.(event);
    this.emit(event);
  }

  private transitionToFailed(record: InFlightRecord, failure: SendFailure, label: string): void {
    if (record.settled) return;
    record.settled = true;
    record.state = "failed";
    record.failure = failure;
    this.inFlight.delete(record.clientMessageId);
    this.acknowledged.add(record.clientMessageId);
    const event: SendStatusEvent = {
      state: "failed",
      runId: record.runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      error: failure,
    };
    dbgWarn("send", "submit.failed", {
      runId: record.runId,
      clientMessageId: record.clientMessageId,
      cause: record.cause,
      code: failure.code,
      retryable: failure.retryable,
      label,
    });
    this.onFailure?.(event);
    this.emit(event);
  }

  private emit(event: SendStatusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        dbgWarn("send", "listener.error", { error: e });
      }
    }
  }
}

/**
 * Public Error subclass that carries the structured failure.
 */
export class SendCoordinatorError extends Error {
  readonly failure: SendFailure;
  constructor(failure: SendFailure) {
    super(failure.message);
    this.name = "SendCoordinatorError";
    this.failure = failure;
  }
}

function toSendFailure(raw: unknown): SendFailure {
  if (raw instanceof SendCoordinatorError) return raw.failure;
  if (raw instanceof Error) {
    const message = raw.message || raw.name || "Transport error";
    if (/timeout/i.test(raw.name) || /timeout/i.test(message)) {
      return { code: "timeout", message, retryable: true, cause: raw.name };
    }
    if (
      /not.?connected/i.test(message) ||
      /reconnect/i.test(message) ||
      /websocket/i.test(message) ||
      /disposed/i.test(raw.name)
    ) {
      return {
        code: "transport_unavailable",
        message,
        retryable: true,
        cause: raw.name,
      };
    }
    if (/stale.?identity|identity.?changed/i.test(message)) {
      return { code: "stale_identity", message, retryable: false, cause: raw.name };
    }
    if (/actor.?dead|not.?found|unknown.?run|rejected/i.test(message)) {
      return { code: "rejected", message, retryable: false, cause: raw.name };
    }
    return { code: "unknown", message, retryable: true, cause: raw.name };
  }
  return { code: "unknown", message: String(raw), retryable: true };
}
