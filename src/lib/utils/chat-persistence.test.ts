/**
 * Tests for the chat persistence helper.
 */
import { describe, expect, it } from "vitest";

describe("chat-persistence", () => {
  it("readActiveSessionId returns '' when localStorage is unavailable", async () => {
    // jsdom-free vitest environment; the module already guards for
    // `typeof localStorage === "undefined"`. Verify the contract.
    const { readActiveSessionId } = await import("./chat-persistence");
    expect(readActiveSessionId()).toBe("");
  });

  it("write + clear are no-ops when localStorage is unavailable", async () => {
    const { writeActiveSessionId, clearActiveSessionId, readActiveSessionId } =
      await import("./chat-persistence");
    expect(() => writeActiveSessionId("run-1")).not.toThrow();
    expect(() => clearActiveSessionId()).not.toThrow();
    expect(readActiveSessionId()).toBe("");
  });
});
