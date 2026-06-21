/**
 * PermissionError: a typed rejection surfaced from the coordinator to
 * the caller (UI handler / composable). The wire-format codes must
 * match the Rust `PermissionErrorCode` enum in src-tauri/src/.
 */
import type { PermissionErrorCode, PermissionFailure } from "./types";

export class PermissionError extends Error {
  readonly code: PermissionErrorCode;
  readonly retryable: boolean;

  constructor(failure: PermissionFailure) {
    super(failure.message);
    this.name = "PermissionError";
    this.code = failure.code;
    this.retryable = failure.retryable;
  }
}

export function isPermissionError(value: unknown): value is PermissionError {
  return value instanceof PermissionError;
}

/**
 * Coerce an arbitrary throw value into a typed PermissionFailure. The
 * caller (UI / IPC layer) must NEVER let raw user content (tool input,
 * deny message text, suggestion payloads) leak into `message`; only a
 * terse description of WHAT happened.
 */
export function classifyFailure(
  code: PermissionErrorCode,
  message: string,
  retryable: boolean,
): PermissionFailure {
  return { code, message, retryable };
}
