/**
 * Tests for the centralized timing constants.
 *
 * The constants are pure values; the tests assert the *contracts* between
 * related constants (e.g. WS reconnect max > base, debounce < timeout).
 * Future tweaks that violate these contracts will fail here.
 */
import { describe, expect, it } from "vitest";
import * as T from "../timing";

describe("timing constants", () => {
  it("WS reconnect: max must be >= base", () => {
    expect(T.WS_RECONNECT_MAX_MS).toBeGreaterThanOrEqual(T.WS_RECONNECT_BASE_MS);
  });

  it("session timeouts: response must be >= spawn", () => {
    // A response can't time out before the spawn does.
    expect(T.SESSION_RESPONSE_TIMEOUT_MS).toBeGreaterThanOrEqual(T.SESSION_SPAWN_TIMEOUT_MS);
  });

  it("debounces are sub-second to sub-10s", () => {
    expect(T.RECOVER_DEBOUNCE_MS).toBeGreaterThan(100);
    expect(T.RECOVER_DEBOUNCE_MS).toBeLessThan(10_000);

    expect(T.SIDEBAR_DEBOUNCE_SAVE_MS).toBeGreaterThan(50);
    expect(T.SIDEBAR_DEBOUNCE_SAVE_MS).toBeLessThan(2000);
  });

  it("tool burst: collapsing should be <= settling", () => {
    // The collapse animation must finish before we collapse the next one.
    expect(T.TOOL_BURST_COLLAPSING_MS).toBeLessThanOrEqual(T.TOOL_BURST_SETTLING_MS);
  });

  it("long press is between 200ms and 2s (human-feasible)", () => {
    expect(T.LONG_PRESS_MS).toBeGreaterThan(200);
    expect(T.LONG_PRESS_MS).toBeLessThan(2000);
  });

  it("all constants are positive integers", () => {
    for (const [name, value] of Object.entries(T)) {
      expect(typeof value, `${name} should be a number`).toBe("number");
      expect(Number.isInteger(value), `${name} should be an integer ms value`).toBe(true);
      expect(value, `${name} should be positive`).toBeGreaterThan(0);
    }
  });

  it("archive threshold is exactly 1 hour", () => {
    expect(T.ARCHIVE_THRESHOLD_MS).toBe(60 * 60 * 1000);
  });
});
