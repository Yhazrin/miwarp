import { describe, it, expect, vi } from "vitest";
import {
  TextInputController,
  hasKeyboardControlChars,
  stripKeyboardControlChars,
  mapIndexAfterStrip,
} from "../text-input-controller";

function makeDeps() {
  const setInputText = vi.fn();
  const onAfterSanitize = vi.fn();
  const onArrowNav = vi.fn(() => false);
  const onEnter = vi.fn(() => true);
  const onEscape = vi.fn(() => true);
  const onShortcutHelp = vi.fn(() => true);
  const hasContent = vi.fn(() => false);

  return {
    getInputText: () => "hi\x1d",
    setInputText,
    getTextareaEl: () => undefined,
    hasContent,
    router: { onArrowNav, onEnter, onEscape, onShortcutHelp },
    onAfterSanitize,
    mocks: {
      setInputText,
      onAfterSanitize,
      onArrowNav,
      onEnter,
      onEscape,
      onShortcutHelp,
      hasContent,
    },
  };
}

describe("hasKeyboardControlChars", () => {
  it("returns false for normal text", () => {
    expect(hasKeyboardControlChars("hello world")).toBe(false);
  });
  it("detects C0 control characters", () => {
    expect(hasKeyboardControlChars("hi\x1d")).toBe(true);
  });
  it("detects C1 control characters", () => {
    expect(hasKeyboardControlChars("hi\x7f")).toBe(true);
  });
  it("detects private-use characters", () => {
    expect(hasKeyboardControlChars("hi\uf700")).toBe(true);
  });
  it("detects ANSI arrow escape", () => {
    expect(hasKeyboardControlChars("hi\x1b[A")).toBe(true);
  });
  it("preserves newlines and tabs", () => {
    expect(hasKeyboardControlChars("hi\nthere\tfriend")).toBe(false);
  });
});

describe("stripKeyboardControlChars", () => {
  it("strips private-use and C0 controls, preserves text", () => {
    expect(stripKeyboardControlChars("a\uf700b\x1dc")).toBe("abc");
  });
  it("strips ANSI arrow escape", () => {
    expect(stripKeyboardControlChars("foo\x1b[Abar")).toBe("foobar");
  });
  it("preserves CJK characters and emoji", () => {
    expect(stripKeyboardControlChars("你好世界")).toBe("你好世界");
  });
});

describe("mapIndexAfterStrip", () => {
  it("returns the cleaned index after stripping", () => {
    // raw = "a\u{f700}b" (positions 0='a', 1=pua, 2='b')
    // After strip → "ab" (cleaned positions 0='a', 1='b')
    const raw = "a\uf700b";
    expect(mapIndexAfterStrip(raw, 0)).toBe(0); // before 'a'
    expect(mapIndexAfterStrip(raw, 1)).toBe(1); // before pua → after 'a'
    expect(mapIndexAfterStrip(raw, 2)).toBe(1); // after pua → still after 'a'
    expect(mapIndexAfterStrip(raw, 3)).toBe(2); // after 'b'
  });

  it("strips ANSI arrow escapes", () => {
    const raw = "x\x1b[Ay";
    expect(stripKeyboardControlChars(raw)).toBe("xy");
    expect(mapIndexAfterStrip(raw, 0)).toBe(0);
    expect(mapIndexAfterStrip(raw, 1)).toBe(1);
    expect(mapIndexAfterStrip(raw, 4)).toBe(1);
    expect(mapIndexAfterStrip(raw, 5)).toBe(2);
  });
});

describe("TextInputController.handleInput", () => {
  it("sanitizes control chars and dispatches onAfterSanitize with cleaned text", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    ctl.handleInput(undefined);
    expect(deps.setInputText).toHaveBeenCalledWith("hi");
    expect(deps.onAfterSanitize).toHaveBeenCalledWith("hi");
  });

  it("does not sanitize during IME composition", () => {
    const deps = makeDeps();
    // During IME, the input text is already clean (it's raw text after composition end)
    deps.getInputText = () => "x";
    const ctl = new TextInputController(deps);
    ctl.handleInput({ isComposing: true } as unknown as InputEvent);
    expect(deps.setInputText).not.toHaveBeenCalled();
    expect(deps.onAfterSanitize).toHaveBeenCalledWith("x");
  });
});

describe("TextInputController.handleKeydown", () => {
  function makeKeyEvent(key: string, props: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key,
      isComposing: false,
      keyCode: 0,
      shiftKey: false,
      preventDefault: vi.fn(),
      ...props,
    } as unknown as KeyboardEvent;
  }

  it("skips during IME composition (keyCode 229)", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    const e = makeKeyEvent("Enter", { isComposing: true, keyCode: 229 });
    ctl.handleKeydown(e);
    expect(deps.router.onEnter).not.toHaveBeenCalled();
  });

  it("dispatches Enter to router and preventDefaults when handled", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    const e = makeKeyEvent("Enter", { shiftKey: false });
    ctl.handleKeydown(e);
    expect(deps.router.onEnter).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("does not dispatch Enter on Shift+Enter", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    const e = makeKeyEvent("Enter", { shiftKey: true });
    ctl.handleKeydown(e);
    expect(deps.router.onEnter).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("dispatches ArrowUp to router", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    const e = makeKeyEvent("ArrowUp");
    ctl.handleKeydown(e);
    expect(deps.router.onArrowNav).toHaveBeenCalledWith("ArrowUp");
  });

  it("dispatches Escape to router", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    const e = makeKeyEvent("Escape");
    ctl.handleKeydown(e);
    expect(deps.router.onEscape).toHaveBeenCalled();
  });

  it("forwards ? shortcut to router when input is empty", () => {
    const deps = makeDeps();
    deps.mocks.hasContent.mockReturnValue(false);
    const ctl = new TextInputController(deps);
    const e = makeKeyEvent("?");
    ctl.handleKeydown(e);
    expect(deps.router.onShortcutHelp).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("does not forward ? shortcut when input has content", () => {
    const deps = makeDeps();
    deps.mocks.hasContent.mockReturnValue(true);
    const ctl = new TextInputController(deps);
    const e = makeKeyEvent("?");
    ctl.handleKeydown(e);
    expect(deps.router.onShortcutHelp).not.toHaveBeenCalled();
  });
});

describe("TextInputController.handleBeforeInput", () => {
  it("rejects beforeinput with control characters", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    const e = {
      isComposing: false,
      data: "x\x1d",
      inputType: "insertText",
      preventDefault: vi.fn(),
    } as unknown as InputEvent;
    ctl.handleBeforeInput(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("allows normal beforeinput", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    const e = {
      isComposing: false,
      data: "hello",
      inputType: "insertText",
      preventDefault: vi.fn(),
    } as unknown as InputEvent;
    ctl.handleBeforeInput(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores IME composition beforeinput", () => {
    const deps = makeDeps();
    const ctl = new TextInputController(deps);
    const e = {
      isComposing: true,
      data: "x",
      inputType: "insertCompositionText",
      preventDefault: vi.fn(),
    } as unknown as InputEvent;
    ctl.handleBeforeInput(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
