import { describe, it, expect, vi } from "vitest";
import {
  ConnectionState,
  ConnectionStateMachine,
  TransportError,
  AuthFailureError,
  DisposedError,
  NotConnectedError,
} from "./connection-state";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

describe("ConnectionStateMachine", () => {
  it("starts in idle state", () => {
    const m = new ConnectionStateMachine();
    expect(m.state).toBe(ConnectionState.Idle);
    expect(m.canConnect).toBe(true);
    expect(m.canReconnect).toBe(false); // idle can't reconnect, only connect
  });

  it("transitions idle → connecting → open", () => {
    const m = new ConnectionStateMachine();
    const listener = vi.fn();
    m.subscribe(listener);

    expect(m.transition(ConnectionState.Connecting)).toBe(true);
    expect(m.state).toBe(ConnectionState.Connecting);
    expect(m.generation).toBe(1);

    expect(m.transition(ConnectionState.Open)).toBe(true);
    expect(m.state).toBe(ConnectionState.Open);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(ConnectionState.Connecting, ConnectionState.Idle);
    expect(listener).toHaveBeenCalledWith(ConnectionState.Open, ConnectionState.Connecting);
  });

  it("rejects invalid transitions", () => {
    const m = new ConnectionStateMachine();
    expect(m.transition(ConnectionState.Open)).toBe(false); // idle → open is invalid
    expect(m.state).toBe(ConnectionState.Idle);
  });

  it("increments generation on each connecting transition", () => {
    const m = new ConnectionStateMachine();
    m.transition(ConnectionState.Connecting);
    expect(m.generation).toBe(1);
    m.transition(ConnectionState.Closed);
    m.transition(ConnectionState.Connecting);
    expect(m.generation).toBe(2);
  });

  it("allows full lifecycle: idle → connecting → open → reconnecting → connecting → open", () => {
    const m = new ConnectionStateMachine();
    m.transition(ConnectionState.Connecting);
    m.transition(ConnectionState.Open);
    m.transition(ConnectionState.Reconnecting);
    m.transition(ConnectionState.Connecting);
    m.transition(ConnectionState.Open);
    expect(m.state).toBe(ConnectionState.Open);
    expect(m.generation).toBe(2);
  });

  it("auth_failed is terminal (can only go to disposed)", () => {
    const m = new ConnectionStateMachine();
    m.transition(ConnectionState.Connecting);
    m.transition(ConnectionState.AuthFailed);
    expect(m.state).toBe(ConnectionState.AuthFailed);
    expect(m.canConnect).toBe(false);
    expect(m.canReconnect).toBe(false);
    expect(m.transition(ConnectionState.Connecting)).toBe(false);
    expect(m.transition(ConnectionState.Disposed)).toBe(true);
  });

  it("disposed is fully terminal", () => {
    const m = new ConnectionStateMachine();
    m.transition(ConnectionState.Disposed);
    expect(m.transition(ConnectionState.Idle)).toBe(false);
    expect(m.state).toBe(ConnectionState.Disposed);
  });

  it("unsubscribe from listener works", () => {
    const m = new ConnectionStateMachine();
    const listener = vi.fn();
    const unsub = m.subscribe(listener);
    m.transition(ConnectionState.Connecting);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    m.transition(ConnectionState.Open);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reset returns to idle and clears listeners", () => {
    const m = new ConnectionStateMachine();
    const listener = vi.fn();
    m.subscribe(listener);
    m.transition(ConnectionState.Connecting);
    m.transition(ConnectionState.Closed);
    expect(listener).toHaveBeenCalledTimes(2);
    m.reset();
    expect(m.state).toBe(ConnectionState.Idle);
    expect(m.generation).toBe(0);
    // Listener was cleared — new transitions don't fire it
    m.transition(ConnectionState.Connecting);
    expect(listener).toHaveBeenCalledTimes(2); // still 2, not 3
  });
});

describe("TransportError hierarchy", () => {
  it("TransportError has code and data", () => {
    const err = new TransportError("test", "TEST_CODE", { foo: "bar" });
    expect(err.message).toBe("test");
    expect(err.code).toBe("TEST_CODE");
    expect(err.data).toEqual({ foo: "bar" });
    expect(err.name).toBe("TransportError");
  });

  it("AuthFailureError has code and data", () => {
    const err = new AuthFailureError(4401, "bad token");
    expect(err.code).toBe("AUTH_FAILURE");
    expect(err.data).toEqual({ code: 4401, reason: "bad token" });
    expect(err.name).toBe("AuthFailureError");
  });

  it("DisposedError", () => {
    const err = new DisposedError();
    expect(err.code).toBe("DISPOSED");
    expect(err.name).toBe("DisposedError");
  });

  it("NotConnectedError", () => {
    const err = new NotConnectedError();
    expect(err.code).toBe("NOT_CONNECTED");
    expect(err.name).toBe("NotConnectedError");
  });
});
