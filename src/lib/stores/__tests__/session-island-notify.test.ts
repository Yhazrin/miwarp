import { describe, expect, it, vi } from "vitest";
import {
  pushSessionIslandNotify,
  registerSessionIslandNotify,
} from "$lib/stores/session-island-notify.svelte";

describe("session-island-notify", () => {
  it("returns false when chat page has not registered a listener", () => {
    registerSessionIslandNotify(null);
    expect(
      pushSessionIslandNotify({
        text: "Claude Code updated",
        tone: "info",
      }),
    ).toBe(false);
  });

  it("forwards payloads to the registered listener", () => {
    const listener = vi.fn();
    registerSessionIslandNotify(listener);

    expect(
      pushSessionIslandNotify({
        text: "Claude Code updated",
        tone: "info",
      }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      text: "Claude Code updated",
      tone: "info",
    });

    registerSessionIslandNotify(null);
  });
});
