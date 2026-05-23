import { describe, it, expect, afterEach } from "vitest";
import { isSessionDragActive, setSessionDragActive } from "./session-drag-state";

describe("session-drag-state", () => {
  afterEach(() => {
    setSessionDragActive(false);
  });

  it("tracks active session drag flag", () => {
    expect(isSessionDragActive()).toBe(false);
    setSessionDragActive(true);
    expect(isSessionDragActive()).toBe(true);
    setSessionDragActive(false);
    expect(isSessionDragActive()).toBe(false);
  });
});
