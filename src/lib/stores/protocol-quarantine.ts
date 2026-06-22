import { isKnownBusEventType } from "$lib/bus/known-event-types";
import { dbgWarn } from "$lib/utils/debug";

/** Align with backend `PROTOCOL_DESYNC_THRESHOLD` (session_actor/constants.rs). */
export const PROTOCOL_ERROR_THRESHOLD = 5;

/** Consecutive invariant errors before requesting a soft timeline recover. */
export const PROTOCOL_RECOVER_THRESHOLD = PROTOCOL_ERROR_THRESHOLD;

/** Consecutive invariant errors before requesting a full run reload. */
export const PROTOCOL_FULL_RELOAD_THRESHOLD = PROTOCOL_ERROR_THRESHOLD + 3;

/** Consecutive invariant errors before entering terminate (stop applying). */
export const PROTOCOL_TERMINATE_THRESHOLD = PROTOCOL_ERROR_THRESHOLD * 2;

/** Backend-emitted recovery signals — always pass through to UI/store. */
export const PROTOCOL_RECOVERY_EVENT_TYPES = new Set([
  "session_recovering",
  "session_recovered",
  "protocol_desync",
]);

export type ProtocolErrorCategory = "ignorable" | "invariant" | "apply_failure";

export type ProtocolErrorKind =
  | "malformed_json"
  | "malformed_payload"
  | "unknown_event_type"
  | "wrong_run_id"
  | "seq_regression"
  | "duplicate_seq"
  | "apply_throw"
  | "consecutive_threshold"
  | "backend_desync";

export type ProtocolQuarantinePhase = "healthy" | "degraded" | "quarantined" | "terminated";

export type ProtocolQuarantineAction = "pass" | "drop" | "recover" | "full_reload" | "terminate";

export interface ProtocolErrorEvidence {
  kind: ProtocolErrorKind;
  eventType: string;
  /** Sanitized detail — never includes user text, tool output, or raw payloads. */
  detail: string;
  atMs: number;
}

export interface RunProtocolQuarantineState {
  phase: ProtocolQuarantinePhase;
  consecutiveInvariantErrors: number;
  recoverAttempted: boolean;
  lastError: ProtocolErrorEvidence | null;
}

export interface ProtocolInspectInput {
  runId: string;
  subscribedRunId: string;
  payload: unknown;
  lastSeq: number;
}

export interface ProtocolInspectResult {
  action: ProtocolQuarantineAction;
  category?: ProtocolErrorCategory;
  evidence?: ProtocolErrorEvidence;
  state: RunProtocolQuarantineState;
}

export interface ParsedBusEnvelope {
  type: string;
  runId: string;
  seq: number;
}

export interface ParseBusEnvelopeResult {
  ok: true;
  envelope: ParsedBusEnvelope;
}

export interface ParseBusEnvelopeError {
  ok: false;
  kind: ProtocolErrorKind;
  detail: string;
}

export type ParseBusEnvelopeOutcome = ParseBusEnvelopeResult | ParseBusEnvelopeError;

/** Parse raw WebSocket/Tauri JSON without logging sensitive payload content. */
export function parseRawBusJson(raw: string): ParseBusEnvelopeOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, kind: "malformed_json", detail: "invalid JSON" };
  }
  return parseBusEnvelope(parsed);
}

/** Structural envelope check — type + run_id required; seq optional. */
export function parseBusEnvelope(payload: unknown): ParseBusEnvelopeOutcome {
  if (!payload || typeof payload !== "object") {
    return { ok: false, kind: "malformed_payload", detail: "payload is not an object" };
  }
  const record = payload as Record<string, unknown>;
  const type = record.type;
  const runId = record.run_id;
  if (typeof type !== "string" || !type) {
    return { ok: false, kind: "malformed_payload", detail: "missing type" };
  }
  if (typeof runId !== "string" || !runId) {
    return { ok: false, kind: "malformed_payload", detail: "missing run_id" };
  }
  const seqRaw = record._seq;
  const seq = typeof seqRaw === "number" && Number.isFinite(seqRaw) ? seqRaw : 0;
  return { ok: true, envelope: { type, runId, seq } };
}

export function sanitizeProtocolEvidence(
  kind: ProtocolErrorKind,
  eventType: string,
  meta: Record<string, string | number> = {},
): ProtocolErrorEvidence {
  let detail: string;
  switch (kind) {
    case "malformed_json":
      detail = "invalid JSON";
      break;
    case "malformed_payload":
      detail = meta.reason ? String(meta.reason) : "malformed payload";
      break;
    case "unknown_event_type":
      detail = `unknown type: ${eventType || "?"}`;
      break;
    case "wrong_run_id":
      detail = "run_id mismatch";
      break;
    case "seq_regression":
      detail = `seq ${meta.seq} < last ${meta.lastSeq}`;
      break;
    case "duplicate_seq":
      detail = `duplicate seq ${meta.seq}`;
      break;
    case "apply_throw":
      detail = "event apply failed";
      break;
    case "consecutive_threshold":
      detail = `consecutive errors ${meta.count}`;
      break;
    case "backend_desync":
      detail = "backend protocol desync";
      break;
    default:
      detail = kind;
  }
  return { kind, eventType, detail, atMs: Date.now() };
}

function defaultRunState(): RunProtocolQuarantineState {
  return {
    phase: "healthy",
    consecutiveInvariantErrors: 0,
    recoverAttempted: false,
    lastError: null,
  };
}

/**
 * Per-run protocol quarantine coordinator. Sits ahead of SessionStore apply
 * to classify ignorable unknowns vs invariant-breaking events and escalate
 * recover → full_reload → terminate with a bounded consecutive counter that
 * resets on successful applies.
 */
export class ProtocolQuarantineCoordinator {
  private readonly runs = new Map<string, RunProtocolQuarantineState>();

  getState(runId: string): RunProtocolQuarantineState {
    return this.runs.get(runId) ?? defaultRunState();
  }

  reset(runId: string): void {
    this.runs.delete(runId);
  }

  resetAll(): void {
    this.runs.clear();
  }

  inspect(input: ProtocolInspectInput): ProtocolInspectResult {
    const state = this.ensureRun(input.runId);

    if (input.payload && typeof input.payload === "object") {
      const type = (input.payload as Record<string, unknown>).type;
      if (typeof type === "string" && PROTOCOL_RECOVERY_EVENT_TYPES.has(type)) {
        if (type === "session_recovered") {
          const ok = (input.payload as Record<string, unknown>).ok;
          if (ok === true) {
            this.reset(input.runId);
            return { action: "pass", state: defaultRunState() };
          }
        }
        if (type === "protocol_desync") {
          this.enterTerminated(
            input.runId,
            sanitizeProtocolEvidence("backend_desync", "protocol_desync"),
          );
          return {
            action: "terminate",
            category: "invariant",
            evidence: this.getState(input.runId).lastError ?? undefined,
            state: this.getState(input.runId),
          };
        }
        return { action: "pass", state: this.getState(input.runId) };
      }
    }

    const parsed = parseBusEnvelope(input.payload);
    if (!parsed.ok) {
      return this.recordInvariant(input.runId, parsed.kind, "", parsed.detail);
    }

    const { type, runId: eventRunId, seq } = parsed.envelope;

    if (eventRunId !== input.subscribedRunId) {
      return this.recordInvariant(input.runId, "wrong_run_id", type);
    }

    if (seq > 0 && input.lastSeq > 0 && seq < input.lastSeq) {
      return this.recordInvariant(input.runId, "seq_regression", type, undefined, {
        seq,
        lastSeq: input.lastSeq,
      });
    }

    if (seq > 0 && seq === input.lastSeq) {
      const evidence = sanitizeProtocolEvidence("duplicate_seq", type, { seq });
      dbgWarn("protocol-quarantine", "drop duplicate seq", {
        runId: input.runId,
        eventType: type,
        detail: evidence.detail,
      });
      return { action: "drop", category: "ignorable", evidence, state };
    }

    if (!isKnownBusEventType(type)) {
      const evidence = sanitizeProtocolEvidence("unknown_event_type", type);
      dbgWarn("protocol-quarantine", "drop ignorable unknown", {
        runId: input.runId,
        eventType: type,
        detail: evidence.detail,
      });
      return { action: "drop", category: "ignorable", evidence, state };
    }

    // Structural validity alone is not success: the reducer may still reject
    // this event. The middleware calls recordApplySuccess only after the Store
    // has applied the event or batch without throwing.
    return { action: "pass", state: this.getState(input.runId) };
  }

  recordApplySuccess(runId: string): void {
    this.recordSuccess(runId);
  }

  recordApplyFailure(runId: string, eventType: string): ProtocolInspectResult {
    return this.recordInvariant(runId, "apply_throw", eventType);
  }

  private ensureRun(runId: string): RunProtocolQuarantineState {
    let state = this.runs.get(runId);
    if (!state) {
      state = defaultRunState();
      this.runs.set(runId, state);
    }
    return state;
  }

  private recordSuccess(runId: string): void {
    this.runs.set(runId, defaultRunState());
  }

  private enterTerminated(runId: string, evidence: ProtocolErrorEvidence): void {
    const state = this.ensureRun(runId);
    state.phase = "terminated";
    state.lastError = evidence;
    state.consecutiveInvariantErrors = Math.max(
      state.consecutiveInvariantErrors,
      PROTOCOL_TERMINATE_THRESHOLD,
    );
    dbgWarn("protocol-quarantine", "terminated", {
      runId,
      eventType: evidence.eventType,
      detail: evidence.detail,
    });
  }

  private recordInvariant(
    runId: string,
    kind: ProtocolErrorKind,
    eventType: string,
    detailOverride?: string,
    meta: Record<string, string | number> = {},
  ): ProtocolInspectResult {
    const state = this.ensureRun(runId);
    if (state.phase === "terminated") {
      const evidence =
        state.lastError ??
        sanitizeProtocolEvidence(kind, eventType, {
          ...meta,
          ...(detailOverride !== undefined ? { reason: detailOverride } : {}),
        });
      return { action: "terminate", category: "invariant", evidence, state };
    }

    state.consecutiveInvariantErrors += 1;
    const evidence = sanitizeProtocolEvidence(kind, eventType, {
      ...meta,
      ...(detailOverride !== undefined ? { reason: detailOverride } : {}),
      count: state.consecutiveInvariantErrors,
    });
    state.lastError = evidence;

    if (state.consecutiveInvariantErrors >= PROTOCOL_TERMINATE_THRESHOLD) {
      state.phase = "terminated";
      dbgWarn("protocol-quarantine", "terminate threshold", {
        runId,
        eventType,
        detail: evidence.detail,
        count: state.consecutiveInvariantErrors,
      });
      return { action: "terminate", category: "invariant", evidence, state };
    }

    if (
      state.consecutiveInvariantErrors >= PROTOCOL_FULL_RELOAD_THRESHOLD ||
      (state.recoverAttempted && state.consecutiveInvariantErrors >= PROTOCOL_RECOVER_THRESHOLD)
    ) {
      state.phase = "quarantined";
      dbgWarn("protocol-quarantine", "full reload threshold", {
        runId,
        eventType,
        detail: evidence.detail,
        count: state.consecutiveInvariantErrors,
      });
      return { action: "full_reload", category: "invariant", evidence, state };
    }

    if (state.consecutiveInvariantErrors >= PROTOCOL_RECOVER_THRESHOLD) {
      state.phase = "quarantined";
      state.recoverAttempted = true;
      dbgWarn("protocol-quarantine", "recover threshold", {
        runId,
        eventType,
        detail: evidence.detail,
        count: state.consecutiveInvariantErrors,
      });
      return { action: "recover", category: "invariant", evidence, state };
    }

    state.phase = "degraded";
    dbgWarn("protocol-quarantine", "degraded drop", {
      runId,
      eventType,
      detail: evidence.detail,
      count: state.consecutiveInvariantErrors,
    });
    return { action: "drop", category: "invariant", evidence, state };
  }
}
