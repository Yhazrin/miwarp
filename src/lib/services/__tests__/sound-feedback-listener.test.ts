import { describe, expect, it } from "vitest";

/** Mirrors idle/completed debounce logic in sound-feedback-listener. */
function consumeActiveTurn(active: Set<string>, runId: string): boolean {
  return active.delete(runId);
}

describe("sound-feedback-listener turn tracking", () => {
  it("plays completion only after a running turn", () => {
    const active = new Set<string>();
    expect(consumeActiveTurn(active, "run-1")).toBe(false);
    active.add("run-1");
    expect(consumeActiveTurn(active, "run-1")).toBe(true);
    expect(consumeActiveTurn(active, "run-1")).toBe(false);
  });
});
