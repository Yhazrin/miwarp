import { describe, it, expect, vi, beforeAll } from "vitest";
import { SubmitController } from "../submit-controller";
import type { PendingAttachment } from "$lib/stores/prompt-input-store.svelte";
import type { PromptInputSnapshot } from "$lib/types";

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
    inputText?: string;
    attachments?: Array<{
      id: string;
      name: string;
      type: string;
      size: number;
      contentBase64?: string;
      filePath?: string;
    }>;
    pastedBlocks?: Array<{ id: string; text: string }>;
    pathRefs?: Array<{ id: string; path: string }>;
    isBusy?: boolean;
    isDisabled?: boolean;
    onSend?: (
      text: string,
      atts: Array<{ name: string; type: string; size: number; contentBase64: string }>,
    ) => Promise<void> | void;
    onBtwSend?: (q: string) => void;
    onModelSwitch?: (m: string) => void;
    onVirtualCommand?: (a: string, args: string) => void;
  } = {},
) {
  let inputText = opts.inputText ?? "";
  const setInputText = vi.fn((s: string) => {
    inputText = s;
  });
  let attachments: PendingAttachment[] = (opts.attachments ?? []) as PendingAttachment[];
  let pastedBlocks: unknown[] = opts.pastedBlocks ?? [];
  let pathRefs: unknown[] = opts.pathRefs ?? [];
  const getInputText = () => inputText;
  const setAttachments = vi.fn((a: PendingAttachment[]) => {
    attachments = a;
  });
  const getAttachments = () => attachments;
  const setPastedBlocks = vi.fn((b: unknown[]) => {
    pastedBlocks = b;
  });
  const getPastedBlocks = () => pastedBlocks;
  const setPathRefs = vi.fn((r: unknown[]) => {
    pathRefs = r;
  });
  const getPathRefs = () => pathRefs;
  const getSnapshot = vi.fn(
    (): PromptInputSnapshot => ({
      text: inputText,
      attachments: attachments as PromptInputSnapshot["attachments"],
      pastedBlocks: pastedBlocks as PromptInputSnapshot["pastedBlocks"],
      pathRefs: pathRefs as PromptInputSnapshot["pathRefs"],
    }),
  );
  const restoreSnapshot = vi.fn((snap: PromptInputSnapshot) => {
    inputText = snap.text;
    attachments = snap.attachments;
    pastedBlocks = snap.pastedBlocks;
    pathRefs = snap.pathRefs ?? [];
  });
  const onSend = opts.onSend ?? vi.fn();
  return {
    deps: {
      getInputText,
      setInputText,
      getAttachments,
      setAttachments,
      getPastedBlocks,
      setPastedBlocks,
      getPathRefs,
      setPathRefs,
      getTextareaEl: () => undefined,
      getSnapshot,
      restoreSnapshot,
      onSend,
      onBtwSend: opts.onBtwSend,
      onModelSwitch: opts.onModelSwitch,
      onVirtualCommand: opts.onVirtualCommand,
      goto: vi.fn(),
      resetHistory: vi.fn(),
      scheduleAutoResize: vi.fn(),
      isBusy: () => opts.isBusy ?? false,
      isDisabled: () => opts.isDisabled ?? false,
    },
    spies: {
      setInputText,
      setAttachments,
      setPastedBlocks,
      setPathRefs,
      getSnapshot,
      restoreSnapshot,
      onSend,
    },
  };
}

describe("SubmitController.canSend", () => {
  it("returns true when input text is non-empty", () => {
    const { deps } = makeDeps({ inputText: "hello" });
    const ctl = new SubmitController(deps);
    expect(ctl.canSend()).toBe(true);
  });

  it("returns false when input is empty and no attachments", () => {
    const { deps } = makeDeps({ inputText: "" });
    const ctl = new SubmitController(deps);
    expect(ctl.canSend()).toBe(false);
  });

  it("returns false when disabled or busy", () => {
    const { deps: d1 } = makeDeps({ inputText: "hi", isDisabled: true });
    expect(new SubmitController(d1).canSend()).toBe(false);
    const { deps: d2 } = makeDeps({ inputText: "hi", isBusy: true });
    expect(new SubmitController(d2).canSend()).toBe(false);
  });

  it("returns true with paste blocks even when text empty", () => {
    const { deps } = makeDeps({ pastedBlocks: [{ id: "1", text: "x" }] });
    const ctl = new SubmitController(deps);
    expect(ctl.canSend()).toBe(true);
  });

  it("returns true with path-ref attachment even when text empty", () => {
    const { deps } = makeDeps({
      attachments: [
        { id: "1", name: "f.pdf", type: "application/pdf", size: 100, filePath: "/tmp/f.pdf" },
      ],
    });
    const ctl = new SubmitController(deps);
    expect(ctl.canSend()).toBe(true);
  });
});

describe("SubmitController.send — virtual commands", () => {
  it("intercepts /model <value> and calls onModelSwitch", () => {
    const onModelSwitch = vi.fn();
    const { deps, spies } = makeDeps({
      inputText: "/model opus-4-1",
      onModelSwitch,
    });
    const ctl = new SubmitController(deps);
    ctl.send();
    expect(onModelSwitch).toHaveBeenCalledWith("opus-4-1");
    expect(spies.setInputText).toHaveBeenCalledWith("");
    expect(spies.onSend).not.toHaveBeenCalled();
  });

  it("intercepts /btw <question> and calls onBtwSend", () => {
    const onBtwSend = vi.fn();
    const { deps, spies } = makeDeps({
      inputText: "/btw what is the weather?",
      onBtwSend,
    });
    const ctl = new SubmitController(deps);
    ctl.send();
    expect(onBtwSend).toHaveBeenCalledWith("what is the weather?");
    expect(spies.onSend).not.toHaveBeenCalled();
  });

  it("intercepts /copy virtual command and calls onVirtualCommand", () => {
    const onVirtualCommand = vi.fn();
    const { deps, spies } = makeDeps({
      inputText: "/copy",
      onVirtualCommand,
    });
    const ctl = new SubmitController(deps);
    ctl.send();
    expect(onVirtualCommand).toHaveBeenCalledWith("copy-last", "");
    expect(spies.onSend).not.toHaveBeenCalled();
  });

  it("intercepts /help virtual command (action handler)", () => {
    const onVirtualCommand = vi.fn();
    const { deps, spies } = makeDeps({
      inputText: "/help",
      onVirtualCommand,
    });
    const ctl = new SubmitController(deps);
    ctl.send();
    expect(onVirtualCommand).toHaveBeenCalled();
    expect(spies.onSend).not.toHaveBeenCalled();
  });
});

describe("SubmitController.send — clear & restore", () => {
  it("clears input + attachments + paste blocks + path refs after accepted send", async () => {
    const { deps, spies } = makeDeps({
      inputText: "hello",
      attachments: [
        { id: "a1", name: "x.png", type: "image/png", size: 100, contentBase64: "BASE64" },
      ],
      pastedBlocks: [{ id: "p1", text: "pasted" }],
    });
    const ctl = new SubmitController(deps);
    ctl.send();
    // The submit controller calls onSend via Promise.resolve().then(...).
    // Microtask + setTimeout(0) is enough to drain that.
    await new Promise((r) => setTimeout(r, 5));
    expect(spies.setInputText).toHaveBeenCalledWith("");
    expect(spies.setAttachments).toHaveBeenCalledWith([]);
    expect(spies.setPastedBlocks).toHaveBeenCalledWith([]);
    expect(spies.setPathRefs).toHaveBeenCalledWith([]);
    expect(spies.onSend).toHaveBeenCalledWith("pasted\n\nhello", [
      { name: "x.png", type: "image/png", size: 100, contentBase64: "BASE64" },
    ]);
  });

  it("restores draft on send failure", async () => {
    const onSend = vi.fn(() => Promise.reject(new Error("send failed")));
    const { deps, spies } = makeDeps({
      inputText: "draft",
      pastedBlocks: [{ id: "p1", text: "pasted" }],
      onSend,
    });
    const ctl = new SubmitController(deps);
    ctl.send();
    await new Promise((r) => setTimeout(r, 0));
    expect(spies.restoreSnapshot).toHaveBeenCalled();
  });

  it("does not call onSend when busy", () => {
    const onSend = vi.fn();
    const { deps, spies } = makeDeps({ inputText: "hi", isBusy: true, onSend });
    const ctl = new SubmitController(deps);
    ctl.send();
    expect(spies.onSend).not.toHaveBeenCalled();
  });
});

describe("SubmitController.btwSend", () => {
  it("clears input and forwards to onBtwSend", () => {
    const onBtwSend = vi.fn();
    const { deps, spies } = makeDeps({ inputText: "side question", onBtwSend });
    const ctl = new SubmitController(deps);
    ctl.btwSend();
    expect(spies.setInputText).toHaveBeenCalledWith("");
    expect(onBtwSend).toHaveBeenCalledWith("side question");
  });

  it("is a no-op when question is empty", () => {
    const onBtwSend = vi.fn();
    const { deps, spies } = makeDeps({ inputText: "  ", onBtwSend });
    const ctl = new SubmitController(deps);
    ctl.btwSend();
    expect(spies.setInputText).not.toHaveBeenCalled();
    expect(onBtwSend).not.toHaveBeenCalled();
  });
});
