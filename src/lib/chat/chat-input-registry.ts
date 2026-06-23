/**
 * chat-input-registry — a small bridge so deep components (like the
 * MermaidInteractive popover inside a chat message) can talk to the
 * session's prompt input without prop-drilling through every layer.
 *
 * The chat route registers the live `PromptInput` handle once it mounts;
 * non-chat routes leave it undefined and consumers fall back to clipboard-
 * only flows. This is a module-level ref holder on purpose — same pattern
 * as `session-store.svelte.ts`'s `sessionStore` singleton.
 */

export interface ChatInputHandle {
  setValue(text: string): void;
  focus(): void;
}

let current: ChatInputHandle | undefined;

export function setChatInputHandle(next: ChatInputHandle | undefined): void {
  current = next;
}

export function getChatInputHandle(): ChatInputHandle | undefined {
  return current;
}
