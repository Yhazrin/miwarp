import { describe, expect, it } from "vitest";
import {
  containsDisallowedPromptControls,
  isPromptNavigationKey,
  misencodedNavigationDirection,
  sanitizePromptText,
} from "../prompt-text";

describe("sanitizePromptText", () => {
  it("preserves normal text and newlines", () => {
    expect(sanitizePromptText("hello\nworld\t!")).toBe("hello\nworld\t!");
  });

  it("strips GS (0x1d) control characters", () => {
    const poisoned = "a\u001db\u001d";
    expect(sanitizePromptText(poisoned)).toBe("ab");
    expect(containsDisallowedPromptControls(poisoned)).toBe(true);
  });

  it("strips C1 controls", () => {
    expect(sanitizePromptText("x\u009dy")).toBe("xy");
  });
});

describe("misencodedNavigationDirection", () => {
  it("detects ArrowRight misreported as \\x1d", () => {
    const e = {
      key: "\u001d",
      keyCode: 39,
      which: 39,
      length: 1,
    } as unknown as KeyboardEvent;
    expect(misencodedNavigationDirection(e)).toBe("right");
  });

  it("does not treat printable keys as navigation", () => {
    const e = { key: "a", keyCode: 65, which: 65, length: 1 } as unknown as KeyboardEvent;
    expect(misencodedNavigationDirection(e)).toBeNull();
  });
});

describe("isPromptNavigationKey", () => {
  it("recognizes arrow key names and legacy key codes", () => {
    expect(isPromptNavigationKey({ key: "ArrowRight", keyCode: 39 } as KeyboardEvent)).toBe(true);
    expect(isPromptNavigationKey({ key: "x", keyCode: 39 } as KeyboardEvent)).toBe(true);
  });
});
