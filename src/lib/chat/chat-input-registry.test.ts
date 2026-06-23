import { afterEach, describe, expect, it } from "vitest";
import {
  getChatInputHandle,
  setChatInputHandle,
  type ChatInputHandle,
} from "./chat-input-registry";

afterEach(() => {
  // Always leave the registry in a clean state for the next test.
  setChatInputHandle(undefined);
});

describe("chat-input-registry", () => {
  it("returns undefined when nothing has been registered", () => {
    expect(getChatInputHandle()).toBeUndefined();
  });

  it("exposes the most recently registered handle to consumers", () => {
    const handle: ChatInputHandle = {
      setValue: () => undefined,
      focus: () => undefined,
    };
    setChatInputHandle(handle);
    expect(getChatInputHandle()).toBe(handle);

    const next: ChatInputHandle = {
      setValue: () => undefined,
      focus: () => undefined,
    };
    setChatInputHandle(next);
    expect(getChatInputHandle()).toBe(next);
  });

  it("clears the registry when set to undefined", () => {
    setChatInputHandle({ setValue: () => undefined, focus: () => undefined });
    expect(getChatInputHandle()).toBeDefined();
    setChatInputHandle(undefined);
    expect(getChatInputHandle()).toBeUndefined();
  });
});
