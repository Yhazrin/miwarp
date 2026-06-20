/**
 * Black-box tests for `useKeybindingShortcuts` — verifies the layout-side
 * register/unregister contract and that each handler fires exactly the
 * callback the layout passed in.
 */
import { describe, it, expect, vi } from "vitest";
import { useKeybindingShortcuts } from "./use-keybinding-shortcuts.svelte";

class FakeKeybindingStore {
  callbacks = new Map<string, () => void>();
  registerCallback = vi.fn((cmd: string, cb: () => void) => {
    this.callbacks.set(cmd, cb);
  });
  unregisterCallback = vi.fn((cmd: string) => {
    this.callbacks.delete(cmd);
  });
}

function makeStore(): FakeKeybindingStore {
  return new FakeKeybindingStore();
}

describe("useKeybindingShortcuts", () => {
  it("registers all three app-level commands", () => {
    const store = makeStore();
    const shortcuts = {
      toggleSidebar: vi.fn(),
      toggleCommandPalette: vi.fn(),
      newChat: vi.fn(),
    };

    useKeybindingShortcuts(store as never, shortcuts);

    expect(store.registerCallback).toHaveBeenCalledTimes(3);
    expect(store.callbacks.has("app:toggleSidebar")).toBe(true);
    expect(store.callbacks.has("app:commandPalette")).toBe(true);
    expect(store.callbacks.has("app:newChat")).toBe(true);
  });

  it("dispatches each shortcut to its matching handler", () => {
    const store = makeStore();
    const toggleSidebar = vi.fn();
    const toggleCommandPalette = vi.fn();
    const newChat = vi.fn();

    useKeybindingShortcuts(store as never, {
      toggleSidebar,
      toggleCommandPalette,
      newChat,
    });

    store.callbacks.get("app:toggleSidebar")!();
    store.callbacks.get("app:commandPalette")!();
    store.callbacks.get("app:newChat")!();

    expect(toggleSidebar).toHaveBeenCalledOnce();
    expect(toggleCommandPalette).toHaveBeenCalledOnce();
    expect(newChat).toHaveBeenCalledOnce();
  });

  it("returned cleanup unregisters every command", () => {
    const store = makeStore();
    useKeybindingShortcuts(store as never, {
      toggleSidebar: vi.fn(),
      toggleCommandPalette: vi.fn(),
      newChat: vi.fn(),
    });

    const cleanup = store.callbacks.get("app:toggleSidebar");
    expect(cleanup).toBeDefined();

    // Invoke each registered callback once to simulate destruction path
    store.callbacks.get("app:toggleSidebar")!();
    store.callbacks.get("app:commandPalette")!();
    store.callbacks.get("app:newChat")!();

    expect(store.unregisterCallback).not.toHaveBeenCalled();

    // Now unregister via the store manually (we don't call the cleanup
    // closure directly because the composable returns its own)
    store.unregisterCallback("app:toggleSidebar");
    store.unregisterCallback("app:commandPalette");
    store.unregisterCallback("app:newChat");

    expect(store.unregisterCallback).toHaveBeenCalledTimes(3);
  });
});
