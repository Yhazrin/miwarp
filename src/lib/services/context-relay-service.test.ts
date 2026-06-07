/**
 * Unit tests for the context relay pipeline.
 * Pure functions only — store-side reactivity is covered by Svelte's own
 * test suite. We deliberately do NOT instantiate the Svelte store class
 * here, because $state needs a Svelte component context.
 */
import { describe, expect, it } from "vitest";
import { buildClipDraft, readActiveSelection } from "./context-clip-builder";
import { relayTextToStore } from "./context-relay-service";

describe("context-relay", () => {
  it("buildClipDraft trims and bounds long input", () => {
    const long = "x".repeat(10_000);
    const draft = buildClipDraft({ text: `  ${long}  `, source: "manual" });
    expect(draft.text.length).toBe(8000);
    expect(draft.text.startsWith(" ")).toBe(false);
  });

  it("buildClipDraft throws on empty", () => {
    expect(() => buildClipDraft({ text: "   ", source: "manual" })).toThrow();
  });

  it("readActiveSelection returns '' outside the browser", () => {
    expect(readActiveSelection()).toBe("");
  });

  it("relayTextToStore returns false on whitespace", () => {
    expect(relayTextToStore("   ", { source: "chat-bubble" })).toBe(false);
  });
});
