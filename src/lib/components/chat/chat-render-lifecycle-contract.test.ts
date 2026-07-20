import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inputDockSource = readFileSync(new URL("./ChatInputDock.svelte", import.meta.url), "utf8");

describe("chat render lifecycle contract", () => {
  it("keeps the prompt mounted while a session is loading", () => {
    expect(inputDockSource.match(/^\s*<PromptInput\s*$/gm)).toHaveLength(1);
    expect(inputDockSource).not.toContain(
      '{#if store.sessionAlive || !store.run || store.phase === "empty"',
    );
    expect(inputDockSource).toContain(
      'disabled={inputBlockedByPermission || store.phase === "loading"}',
    );
  });
});
