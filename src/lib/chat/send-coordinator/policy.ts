/**
 * Default policy knobs for {@link SendCoordinator}.
 *
 * Centralised so callers can audit the bounded-map defaults and the TTL
 * in one place. Each default is overridable via the corresponding
 * `SendCoordinatorOptions` field.
 */

export const DEFAULT_SUBMIT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_QUEUED = 32;
export const DEFAULT_MAX_RETRYABLE = 64;
export const DEFAULT_MAX_ACKNOWLEDGED = 512;
export const DEFAULT_QUEUE_TTL_MS = 30_000;
