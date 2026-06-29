import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// [R1-B] Verifies the picker store honors user picks across `applyDefault`
// calls (the bug it replaces: local $state in ChatConversationStage was
// overwritten by the probe effect whenever `welcomeVisible` toggled).
import { runtimePickerStore } from "./runtime-picker-store.svelte";

describe("runtimePickerStore", () => {
  beforeEach(() => {
    // Reset between tests; class state lives on the singleton.
    runtimePickerStore.selected = "claude";
    runtimePickerStore.userPicked = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to claude", () => {
    expect(runtimePickerStore.selected).toBe("claude");
    expect(runtimePickerStore.userPicked).toBe(false);
  });

  it("select() flips userPicked and updates selected", () => {
    runtimePickerStore.select("codex");
    expect(runtimePickerStore.selected).toBe("codex");
    expect(runtimePickerStore.userPicked).toBe(true);
  });

  it("applyDefault() respects user picks (does not overwrite)", () => {
    runtimePickerStore.select("cursor");
    runtimePickerStore.applyDefault("claude");
    expect(runtimePickerStore.selected).toBe("cursor");
  });

  it("applyDefault() sets the default when user has not picked", () => {
    runtimePickerStore.applyDefault("mimo");
    expect(runtimePickerStore.selected).toBe("mimo");
    expect(runtimePickerStore.userPicked).toBe(false);
  });
});
