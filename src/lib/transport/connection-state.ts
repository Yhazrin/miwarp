/**
 * Connection state machine for WebSocket transport.
 *
 * States: idle → connecting → open → reconnecting → auth_failed → closed → disposed
 *
 * All state transitions are centralized here. Consumers subscribe to changes.
 * Scattered booleans (shouldReconnect, connectPromise, etc.) are eliminated.
 */

import { dbg, dbgWarn } from "$lib/utils/debug";

export const ConnectionState = {
  Idle: "idle",
  Connecting: "connecting",
  Open: "open",
  Reconnecting: "reconnecting",
  AuthFailed: "auth_failed",
  Closed: "closed",
  Disposed: "disposed",
} as const;

export type ConnectionStateValue = (typeof ConnectionState)[keyof typeof ConnectionState];

export type ConnectionStateListener = (
  state: ConnectionStateValue,
  previous: ConnectionStateValue,
) => void;

/** Typed errors for connection lifecycle.
 *  Unified shape: `{ code, message, data, retryable }`.
 *  `retryable` tells callers whether reconnecting / retrying the same call
 *  could succeed — connection glitches are retryable; auth failures and
 *  disposed transports are not.
 */
export class TransportError extends Error {
  readonly code: string;
  readonly data?: unknown;
  readonly retryable: boolean;

  constructor(message: string, code: string, data?: unknown, retryable = true) {
    super(message);
    this.name = "TransportError";
    this.code = code;
    this.data = data;
    this.retryable = retryable;
  }
}

export class IpcTimeoutError extends TransportError {
  constructor(cmd: string, timeoutMs: number) {
    super(`IPC_TIMEOUT: ${cmd} did not respond in ${timeoutMs}ms`, "IPC_TIMEOUT", {
      cmd,
      timeoutMs,
    });
    this.name = "IpcTimeoutError";
  }
}

export class ConnectionTimeoutError extends TransportError {
  constructor(timeoutMs: number) {
    super(`Connection timed out after ${timeoutMs}ms`, "CONNECTION_TIMEOUT");
    this.name = "ConnectionTimeoutError";
  }
}

export class ConnectionFailedError extends TransportError {
  constructor(message = "WebSocket connection failed", data?: unknown) {
    super(message, "CONNECTION_FAILED", data);
    this.name = "ConnectionFailedError";
  }
}

export class ConnectionClosedError extends TransportError {
  constructor(code: number, reason?: string) {
    super(`WebSocket closed (code ${code})${reason ? `: ${reason}` : ""}`, "CONNECTION_CLOSED", {
      code,
      reason,
    });
    this.name = "ConnectionClosedError";
  }
}

export class AuthFailureError extends TransportError {
  constructor(code: number, reason?: string) {
    super(
      `Authentication failed (code ${code}): ${reason ?? "unknown"}`,
      "AUTH_FAILURE",
      { code, reason },
      false,
    );
    this.name = "AuthFailureError";
  }
}

export class DisposedError extends TransportError {
  constructor() {
    super("Transport has been disposed", "DISPOSED", undefined, false);
    this.name = "DisposedError";
  }
}

export class NotConnectedError extends TransportError {
  constructor() {
    super("WebSocket is not connected", "NOT_CONNECTED");
    this.name = "NotConnectedError";
  }
}

/** Valid state transitions — anything else is a no-op + warning */
const VALID_TRANSITIONS: Record<ConnectionStateValue, ConnectionStateValue[]> = {
  [ConnectionState.Idle]: [ConnectionState.Connecting, ConnectionState.Disposed],
  [ConnectionState.Connecting]: [
    ConnectionState.Open,
    ConnectionState.Closed,
    ConnectionState.AuthFailed,
    ConnectionState.Disposed,
  ],
  [ConnectionState.Open]: [
    ConnectionState.Reconnecting,
    ConnectionState.Closed,
    ConnectionState.Disposed,
  ],
  [ConnectionState.Reconnecting]: [
    ConnectionState.Connecting,
    ConnectionState.Closed,
    ConnectionState.AuthFailed,
    ConnectionState.Disposed,
  ],
  [ConnectionState.AuthFailed]: [ConnectionState.Disposed],
  [ConnectionState.Closed]: [
    ConnectionState.Connecting,
    ConnectionState.Reconnecting,
    ConnectionState.Disposed,
  ],
  [ConnectionState.Disposed]: [],
};

export class ConnectionStateMachine {
  private _state: ConnectionStateValue = ConnectionState.Idle;
  private listeners = new Set<ConnectionStateListener>();
  private _generation = 0;

  get state(): ConnectionStateValue {
    return this._state;
  }

  /** Generation counter — increments on each new connection attempt. Used to invalidate stale callbacks. */
  get generation(): number {
    return this._generation;
  }

  /** Whether the machine can initiate a connection right now */
  get canConnect(): boolean {
    return (
      this._state === ConnectionState.Idle ||
      this._state === ConnectionState.Closed ||
      this._state === ConnectionState.Reconnecting
    );
  }

  /** Whether the machine can reconnect (not auth-failed, not disposed) */
  get canReconnect(): boolean {
    return this._state === ConnectionState.Closed || this._state === ConnectionState.Reconnecting;
  }

  subscribe(listener: ConnectionStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  transition(to: ConnectionStateValue): boolean {
    const from = this._state;
    if (from === to) return true;
    if (!VALID_TRANSITIONS[from].includes(to)) {
      dbgWarn("transport", "connectionState.invalidTransition", { from, to });
      return false;
    }
    this._state = to;
    if (to === ConnectionState.Connecting) {
      this._generation++;
    }
    dbg("transport", "connectionState.transition", { from, to, generation: this._generation });
    for (const listener of this.listeners) {
      try {
        listener(to, from);
      } catch (e) {
        dbgWarn("transport", "connectionState.listenerError", { error: e });
      }
    }
    return true;
  }

  /** Reset to idle for reuse (only if not disposed) */
  reset(): void {
    if (this._state === ConnectionState.Disposed) return;
    this._state = ConnectionState.Idle;
    this._generation = 0;
    this.listeners.clear();
  }
}
