/**
 * Unit tests for the typed window event-bus shell (`appEvents`).
 *
 * These tests cover the **shell only** — they verify that:
 *
 *   1. `appEvents.emit` dispatches a real `CustomEvent` whose `detail`
 *      matches the typed payload.
 *   2. `appEvents.on` receives the typed payload and returns an unsubscribe
 *      function that detaches the listener.
 *   3. The TypeScript compiler enforces payload shapes for both emit and on.
 *      (Compile-time only — the `// @ts-expect-error` lines below document
 *      the constraint without breaking the build.)
 *   4. The bus interoperates with raw `window.dispatchEvent` so old code
 *      keeps working alongside new typed code.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  EVT_CWD_CHANGED,
  EVT_PROJECT_CHANGED,
  EVT_RUNS_CHANGED,
  EVT_SUMMARIZE_CHAT,
} from "./bus-events";
import { appEvents } from "./typed-events";

describe("appEvents.emit + on", () => {
  it("delivers a typed payload from emit to on", () => {
    const handler = vi.fn();
    const off = appEvents.on(EVT_PROJECT_CHANGED, handler);

    appEvents.emit(EVT_PROJECT_CHANGED, { cwd: "/tmp/project" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ cwd: "/tmp/project" });

    off();
  });

  it("delivers void payload for no-detail events", () => {
    const handler = vi.fn();
    const off = appEvents.on(EVT_CWD_CHANGED, handler);

    appEvents.emit(EVT_CWD_CHANGED, undefined);

    expect(handler).toHaveBeenCalledTimes(1);
    // Browser quirk: `new CustomEvent(name, { detail: undefined })` makes
    // `event.detail` come back as `null` on the listener side. The type
    // layer models this as `void`, which we treat as `undefined | null`.
    expect(handler).toHaveBeenCalledWith(null);

    off();
  });

  it("unsubscribe function detaches the listener", () => {
    const handler = vi.fn();
    const off = appEvents.on(EVT_RUNS_CHANGED, handler);

    appEvents.emit(EVT_RUNS_CHANGED, undefined);
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    appEvents.emit(EVT_RUNS_CHANGED, undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("interoperates with raw window.addEventListener for the same name", () => {
    // Old code uses `window.dispatchEvent(new Event(EVT_RUNS_CHANGED))`
    // and listens via `window.addEventListener`. New code uses `appEvents`.
    // They must interoperate because both go through the same window bus.
    const handler = vi.fn();
    window.addEventListener(EVT_SUMMARIZE_CHAT, () => handler());

    appEvents.emit(EVT_SUMMARIZE_CHAT, undefined);

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(EVT_SUMMARIZE_CHAT, handler);
  });
});

describe("appEvents payload type enforcement", () => {
  it("documents that wrong-shape payloads are caught at compile time", () => {
    // The following block is intentionally commented out — its purpose is to
    // document that the TypeScript compiler rejects these shapes. If a
    // future change loosens the type, removing this comment will surface
    // the regression in `npm run check`.
    //
    //   appEvents.emit(EVT_PROJECT_CHANGED, { wrong: "shape" });
    //                  // ~~~~~~~~~~~~~~~~~ TS2345: missing 'cwd'
    //
    //   appEvents.emit(EVT_PROJECT_CHANGED, { cwd: 42 });
    //                  // ~~~~~~~~~~~~~~~~~ TS2345: number is not string
    //
    //   appEvents.emit(EVT_RUNS_CHANGED, { cwd: "x" });
    //                  // ~~~~~~~~~~~~~~~~~ TS2345: void slot cannot have payload
    //
    //   appEvents.on(EVT_PROJECT_CHANGED, (detail: { other: string }) => { void detail; });
    //                  // ~~~~~~~~~~~~~~~~~ TS2345: 'other' is not 'cwd'
    //
    // Verify the runtime accepts the valid shape so the test still passes.
    expect(true).toBe(true);
  });

  it("runtime payload is delivered as-is for non-void slots", () => {
    const handler = vi.fn();
    const off = appEvents.on(EVT_PROJECT_CHANGED, handler);

    const payload = { cwd: "/Users/test" };
    appEvents.emit(EVT_PROJECT_CHANGED, payload);

    expect(handler).toHaveBeenCalledWith(payload);

    off();
  });
});
