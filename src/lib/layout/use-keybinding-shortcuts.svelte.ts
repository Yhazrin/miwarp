/**
 * useKeybindingShortcuts — register the layout-level app keybinding callbacks
 * exactly once and tear them down on cleanup.
 *
 * Extracts the previously-inline `keybindingStore.registerCallback(...)` block
 * from `src/routes/+layout.svelte`'s `onMount` so that layout stays focused on
 * navigation/state and the binding surface area lives next to the other
 * `KeybindingStore` consumers.
 */
import type { KeybindingStore } from "$lib/stores/keybindings.svelte";

export type KeybindingShortcuts = {
  toggleSidebar: () => void;
  toggleCommandPalette: () => void;
  newChat: () => void;
};

export function useKeybindingShortcuts(
  store: KeybindingStore,
  shortcuts: KeybindingShortcuts,
): () => void {
  store.registerCallback("app:toggleSidebar", shortcuts.toggleSidebar);
  store.registerCallback("app:commandPalette", shortcuts.toggleCommandPalette);
  store.registerCallback("app:newChat", shortcuts.newChat);

  return () => {
    store.unregisterCallback("app:toggleSidebar");
    store.unregisterCallback("app:commandPalette");
    store.unregisterCallback("app:newChat");
  };
}
