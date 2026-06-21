/**
 * Failure classification for {@link SendCoordinator}.
 *
 * `SendCoordinatorError` is the surfaced promise rejection; `toSendFailure`
 * is the rule used to map raw transport errors into a {@link SendFailure}.
 * The classifier recognises five commonly-seen shapes:
 *
 *   - timeout           → retryable, code `timeout`
 *   - transport down    → retryable, code `transport_unavailable`
 *   - identity changed  → NOT retryable, code `stale_identity`
 *   - generation stale  → retryable, code `stale_generation`
 *   - actor rejected    → NOT retryable, code `rejected`
 *
 * Anything else maps to `unknown` (retryable by default — callers should
 * re-attempt once and surface to the user if it keeps failing).
 */
import type { SendFailure } from "./types";

export class SendCoordinatorError extends Error {
  readonly failure: SendFailure;
  constructor(failure: SendFailure) {
    super(failure.message);
    this.name = "SendCoordinatorError";
    this.failure = failure;
  }
}

export function toSendFailure(raw: unknown): SendFailure {
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
      return { code: "transport_unavailable", message, retryable: true, cause: raw.name };
    }
    if (/stale.?identity|identity.?changed/i.test(message)) {
      return { code: "stale_identity", message, retryable: false, cause: raw.name };
    }
    if (/stale.?generation/i.test(message)) {
      return { code: "stale_generation", message, retryable: true, cause: raw.name };
    }
    if (/actor.?dead|not.?found|unknown.?run|rejected/i.test(message)) {
      return { code: "rejected", message, retryable: false, cause: raw.name };
    }
    return { code: "unknown", message, retryable: true, cause: raw.name };
  }
  return { code: "unknown", message: String(raw), retryable: true };
}
