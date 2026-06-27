import { describe, it, expect, vi, beforeAll } from "vitest";
import { HistoryController } from "../history-controller";
import type { PromptInputSnapshot } from "$lib/types";

// jsdom-style shim: vitest uses node env by default, so rAF is missing
beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(
        () => cb(Date.now()),
        0,
      ) as unknown as number) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as typeof globalThis.cancelAnimationFrame;
  }
});

function makeDeps(
  opts: {
    userHistory?: string[];
    scopeKey?: string;
    initialText?: string;
  } = {},
) {
  const userHistory = opts.userHistory ?? ["first prompt", "second prompt", "third prompt"];
  let scopeKey = opts.scopeKey ?? "run-1";
  let inputText = opts.initialText ?? "";
  let attachments: unknown[] = [];
  let pastedBlocks: unknown[] = [];
  const setInputText = vi.fn((s: string) => {
    inputText = s;
  });
  const getInputText = () => inputText;
  const setAttachments = vi.fn((a: unknown[]) => {
    attachments = a;
  });
  const getAttachments = () => attachments;
  const setPastedBlocks = vi.fn((b: unknown[]) => {
    pastedBlocks = b;
  });
  const getPastedBlocks = () => pastedBlocks;
  const scheduleAutoResize = vi.fn();
  const getSnapshot = vi.fn(
    (): PromptInputSnapshot => ({
      text: inputText,
      attachments: [],
      pastedBlocks: [],
      pathRefs: [],
    }),
  );
  const restoreSnapshot = vi.fn((snap: PromptInputSnapshot) => {
    inputText = snap.text;
    attachments = snap.attachments as unknown[];
    pastedBlocks = snap.pastedBlocks as unknown[];
  });
  const getTextareaEl = () => undefined;

  const deps = {
    getInputText,
    setInputText,
    getSnapshot,
    restoreSnapshot,
    getPastedBlocks,
    setPastedBlocks,
    getAttachments,
    setAttachments,
    getTextareaEl,
    scheduleAutoResize,
    userHistory: () => userHistory,
    scopeKey: () => scopeKey,
    setScopeKey: (s: string) => {
      scopeKey = s;
    },
  };

  return {
    deps,
    spies: { setInputText, setAttachments, setPastedBlocks, getSnapshot, restoreSnapshot },
  };
}

describe("HistoryController.syncScope", () => {
  it("resets on initial scope", () => {
    const { deps } = makeDeps();
    const ctl = new HistoryController(deps);
    expect(ctl.syncScope()).toBe(true);
  });

  it("returns false on subsequent calls with same scope", () => {
    const { deps } = makeDeps();
    const ctl = new HistoryController(deps);
    ctl.syncScope();
    expect(ctl.syncScope()).toBe(false);
  });

  it("resets when scope key changes", () => {
    const ref = makeDeps({ scopeKey: "run-1" });
    const ctl = new HistoryController(ref.deps);
    ctl.syncScope();
    expect(ctl.syncScope()).toBe(false);
    ref.deps.setScopeKey("run-2");
    expect(ctl.syncScope()).toBe(true);
  });
});

describe("HistoryController.handleKey (single-line)", () => {
  it("ignores Up/Down when no history", () => {
    const { deps } = makeDeps({ userHistory: [] });
    const ctl = new HistoryController(deps);
    const handled = ctl.handleKey("ArrowUp", { atMenuOpen: false, slashMenuOpen: false });
    expect(handled).toBe(false);
  });

  it("rejects Up/Down when at menu is open", () => {
    const { deps } = makeDeps();
    const ctl = new HistoryController(deps);
    const handled = ctl.handleKey("ArrowUp", { atMenuOpen: true, slashMenuOpen: false });
    expect(handled).toBe(false);
  });
});

describe("HistoryController.apply (synthetic)", () => {
  it("captures draft and applies history entry on enter action", () => {
    const { deps, spies } = makeDeps();
    const ctl = new HistoryController(deps);
    ctl.syncScope();

    ctl.apply({ type: "enter", index: 0 });
    expect(spies.getSnapshot).toHaveBeenCalled();
    expect(spies.setInputText).toHaveBeenLastCalledWith("first prompt");
    expect(spies.setAttachments).toHaveBeenLastCalledWith([]);
    expect(spies.setPastedBlocks).toHaveBeenLastCalledWith([]);
  });

  it("restore-draft restores the previously captured snapshot", () => {
    const { deps, spies } = makeDeps({ initialText: "my draft" });
    const ctl = new HistoryController(deps);
    ctl.syncScope();
    ctl.apply({ type: "enter", index: 0 });
    spies.setInputText.mockClear();
    ctl.apply({ type: "restore-draft" });
    expect(spies.restoreSnapshot).toHaveBeenCalled();
    expect(deps.getInputText()).toBe("my draft");
  });

  it("boundary action is a no-op", () => {
    const { deps, spies } = makeDeps();
    const ctl = new HistoryController(deps);
    ctl.syncScope();
    ctl.apply({ type: "boundary" });
    expect(spies.setInputText).not.toHaveBeenCalled();
  });

  it("stale index resets", () => {
    const { deps, spies } = makeDeps();
    const ctl = new HistoryController(deps);
    ctl.syncScope();
    ctl.apply({ type: "enter", index: 0 });
    spies.setInputText.mockClear();
    ctl.apply({ type: "up", index: 99 });
    // no setInputText because the stale-index guard resets
    expect(spies.setInputText).not.toHaveBeenCalled();
  });
});
